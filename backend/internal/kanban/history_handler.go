package kanban

import (
	"net/http"
	"strconv"
)

func (h handler) history(w http.ResponseWriter, r *http.Request) {
	number, ok := taskNumber(w, r)
	if !ok {
		return
	}
	var before int64
	if values, exists := r.URL.Query()["before"]; exists {
		var err error
		if len(values) != 1 {
			invalid(w, "履歴カーソルが不正です。")
			return
		}
		before, err = strconv.ParseInt(values[0], 10, 64)
		if err != nil || before <= 0 {
			invalid(w, "履歴カーソルが不正です。")
			return
		}
	}
	page, err := h.repo.History(r.Context(), number, before)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, page)
}
