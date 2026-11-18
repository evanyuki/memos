package photomedia

import (
	"bytes"
	"context"
	"encoding/binary"
	"hash/crc32"
	"image/png"
	"io"
	"os"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/photometadata"
)

// walkPNG checks chunk framing and excludes any trailer after IEND.
func walkPNG(ctx context.Context, data []byte, visit func(string, []byte) error) error {
	if !bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) {
		return errors.New("invalid PNG header")
	}
	hasPixels := false
	for pos := 8; pos+12 <= len(data); {
		if err := ctx.Err(); err != nil {
			return err
		}
		length := uint64(binary.BigEndian.Uint32(data[pos:]))
		if length > uint64(len(data)-pos-12) {
			return errors.New("invalid PNG chunk length")
		}
		end := pos + 12 + int(length)
		kind := string(data[pos+4 : pos+8])
		if crc32.ChecksumIEEE(data[pos+4:end-4]) != binary.BigEndian.Uint32(data[end-4:end]) {
			return errors.New("invalid PNG checksum")
		}
		if (pos == 8) != (kind == "IHDR") || (kind == "IHDR" && length != 13) {
			return errors.New("invalid PNG image header")
		}
		if kind == "IDAT" && length > 0 {
			hasPixels = true
		}
		if kind == "IEND" && (length != 0 || !hasPixels) {
			return errors.New("invalid PNG end")
		}
		if kind[0]&0x20 == 0 && kind != "IHDR" && kind != "IDAT" && kind != "PLTE" && kind != "IEND" {
			return errors.New("unsupported critical PNG chunk")
		}
		if err := visit(kind, data[pos:end]); err != nil {
			return err
		}
		if kind == "IEND" {
			return nil
		}
		pos = end
	}
	return errors.New("missing PNG end")
}

// orientationChunk keeps only the IFD0 orientation scalar from the source EXIF.
func orientationChunk(ctx context.Context, tiff []byte) ([]byte, error) {
	meta, err := photometadata.Extract(ctx, tiff, "image/tiff")
	if err != nil {
		return nil, err
	}
	value, ok := meta.Tags["Orientation"]
	if !ok {
		return nil, nil
	}
	orientation, ok := value.(uint16)
	if !ok || orientation < 1 || orientation > 8 {
		return nil, errors.New("invalid PNG orientation")
	}
	exif := []byte("eXIfMM\x00\x2a\x00\x00\x00\x08\x00\x01\x01\x12\x00\x03\x00\x00\x00\x01\x00\x00\x00\x00\x00\x00\x00\x00")
	exif[23] = byte(orientation)
	chunk := binary.BigEndian.AppendUint32(nil, uint32(len(exif)-4))
	chunk = append(chunk, exif...)
	return binary.BigEndian.AppendUint32(chunk, crc32.ChecksumIEEE(exif)), nil
}

// cleanPNG retains the compressed frames and profiles for the ExifTool-verified path.
func cleanPNG(ctx context.Context, input, output string) error {
	data, err := os.ReadFile(input)
	if err != nil {
		return err
	}
	var clean bytes.Buffer
	clean.WriteString("\x89PNG\r\n\x1a\n")
	err = walkPNG(ctx, data, func(kind string, chunk []byte) error {
		switch kind {
		case "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "sRGB", "iCCP", "gAMA", "cHRM", "sBIT",
			"cICP", "mDCV", "mDCv", "cLLI", "cLLi", "bKGD", "pHYs", "acTL", "fcTL", "fdAT":
			clean.Write(chunk)
		case "eXIf":
			orientation, err := orientationChunk(ctx, chunk[8:len(chunk)-4])
			if err != nil {
				return err
			}
			clean.Write(orientation)
		}
		return nil
	})
	if err != nil {
		return err
	}
	return os.WriteFile(output, clean.Bytes(), 0600)
}

// pngProperties reads only the rendering fields needed by the native display and thumbnail paths.
func pngProperties(ctx context.Context, data []byte, fields *bytes.Buffer) (imageInfo, error) {
	cfg, err := png.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return imageInfo{}, err
	}
	info := imageInfo{FileType: "PNG", ImageWidth: cfg.Width, ImageHeight: cfg.Height}
	seen := make(map[string]bool)
	err = walkPNG(ctx, data, func(kind string, chunk []byte) error {
		body := chunk[8 : len(chunk)-4]
		var size int
		switch kind {
		case "cICP", "gAMA":
			size = 4
		case "cHRM":
			size = 32
		case "sRGB":
			size = 1
		case "cLLI", "cLLi":
			size = 8
		case "mDCV", "mDCv":
			size = 24
		case "eXIf":
			if fields == nil {
				return nil
			}
			orientation, err := orientationChunk(ctx, body)
			if err != nil {
				return err
			}
			chunk = orientation
		default:
			return nil
		}
		if seen[kind] || (size > 0 && len(body) != size) {
			return errors.New("invalid PNG rendering metadata")
		}
		seen[kind] = true
		if kind == "cICP" {
			info.ColorPrimaries, info.TransferCharacteristics = int(body[0]), int(body[1])
		}
		if fields != nil {
			fields.Write(chunk)
		}
		return nil
	})
	return info, err
}

func renderPNGWithoutExifTool(ctx context.Context, source io.Reader) ([]byte, error) {
	data, err := io.ReadAll(source)
	if err != nil {
		return nil, err
	}
	if len(data) > maxSourceBytes {
		return nil, errors.New("source exceeds preview limit")
	}
	var fields bytes.Buffer
	info, err := pngProperties(ctx, data, &fields)
	if err != nil {
		return nil, err
	}
	// Budget for the decoder's RGBA buffers using the validated IHDR bit depth.
	bytesPerPixel := 4
	if data[24] == 16 {
		bytesPerPixel = 8
	}
	if info.ImageWidth > maxSourceBytes/bytesPerPixel/info.ImageHeight {
		return nil, errors.New("unsupported preview dimensions")
	}
	img, err := png.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, img); err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if fields.Len() == 0 {
		return encoded.Bytes(), nil
	}
	// Colour and orientation chunks precede the palette and pixel data.
	const afterIHDR = 8 + 12 + 13
	out := make([]byte, 0, encoded.Len()+fields.Len())
	out = append(out, encoded.Bytes()[:afterIHDR]...)
	out = append(out, fields.Bytes()...)
	return append(out, encoded.Bytes()[afterIHDR:]...), nil
}
