package photomedia

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"

	"github.com/pkg/errors"
)

type imageInfo struct {
	FileType                                string
	ImageWidth, ImageHeight                 int
	TransferCharacteristics, ColorPrimaries int
}

func matchesImageFormat(ext, detected string) bool {
	switch ext {
	case ".jpg":
		return detected == "JPEG" || detected == "MPO"
	case ".heic", ".heif":
		return detected == "HEIC" || detected == "HEIF"
	case ".avif":
		return detected == "AVIF"
	case ".tif":
		return detected == "TIFF"
	case ".png":
		return detected == "PNG" || detected == "APNG"
	case ".gif":
		return detected == "GIF"
	case ".svg":
		return detected == "SVG"
	case ".webp":
		return detected == "WEBP"
	default:
		return false
	}
}

func readImageInfo(ctx context.Context, path string) (imageInfo, error) {
	if filepath.Ext(path) == ".png" {
		data, err := os.ReadFile(path)
		if err != nil {
			return imageInfo{}, err
		}
		return pngProperties(ctx, data, nil)
	}
	raw, err := exec.CommandContext(ctx, "exiftool", "-j", "-n", "-FileType", "-ImageWidth", "-ImageHeight",
		"-TransferCharacteristics", "-ColorPrimaries", path).Output()
	if err != nil {
		return imageInfo{}, err
	}
	var info []imageInfo
	if err = json.Unmarshal(raw, &info); err != nil || len(info) != 1 {
		return imageInfo{}, errors.New("could not read image properties")
	}
	return info[0], nil
}

func thumbnail(ctx context.Context, input, output string, info imageInfo) error {
	if info.ImageWidth <= 0 || info.ImageHeight <= 0 || info.ImageWidth > 100_000_000/info.ImageHeight {
		return errors.New("unsupported preview dimensions")
	}
	if info.FileType != "JPEG" && (info.TransferCharacteristics == 16 || info.TransferCharacteristics == 18) {
		// Resize in the source colour space. A gain-map JPEG already contains its
		// camera-rendered SDR base. PQ and HLG rasters require an explicit transfer.
		dir := filepath.Dir(input)
		resized, oriented := filepath.Join(dir, "small.v"), filepath.Join(dir, "oriented.png")
		scale := math.Min(1, 600/float64(max(info.ImageWidth, info.ImageHeight)))
		if err := run(ctx, "vips", "resize", input, resized, strconv.FormatFloat(scale, 'g', -1, 64)); err != nil {
			return err
		}
		if err := run(ctx, "vips", "autorot", resized, oriented+"[strip,bitdepth=16]"); err != nil {
			return err
		}
		data, err := os.ReadFile(oriented)
		if err != nil {
			return err
		}
		img, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			return err
		}
		sdr, err := toneMap(img, info)
		if err != nil {
			return err
		}
		input = filepath.Join(dir, "sdr.png")
		f, err := os.Create(input)
		if err != nil {
			return err
		}
		err = png.Encode(f, sdr)
		closeErr := f.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return run(ctx, "vips", "thumbnail", input, output+"[Q=82,strip]", "600", "--height", "600", "--size", "down", "--export-profile", "srgb")
}

// toneMap converts PQ or HLG samples to linear light, transforms the primaries,
// compresses luminance and encodes sRGB. Alpha never passes through a colour curve.
func toneMap(src image.Image, info imageInfo) (*image.NRGBA, error) {
	matrix := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	switch info.ColorPrimaries {
	case 1: // BT.709 / sRGB
	case 9:
		matrix = [3][3]float64{{1.66049, -.58764, -.07285}, {-.12455, 1.13290, -.00835}, {-.01815, -.10058, 1.11873}}
	case 12:
		matrix = [3][3]float64{{1.22494, -.22494, 0}, {-.04206, 1.04206, 0}, {-.01964, -.07864, 1.09828}}
	default:
		return nil, errors.New("unsupported HDR colour primaries")
	}
	linear := func(v uint16) float64 {
		x := float64(v) / 65535
		if info.TransferCharacteristics == 18 {
			if x <= .5 {
				return x * x / 3
			}
			return (math.Exp((x-.55991073)/.17883277) + .28466892) / 12
		}
		p := math.Pow(x, 1/(2523.0/32))
		return 10000 / 203.0 * math.Pow(math.Max(p-3424.0/4096, 0)/(2413.0/128-2392.0/128*p), 1/(2610.0/16384))
	}
	encode := func(v float64) uint8 {
		v = math.Max(0, math.Min(1, v))
		if v <= .0031308 {
			v *= 12.92
		} else {
			v = 1.055*math.Pow(v, 1/2.4) - .055
		}
		return uint8(math.Round(v * 255))
	}
	b := src.Bounds()
	dst := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			c := color.NRGBA64Model.Convert(src.At(x, y)).(color.NRGBA64)
			r, g, bl := linear(c.R), linear(c.G), linear(c.B)
			mul := func(row [3]float64) float64 { return row[0]*r + row[1]*g + row[2]*bl }
			red, green, blue := mul(matrix[0]), mul(matrix[1]), mul(matrix[2])
			lum := math.Max(0, .2126*red+.7152*green+.0722*blue)
			scale := 1.0
			if info.TransferCharacteristics == 18 {
				scale = 1000 / 203.0 * math.Pow(lum, .2)
			}
			scale /= 1 + lum*scale
			dst.SetNRGBA(x, y, color.NRGBA{R: encode(red * scale), G: encode(green * scale), B: encode(blue * scale), A: uint8(c.A >> 8)})
		}
	}
	return dst, nil
}
