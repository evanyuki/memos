package fileserver

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/aws/smithy-go"
	"github.com/labstack/echo/v5"
	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/photomedia"
	"github.com/usememos/memos/internal/storage"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/store"
)

func (s *FileServerService) servePhoto(ctx context.Context, c *echo.Context, a *store.Attachment, variant photomedia.Variant, public bool) error {
	key := a.PhotoKey(variant)
	tag := fmt.Sprintf(`W/"%x"`, sha256.Sum256([]byte(key)))
	headers := func() {
		if public {
			c.Response().Header().Set(echo.HeaderCacheControl, publicAttachmentCacheControl)
		}
		setSecurityHeaders(c)
		setMediaHeaders(c, variant.ContentType(a.Type), a.Type)
		c.Response().Header().Set("ETag", tag)
	}
	if a.Payload.GetPhotoPreviewVersion() == 1 && a.StorageType != storepb.AttachmentStorageType_EXTERNAL && variant != photomedia.Motion && photomedia.SupportsImage(a.Type) {
		for candidate := range strings.SplitSeq(c.Request().Header.Get("If-None-Match"), ",") {
			candidate = strings.TrimSpace(candidate)
			if candidate == "*" || strings.TrimPrefix(candidate, "W/") == strings.TrimPrefix(tag, "W/") {
				headers()
				return c.NoContent(http.StatusNotModified)
			}
		}
		if a.StorageType == storepb.AttachmentStorageType_S3 {
			driver, _, err := s.Store.ResolveAttachmentS3Driver(ctx, a)
			if err != nil {
				return err
			}
			requestRange := singleRangeHeader(c.Request().Header)
			if c.Request().Header.Get("If-Range") != "" {
				requestRange = ""
			}
			object, err := driver.GetObjectStream(ctx, key, requestRange)
			if err == nil {
				headers()
				return sendObjectStream(c, object, variant.ContentType(a.Type))
			}
			if !missingObject(err) {
				return objectStreamError(c, err)
			}
		}
	}
	data, err := s.photoBytes(ctx, a, variant, nil)
	if err != nil {
		if variant == photomedia.Thumbnail && canUseDisplayThumbnail(a, err) {
			// A cached WebP takes precedence. Without its encoder, serve the
			// sanitized display with its own content type, object key and ETag.
			return s.servePhoto(ctx, c, a, photomedia.Display, public)
		}
		slog.Warn("photo preview unavailable", "attachment", a.UID, "variant", variant, "error", err)
		c.Response().Header().Set("Retry-After", "5")
		return echo.NewHTTPError(http.StatusServiceUnavailable, "photo preview unavailable")
	}
	headers()
	http.ServeContent(c.Response(), c.Request(), a.Filename, time.Time{}, bytes.NewReader(data))
	return nil
}

func (s *FileServerService) photoBytes(ctx context.Context, a *store.Attachment, variant photomedia.Variant, original []byte) ([]byte, error) {
	key := a.PhotoKey(variant)
	wait := s.thumbnailGroup.DoChan(key, func() (any, error) {
		// A client navigating away must not cancel a copy needed by another viewer.
		job, cancel := context.WithTimeout(context.WithoutCancel(ctx), 2*time.Minute)
		defer cancel()
		var driver storage.Driver
		var err error
		local := filepath.Join(s.Profile.Data, filepath.FromSlash(key))
		if a.StorageType == storepb.AttachmentStorageType_S3 {
			driver, _, err = s.Store.ResolveAttachmentS3Driver(job, a)
			if err != nil {
				return nil, err
			}
			data, err := driver.GetObject(job, key)
			if err == nil {
				return data, nil
			}
			if !missingObject(err) {
				return nil, err
			}
		} else {
			data, err := os.ReadFile(local)
			if err == nil {
				return data, nil
			}
			if !os.IsNotExist(err) {
				return nil, err
			}
		}
		if variant == photomedia.Thumbnail && a.Type == "image/png" {
			if _, err := exec.LookPath("vips"); err != nil {
				return nil, err
			}
		}
		if err := s.thumbnailSemaphore.Acquire(job, 1); err != nil {
			return nil, err
		}
		defer s.thumbnailSemaphore.Release(1)
		var source io.Reader = bytes.NewReader(original)
		if original == nil {
			reader, err := s.getAttachmentReader(job, a)
			if err != nil {
				return nil, err
			}
			defer reader.Close()
			source = reader
		}
		data, location, err := photomedia.Render(job, source, a.Type, variant)
		if err != nil {
			return nil, err
		}
		if variant == photomedia.Display && string(location) != a.Payload.GetLocationStatus() {
			if err := s.Store.UpdateAttachment(job, &store.UpdateAttachment{ID: a.ID, PayloadPatch: map[string]any{"locationStatus": location}}); err != nil {
				return nil, err
			}
		}
		if driver != nil {
			_, err = driver.UploadObject(job, key, variant.ContentType(a.Type), bytes.NewReader(data))
		} else {
			err = saveLocalPhoto(local, data)
		}
		if err != nil {
			return nil, err
		}
		current, err := s.Store.GetAttachment(job, &store.FindAttachment{ID: &a.ID})
		if err != nil {
			return nil, err
		}
		if current == nil || current.PhotoKey(variant) != key {
			if driver != nil {
				err = driver.DeleteObject(job, key)
			} else {
				err = os.Remove(local)
			}
			if err != nil && !os.IsNotExist(err) {
				return nil, err
			}
			return nil, errors.New("photo was deleted during processing")
		}
		return data, nil
	})
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case result := <-wait:
		if result.Err != nil {
			return nil, result.Err
		}
		return result.Val.([]byte), nil
	}
}

func canUseDisplayThumbnail(a *store.Attachment, err error) bool {
	return a.Type == "image/png" && errors.Is(err, exec.ErrNotFound)
}

func missingObject(err error) bool {
	var apiErr smithy.APIError
	return errors.As(err, &apiErr) && (apiErr.ErrorCode() == "NoSuchKey" || apiErr.ErrorCode() == "NotFound")
}

func saveLocalPhoto(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".photo-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	_, writeErr := f.Write(data)
	closeErr := f.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
