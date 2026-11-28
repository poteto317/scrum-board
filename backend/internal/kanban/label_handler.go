package kanban

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

const (
	msgLabelNotFound = "ラベルが見つかりません。"
	msgLabelName     = "ラベル名は1〜40文字で、制御文字や不可視文字を含めず入力してください。"
	msgLabelColor    = "色は #rrggbb 形式（例: #3b82f6）で指定してください。"
	msgLabelIDs      = "labelIds は正の整数の配列（重複を除いて20件まで）で指定してください。"
)

func failLabel(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		reply(w, 404, map[string]string{"message": msgLabelNotFound})
		return
	}
	fail(w, err)
}

func labelPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "ラベルIDが不正です。")
		return 0, false
	}
	return n, true
}

func (h handler) listLabels(w http.ResponseWriter, r *http.Request) {
	labels, err := h.repo.ListLabels(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	if labels == nil {
		labels = []Label{}
	}
	reply(w, 200, map[string][]Label{"labels": labels})
}

func (h handler) createLabel(w http.ResponseWriter, r *http.Request) {
	var in LabelInput
	if !decode(w, r, &in) {
		return
	}
	name, ok := NormalizeLabelName(in.Name)
	if !ok {
		invalid(w, msgLabelName)
		return
	}
	color, ok := NormalizeLabelColor(in.Color)
	if !ok {
		invalid(w, msgLabelColor)
		return
	}
	created, err := h.repo.CreateLabel(r.Context(), LabelInput{Name: name, Color: color})
	if err != nil {
		failLabel(w, err)
		return
	}
	reply(w, 201, created)
}

func (h handler) updateLabel(w http.ResponseWriter, r *http.Request) {
	id, ok := labelPathID(w, r)
	if !ok {
		return
	}
	var body struct {
		Name  json.RawMessage `json:"name"`
		Color json.RawMessage `json:"color"`
	}
	if !decode(w, r, &body) {
		return
	}
	var patch LabelPatch
	if len(body.Name) > 0 {
		var raw string
		if string(body.Name) == "null" || json.Unmarshal(body.Name, &raw) != nil {
			invalid(w, msgLabelName)
			return
		}
		name, valid := NormalizeLabelName(raw)
		if !valid {
			invalid(w, msgLabelName)
			return
		}
		patch.Name = &name
	}
	if len(body.Color) > 0 {
		var raw string
		if string(body.Color) == "null" || json.Unmarshal(body.Color, &raw) != nil {
			invalid(w, msgLabelColor)
			return
		}
		color, valid := NormalizeLabelColor(raw)
		if !valid {
			invalid(w, msgLabelColor)
			return
		}
		patch.Color = &color
	}
	if patch.Name == nil && patch.Color == nil {
		invalid(w, "name か color を指定してください。")
		return
	}
	updated, err := h.repo.UpdateLabel(r.Context(), id, patch)
	if err != nil {
		failLabel(w, err)
		return
	}
	reply(w, 200, updated)
}

func (h handler) deleteLabel(w http.ResponseWriter, r *http.Request) {
	id, ok := labelPathID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteLabel(r.Context(), id); err != nil {
		failLabel(w, err)
		return
	}
	w.WriteHeader(204)
}

// parseItemLabelIDs validates the labelIds of POST/PATCH items (shared). present is false
// when the key was omitted (nothing to do, no error). On a violation errMsg is non-empty.
func parseItemLabelIDs(raw json.RawMessage) (ids []int64, present bool, errMsg string) {
	if len(raw) == 0 {
		return nil, false, ""
	}
	ids, issue := parsePositiveIDList(raw, MaxItemLabelInputLen, true)
	if issue != idListOK || len(ids) > MaxItemLabels {
		return nil, true, msgLabelIDs
	}
	return ids, true, ""
}
