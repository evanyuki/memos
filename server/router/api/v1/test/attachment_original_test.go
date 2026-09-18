package test

import (
	"context"
	"crypto/sha256"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/testutil"
	"github.com/usememos/memos/internal/testutil/fakes3"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
	apiv1 "github.com/usememos/memos/server/router/api/v1"
	"github.com/usememos/memos/store"
)

func TestCreateAttachmentOriginalPreference(t *testing.T) {
	for _, storageType := range []string{"local", "s3"} {
		t.Run(storageType, func(t *testing.T) {
			ts := NewTestService(t)
			defer ts.Cleanup()
			ctx := context.Background()
			user, err := ts.CreateRegularUser(ctx, "original_photographer")
			require.NoError(t, err)
			userCtx := ts.CreateUserContext(ctx, user.ID)
			if storageType == "s3" {
				fake := fakes3.New(t, "originals")
				storage := fakeStorage("original-s3", "Original photos", fake.Config("originals"))
				upsertS3StorageSetting(ctx, t, ts, storage.Id, storage)
			}
			original := testutil.BuildPhotographyJPEG()
			// This is a direct API upload: no browser/exifr metadata is supplied.
			create := func(name string, metadata *v1pb.MediaMetadata) (*v1pb.Attachment, []byte) {
				t.Helper()
				attachment, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{Attachment: &v1pb.Attachment{Filename: name, Type: "image/jpeg", Content: original, MediaMetadata: metadata}})
				require.NoError(t, err)
				uid, err := apiv1.ExtractAttachmentUIDFromName(attachment.Name)
				require.NoError(t, err)
				stored, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
				require.NoError(t, err)
				blob, err := ts.Service.GetAttachmentBlob(userCtx, stored)
				require.NoError(t, err)
				return attachment, blob
			}
			setPreference := func(enabled bool) {
				t.Helper()
				_, err := ts.Store.UpsertUserSetting(ctx, &storepb.UserSetting{UserId: user.ID, Key: storepb.UserSetting_GENERAL, Value: &storepb.UserSetting_General{General: &storepb.GeneralUserSetting{SaveMediaMetadata: enabled}}})
				require.NoError(t, err)
			}
			setPreference(false)
			private, cleaned := create("privacy.jpg", nil)
			require.Nil(t, private.MediaMetadata)
			require.NotEqual(t, sha256.Sum256(original), sha256.Sum256(cleaned))
			// Existing API clients can still explicitly supply metadata with the preference off.
			explicit := &v1pb.MediaMetadata{Details: &v1pb.MediaMetadata_Photo{Photo: &v1pb.PhotoMetadata{CameraMake: "client camera", ColorSpace: "client color"}}}
			explicitResult, _ := create("explicit.jpg", explicit)
			require.True(t, proto.Equal(explicit, explicitResult.MediaMetadata))
			setPreference(true)
			photo, preserved := create("original.jpg", nil)
			require.Equal(t, sha256.Sum256(original), sha256.Sum256(preserved))
			require.Equal(t, int64(len(original)), photo.Size)
			require.Equal(t, "image/jpeg", photo.Type)
			require.Equal(t, "Model A", photo.MediaMetadata.GetPhoto().GetCameraModel())
			require.InDelta(t, 2.8, photo.MediaMetadata.GetPhoto().GetFNumber(), 1e-9)
			require.Equal(t, "Display P3", photo.MediaMetadata.GetPhoto().GetIccProfile())
			require.Equal(t, int32(10), photo.MediaMetadata.GetWidth())
			require.Equal(t, int32(20), photo.MediaMetadata.GetHeight())
			setPreference(false)
			got, err := ts.Service.GetAttachment(userCtx, &v1pb.GetAttachmentRequest{Name: photo.Name})
			require.NoError(t, err)
			require.True(t, proto.Equal(photo.MediaMetadata, got.MediaMetadata), "preference changes must not rewrite existing photos")
		})
	}
}

func TestCreateAttachmentOriginalPreservesUnsupportedContainer(t *testing.T) {
	ts := NewTestService(t)
	defer ts.Cleanup()
	ctx := context.Background()
	user, err := ts.CreateHostUser(ctx, "original_admin")
	require.NoError(t, err)
	_, err = ts.Store.UpsertUserSetting(ctx, &storepb.UserSetting{UserId: user.ID, Key: storepb.UserSetting_GENERAL, Value: &storepb.UserSetting_General{General: &storepb.GeneralUserSetting{SaveMediaMetadata: true}}})
	require.NoError(t, err)
	userCtx := ts.CreateUserContext(ctx, user.ID)
	for _, mime := range []string{"image/heic", "image/avif", "image/tiff", "image/webp"} {
		t.Run(mime, func(t *testing.T) {
			// The arbitrary bytes exercise unsupported metadata handling, not decoder coverage.
			content := []byte("preserve unsupported HDR/ICC/MakerNote container bytes exactly")
			photo, err := ts.Service.CreateAttachment(userCtx, &v1pb.CreateAttachmentRequest{Attachment: &v1pb.Attachment{Filename: "photo.bin", Type: mime, Content: content}})
			require.NoError(t, err)
			uid, err := apiv1.ExtractAttachmentUIDFromName(photo.Name)
			require.NoError(t, err)
			stored, err := ts.Store.GetAttachment(ctx, &store.FindAttachment{UID: &uid})
			require.NoError(t, err)
			blob, err := ts.Service.GetAttachmentBlob(ctx, stored)
			require.NoError(t, err)
			require.Equal(t, content, blob)
			require.Nil(t, photo.MediaMetadata)
		})
	}
}
