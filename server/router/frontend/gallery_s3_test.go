package frontend

import (
	"context"
	"crypto/sha256"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/testutil"
	"github.com/usememos/memos/internal/testutil/fakes3"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

func TestGalleryS3OriginalPreservationAndMemoPermissionChange(t *testing.T) {
	f := newGalleryFixture(t)
	s3 := fakes3.New(t, "gallery-originals")
	ctx := context.Background()
	ownerCtx := f.service.CreateUserContext(ctx, f.owner.ID)
	_, err := f.service.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_STORAGE,
		Value: &storepb.InstanceSetting_StorageSetting{StorageSetting: &storepb.InstanceStorageSetting{
			DefaultStorageId: "gallery-s3", FilepathTemplate: "originals/{uuid}_{filename}", UploadSizeLimitMb: 30,
			Storages: []*storepb.Storage{{
				Id: "gallery-s3", Name: "Test S3", Type: storepb.StorageType_STORAGE_TYPE_S3,
				Config: &storepb.Storage_S3Config{S3Config: s3.Config("gallery-originals")},
			}},
		}},
	})
	require.NoError(t, err)
	_, err = f.service.Service.UpdateUserSetting(ownerCtx, &v1pb.UpdateUserSettingRequest{
		Setting: &v1pb.UserSetting{
			Name:  "users/" + f.owner.Username + "/settings/GENERAL",
			Value: &v1pb.UserSetting_GeneralSetting_{GeneralSetting: &v1pb.UserSetting_GeneralSetting{SaveMediaMetadata: true}},
		},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"save_media_metadata"}},
	})
	require.NoError(t, err)

	// The same live handler serves all requests before and after the upload.
	before := f.request(t, "/api/v1/gallery/photos", nil)
	require.Equal(t, 200, before.Code)
	require.JSONEq(t, `{"photos":[],"nextPageToken":""}`, before.Body.String())
	original := testutil.BuildPhotographyJPEG()
	var attachments []*v1pb.Attachment
	for _, filename := range []string{"first-photo.jpg", "second-photo.jpg"} {
		attachment, err := f.service.Service.CreateAttachment(ownerCtx, &v1pb.CreateAttachmentRequest{
			Attachment: &v1pb.Attachment{Filename: filename, Type: "image/jpeg", Content: original},
		})
		require.NoError(t, err)
		attachments = append(attachments, attachment)
		require.Empty(t, attachment.ExternalLink, "managed originals must not bypass memo permissions")
		metadata := attachment.GetMediaMetadata().GetPhoto()
		require.NotNil(t, metadata, "upload must extract metadata when the client did not supply any")
		require.Equal(t, "Display P3", metadata.IccProfile)
		uid := strings.TrimPrefix(attachment.Name, "attachments/")
		stored, err := f.service.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
		require.NoError(t, err)
		require.Equal(t, storepb.AttachmentStorageType_S3, stored.StorageType)
		require.Empty(t, stored.Blob)
		object, err := s3.GetObject("gallery-originals", stored.Payload.GetS3Object().Key)
		require.NoError(t, err)
		require.Equal(t, original, object)
		require.Equal(t, sha256.Sum256(original), sha256.Sum256(object))
	}
	before = f.request(t, "/api/v1/gallery/photos", nil)
	require.JSONEq(t, `{"photos":[],"nextPageToken":""}`, before.Body.String(), "unbound uploads must not appear")
	memo, err := f.service.Service.CreateMemo(ownerCtx, &v1pb.CreateMemoRequest{
		Memo: &v1pb.Memo{Content: "Original photography #landscape", Visibility: v1pb.Visibility_PUBLIC},
	})
	require.NoError(t, err)
	_, err = f.service.Service.SetMemoAttachments(ownerCtx, &v1pb.SetMemoAttachmentsRequest{Name: memo.Name, Attachments: attachments})
	require.NoError(t, err)
	after := f.request(t, "/api/v1/gallery/photos?visibility=PUBLIC", nil)
	require.Equal(t, 200, after.Code)
	for _, attachment := range attachments {
		require.Contains(t, after.Body.String(), attachment.Name)
	}
	require.Contains(t, after.Body.String(), `"iccProfile":"Display P3"`)
	require.NotContains(t, after.Body.String(), "test-secret-key")
	require.NotContains(t, after.Body.String(), s3.URL)

	download := func(path string, owner bool) *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		if owner {
			token, _, err := auth.GenerateAccessTokenV2(f.owner.ID, f.owner.Username, string(f.owner.Role), string(f.owner.RowStatus), []byte(f.service.Secret))
			require.NoError(t, err)
			req.Header.Set("Authorization", "Bearer "+token)
		}
		rec := httptest.NewRecorder()
		f.echo.ServeHTTP(rec, req)
		return rec
	}
	for _, attachment := range attachments {
		path := "/file/" + attachment.Name + "/" + url.PathEscape(attachment.Filename)
		response := download(path, false)
		require.Equal(t, 200, response.Code)
		require.Equal(t, original, response.Body.Bytes(), "S3 download must retain EXIF, ICC and MakerNote bytes")
		require.Equal(t, 200, download(path+"?thumbnail=true", false).Code)
		uid := strings.TrimPrefix(attachment.Name, "attachments/")
		page := f.request(t, "/gallery/photos/"+uid, nil)
		require.Equal(t, 200, page.Code)
		require.Contains(t, page.Body.String(), "Display P3")
	}

	// The visibility mutation applies to every attachment without rebuilding or restarting.
	_, err = f.service.Service.UpdateMemo(ownerCtx, &v1pb.UpdateMemoRequest{
		Memo:       &v1pb.Memo{Name: memo.Name, Visibility: v1pb.Visibility_PRIVATE},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"visibility"}},
	})
	require.NoError(t, err)
	for _, attachment := range attachments {
		uid := strings.TrimPrefix(attachment.Name, "attachments/")
		path := "/file/" + attachment.Name + "/" + url.PathEscape(attachment.Filename)
		for _, protected := range []string{path, path + "?thumbnail=true", "/gallery/photos/" + uid, "/api/v1/gallery/photos/" + uid} {
			response := download(protected, false)
			require.Equal(t, 401, response.Code, protected)
			require.Equal(t, "private, no-store", response.Header().Get("Cache-Control"))
			require.NotContains(t, response.Body.String(), "Display P3")
			require.Equal(t, 200, download(protected, true).Code, protected)
		}
		require.Equal(t, sha256.Sum256(original), sha256.Sum256(download(path, true).Body.Bytes()))
	}
	after = f.request(t, "/api/v1/gallery/photos?visibility=PUBLIC", nil)
	require.JSONEq(t, `{"photos":[],"nextPageToken":""}`, after.Body.String())
	after = f.request(t, "/api/v1/gallery/photos?visibility=PRIVATE", f.owner)
	for _, attachment := range attachments {
		require.Contains(t, after.Body.String(), attachment.Name)
	}
}
