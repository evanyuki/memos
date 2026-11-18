package v1

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/pkg/errors"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/internal/util"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func convertAttachmentFromStore(attachment *store.Attachment) *v1pb.Attachment {
	attachmentMessage := &v1pb.Attachment{
		Name:           fmt.Sprintf("%s%s", AttachmentNamePrefix, attachment.UID),
		CreateTime:     timestamppb.New(time.Unix(attachment.CreatedTs, 0)),
		Filename:       attachment.Filename,
		Type:           attachment.Type,
		Size:           attachment.Size,
		MotionMedia:    convertMotionMediaFromStore(getAttachmentMotionMedia(attachment)),
		MediaMetadata:  convertMediaMetadataFromStore(attachment.Payload.GetMediaMetadata()),
		AllowOriginal:  attachment.Payload.GetAllowOriginal(),
		LocationStatus: attachment.Payload.GetLocationStatus(),
	}
	// The file download is the explicit opt-in boundary. Gallery, memo, share
	// and SSR responses never publish the camera's coordinates.
	if photo := attachmentMessage.MediaMetadata.GetPhoto(); photo != nil {
		photo.Location = nil
	}
	if attachment.MemoUID != nil && *attachment.MemoUID != "" {
		memoName := fmt.Sprintf("%s%s", MemoNamePrefix, *attachment.MemoUID)
		attachmentMessage.Memo = &memoName
	}
	// Managed storage is always addressed through the authenticated file route.
	// In particular, never expose an expiring S3 presigned URL as attachment API
	// metadata because it can outlive a memo visibility change.
	if attachment.StorageType == storepb.AttachmentStorageType_EXTERNAL {
		attachmentMessage.ExternalLink = attachment.Reference
	}

	return attachmentMessage
}

// SaveAttachmentBlob saves the blob of attachment based on the storage config.
func SaveAttachmentBlob(ctx context.Context, profile *profile.Profile, stores *store.Store, create *store.Attachment) error {
	instanceStorageSetting, err := stores.GetInstanceStorageSetting(ctx)
	if err != nil {
		return errors.Wrap(err, "Failed to find instance storage setting")
	}

	defaultStorage := store.GetDefaultStorage(instanceStorageSetting)
	if defaultStorage == nil {
		return errors.New("default storage is not configured")
	}

	if defaultStorage.Type == storepb.StorageType_STORAGE_TYPE_LOCAL {
		template := instanceStorageSetting.FilepathTemplate
		if template == "" {
			template = "assets/{timestamp}_{uuid}_{filename}"
		}
		target := filepath.FromSlash(attachmentObjectPath(template, create))
		if !filepath.IsAbs(target) {
			target = filepath.Join(profile.Data, target)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return errors.Wrap(err, "create attachment directory")
		}
		file, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if os.IsExist(err) {
			ext := filepath.Ext(target)
			file, err = os.CreateTemp(filepath.Dir(target), strings.TrimSuffix(filepath.Base(target), ext)+"_*"+ext)
		}
		if err != nil {
			return errors.Wrap(err, "create attachment file")
		}
		_, writeErr := file.Write(create.Blob)
		closeErr := file.Close()
		if writeErr != nil || closeErr != nil {
			_ = os.Remove(file.Name())
			if writeErr != nil {
				return writeErr
			}
			return closeErr
		}
		create.Reference = filepath.ToSlash(file.Name())
		create.Blob = nil
		create.StorageType = storepb.AttachmentStorageType_LOCAL
	} else if defaultStorage.Type == storepb.StorageType_STORAGE_TYPE_S3 {
		driver, err := stores.StorageDriver(ctx, defaultStorage)
		if err != nil {
			return errors.Wrap(err, "failed to create storage driver")
		}

		filepathTemplate := attachmentObjectPath(instanceStorageSetting.FilepathTemplate, create)
		key, err := driver.UploadObject(ctx, filepathTemplate, create.Type, bytes.NewReader(create.Blob))
		if err != nil {
			return errors.Wrap(err, "failed to upload via storage driver")
		}

		// S3 attachments carry no reference; they are served via the authenticated file route.
		create.Blob = nil
		create.StorageType = storepb.AttachmentStorageType_S3
		if create.Payload == nil {
			create.Payload = &storepb.AttachmentPayload{}
		}
		create.Payload.Payload = &storepb.AttachmentPayload_S3Object_{
			S3Object: &storepb.AttachmentPayload_S3Object{
				Key:       key,
				StorageId: defaultStorage.Id,
			},
		}
	}

	return nil
}

