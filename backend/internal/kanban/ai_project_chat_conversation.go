package kanban

// Which conversation a POST /api/projects/{id}/ai-chat is for. It is decided once, before the
// model is called; reading the history and storing the answer use that same conversation.

import "net/http"

const msgProjectChatConversationAndNew = "conversationId と newConversation は同時に指定できません。"

// projectChatTarget is what the request says about its conversation.
type projectChatTarget int

const (
	// projectChatTargetLatest: nothing given. The message continues the latest conversation
	// (a new one when there is none): what the API meant while there was one history, and
	// what a screen from before the conversations still sends.
	projectChatTargetLatest projectChatTarget = iota
	// projectChatTargetNew: "newConversation": true.
	projectChatTargetNew
	// projectChatTargetNamed: "conversationId" given.
	projectChatTargetNamed
)

// projectChatTargetOf reads the target from a request that decodeProjectChatRequest accepted
// (conversationId and newConversation are never both set).
func projectChatTargetOf(req projectAIChatRequest) projectChatTarget {
	switch {
	case req.NewConversation:
		return projectChatTargetNew
	case req.ConversationID != nil:
		return projectChatTargetNamed
	}
	return projectChatTargetLatest
}

// resolveProjectChatConversation finds the conversation the message continues; nil means a
// new one. A named conversation that is not the caller's in this project is answered here
// with 404, before anything of the AI is checked and without calling the model.
func (h handler) resolveProjectChatConversation(w http.ResponseWriter, r *http.Request, projectID, userID int64, req projectAIChatRequest) (*ProjectAIConversation, bool) {
	switch projectChatTargetOf(req) {
	case projectChatTargetNew:
		return nil, true
	case projectChatTargetNamed:
		conversation, err := h.repo.GetProjectAIConversation(r.Context(), projectID, userID, *req.ConversationID)
		if err != nil {
			failProjectAIConversation(w, err)
			return nil, false
		}
		return &conversation, true
	}
	latest, err := h.repo.LatestProjectAIConversation(r.Context(), projectID, userID)
	if err != nil {
		fail(w, err)
		return nil, false
	}
	return latest, true
}

// projectChatConversationID is the id the exchange is stored under: the resolved
// conversation's, or nil for a new conversation.
func projectChatConversationID(conversation *ProjectAIConversation) *int64 {
	if conversation == nil {
		return nil
	}
	return &conversation.ID
}

// projectChatHistoryInStored is the part of the history read before the model call that
// belongs to the conversation the exchange was stored in: all of it when that is the
// conversation the history was read from, none when the exchange went to another one (a new
// conversation, also when the intended one was deleted meanwhile). Messages of a deleted
// conversation are never shown as the new one's.
func projectChatHistoryInStored(storedID int64, readFrom *int64, before []ProjectAIMessage) []ProjectAIMessage {
	if readFrom == nil || *readFrom != storedID {
		return nil
	}
	return before
}
