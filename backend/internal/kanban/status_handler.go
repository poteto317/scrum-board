package kanban

import (
	"net/http"
	"strings"
)

// changeStatusByNumber lets API clients use the same number and column names as the UI.
func (h handler) changeStatusByNumber(w http.ResponseWriter, r *http.Request) {
	number, ok := taskNumber(w, r)
	if !ok {
		return
	}
	var input struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &input) {
		return
	}
	input.Status = strings.TrimSpace(input.Status)
	if !validColumnName(input.Status) {
		invalid(w, "ステータス名は1〜60文字で入力してください。")
		return
	}
	card, err := h.repo.GetCardByNumber(r.Context(), number)
	if err != nil {
		fail(w, err)
		return
	}
	column, err := h.repo.GetColumnByName(r.Context(), input.Status)
	if err != nil {
		fail(w, err)
		return
	}
	updated, err := h.repo.UpdateCard(r.Context(), card.ID, CardPatch{ColumnID: &column.ID})
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, updated)
}
