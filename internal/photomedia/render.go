// Package photomedia produces display copies without modifying camera files.
package photomedia

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/motionphoto"
)

// Variant identifies a derived object. Bump the object version when its privacy policy changes.
type Variant string

const (
	Display   Variant = "display"
	Thumbnail Variant = "thumbnail"
	Motion    Variant = "motion"
)

const maxSourceBytes = 256 << 20 // Same as the attachment API request ceiling.

// Key is shared by readers, writers and storage cleanup.
func Key(uid string, variant Variant) string {
	return ".memos-previews/v1/" + uid + "/" + string(variant)
}

// ContentType returns the type of the generated file.
func (v Variant) ContentType(original string) string {
	switch v {
	case Thumbnail:
		return "image/webp"
	case Motion:
		return "video/mp4"
	default:
		if original == "image/svg+xml" {
			return "image/png"
		}
		return original
	}
}

var extensions = map[string]string{
	"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png", "image/webp": ".webp",
	"image/heic": ".heic", "image/heif": ".heif", "image/avif": ".avif", "image/gif": ".gif",
	"image/tiff": ".tif", "image/svg+xml": ".svg", "video/quicktime": ".mov", "video/mp4": ".mp4",
}

// SupportsImage reports whether the application can generate a display copy for the MIME type.
func SupportsImage(mime string) bool {
	return strings.HasPrefix(mime, "image/") && extensions[mime] != ""
}

// LocationState records only whether readable location metadata was found.
type LocationState string

const (
	Unknown LocationState = "unknown"
	Present LocationState = "present"
	Absent  LocationState = "not_found"
)

// InspectLocation checks embedded documents as well as the primary EXIF, IPTC, XMP and QuickTime tags.
func InspectLocation(ctx context.Context, path string) LocationState {
	args := []string{"-j", "-s", "-a", "-ee3", "-G4:1", "-GPS*", "-*Latitude*", "-*Longitude*", "-*Location*",
		"-City", "-Sub-location", "-Province-State", "-Country*", "-State", "-FileType", "-Warning", "-Error", path}
	out, err := exec.CommandContext(ctx, "exiftool", args...).Output()
	if err != nil {
		return Unknown
	}
	var records []map[string]json.RawMessage
	if json.Unmarshal(out, &records) != nil || len(records) != 1 {
		return Unknown
	}
	state := Absent
	for key, value := range records[0] {
		tag := key[strings.LastIndex(key, ":")+1:]
		switch tag {
		case "FileType":
			switch string(value) {
			case `"JPEG"`, `"MPO"`, `"PNG"`, `"APNG"`, `"GIF"`, `"WEBP"`, `"HEIF"`, `"HEIC"`, `"AVIF"`, `"TIFF"`, `"MP4"`, `"MOV"`, `"SVG"`:
			default:
				state = Unknown
			}
		case "SourceFile", "GPSVersionID", "GPSMapDatum":
		case "Warning", "Error":
			state = Unknown
		default:
			return Present
		}
	}
	return state
}

