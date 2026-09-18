package testutil

import "encoding/binary"

// BuildPhotographyJPEG returns a real 20x10 JPEG with deterministic EXIF and an ICC description.
// It includes orientation 6, GPS, lens/exposure settings, and an uninterpreted MakerNote.
func BuildPhotographyJPEG() []byte {
	tiff := BuildPhotographyTIFF()
	exif := append([]byte("Exif\x00\x00"), tiff...)
	icc := append([]byte("ICC_PROFILE\x00\x01\x01"), BuildICCProfile("Display P3")...)
	jpeg := BuildJPEG(20, 10)
	result := append([]byte{}, jpeg[:2]...)
	for _, entry := range []struct {
		marker byte
		data   []byte
	}{{0xe1, exif}, {0xe2, icc}} {
		result = append(result, 0xff, entry.marker, byte((len(entry.data)+2)>>8), byte(len(entry.data)+2))
		result = append(result, entry.data...)
	}
	return append(result, jpeg[2:]...)
}

// BuildPhotographyTIFF returns metadata-only TIFF suitable for EXIF container tests.
func BuildPhotographyTIFF() []byte {
	data := make([]byte, 2048)
	copy(data, "II")
	le := binary.LittleEndian
	le.PutUint16(data[2:], 42)
	le.PutUint32(data[4:], 8)
	next := 1024
	put := func(bytes []byte) uint32 {
		offset := next
		copy(data[offset:], bytes)
		next += len(bytes)
		return uint32(offset)
	}
	entry := func(position int, tag, kind uint16, count, value uint32) {
		le.PutUint16(data[position:], tag)
		le.PutUint16(data[position+2:], kind)
		le.PutUint32(data[position+4:], count)
		le.PutUint32(data[position+8:], value)
	}
	text := func(position int, tag uint16, value string) {
		raw := append([]byte(value), 0)
		var offset uint32
		if len(raw) <= 4 {
			var tmp [4]byte
			copy(tmp[:], raw)
			offset = le.Uint32(tmp[:])
		} else {
			offset = put(raw)
		}
		entry(position, tag, 2, uint32(len(raw)), offset)
	}
	rat := func(position int, tag uint16, numerator, denominator uint32, signed bool) {
		var raw [8]byte
		le.PutUint32(raw[:], numerator)
		le.PutUint32(raw[4:], denominator)
		kind := uint16(5)
		if signed {
			kind = 10
		}
		entry(position, tag, kind, 1, put(raw[:]))
	}
	le.PutUint16(data[8:], 8)
	entry(10, 0x100, 4, 1, 20)
	entry(22, 0x101, 4, 1, 10)
	text(34, 0x10f, "Camera Co")
	text(46, 0x110, "Model A")
	entry(58, 0x112, 3, 1, 6)
	entry(70, 0x8769, 4, 1, 128)
	entry(82, 0x8825, 4, 1, 400)
	entry(94, 0x102, 3, 1, 10)
	le.PutUint16(data[128:], 16)
	rat(130, 0x829a, 1, 125, false)
	rat(142, 0x829d, 28, 10, false)
	entry(154, 0x8827, 3, 1, 200)
	text(166, 0x9003, "2026:09:18 08:20:30")
	text(178, 0x9011, "+08:00")
	text(190, 0x9291, "123")
	text(202, 0xa434, "Lens 35mm")
	rat(214, 0x920a, 35, 1, false)
	entry(226, 0x8822, 3, 1, 3)
	rat(238, 0x9204, 0xffffffff, 3, true)
	entry(250, 0x9207, 3, 1, 5)
	entry(262, 0xa403, 3, 1, 0)
	entry(274, 0xa001, 3, 1, 1)
	entry(286, 0xa405, 3, 1, 50)
	entry(298, 0xa002, 4, 1, 20)
	entry(310, 0x927c, 7, 13, put([]byte("maker-private")))
	le.PutUint16(data[400:], 6)
	text(402, 1, "N")
	text(426, 3, "E")
	entry(450, 5, 1, 1, 1)
	for _, gps := range []struct {
		pos    int
		tag    uint16
		values [3]uint32
	}{{414, 2, [3]uint32{30, 15, 0}}, {438, 4, [3]uint32{120, 10, 30}}} {
		var raw [24]byte
		for i, v := range gps.values {
			le.PutUint32(raw[i*8:], v)
			le.PutUint32(raw[i*8+4:], 1)
		}
		entry(gps.pos, gps.tag, 5, 3, put(raw[:]))
	}
	rat(462, 6, 25, 2, false)
	return data[:next]
}

// BuildICCProfile creates a bounded ICC v2 profile with a textDescription tag.
func BuildICCProfile(description string) []byte {
	text := append([]byte(description), 0)
	data := make([]byte, 144+12+len(text))
	be := binary.BigEndian
	be.PutUint32(data, uint32(len(data)))
	copy(data[36:], "acsp")
	be.PutUint32(data[128:], 1)
	copy(data[132:], "desc")
	be.PutUint32(data[136:], 144)
	be.PutUint32(data[140:], uint32(12+len(text)))
	copy(data[144:], "desc")
	be.PutUint32(data[152:], uint32(len(text)))
	copy(data[156:], text)
	return data
}
