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
	if f.StatusIDs == nil {
		f.StatusIDs = []int64{}
	}
	reply(w, 200, f)
}

func (h handler) putListFilter(w http.ResponseWriter, r *http.Request) {
	f, ok := decodeListFilter(w, r)
	if !ok {
		return
	}
	out, err := h.repo.PutListFilter(r.Context(), f)
	if err != nil {
		fail(w, err)
		return
	}
	if out.StatusIDs == nil {
		out.StatusIDs = []int64{}
	}
	reply(w, 200, out)
}

func decodeListFilter(w http.ResponseWriter, r *http.Request) (ListFilter, bool) {
	var body struct {
		Query     json.RawMessage `json:"query"`
		StatusIDs json.RawMessage `json:"statusIds"`
	}
	if !decode(w, r, &body) {
		return ListFilter{}, false
	}
	if len(body.Query) == 0 {
		invalid(w, "query を指定してください。")
		return ListFilter{}, false
	}
	if string(body.Query) == "null" {
		invalid(w, "query は文字列で指定してください。")
		return ListFilter{}, false
	}
	var query string
	if err := json.Unmarshal(body.Query, &query); err != nil {
		invalid(w, "query は文字列で指定してください。")
		return ListFilter{}, false
	}
	query = strings.TrimSpace(query)
	if utf8.RuneCountInString(query) > 200 {
		invalid(w, "query は200文字以内で指定してください。")
		return ListFilter{}, false
	}
	if len(body.StatusIDs) == 0 {
		invalid(w, "statusIds を指定してください。")
		return ListFilter{}, false
	}
	if string(body.StatusIDs) == "null" {
		invalid(w, "statusIds は配列で指定してください。")
		return ListFilter{}, false
	}
	var raw []any
	if err := json.Unmarshal(body.StatusIDs, &raw); err != nil {
		invalid(w, "statusIds は数値の配列で指定してください。")
		return ListFilter{}, false
	}
	if len(raw) > maxListFilterStatusIDs {
		invalid(w, "statusIds が多すぎます。")
		return ListFilter{}, false
	}
	ids := make([]int64, 0, len(raw))
	for _, v := range raw {
		n, ok := v.(float64)
		if !ok || math.IsNaN(n) || math.IsInf(n, 0) || n != math.Trunc(n) || n <= 0 {
			invalid(w, "statusIds は正の整数のみ指定してください。")
			return ListFilter{}, false
		}
		ids = append(ids, int64(n))
	}
	return ListFilter{Query: query, StatusIDs: ids}, true
}
