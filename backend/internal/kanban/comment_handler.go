package kanban

import (
	"encoding/json"
	"net/http"
	"strconv"
)

func (h handler) listComments(w http.ResponseWriter, r *http.Request) {
	card, ok := h.commentParentItem(w, r, false)
	if !ok {
		return
	}
	list, err := h.repo.ListComments(r.Context(), card.ID)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, map[string][]Comment{"comments": list})
}

func (h handler) createComment(w http.ResponseWriter, r *http.Request) {
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	if errMsg := commentUnknownFields(raw); errMsg != "" {
		invalid(w, errMsg)
		return
	}
	body, ok, errMsg := parseRequiredCommentBody(raw)
	if !ok {
		invalid(w, errMsg)
		return
	}
	author, ok, errMsg := parseOptionalCommentAuthor(raw, true)
	if !ok {
		invalid(w, errMsg)
		return
	}
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	created, err := h.repo.CreateComment(r.Context(), card.ID, author, body)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusCreated, created)
}

func (h handler) updateComment(w http.ResponseWriter, r *http.Request) {
	commentID, ok := commentPathID(w, r)
	if !ok {
		return
	}
	var raw map[string]json.RawMessage
	if !decode(w, r, &raw) {
		return
	}
	if errMsg := commentUnknownFields(raw); errMsg != "" {
		invalid(w, errMsg)
		return
	}
	_, hasAuthor := raw["author"]
	_, hasBody := raw["body"]
	if !hasAuthor && !hasBody {
		invalid(w, "author または body を指定してください。")
		return
	}
	var author *string
	var body *string
	if hasAuthor {
		a, ok, errMsg := parseOptionalCommentAuthor(raw, false)
		if !ok {
			invalid(w, errMsg)
			return
		}
		author = &a
	}
	if hasBody {
		b, ok, errMsg := parseRequiredCommentBody(raw)
		if !ok {
			invalid(w, errMsg)
			return
		}
		body = &b
	}
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	updated, err := h.repo.UpdateComment(r.Context(), card.ID, commentID, author, body)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, updated)
}

func (h handler) deleteComment(w http.ResponseWriter, r *http.Request) {
	commentID, ok := commentPathID(w, r)
	if !ok {
		return
	}
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	if err := h.repo.DeleteComment(r.Context(), card.ID, commentID); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h handler) commentParentItem(w http.ResponseWriter, r *http.Request, needEdit bool) (Item, bool) {
	number, ok := taskNumber(w, r)
	if !ok {
		return Item{}, false
	}
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return Item{}, false
	}
	card, err := h.repo.GetItemByNumber(r.Context(), number, pid)
	if err != nil {
		fail(w, err)
		return Item{}, false
	}
	if needEdit {
		if _, ok := h.requireEdit(w, r, card); !ok {
			return Item{}, false
		}
	} else if _, _, ok := h.requireView(w, r, card); !ok {
		return Item{}, false
	}
	return card, true
}

func commentPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	commentID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || commentID <= 0 {
		invalid(w, "コメントIDが不正です。")
		return 0, false
	}
	return commentID, true
}

func commentUnknownFields(raw map[string]json.RawMessage) string {
	for key := range raw {
		if key != "author" && key != "body" {
			return "不明なフィールドがあります。"
		}
	}
	return ""
}

// parseOptionalCommentAuthor: allowMissing=true treats absent key as "".
func parseOptionalCommentAuthor(raw map[string]json.RawMessage, allowMissing bool) (string, bool, string) {
	authorRaw, hasAuthor := raw["author"]
	if !hasAuthor {
		if allowMissing {
			return "", true, ""
		}
		return "", false, "表示名は60文字以内で、制御文字を含めず入力してください。"
	}
	msg := "表示名は60文字以内で、制御文字を含めず入力してください。"
	if string(authorRaw) == "null" {
		return "", false, msg
	}
	var authorStr string
	if err := json.Unmarshal(authorRaw, &authorStr); err != nil {
		return "", false, msg
	}
	author, ok := NormalizeCommentAuthor(authorStr)
	if !ok {
		return "", false, msg
	}
	return author, true, ""
}

func parseRequiredCommentBody(raw map[string]json.RawMessage) (string, bool, string) {
	bodyRaw, hasBody := raw["body"]
	missing := "本文を入力してください。"
	invalidBody := "本文は1〜4000文字で、制御文字を含めず入力してください。"
	if !hasBody {
		return "", false, missing
	}
	if string(bodyRaw) == "null" {
		return "", false, missing
	}
	var bodyStr string
	if err := json.Unmarshal(bodyRaw, &bodyStr); err != nil {
		return "", false, missing
	}
	body, ok := NormalizeCommentBody(bodyStr)
	if !ok {
		return "", false, invalidBody
	}
	return body, true, ""
}
