package v1

import (
	"context"
	"math"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode"

	"google.golang.org/protobuf/proto"

	"github.com/usememos/memos/internal/photometadata"
	v1pb "github.com/usememos/memos/proto/gen/api/v1"
	storepb "github.com/usememos/memos/proto/gen/store"
)

// extractPhotoMetadata never rewrites image bytes. Successfully read fields override
// client guesses; fields unsupported by the parser retain validated client values.
func extractPhotoMetadata(ctx context.Context, blob []byte, mimeType string, client *storepb.MediaMetadata) (*storepb.MediaMetadata, error) {
	meta, extractErr := photometadata.Extract(ctx, blob, mimeType)
	tags := meta.Tags
	photo := &v1pb.PhotoMetadata{
		CameraMake: metadataText(tags["Make"]), CameraModel: metadataText(tags["Model"]), LensModel: metadataText(tags["LensModel"]),
		FNumber: metadataPositive(tags["FNumber"]), ExposureTimeSeconds: metadataPositive(tags["ExposureTime"]),
		Iso: metadataInteger(tags["ISO"], 1, math.MaxInt32), FocalLengthMm: metadataPositive(tags["FocalLength"]),
		FocalLength_35Mm:      metadataPositive(tags["FocalLengthIn35mmFormat"]),
		ExposureBiasEv:        metadataNumber(tags["ExposureCompensation"]),
		SourceExifOrientation: metadataInteger(tags["Orientation"], 1, 8),
		BitsPerSample:         metadataInteger(tags["BitsPerSample"], 1, 64),
		IccProfile:            metadataText(meta.ICCProfile),
		ExposureProgram:       metadataEnum(tags["ExposureProgram"], map[int]string{0: "Not defined", 1: "Manual", 2: "Program AE", 3: "Aperture-priority AE", 4: "Shutter-priority AE", 5: "Creative", 6: "Action", 7: "Portrait", 8: "Landscape"}),
		MeteringMode:          metadataEnum(tags["MeteringMode"], map[int]string{0: "Unknown", 1: "Average", 2: "Center-weighted average", 3: "Spot", 4: "Multi-spot", 5: "Multi-segment", 6: "Partial", 255: "Other"}),
		WhiteBalance:          metadataEnum(tags["WhiteBalance"], map[int]string{0: "Auto", 1: "Manual"}),
		ColorSpace:            metadataEnum(tags["ColorSpace"], map[int]string{1: "sRGB", 2: "Adobe RGB", 65535: "Uncalibrated"}),
	}
	photo.CaptureTime = metadataCaptureTime(tags)
	// The EXIF reader normalizes subsecond strings to integers, discarding leading
	// zeroes. Retain a client's exact fraction only if it agrees with the source;
	// otherwise omit it rather than inventing a different capture instant.
	if source, supplied := photo.CaptureTime, client.GetPhoto().GetCaptureTime(); source != nil && supplied != nil {
		base, fraction, hasFraction := strings.Cut(supplied.LocalDateTime, ".")
		if base == source.LocalDateTime && hasFraction && len(fraction) <= 9 {
			parsed, parseErr := strconv.Atoi(fraction)
			if n := metadataInteger(tags["SubSecTimeOriginal"], 0, math.MaxInt32); parseErr == nil && n != nil && int(*n) == parsed {
				source.LocalDateTime = supplied.LocalDateTime
			}
		}
	}
	photo.Location = metadataLocation(tags)
	width, height := meta.Width, meta.Height
	if width <= 0 || height <= 0 {
		w, h := metadataInteger(tags["ExifImageWidth"], 1, math.MaxInt32), metadataInteger(tags["ExifImageHeight"], 1, math.MaxInt32)
		if w == nil || h == nil {
			w, h = metadataInteger(tags["ImageWidth"], 1, math.MaxInt32), metadataInteger(tags["ImageHeight"], 1, math.MaxInt32)
		}
		if w != nil && h != nil {
			width, height = int(*w), int(*h)
		}
	}
	if !meta.DisplayOriented && photo.GetSourceExifOrientation() >= 5 {
		width, height = height, width
	}
	normalized := &v1pb.MediaMetadata{}
	if width > 0 && height > 0 && width <= math.MaxInt32 && height <= math.MaxInt32 {
		normalized.Width, normalized.Height = proto.Int32(int32(width)), proto.Int32(int32(height))
	}
	if proto.Size(photo) > 0 {
		normalized.Details = &v1pb.MediaMetadata_Photo{Photo: photo}
	}
	if proto.Size(normalized) == 0 {
		return client, extractErr
	}
	validated, err := validateClientMediaMetadata(normalized, mimeType)
	if err != nil {
		return client, err
	}
	merged := &storepb.MediaMetadata{}
	if client != nil {
		proto.Merge(merged, client)
	}
	proto.Merge(merged, validated)
	return merged, extractErr
}

