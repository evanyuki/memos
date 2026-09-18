package photometadata

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"io"
	"unicode/utf16"
)

const maxICCBytes = 1 << 20

// Only the ICC description is indexed; full profiles remain byte-identical inside the original.
func embeddedICCDescription(data []byte, mimeType string) string {
	switch mimeType {
	case "image/jpeg", "image/jpg":
		if len(data) < 2 || data[0] != 0xff || data[1] != 0xd8 {
			return ""
		}
		parts := map[byte][]byte{}
		var count byte
		total := 0
		for pos, steps := 2, 0; pos+4 <= len(data) && steps < 4096; steps++ {
			if data[pos] != 0xff {
				break
			}
			marker := data[pos+1]
			if marker == 0xda || marker == 0xd9 {
				break
			}
			if marker == 0xff {
				pos++
				continue
			}
			length := int(binary.BigEndian.Uint16(data[pos+2:]))
			if length < 2 || pos+2+length > len(data) {
				break
			}
			segment := data[pos+4 : pos+2+length]
			if marker == 0xe2 && len(segment) >= 14 && bytes.Equal(segment[:12], []byte("ICC_PROFILE\x00")) {
				sequence, expected := segment[12], segment[13]
				if expected == 0 || sequence == 0 || sequence > expected || (count != 0 && count != expected) {
					return ""
				}
				if _, exists := parts[sequence]; exists {
					return ""
				}
				count = expected
				total += len(segment) - 14
				if total > maxICCBytes {
					return ""
				}
				parts[sequence] = segment[14:]
			}
			pos += 2 + length
		}
		if count == 0 || len(parts) != int(count) {
			return ""
		}
		profile := make([]byte, 0, total)
		for i := 1; i <= int(count); i++ {
			profile = append(profile, parts[byte(i)]...)
		}
		return iccDescription(profile)
	case "image/png":
		if len(data) < 8 || !bytes.Equal(data[:8], []byte{137, 80, 78, 71, 13, 10, 26, 10}) {
			return ""
		}
		for pos, steps := 8, 0; pos+12 <= len(data) && steps < 4096; steps++ {
			length := uint64(binary.BigEndian.Uint32(data[pos:]))
			if length > uint64(len(data)-pos-12) {
				break
			}
			chunk := data[pos+8 : pos+8+int(length)]
			if string(data[pos+4:pos+8]) == "iCCP" {
				separator := bytes.IndexByte(chunk, 0)
				if separator < 1 || separator > 79 || separator+2 >= len(chunk) || chunk[separator+1] != 0 {
					return ""
				}
				reader, err := zlib.NewReader(bytes.NewReader(chunk[separator+2:]))
				if err != nil {
					return ""
				}
				profile, err := io.ReadAll(io.LimitReader(reader, maxICCBytes+1))
				reader.Close()
				if err != nil || len(profile) > maxICCBytes {
					return ""
				}
				return iccDescription(profile)
			}
			pos += 12 + int(length)
		}
	case "image/webp":
		if len(data) < 12 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" {
			return ""
		}
		for pos, steps := 12, 0; pos+8 <= len(data) && steps < 4096; steps++ {
			length := uint64(binary.LittleEndian.Uint32(data[pos+4:]))
			if length > uint64(len(data)-pos-8) {
				break
			}
			if string(data[pos:pos+4]) == "ICCP" {
				return iccDescription(data[pos+8 : pos+8+int(length)])
			}
			pos += 8 + int(length) + (int(length) & 1)
		}
	case "image/heic", "image/heif", "image/avif":
		return bmffICCDescription(data, 0)
	default:
		return ""
	}
	return ""
}

func bmffICCDescription(data []byte, depth int) string {
	descriptions := map[string]struct{}{}
	collectBMFFICC(data, depth, descriptions)
	// Without an item-to-property association, multiple different profiles cannot
	// safely be attributed to the primary image. Leave that value unknown.
	if len(descriptions) != 1 {
		return ""
	}
	for description := range descriptions {
		return description
	}
	return ""
}

