package kanban

import (
	"encoding/json"
	"math"
	"net/http"
	"strings"
	"unicode/utf8"
)

const maxListFilterStatusIDs = 64

func (h handler) getListFilter(w http.ResponseWriter, r *http.Request) {
	f, err := h.repo.GetListFilter(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, ensureWorkspaceFilters(f))
}

func (h handler) putListFilter(w http.ResponseWriter, r *http.Request) {
	f, ok := decodeWorkspaceListFilters(w, r)
	if !ok {
		return
	}
	out, err := h.repo.PutListFilter(r.Context(), f)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, ensureWorkspaceFilters(out))
}

func ensureWorkspaceFilters(f WorkspaceListFilters) WorkspaceListFilters {
	f.Board = ensureListFilter(f.Board)
	f.Backlog = ensureListFilter(f.Backlog)
	return f
}

func ensureListFilter(f ListFilter) ListFilter {
	if f.StatusIDs == nil {
		f.StatusIDs = []int64{}
	}
	return f
}

func decodeWorkspaceListFilters(w http.ResponseWriter, r *http.Request) (WorkspaceListFilters, bool) {
	var body struct {
		Board   json.RawMessage `json:"board"`
		Backlog json.RawMessage `json:"backlog"`
	}
	if !decode(w, r, &body) {
		return WorkspaceListFilters{}, false
	}
	if len(body.Board) == 0 {
		invalid(w, "board を指定してください。")
		return WorkspaceListFilters{}, false
	}
	if len(body.Backlog) == 0 {
		invalid(w, "backlog を指定してください。")
		return WorkspaceListFilters{}, false
	}
	board, ok := decodeOneListFilter(w, body.Board, "board")
	if !ok {
		return WorkspaceListFilters{}, false
	}
	backlog, ok := decodeOneListFilter(w, body.Backlog, "backlog")
	if !ok {
		return WorkspaceListFilters{}, false
	}
	return WorkspaceListFilters{Board: board, Backlog: backlog}, true
}

func decodeOneListFilter(w http.ResponseWriter, raw json.RawMessage, label string) (ListFilter, bool) {
	if string(raw) == "null" {
		invalid(w, label+" はオブジェクトで指定してください。")
		return ListFilter{}, false
	}
	var body struct {
		Query     json.RawMessage `json:"query"`
		StatusIDs json.RawMessage `json:"statusIds"`
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		invalid(w, label+" の形式が不正です。")
		return ListFilter{}, false
	}
	if len(body.Query) == 0 {
		invalid(w, label+".query を指定してください。")
		return ListFilter{}, false
	}
	if string(body.Query) == "null" {
		invalid(w, label+".query は文字列で指定してください。")
		return ListFilter{}, false
	}
	var query string
	if err := json.Unmarshal(body.Query, &query); err != nil {
		invalid(w, label+".query は文字列で指定してください。")
		return ListFilter{}, false
	}
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 200 {
		invalid(w, label+".query は200文字以内で指定してください。")
		return ListFilter{}, false
	}
	if len(body.StatusIDs) == 0 {
		invalid(w, label+".statusIds を指定してください。")
		return ListFilter{}, false
	}
	if string(body.StatusIDs) == "null" {
		invalid(w, label+".statusIds は配列で指定してください。")
		return ListFilter{}, false
	}
	var rawIDs []any
	if err := json.Unmarshal(body.StatusIDs, &rawIDs); err != nil {
		invalid(w, label+".statusIds は数値の配列で指定してください。")
		return ListFilter{}, false
	}
	if len(rawIDs) > maxListFilterStatusIDs {
		invalid(w, label+".statusIds が多すぎます。")
		return ListFilter{}, false
	}
	ids := make([]int64, 0, len(rawIDs))
	for _, v := range rawIDs {
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || n <= 0 {
			invalid(w, label+".statusIds は正の整数のみ指定してください。")
			return ListFilter{}, false
		}
		ids = append(ids, int64(n))
	}
	return ListFilter{Query: query, StatusIDs: ids}, true
}
