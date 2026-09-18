package photometadata

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"hash/crc32"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/usememos/memos/internal/testutil"
)

func TestICCContainersAndMalformedProfiles(t *testing.T) {
	profile := testutil.BuildICCProfile("Display P3")
	var compressed bytes.Buffer
	z := zlib.NewWriter(&compressed)
	_, err := z.Write(profile)
	require.NoError(t, err)
	require.NoError(t, z.Close())
	png := []byte{137, 80, 78, 71, 13, 10, 26, 10}
	chunk := append([]byte("profile\x00\x00"), compressed.Bytes()...)
	png = appendPNGChunk(png, "iCCP", chunk)
	webp := append([]byte("RIFF\x00\x00\x00\x00WEBPICCP"), make([]byte, 4)...)
	binary.LittleEndian.PutUint32(webp[16:], uint32(len(profile)))
	webp = append(webp, profile...)
	if len(profile)%2 == 1 {
		webp = append(webp, 0)
	}
	binary.LittleEndian.PutUint32(webp[4:], uint32(len(webp)-8))
	heif := box("meta", append(make([]byte, 4), box("iprp", box("ipco", box("colr", append([]byte("prof"), profile...))))...))
	conflicting := box("meta", append(make([]byte, 4), box("iprp", box("ipco", append(box("colr", append([]byte("prof"), profile...)), box("colr", append([]byte("prof"), testutil.BuildICCProfile("sRGB")...))...)))...))
	require.Empty(t, embeddedICCDescription(conflicting, "image/heic"), "do not guess the primary image's profile")
	for _, fixture := range []struct {
		mime string
		data []byte
	}{{"image/jpeg", testutil.BuildPhotographyJPEG()}, {"image/png", png}, {"image/webp", webp}, {"image/heic", heif}, {"image/avif", heif}} {
		t.Run(fixture.mime, func(t *testing.T) { require.Equal(t, "Display P3", embeddedICCDescription(fixture.data, fixture.mime)) })
	}
	for n := 0; n < len(profile); n++ {
		require.Empty(t, iccDescription(profile[:n]), "truncated profile length %d", n)
	}
	broken := append([]byte{}, profile...)
	binary.BigEndian.PutUint32(broken[136:], 0xffffffff)
	require.Empty(t, iccDescription(broken))
	broken = append([]byte{}, profile...)
	binary.BigEndian.PutUint32(broken[128:], 0xffffffff)
	require.Empty(t, iccDescription(broken))
}

func appendPNGChunk(data []byte, kind string, body []byte) []byte {
	var length [4]byte
	binary.BigEndian.PutUint32(length[:], uint32(len(body)))
	data = append(data, length[:]...)
	chunk := append([]byte(kind), body...)
	data = append(data, chunk...)
	binary.BigEndian.PutUint32(length[:], crc32.ChecksumIEEE(chunk))
	return append(data, length[:]...)
}

func box(kind string, body []byte) []byte {
	data := make([]byte, 8)
	binary.BigEndian.PutUint32(data, uint32(len(body)+8))
	copy(data[4:], kind)
	return append(data, body...)
}

func TestICCUnicodeAndLimits(t *testing.T) {
	// One English UTF-16BE description record in an ICC v4 mluc tag.
	profile := make([]byte, 176)
	binary.BigEndian.PutUint32(profile, uint32(len(profile)))
	copy(profile[36:], "acsp")
	binary.BigEndian.PutUint32(profile[128:], 1)
	copy(profile[132:], "desc")
	binary.BigEndian.PutUint32(profile[136:], 144)
	binary.BigEndian.PutUint32(profile[140:], 32)
	copy(profile[144:], "mluc")
	binary.BigEndian.PutUint32(profile[152:], 1)
	binary.BigEndian.PutUint32(profile[156:], 12)
	copy(profile[160:], "enUS")
	binary.BigEndian.PutUint32(profile[164:], 4)
	binary.BigEndian.PutUint32(profile[168:], 28)
	copy(profile[172:], []byte{0, 'P', 0, '3'})
	require.Equal(t, "P3", iccDescription(profile))
	require.Empty(t, iccDescription(make([]byte, maxICCBytes+1)))
}