func metadataText(value any) string {
	text, ok := value.(string)
	if !ok {
		return ""
	}
	text = strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, text))
	if len(text) > maxMediaMetadataStringBytes {
		return ""
	}
	return text
}

func metadataNumber(value any) *float64 {
	if value == nil {
		return nil
	}
	r := reflect.ValueOf(value)
	if r.Kind() == reflect.Slice || r.Kind() == reflect.Array {
		if r.Len() == 0 {
			return nil
		}
		return metadataNumber(r.Index(0).Interface())
	}
	var result float64
	switch r.Kind() {
	case reflect.Float32, reflect.Float64:
		result = r.Float()
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		result = float64(r.Int())
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		result = float64(r.Uint())
	default:
		return nil
	}
	if !isFinite(result) {
		return nil
	}
	return &result
}

func metadataPositive(value any) *float64 {
	n := metadataNumber(value)
	if n == nil || *n <= 0 {
		return nil
	}
	return n
}

func metadataInteger(value any, minimum, maximum int32) *int32 {
	n := metadataNumber(value)
	if n == nil || math.Trunc(*n) != *n || *n < float64(minimum) || *n > float64(maximum) {
		return nil
	}
	return proto.Int32(int32(*n))
}

func metadataEnum(value any, labels map[int]string) string {
	n := metadataInteger(value, 0, math.MaxInt32)
	if n == nil {
		return ""
	}
	return labels[int(*n)]
}

func metadataCaptureTime(tags map[string]any) *v1pb.MediaCaptureTime {
	for _, keys := range [][3]string{{"DateTimeOriginal", "SubSecTimeOriginal", "OffsetTimeOriginal"}, {"CreateDate", "SubSecTimeDigitized", "OffsetTimeDigitized"}} {
		date := metadataText(tags[keys[0]])
		parsed, err := time.Parse("2006:01:02 15:04:05", date)
		if err != nil || parsed.Year() == 0 {
			continue
		}
		capture := &v1pb.MediaCaptureTime{LocalDateTime: parsed.Format("2006-01-02T15:04:05")}
		subseconds := metadataText(tags[keys[1]])
		if len(subseconds) > 0 && len(subseconds) <= 9 && strings.Trim(subseconds, "0123456789") == "" {
			capture.LocalDateTime += "." + subseconds
		}
		if offset := metadataText(tags[keys[2]]); offset != "" {
			capture.UtcOffset = &offset
			if validateMediaCaptureTime(capture) != nil {
				capture.UtcOffset = nil
			}
		}
		return capture
	}
	return nil
}

func metadataLocation(tags map[string]any) *v1pb.MediaLocation {
	latitude, longitude := metadataNumber(tags["GPSLatitude"]), metadataNumber(tags["GPSLongitude"])
	ns, ew := metadataText(tags["GPSLatitudeRef"]), metadataText(tags["GPSLongitudeRef"])
	if latitude == nil || longitude == nil || (ns != "N" && ns != "S") || (ew != "E" && ew != "W") {
		return nil
	}
	if ns == "S" {
		*latitude = -*latitude
	}
	if ew == "W" {
		*longitude = -*longitude
	}
	location := &v1pb.MediaLocation{Latitude: latitude, Longitude: longitude, AltitudeMeters: metadataNumber(tags["GPSAltitude"])}
	if location.AltitudeMeters != nil {
		if ref := metadataNumber(tags["GPSAltitudeRef"]); ref != nil && *ref == 1 {
			*location.AltitudeMeters = -*location.AltitudeMeters
		}
	}
	if validateMediaLocation(location) != nil {
		return nil
	}
	return location
}
