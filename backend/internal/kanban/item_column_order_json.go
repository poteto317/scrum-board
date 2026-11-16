package kanban

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

// UnmarshalJSON decodes offsetYs via json.Number so non-integers (e.g. 1.5) are rejected,
// and DisallowUnknownFields so columns[] elements reject extra keys (parent Decoder does not).
func (o *ItemColumnOrder) UnmarshalJSON(data []byte) error {
	var raw struct {
		ColumnID int64           `json:"columnId"`
		ItemIDs  []int64         `json:"itemIds"`
		OffsetYs json.RawMessage `json:"offsetYs"`
	}
	dec := json.NewDecoder(bytes.NewReader(data))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&raw); err != nil {
		return err
	}
	o.ColumnID = raw.ColumnID
	o.ItemIDs = raw.ItemIDs
	if len(raw.OffsetYs) == 0 || string(raw.OffsetYs) == "null" {
		o.OffsetYs = nil
		return nil
	}
	offDec := json.NewDecoder(bytes.NewReader(raw.OffsetYs))
	offDec.UseNumber()
	var elems []any
	if err := offDec.Decode(&elems); err != nil {
		return fmt.Errorf("%w: offsetYs", ErrItemOrder)
	}
	if err := offDec.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("%w: offsetYs", ErrItemOrder)
	}
	offsets := make([]int, len(elems))
	for i, el := range elems {
		n, ok := el.(json.Number)
		if !ok {
			return fmt.Errorf("%w: offsetYs", ErrItemOrder)
		}
		v, err := n.Int64()
		if err != nil {
			return fmt.Errorf("%w: offsetYs", ErrItemOrder)
		}
		if v > int64(MaxOffsetY) {
			return fmt.Errorf("%w: offsetYs", ErrItemOrder)
		}
		offsets[i] = int(v)
	}
	o.OffsetYs = &offsets
	return nil
}
