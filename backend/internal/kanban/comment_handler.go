package kanban

import (
	"encoding/json"
	"log/slog"
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
	if errMsg := commentCreateUnknownFields(raw); errMsg != "" {
		invalid(w, errMsg)
		return
	}
	body, ok, errMsg := parseRequiredCommentBody(raw)
	if !ok {
		invalid(w, errMsg)
		return
	}
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	user, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return
	}
	author, ok := commentAuthorFromUser(user)
	if !ok {
		invalid(w, "表示名は60文字以内で、制御文字を含めず入力してください。")
		return
	}
	created, err := h.repo.CreateComment(r.Context(), card.ID, author, body, user.ID)
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
	if errMsg := commentPatchUnknownFields(raw); errMsg != "" {
		invalid(w, errMsg)
		return
	}
	_, hasBody := raw["body"]
	if !hasBody {
		invalid(w, "body を指定してください。")
		return
	}
	body, ok, errMsg := parseRequiredCommentBody(raw)
	if !ok {
		invalid(w, errMsg)
		return
	}
	card, ok := h.commentParentItem(w, r, true)
	if !ok {
		return
	}
	if _, ok := h.requireCommentModifyACL(w, r, card, commentID); !ok {
		return
	}
	updated, err := h.repo.UpdateComment(r.Context(), card.ID, commentID, &body)
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
	if _, ok := h.requireCommentModifyACL(w, r, card, commentID); !ok {
		return
	}
	keys, keyErr := h.repo.ListAttachmentObjectKeysByCommentID(r.Context(), commentID)
	if keyErr != nil {
		slog.Error("list attachment keys before comment delete", "commentId", commentID, "error", keyErr)
	}
	if err := h.repo.DeleteComment(r.Context(), card.ID, commentID); err != nil {
		fail(w, err)
		return
	}
	if keyErr == nil {
		h.purgeBlobsBestEffort(r, keys)
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

// requireCommentModifyACL checks login and comment ownership after the parent item passed edit ACL.
func (h handler) requireCommentModifyACL(w http.ResponseWriter, r *http.Request, card Item, commentID int64) (User, bool) {
	user, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return User{}, false
	}
	cur, err := h.repo.GetComment(r.Context(), card.ID, commentID)
	if err != nil {
		fail(w, err)
		return User{}, false
	}
	if !canModifyComment(user, cur) {
		reply(w, 403, map[string]string{"message": msgForbidden})
		return User{}, false
	}
	return user, true
}

func commentPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	commentID, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || commentID <= 0 {
		invalid(w, "コメントIDが不正です。")
		return 0, false
	}
	return commentID, true
}

func commentCreateUnknownFields(raw map[string]json.RawMessage) string {
	for key := range raw {
		if key != "body" {
			return "不明なフィールドがあります。"
		}
	}
	return ""
}

func commentPatchUnknownFields(raw map[string]json.RawMessage) string {
	for key := range raw {
		if key != "body" {
			return "不明なフィールドがあります。"
		}
	}
	return ""
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