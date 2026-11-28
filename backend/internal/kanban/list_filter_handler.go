package kanban

import (
	"encoding/json"
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
	if f.LabelIDs == nil {
		f.LabelIDs = []int64{}
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
	board, errMsg := parseOneListFilter(body.Board, "board")
	if errMsg != "" {
		invalid(w, errMsg)
		return WorkspaceListFilters{}, false
	}
	backlog, errMsg := parseOneListFilter(body.Backlog, "backlog")
	if errMsg != "" {
		invalid(w, errMsg)
		return WorkspaceListFilters{}, false
	}
	return WorkspaceListFilters{Board: board, Backlog: backlog}, true
}

func parseOneListFilter(raw json.RawMessage, label string) (ListFilter, string) {
	if string(raw) == "null" {
		return ListFilter{}, label + " はオブジェクトで指定してください。"
	}
	var body struct {
		Query     json.RawMessage `json:"query"`
		StatusIDs json.RawMessage `json:"statusIds"`
		LabelIDs  json.RawMessage `json:"labelIds"`
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		return ListFilter{}, label + " の形式が不正です。"
	}
	if len(body.Query) == 0 {
		return ListFilter{}, label + ".query を指定してください。"
	}
	if string(body.Query) == "null" {
		return ListFilter{}, label + ".query は文字列で指定してください。"
	}
	var query string
	if err := json.Unmarshal(body.Query, &query); err != nil {
		return ListFilter{}, label + ".query は文字列で指定してください。"
	}
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 200 {
		return ListFilter{}, label + ".query は200文字以内で指定してください。"
	}
	if len(body.StatusIDs) == 0 {
		return ListFilter{}, label + ".statusIds を指定してください。"
	}
	ids, issue := parsePositiveIDList(body.StatusIDs, maxListFilterStatusIDs, false)
	switch issue {
	case idListNull:
		return ListFilter{}, label + ".statusIds は配列で指定してください。"
	case idListBadFormat:
		return ListFilter{}, label + ".statusIds は数値の配列で指定してください。"
	case idListTooMany:
		return ListFilter{}, label + ".statusIds が多すぎます。"
	case idListBadElement:
		return ListFilter{}, label + ".statusIds は正の整数のみ指定してください。"
	}
	labelIDs := []int64{}
	if len(body.LabelIDs) > 0 {
		parsedLabels, labelIssue := parsePositiveIDList(body.LabelIDs, MaxListFilterLabelIDs, true)
		if labelIssue != idListOK {
			return ListFilter{}, label + ".labelIds は正の整数の配列（64件まで）で指定してください。"
		}
		labelIDs = parsedLabels
	}
	return ListFilter{Query: query, StatusIDs: ids, LabelIDs: labelIDs}, ""
}