func collectBMFFICC(data []byte, depth int, descriptions map[string]struct{}) {
	if depth > 4 || len(descriptions) > 1 {
		return
	}
	for pos, steps := 0, 0; pos+8 <= len(data) && steps < 4096; steps++ {
		header := 8
		length := uint64(binary.BigEndian.Uint32(data[pos:]))
		if length == 1 {
			if pos+16 > len(data) {
				return
			}
			length = binary.BigEndian.Uint64(data[pos+8:])
			header = 16
		} else if length == 0 {
			length = uint64(len(data) - pos)
		}
		if length < uint64(header) || length > uint64(len(data)-pos) {
			return
		}
		kind := string(data[pos+4 : pos+8])
		body := data[pos+header : pos+int(length)]
		switch kind {
		case "meta":
			if len(body) >= 4 {
				collectBMFFICC(body[4:], depth+1, descriptions)
			}
		case "iprp", "ipco":
			collectBMFFICC(body, depth+1, descriptions)
		case "colr":
			if len(body) >= 4 && (string(body[:4]) == "prof" || string(body[:4]) == "rICC") {
				if description := iccDescription(body[4:]); description != "" {
					descriptions[description] = struct{}{}
				}
			}
		default:
			// Other boxes contain no ICC profile.
		}
		pos += int(length)
	}
}

// ICC v2 textDescriptionType and v4 multiLocalizedUnicodeType, as defined by ICC.1.
func iccDescription(profile []byte) string {
	if len(profile) < 132 || len(profile) > maxICCBytes || string(profile[36:40]) != "acsp" {
		return ""
	}
	declared := uint64(binary.BigEndian.Uint32(profile))
	if declared < 132 || declared > uint64(len(profile)) {
		return ""
	}
	profile = profile[:declared]
	count := uint64(binary.BigEndian.Uint32(profile[128:]))
	if count > uint64(len(profile)-132)/12 {
		return ""
	}
	for i := uint64(0); i < count; i++ {
		entry := profile[132+i*12:]
		if string(entry[:4]) != "desc" {
			continue
		}
		offset, size := uint64(binary.BigEndian.Uint32(entry[4:])), uint64(binary.BigEndian.Uint32(entry[8:]))
		if offset > uint64(len(profile)) || size > uint64(len(profile))-offset || size < 12 {
			return ""
		}
		tag := profile[offset : offset+size]
		switch string(tag[:4]) {
		case "desc":
			length := uint64(binary.BigEndian.Uint32(tag[8:]))
			if length == 0 || length > uint64(len(tag)-12) || length > 257 {
				return ""
			}
			return string(bytes.TrimRight(tag[12:12+length], "\x00"))
		case "mluc":
			if len(tag) < 16 || binary.BigEndian.Uint32(tag[12:]) != 12 {
				return ""
			}
			entries := uint64(binary.BigEndian.Uint32(tag[8:]))
			if entries == 0 || entries > uint64(len(tag)-16)/12 {
				return ""
			}
			var fallback string
			for j := uint64(0); j < entries; j++ {
				record := tag[16+j*12:]
				length, start := uint64(binary.BigEndian.Uint32(record[4:])), uint64(binary.BigEndian.Uint32(record[8:]))
				if length%2 != 0 || length > 512 || start > uint64(len(tag)) || length > uint64(len(tag))-start {
					continue
				}
				characters := make([]uint16, length/2)
				for n := range characters {
					characters[n] = binary.BigEndian.Uint16(tag[start+uint64(n)*2:])
				}
				text := string(utf16.Decode(characters))
				if string(record[:2]) == "en" {
					return text
				}
				if fallback == "" {
					fallback = text
				}
			}
			return fallback
		default:
			return ""
		}
	}
	return ""
}
