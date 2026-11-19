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
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	card, err := h.repo.GetItemByNumber(r.Context(), number, pid)
	if err != nil {
		fail(w, err)
		return
	}
	if _, ok := h.requireEdit(w, r, card); !ok {
		return
	}
	column, err := h.repo.GetColumnByName(r.Context(), input.Status)
	if err != nil {
		fail(w, err)
		return
	}
	updated, err := h.repo.UpdateItem(r.Context(), card.ID, ItemPatch{ColumnID: &column.ID})
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, updated)
}
