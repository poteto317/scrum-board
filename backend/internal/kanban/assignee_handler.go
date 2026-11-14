package kanban

import "net/http"

// changeAssigneeByNumber lets agents set the assignee using the public task number.
func (h handler) changeAssigneeByNumber(w http.ResponseWriter, r *http.Request) {
	number, ok := taskNumber(w, r)
	if !ok {
		return
	}
	var input struct {
		Assignee *string `json:"assignee"`
	}
	if !decode(w, r, &input) {
		return
	}
	if input.Assignee == nil {
		invalid(w, "assignee を指定してください。")
		return
	}
	value, valid := NormalizeAssignee(*input.Assignee)
	if !valid {
		invalid(w, "対応者は60文字以内で、制御文字を含めず入力してください。")
		return
	}
	card, err := h.repo.GetCardByNumber(r.Context(), number)
	if err != nil {
		fail(w, err)
		return
	}
	updated, err := h.repo.UpdateCard(r.Context(), card.ID, CardPatch{Assignee: &value})
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, updated)
}
