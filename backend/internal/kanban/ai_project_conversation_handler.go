package kanban

// Routes of /api/projects/{id}/ai-conversations: listing, reading and deleting the caller's
// own conversations in a project. A conversation that is missing, another user's or another
// project's is the same 404, so the reply does not tell whether it exists.

import (
	"errors"
	"net/http"
	"strconv"
)

const (
	msgProjectAIConversationInvalidID = "会話IDが不正です。"
	msgProjectAIConversationNotFound  = "会話が見つかりません。"
)

// projectAIConversationPathID reads {cid}. It answers 400 itself.
func projectAIConversationPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("cid"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, msgProjectAIConversationInvalidID)
		return 0, false
	}
	return n, true
}

// failProjectAIConversation answers a repository error of a conversation: ErrNotFound is the
// conversation's 404 (fail would call it an item), anything else goes through fail.
func failProjectAIConversation(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		reply(w, http.StatusNotFound, map[string]string{"message": msgProjectAIConversationNotFound})
		return
	}
	fail(w, err)
}

// projectAIConversationScope resolves the caller, the project and {cid}, in this order.
// It answers 401, 400 or 404 (project) itself.
func (h handler) projectAIConversationScope(w http.ResponseWriter, r *http.Request) (User, Project, int64, bool) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return User{}, Project{}, 0, false
	}
	conversationID, ok := projectAIConversationPathID(w, r)
	if !ok {
		return User{}, Project{}, 0, false
	}
	return user, project, conversationID, true
}

func (h handler) listProjectAIConversations(w http.ResponseWriter, r *http.Request) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListProjectAIConversations(r.Context(), project.ID, user.ID)
	if err != nil {
		fail(w, err)
		return
	}
	if list == nil {
		list = []ProjectAIConversation{}
	}
	reply(w, http.StatusOK, map[string]any{"conversations": list})
}

func (h handler) getProjectAIConversation(w http.ResponseWriter, r *http.Request) {
	user, project, conversationID, ok := h.projectAIConversationScope(w, r)
	if !ok {
		return
	}
	conversation, err := h.repo.GetProjectAIConversation(r.Context(), project.ID, user.ID, conversationID)
	if err != nil {
		failProjectAIConversation(w, err)
		return
	}
	h.replyProjectAIConversation(w, r, project.ID, user.ID, conversation)
}

// replyProjectAIConversation answers 200 with the conversation and its messages, oldest first.
func (h handler) replyProjectAIConversation(w http.ResponseWriter, r *http.Request, projectID, userID int64, conversation ProjectAIConversation) {
	list, err := h.repo.ListProjectAIMessages(r.Context(), projectID, userID, conversation.ID)
	if err != nil {
		fail(w, err)
		return
	}
	if list == nil {
		list = []ProjectAIMessage{}
	}
	reply(w, http.StatusOK, map[string]any{"conversation": conversation, "messages": list})
}

func (h handler) deleteProjectAIConversation(w http.ResponseWriter, r *http.Request) {
	user, project, conversationID, ok := h.projectAIConversationScope(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteProjectAIConversation(r.Context(), project.ID, user.ID, conversationID); err != nil {
		failProjectAIConversation(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
