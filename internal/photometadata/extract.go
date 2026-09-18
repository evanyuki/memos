// Package photometadata reads a bounded subset of photographic metadata without decoding or rewriting pixels.
package photometadata

import (
	"bytes"
	"context"
	"io"
	"strings"
	"time"

	"github.com/bep/imagemeta"
	"github.com/pkg/errors"
)

// Metadata contains values read from the source file. Absent values stay absent.
type Metadata struct {
	Width, Height   int
	DisplayOriented bool
	Tags            map[string]any
	ICCProfile      string
}

// Extract reads EXIF and container dimensions. Malformed metadata does not modify the source.
func Extract(ctx context.Context, data []byte, mimeType string) (Metadata, error) {
	result := Metadata{Tags: make(map[string]any)}
	var format imagemeta.ImageFormat
	switch mimeType {
	case "image/jpeg", "image/jpg":
		format = imagemeta.JPEG
	case "image/tiff":
		format = imagemeta.TIFF
	case "image/png":
		format = imagemeta.PNG
	case "image/webp":
		format = imagemeta.WebP
	case "image/heic", "image/heif":
		format = imagemeta.HEIF
	case "image/avif":
		format = imagemeta.AVIF
	default:
		return result, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return result, err
	}
	reader := &boundedReader{reader: bytes.NewReader(data), ctx: ctx, remaining: 8 << 20, operations: 16384}
	decoded, err := imagemeta.Decode(imagemeta.Options{
		R: reader, ImageFormat: format, Sources: imagemeta.EXIF | imagemeta.CONFIG,
		LimitNumTags: 512, LimitTagSize: 1 << 20,
		ShouldHandleTag: func(tag imagemeta.TagInfo) bool {
			// Never let the embedded thumbnail overwrite the full image's metadata.
			if !strings.HasPrefix(tag.Namespace, "IFD0") {
				return false
			}
			switch tag.Tag {
			case "Make", "Model", "Orientation", "ImageWidth", "ImageHeight", "ExifImageWidth", "ExifImageHeight",
				"DateTimeOriginal", "CreateDate", "SubSecTimeOriginal", "SubSecTimeDigitized", "OffsetTimeOriginal", "OffsetTimeDigitized",
				"GPSLatitude", "GPSLatitudeRef", "GPSLongitude", "GPSLongitudeRef", "GPSAltitude", "GPSAltitudeRef",
				"LensModel", "FNumber", "ExposureTime", "ISO", "FocalLength", "FocalLengthIn35mmFormat",
				"ExposureCompensation", "ExposureProgram", "MeteringMode", "WhiteBalance", "ColorSpace", "BitsPerSample", "ICC_Profile":
				return true
			default:
				return false
			}
		},
		HandleTag: func(tag imagemeta.TagInfo) error {
			if err := ctx.Err(); err != nil {
				return err
			}
			if _, exists := result.Tags[tag.Tag]; !exists {
				if rational, ok := tag.Value.(interface{ Float64() float64 }); ok {
					tag.Value = rational.Float64()
				}
				result.Tags[tag.Tag] = tag.Value
			}
			return nil
		},
	})
	result.Width, result.Height = decoded.ImageConfig.Width, decoded.ImageConfig.Height
	// The BMFF reader already applies the primary item's irot property.
	result.DisplayOriented = (format == imagemeta.HEIF || format == imagemeta.AVIF) && result.Width > 0 && result.Height > 0
	result.ICCProfile = embeddedICCDescription(data, mimeType)
	if result.ICCProfile == "" {
		switch raw := result.Tags["ICC_Profile"].(type) {
		case []byte:
			result.ICCProfile = iccDescription(raw)
		case string:
			result.ICCProfile = iccDescription([]byte(raw))
		default:
			// Unsupported ICC payloads remain absent.
		}
	}
	delete(result.Tags, "ICC_Profile")
	if err == nil {
		err = ctx.Err()
	}
	return result, err
}

// The parser works synchronously. Limits cancel work without leaving a parsing goroutine alive.
type boundedReader struct {
	reader     *bytes.Reader
	ctx        context.Context
	remaining  int
	operations int
}

func (r *boundedReader) check() error {
	if err := r.ctx.Err(); err != nil {
		return err
	}
	r.operations--
	if r.operations < 0 || r.remaining <= 0 {
		return errors.New("image metadata read budget exceeded")
	}
	return nil
}

func (r *boundedReader) Read(p []byte) (int, error) {
	if err := r.check(); err != nil {
		return 0, err
	}
	p = p[:min(len(p), r.remaining)]
	n, err := r.reader.Read(p)
	r.remaining -= n
	return n, err
}

func (r *boundedReader) Seek(offset int64, whence int) (int64, error) {
	if err := r.check(); err != nil {
		return 0, err
	}
	return r.reader.Seek(offset, whence)
}

var _ io.ReadSeeker = (*boundedReader)(nil)