// GetAttachmentBlob reads an attachment from its configured storage.
func (s *APIV1Service) GetAttachmentBlob(ctx context.Context, attachment *store.Attachment) ([]byte, error) {
	// For local storage, read the file from the local disk.
	if attachment.StorageType == storepb.AttachmentStorageType_LOCAL {
		attachmentPath := filepath.FromSlash(attachment.Reference)
		if !filepath.IsAbs(attachmentPath) {
			attachmentPath = filepath.Join(s.Profile.Data, attachmentPath)
		}

		file, err := os.Open(attachmentPath)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, errors.Wrap(err, "file not found")
			}
			return nil, errors.Wrap(err, "failed to open the file")
		}
		defer file.Close()
		blob, err := io.ReadAll(file)
		if err != nil {
			return nil, errors.Wrap(err, "failed to read the file")
		}
		return blob, nil
	}
	// For S3 storage, download the file from S3.
	if attachment.StorageType == storepb.AttachmentStorageType_S3 {
		driver, s3Object, err := s.Store.ResolveAttachmentS3Driver(ctx, attachment)
		if err != nil {
			return nil, errors.Wrap(err, "failed to resolve S3 attachment driver")
		}

		blob, err := driver.GetObject(ctx, s3Object.Key)
		if err != nil {
			return nil, errors.Wrap(err, "failed to get object from S3")
		}
		return blob, nil
	}
	// For database storage, return the blob from the database.
	return attachment.Blob, nil
}

var fileKeyPattern = regexp.MustCompile(`\{[a-z]{1,9}\}`)

func replaceFilenameWithPathTemplate(path, filename string) string {
	t := time.Now()
	path = fileKeyPattern.ReplaceAllStringFunc(path, func(s string) string {
		switch s {
		case "{filename}":
			return filename
		case "{timestamp}":
			return fmt.Sprintf("%d", t.Unix())
		case "{year}":
			return fmt.Sprintf("%d", t.Year())
		case "{month}":
			return fmt.Sprintf("%02d", t.Month())
		case "{day}":
			return fmt.Sprintf("%02d", t.Day())
		case "{hour}":
			return fmt.Sprintf("%02d", t.Hour())
		case "{minute}":
			return fmt.Sprintf("%02d", t.Minute())
		case "{second}":
			return fmt.Sprintf("%02d", t.Second())
		case "{uuid}":
			return util.GenUUID()
		default:
			return s
		}
	})
	return path
}

func attachmentObjectPath(template string, a *store.Attachment) string {
	if !strings.Contains(template, "{filename}") {
		template = filepath.ToSlash(filepath.Join(template, "{filename}"))
	}
	if a.IsCameraMedia() && !strings.Contains(template, "{uuid}") {
		template = strings.Replace(template, "{filename}", "{uuid}_{filename}", 1)
	}
	return replaceFilenameWithPathTemplate(template, a.Filename)
}

func validateFilename(filename string) bool {
	// Reject path traversal attempts and make sure no additional directories are created
	if !filepath.IsLocal(filename) || strings.ContainsAny(filename, "/\\") {
		return false
	}

	// Reject filenames starting or ending with spaces or periods
	if strings.HasPrefix(filename, " ") || strings.HasSuffix(filename, " ") ||
		strings.HasPrefix(filename, ".") || strings.HasSuffix(filename, ".") {
		return false
	}

	return true
}

func normalizeMimeType(mimeType string) (string, bool) {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" || len(mimeType) > 255 {
		return "", false
	}

	mediaType, _, err := mime.ParseMediaType(mimeType)
	if err != nil || mediaType == "" || len(mediaType) > 255 {
		return "", false
	}

	return mediaType, true
}