// Render writes only verified derivatives. Input paths and subprocess arguments never use user filenames.
func Render(ctx context.Context, source io.Reader, mime string, variant Variant) ([]byte, LocationState, error) {
	ext := extensions[mime]
	if ext == "" {
		return nil, Unknown, errors.New("unsupported photo format")
	}
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	source = io.LimitReader(source, maxSourceBytes+1)
	if variant == Display && ext == ".png" {
		if _, err := exec.LookPath("exiftool"); errors.Is(err, exec.ErrNotFound) {
			// The native encoder emits pixels and validated rendering fields only.
			data, err := renderPNGWithoutExifTool(ctx, source)
			return data, Unknown, err
		}
	}
	dir, err := os.MkdirTemp("", "memos-photo-")
	if err != nil {
		return nil, Unknown, err
	}
	defer os.RemoveAll(dir)
	input := filepath.Join(dir, "source"+ext)
	f, err := os.Create(input)
	if err != nil {
		return nil, Unknown, err
	}
	written, copyErr := io.Copy(f, source)
	closeErr := f.Close()
	if copyErr != nil {
		return nil, Unknown, copyErr
	}
	if closeErr != nil {
		return nil, Unknown, closeErr
	}
	if written > maxSourceBytes {
		return nil, Unknown, errors.New("source exceeds preview limit")
	}
	state := Unknown
	output := filepath.Join(dir, "display"+ext)
	switch variant {
	case Thumbnail:
		output = filepath.Join(dir, "thumbnail.webp")
		// Restrict decoding to raster sources. The output has no metadata, retains alpha,
		// and uses the colour-managed SDR base of gain-map images.
		info, infoErr := readImageInfo(ctx, input)
		if infoErr != nil {
			return nil, state, infoErr
		}
		if !matchesImageFormat(ext, info.FileType) {
			return nil, state, errors.New("declared image format does not match source")
		}
		err = thumbnail(ctx, input, output, info)
	case Display, Motion:
		state = InspectLocation(ctx, input)
		if variant == Display && ext != ".jpg" && ext != ".png" {
			info, infoErr := readImageInfo(ctx, input)
			if infoErr != nil {
				return nil, state, infoErr
			}
			if !matchesImageFormat(ext, info.FileType) {
				return nil, state, errors.New("declared image format does not match source")
			}
		}
		if ext == ".jpg" {
			data, err := os.ReadFile(input)
			if err != nil {
				return nil, state, err
			}
			if detected := motionphoto.DetectJPEG(data); detected != nil {
				clip := filepath.Join(dir, "clip.mp4")
				if variant == Motion || state != Present {
					if err := os.WriteFile(clip, data[detected.VideoStart:], 0600); err != nil {
						return nil, state, err
					}
				}
				if state != Present {
					clipState := InspectLocation(ctx, clip)
					if clipState != Absent {
						state = clipState
					}
				}
				if variant == Motion {
					input = clip
				} else {
					err = os.Truncate(input, int64(detected.VideoStart))
				}
				if err != nil {
					return nil, state, err
				}
			} else if variant == Motion {
				return nil, state, errors.New("no embedded motion clip")
			}
		}
		if variant == Motion {
			output = filepath.Join(dir, "display.mp4")
			err = run(ctx, "ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file", "-i", input,
				"-map", "0:v:0", "-map", "0:a?", "-map_metadata", "-1", "-map_metadata:s", "-1", "-map_chapters", "-1",
				"-c", "copy", "-movflags", "+faststart", output)
		} else if ext == ".svg" {
			output = filepath.Join(dir, "display.png")
			err = run(ctx, "vips", "svgload", input, output+"[strip]")
		} else if ext == ".png" {
			err = cleanPNG(ctx, input, output)
		} else {
			err = cleanImageMetadata(ctx, input, output)
			if err == nil && ext == ".jpg" {
				err = restoreGainImages(ctx, input, output)
			}
		}
		if err == nil && InspectLocation(ctx, output) != Absent {
			return nil, state, errors.New("display metadata could not be verified")
		}
	default:
		return nil, state, errors.New("invalid photo variant")
	}
	if err != nil {
		return nil, state, err
	}
	data, err := os.ReadFile(output)
	if err == nil && len(data) == 0 {
		err = errors.New("empty derivative")
	}
	return data, state, err
}

func cleanImageMetadata(ctx context.Context, input, output string) error {
	// Some ExifTool releases read this Apple XMP value but do not declare it
	// writable. Discarding it changes how HDR screens interpret the gain map.
	config := filepath.Join(filepath.Dir(input), "render.config")
	const appleXMP = "%Image::ExifTool::UserDefined = ('Image::ExifTool::XMP::HDRGainMap' => { HDRGainMapHeadroom => { Writable => 'real' } }); 1;"
	if err := os.WriteFile(config, []byte(appleXMP), 0600); err != nil {
		return err
	}
	args := []string{"-config", config, "-all=", "--ICC_Profile:all", "--MPF:all", "--Adobe:all",
		"-TagsFromFile", "@", "-IFD0:Orientation", "-ExifIFD:ColorSpace", "-XMP-hdrgm:all",
		"-XMP-hdrgm:Version", "-XMP-hdrgm:Gamma", "-XMP-apdi:AuxiliaryImageType", "-XMP-HDRGainMap:all"}
	note, readErr := exec.CommandContext(ctx, "exiftool", "-b", "-MakerNotes", input).Output()
	if readErr != nil {
		return readErr
	}
	renderNote, readErr := appleRenderingNote(note)
	if readErr != nil {
		return readErr
	}
	if len(renderNote) != 0 {
		path := filepath.Join(filepath.Dir(input), "hdr-note.bin")
		if err := os.WriteFile(path, renderNote, 0600); err != nil {
			return err
		}
		args = append(args, "-Make=Apple", "-MakerNotes<="+path)
	}
	return run(ctx, "exiftool", append(args, "-o", output, input)...)
}

func run(ctx context.Context, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	var diagnostic bytes.Buffer
	cmd.Stderr = &diagnostic
	if err := cmd.Run(); err != nil {
		return errors.Wrapf(err, "%s: %s", name, strings.TrimSpace(diagnostic.String()))
	}
	return nil
}
