package v1

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/testutil"
	storepb "github.com/usememos/memos/proto/gen/store"
)

func TestExtractPhotoMetadataNormalizesAndOverridesClient(t *testing.T) {
	client := &storepb.MediaMetadata{Width: proto.Int32(999), Height: proto.Int32(888), Details: &storepb.MediaMetadata_Photo{Photo: &storepb.PhotoMetadata{CameraModel: "client guessed", ColorSpace: "client guessed"}}}
	result, err := extractPhotoMetadata(context.Background(), testutil.BuildPhotographyJPEG(), "image/jpeg", client)
	require.NoError(t, err)
	require.Equal(t, int32(10), result.GetWidth())
	require.Equal(t, int32(20), result.GetHeight())
	photo := result.GetPhoto()
	require.Equal(t, "Model A", photo.CameraModel)
	require.Equal(t, int32(6), photo.GetSourceExifOrientation())
	require.Equal(t, "2026-09-18T08:20:30", photo.CaptureTime.LocalDateTime)
	require.Equal(t, "+08:00", photo.CaptureTime.GetUtcOffset())
	require.InDelta(t, 2.8, photo.GetFNumber(), 1e-9)
	require.InDelta(t, 1.0/125, photo.GetExposureTimeSeconds(), 1e-9)
	require.Equal(t, int32(200), photo.GetIso())
	require.InDelta(t, 30.25, photo.Location.GetLatitude(), 1e-9)
	require.InDelta(t, -12.5, photo.Location.GetAltitudeMeters(), 1e-9)
	require.Equal(t, "sRGB", photo.ColorSpace)
	require.Equal(t, "Display P3", photo.IccProfile)
	require.Equal(t, "Auto", photo.WhiteBalance)
	require.Equal(t, "Aperture-priority AE", photo.ExposureProgram)
	require.Equal(t, "Multi-segment", photo.MeteringMode)
	require.InDelta(t, -1.0/3, photo.GetExposureBiasEv(), 1e-9)
	require.Equal(t, 50.0, photo.GetFocalLength_35Mm())
	require.Equal(t, "client guessed", client.GetPhoto().CameraModel, "client input must not be mutated")
}

func TestExtractPhotoMetadataKeepsValidatedClientWhenUnsupported(t *testing.T) {
	client := &storepb.MediaMetadata{Width: proto.Int32(12), Height: proto.Int32(8), Details: &storepb.MediaMetadata_Photo{Photo: &storepb.PhotoMetadata{CameraModel: "camera"}}}
	result, _ := extractPhotoMetadata(context.Background(), []byte("unsupported"), "image/heic", client)
	require.True(t, proto.Equal(client, result))
}

func TestExtractPhotoMetadataDoesNotInventSubsecondPrecision(t *testing.T) {
	for _, fraction := range []string{"123", "0123", "999"} {
		t.Run(fraction, func(t *testing.T) {
			client := &storepb.MediaMetadata{Details: &storepb.MediaMetadata_Photo{Photo: &storepb.PhotoMetadata{CaptureTime: &storepb.MediaCaptureTime{LocalDateTime: "2026-09-18T08:20:30." + fraction}}}}
			result, err := extractPhotoMetadata(context.Background(), testutil.BuildPhotographyJPEG(), "image/jpeg", client)
			require.NoError(t, err)
			expected := "2026-09-18T08:20:30"
			if fraction != "999" {
				expected += "." + fraction
			}
			require.Equal(t, expected, result.GetPhoto().GetCaptureTime().LocalDateTime)
		})
	}
}
