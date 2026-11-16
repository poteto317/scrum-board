package kanban

import (
	"encoding/json"
	"net/http"
)

func (h handler) listItemCommandTemplatesByNumber(w http.ResponseWriter, r *http.Request) {
	n, ok := taskNumber(w, r)
	if !ok {
		return
	}
	card, err := h.repo.GetItemByNumber(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	list, err := h.repo.ListItemCommandTemplates(r.Context(), card.ID)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]CommandTemplate{"templates": list})
}

func (h handler) replaceItemCommandTemplatesByNumber(w http.ResponseWriter, r *http.Request) {
	n, ok := taskNumber(w, r)
	if !ok {
		return
	}
	card, err := h.repo.GetItemByNumber(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	ids, ok := decodeTemplateIDs(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ReplaceItemCommandTemplates(r.Context(), card.ID, ids)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]CommandTemplate{"templates": list})
}

func (h handler) listCommandTemplateDefaults(w http.ResponseWriter, r *http.Request) {
	ids, err := h.repo.ListCommandTemplateDefaults(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]int64{"templateIds": ids})
}

func (h handler) replaceCommandTemplateDefaults(w http.ResponseWriter, r *http.Request) {
	ids, ok := decodeTemplateIDs(w, r)
	if !ok {
		return
	}
	out, err := h.repo.ReplaceCommandTemplateDefaults(r.Context(), ids)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]int64{"templateIds": out})
}

func (h handler) applyCommandTemplatesToAllItems(w http.ResponseWriter, r *http.Request) {
	ids, ok := decodeTemplateIDs(w, r)
	if !ok {
		return
	}
	if err := h.repo.ApplyCommandTemplatesToAllItems(r.Context(), ids); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}

func decodeTemplateIDs(w http.ResponseWriter, r *http.Request) ([]int64, bool) {
	var body struct {
		TemplateIDs json.RawMessage `json:"templateIds"`
	}
	if !decode(w, r, &body) {
		return nil, false
	}
	if len(body.TemplateIDs) == 0 {
		invalid(w, "templateIds を指定してください。")
		return nil, false
	}
	if string(body.TemplateIDs) == "null" {
		invalid(w, "templateIds は配列で指定してください。")
		return nil, false
	}
	var ids []int64
	if err := json.Unmarshal(body.TemplateIDs, &ids); err != nil {
		invalid(w, "templateIds は数値の配列で指定してください。")
		return nil, false
	}
	if ids == nil {
		ids = []int64{}
	}
	return ids, true
}
