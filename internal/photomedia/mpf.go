package photomedia

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"

	"github.com/pkg/errors"
)

// Multi-picture JPEG sizes and offsets are relative to its APP2 TIFF header.
// ExifTool removes JPEG trailers when clearing metadata, including the gain image.
// Clean each referenced codestream independently and rebuild the index from the actual output.
type mpIndex struct {
	order   binary.ByteOrder
	base    int
	entries []byte
}

func jpegIndex(data []byte) (*mpIndex, error) {
	if !bytes.HasPrefix(data, []byte{0xff, 0xd8}) {
		return nil, errors.New("invalid JPEG header")
	}
	for at := 2; at+4 <= len(data); {
		if data[at] != 0xff {
			return nil, errors.New("invalid JPEG segment")
		}
		if data[at+1] == 0xff {
			at++
			continue
		}
		if data[at+1] == 0xda || data[at+1] == 0xd9 {
			return nil, nil
		}
		size := int(binary.BigEndian.Uint16(data[at+2:]))
		end := at + 2 + size
		if size < 2 || end > len(data) {
			return nil, errors.New("invalid JPEG length")
		}
		if data[at+1] == 0xe2 && bytes.HasPrefix(data[at+4:end], []byte("MPF\x00")) {
			base := at + 8
			tiff := data[base:end]
			if len(tiff) < 8 {
				return nil, errors.New("incomplete MPF header")
			}
			var order binary.ByteOrder
			switch string(tiff[:4]) {
			case "MM\x00*":
				order = binary.BigEndian
			case "II*\x00":
				order = binary.LittleEndian
			default:
				return nil, errors.New("invalid MPF header")
			}
			dir := uint64(order.Uint32(tiff[4:]))
			if dir+2 > uint64(len(tiff)) {
				return nil, errors.New("invalid MPF directory")
			}
			n := uint64(order.Uint16(tiff[dir:]))
			if dir+2+12*n > uint64(len(tiff)) {
				return nil, errors.New("incomplete MPF directory")
			}
			for i := range n {
				entry := tiff[dir+2+i*12:]
				if order.Uint16(entry) != 0xb002 {
					continue
				}
				count, start := uint64(order.Uint32(entry[4:])), uint64(order.Uint32(entry[8:]))
				if count < 16 || count%16 != 0 || count > 16*64 || start+count > uint64(len(tiff)) {
					return nil, errors.New("invalid MPF entries")
				}
				return &mpIndex{order, base, tiff[start : start+count]}, nil
			}
			return nil, errors.New("MPF image directory missing")
		}
		at = end
	}
	return nil, errors.New("missing JPEG image")
}

func restoreGainImages(ctx context.Context, input, output string) error {
	original, err := os.ReadFile(input)
	if err != nil {
		return err
	}
	src, err := jpegIndex(original)
	if err != nil {
		return err
	}
	if src == nil {
		return nil
	}
	var images [][]byte
	for pos := 16; pos < len(src.entries); pos += 16 {
		length := uint64(src.order.Uint32(src.entries[pos+4:]))
		offset := uint64(src.base) + uint64(src.order.Uint32(src.entries[pos+8:]))
		if length < 4 || offset+length > uint64(len(original)) {
			return errors.New("gain image exceeds JPEG bounds")
		}
		part := original[offset : offset+length]
		child, err := jpegIndex(part)
		if err != nil || child != nil {
			return errors.New("unsupported nested gain image")
		}
		source := filepath.Join(filepath.Dir(input), fmt.Sprintf("gain-%d.jpg", pos/16))
		target := source + ".clean.jpg"
		if err := os.WriteFile(source, part, 0600); err != nil {
			return err
		}
		if err := cleanImageMetadata(ctx, source, target); err != nil {
			return err
		}
		if InspectLocation(ctx, target) != Absent {
			return errors.New("gain image contains unverifiable metadata")
		}
		image, err := os.ReadFile(target)
		if err != nil {
			return err
		}
		image, err = preserveISOParameters(part, image)
		if err != nil {
			return err
		}
		images = append(images, image)
	}
	// Google readers may locate the gain map using the XMP directory instead
	// of MPF. Recreate just its rendering entries using the sanitized lengths.
	if bytes.Contains(original, []byte("http://ns.google.com/photos/1.0/container/")) && bytes.Contains(original, []byte("GainMap")) {
		if len(images) != 1 {
			return errors.New("unsupported Google gain-map directory")
		}
		if err := run(ctx, "exiftool", "-overwrite_original",
			"-XMP-GContainer:ContainerDirectory={Item={Mime=image/jpeg,Semantic=Primary}}",
			fmt.Sprintf("-XMP-GContainer:ContainerDirectory+={Item={Mime=image/jpeg,Semantic=GainMap,Length=%d}}", len(images[0])), output); err != nil {
			return err
		}
	}
	display, err := os.ReadFile(output)
	if err != nil {
		return err
	}
	display, err = preserveISOParameters(original, display)
	if err != nil {
		return err
	}
	dst, err := jpegIndex(display)
	if err != nil {
		return err
	}
	if dst == nil || len(src.entries) != len(dst.entries) {
		return errors.New("MPF index lost during sanitization")
	}
	if !bytes.HasSuffix(display, []byte{0xff, 0xd9}) {
		return errors.New("invalid primary JPEG end")
	}
	next := len(display)
	dst.order.PutUint32(dst.entries[4:], uint32(next))
	for index, image := range images {
		pos := (index + 1) * 16
		dst.order.PutUint32(dst.entries[pos+4:], uint32(len(image)))
		dst.order.PutUint32(dst.entries[pos+8:], uint32(next-dst.base))
		next += len(image)
	}
	for _, image := range images {
		display = append(display, image...)
	}
	return os.WriteFile(output, display, 0600)
}

// ISO 21496-1 stores numeric rendering parameters in APP2. Some metadata
// writers discard unrecognized APP segments. Only preserve the defined fields
// of the version-zero layout, never arbitrary APP payloads or JPEG trailers.
func preserveISOParameters(source, clean []byte) ([]byte, error) {
	const namespace = "urn:iso:std:iso:ts:21496:-1\x00"
	for at := 2; at+4 <= len(source) && source[at] == 0xff; {
		marker := source[at+1]
		if marker == 0xff {
			at++
			continue
		}
		if marker == 0xda || marker == 0xd9 {
			break
		}
		size := int(binary.BigEndian.Uint16(source[at+2:]))
		end := at + 2 + size
		if size < 2 || end > len(source) {
			return nil, errors.New("invalid JPEG header")
		}
		segment := source[at:end]
		if marker == 0xe2 && bytes.HasPrefix(segment[4:], []byte(namespace)) {
			fields := segment[4+len(namespace):]
			if len(fields) < 4 || binary.BigEndian.Uint16(fields) != 0 {
				return nil, errors.New("unsupported ISO gain-map version")
			}
			if len(fields) > 4 {
				flags := fields[4]
				channels := 1
				if flags&0x80 != 0 {
					channels = 3
				}
				length := 5 + 16 + 40*channels
				if flags&8 != 0 {
					length = 5 + 12 + 20*channels
				}
				if len(fields) != length {
					return nil, errors.New("unexpected ISO gain-map parameter size")
				}
			}
			if bytes.Contains(clean, segment) {
				return clean, nil
			}
			out := make([]byte, 0, len(clean)+len(segment))
			out = append(out, clean[:2]...)
			out = append(out, segment...)
			return append(out, clean[2:]...), nil
		}
		at = end
	}
	return clean, nil
}
