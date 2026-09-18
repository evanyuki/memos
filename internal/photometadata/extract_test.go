package photometadata

import (
	"context"
	"crypto/sha256"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/testutil"
)

func TestExtractOriginalPhotographicMetadata(t *testing.T) {
	original := testutil.BuildPhotographyJPEG()
	before := sha256.Sum256(original)
	result, err := Extract(context.Background(), original, "image/jpeg")
	require.NoError(t, err)
	require.Equal(t, before, sha256.Sum256(original))
	require.Equal(t, 20, result.Width)
	require.Equal(t, 10, result.Height)
	require.Equal(t, "Camera Co", result.Tags["Make"])
	require.Equal(t, "Model A", result.Tags["Model"])
	require.Equal(t, "Lens 35mm", result.Tags["LensModel"])
	require.InDelta(t, 2.8, result.Tags["FNumber"], 1e-9)
	require.InDelta(t, 1.0/125, result.Tags["ExposureTime"], 1e-9)
	require.InDelta(t, 30.25, result.Tags["GPSLatitude"], 1e-9)
	require.Equal(t, "Display P3", result.ICCProfile)
	require.NotContains(t, result.Tags, "MakerNote")
}

func TestExtractIsBoundedAndDoesNotInventMetadata(t *testing.T) {
	for _, mime := range []string{"image/jpeg", "image/tiff", "image/png", "image/webp", "image/heic", "image/avif"} {
		t.Run(mime, func(t *testing.T) {
			result, _ := Extract(context.Background(), []byte("not an image"), mime)
			require.Empty(t, result.Tags)
			require.Empty(t, result.ICCProfile)
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Extract(ctx, testutil.BuildPhotographyJPEG(), "image/jpeg")
	require.Error(t, err)
}

func FuzzExtract(f *testing.F) {
	f.Add(testutil.BuildPhotographyJPEG())
	f.Add([]byte{0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff})
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 1<<20 {
			t.Skip()
		}
		_, _ = Extract(context.Background(), data, "image/jpeg")
	})
}
