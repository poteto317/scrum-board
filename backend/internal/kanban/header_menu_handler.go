package kanban

import (
	"encoding/json"
	"net/http"
	"strings"
)

func (h handler) getHeaderMenu(w http.ResponseWriter, r *http.Request) {
	m, err := h.repo.GetHeaderMenu(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, ensureWorkspaceHeaderMenu(m))
}

func (h handler) putHeaderMenu(w http.ResponseWriter, r *http.Request) {
	m, ok := decodeWorkspaceHeaderMenu(w, r)
	if !ok {
		return
	}
	out, err := h.repo.PutHeaderMenu(r.Context(), m)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, ensureWorkspaceHeaderMenu(out))
}

func ensureWorkspaceHeaderMenu(m WorkspaceHeaderMenu) WorkspaceHeaderMenu {
	m.Board = ensurePageHeaderMenu(m.Board)
	m.Backlog = ensurePageHeaderMenu(m.Backlog)
	m.ItemDetail = ensurePageHeaderMenu(m.ItemDetail)
	return m
}

func ensurePageHeaderMenu(p PageHeaderMenu) PageHeaderMenu {
	if p.HiddenIDs == nil {
		p.HiddenIDs = []string{}
	}
	return p
}

func decodeWorkspaceHeaderMenu(w http.ResponseWriter, r *http.Request) (WorkspaceHeaderMenu, bool) {
	var body struct {
		Board      json.RawMessage `json:"board"`
		Backlog    json.RawMessage `json:"backlog"`
		ItemDetail json.RawMessage `json:"itemDetail"`
	}
	if !decode(w, r, &body) {
		return WorkspaceHeaderMenu{}, false
	}
	if len(body.Board) == 0 {
		invalid(w, "board を指定してください。")
		return WorkspaceHeaderMenu{}, false
	}
	if len(body.Backlog) == 0 {
		invalid(w, "backlog を指定してください。")
		return WorkspaceHeaderMenu{}, false
	}
	if len(body.ItemDetail) == 0 {
		invalid(w, "itemDetail を指定してください。")
		return WorkspaceHeaderMenu{}, false
	}
	board, ok := decodeOnePageHeaderMenuPut(w, body.Board, "board", boardBacklogHeaderMenuIDs)
	if !ok {
		return WorkspaceHeaderMenu{}, false
	}
	backlog, ok := decodeOnePageHeaderMenuPut(w, body.Backlog, "backlog", boardBacklogHeaderMenuIDs)
	if !ok {
		return WorkspaceHeaderMenu{}, false
	}
	itemDetail, ok := decodeOnePageHeaderMenuPut(w, body.ItemDetail, "itemDetail", itemDetailHeaderMenuIDs)
	if !ok {
		return WorkspaceHeaderMenu{}, false
	}
	return WorkspaceHeaderMenu{Board: board, Backlog: backlog, ItemDetail: itemDetail}, true
}

func decodeOnePageHeaderMenuPut(w http.ResponseWriter, raw json.RawMessage, label string, catalog map[string]struct{}) (PageHeaderMenu, bool) {
	if string(raw) == "null" {
		invalid(w, label+" はオブジェクトで指定してください。")
		return PageHeaderMenu{}, false
	}
	var body struct {
		HiddenIDs json.RawMessage `json:"hiddenIds"`
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		invalid(w, label+" の形式が不正です。")
		return PageHeaderMenu{}, false
	}
	if len(body.HiddenIDs) == 0 {
		invalid(w, label+".hiddenIds を指定してください。")
		return PageHeaderMenu{}, false
	}
	if string(body.HiddenIDs) == "null" {
		invalid(w, label+".hiddenIds は配列で指定してください。")
		return PageHeaderMenu{}, false
	}
	var rawIDs []any
	if err := json.Unmarshal(body.HiddenIDs, &rawIDs); err != nil {
		invalid(w, label+".hiddenIds は文字列の配列で指定してください。")
		return PageHeaderMenu{}, false
	}
	ids := make([]string, 0, len(rawIDs))
	for _, v := range rawIDs {
		s, ok := v.(string)
		if !ok {
			invalid(w, label+".hiddenIds は文字列の配列で指定してください。")
			return PageHeaderMenu{}, false
		}
		if _, known := catalog[s]; !known {
			invalid(w, label+".hiddenIds に不正な項目 ID が含まれています。")
			return PageHeaderMenu{}, false
		}
		ids = append(ids, s)
	}
	return PageHeaderMenu{HiddenIDs: ids}, true
}