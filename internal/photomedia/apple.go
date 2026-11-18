package photomedia

import (
	"bytes"
	"encoding/binary"

	"github.com/pkg/errors"
)

// appleRenderingNote builds a new camera note containing only the scalar Apple HDR
// fields. Copying the whole MakerNote would also copy private camera data. Offsets
// in this Apple TIFF directory are relative to the beginning of the note.
func appleRenderingNote(note []byte) ([]byte, error) {
	if !bytes.HasPrefix(note, []byte("Apple iOS\x00")) {
		return nil, nil
	}
	if len(note) < 16 {
		return nil, errors.New("incomplete Apple camera note")
	}
	var order binary.ByteOrder
	switch string(note[12:14]) {
	case "MM":
		order = binary.BigEndian
	case "II":
		order = binary.LittleEndian
	default:
		return nil, errors.New("unknown Apple camera byte order")
	}
	count := int(order.Uint16(note[14:16]))
	if count > (len(note)-16)/12 {
		return nil, errors.New("incomplete Apple camera directory")
	}
	var entries [][]byte
	var values [][]byte
	for n := range count {
		entry := note[16+n*12 : 28+n*12]
		tag := order.Uint16(entry)
		if tag != 0xa && tag != 0x21 && tag != 0x30 {
			continue
		}
		kind := order.Uint16(entry[2:])
		if order.Uint32(entry[4:]) != 1 || (tag == 0xa && kind != 9) || (tag != 0xa && kind != 10) {
			return nil, errors.New("unsupported Apple HDR tag layout")
		}
		var value []byte
		if kind == 10 {
			offset := uint64(order.Uint32(entry[8:]))
			if offset+8 > uint64(len(note)) {
				return nil, errors.New("invalid Apple HDR value")
			}
			value = note[offset : offset+8]
		}
		entries = append(entries, entry)
		values = append(values, value)
	}
	if len(entries) == 0 {
		return nil, nil
	}
	out := make([]byte, 16+12*len(entries)+4)
	copy(out, note[:14])
	order.PutUint16(out[14:], uint16(len(entries)))
	for i, entry := range entries {
		at := 16 + 12*i
		copy(out[at:], entry)
		if values[i] != nil {
			order.PutUint32(out[at+8:], uint32(len(out)))
			out = append(out, values[i]...)
		}
	}
	return out, nil
}
