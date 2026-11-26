package kanban

// Routes of /api/projects/{id}/ai-chat: who is asking about which project, reading the
// caller's latest conversation and clearing all of the caller's conversations. The POST
// (asking the model) is in ai_project_chat_post.go, the routes of single conversations in
// ai_project_conversation_handler.go.

import "net/http"

// projectChatScope resolves the caller and the project of /api/projects/{id}/ai-chat and
// /api/projects/{id}/ai-conversations.
// It answers 401, 400 or 404 itself.
func (h handler) projectChatScope(w http.ResponseWriter, r *http.Request) (User, Project, bool) {
	user, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, http.StatusUnauthorized, map[string]string{"message": msgLoginRequired})
		return User{}, Project{}, false
	}
	id, ok := projectPathID(w, r)
	if !ok {
		return User{}, Project{}, false
	}
	projects, err := h.repo.ListProjects(r.Context())
	if err != nil {
		fail(w, err)
		return User{}, Project{}, false
	}
	for _, p := range projects {
		if p.ID == id {
			return user, p, true
		}
	}
	failProject(w, ErrNotFound)
	return User{}, Project{}, false
}

// latestProjectAIChat answers the caller's latest conversation in the project with its
// messages: what the chat shows when it is opened. Without any conversation it answers
// "conversation": null and no messages.
func (h handler) latestProjectAIChat(w http.ResponseWriter, r *http.Request) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	latest, err := h.repo.LatestProjectAIConversation(r.Context(), project.ID, user.ID)
	if err != nil {
		fail(w, err)
		return
	}
	if latest == nil {
		reply(w, http.StatusOK, map[string]any{"conversation": nil, "messages": []ProjectAIMessage{}})
		return
	}
	h.replyProjectAIConversation(w, r, project.ID, user.ID, *latest)
}

// clearProjectAIChat deletes all of the caller's conversations in the project.
func (h handler) clearProjectAIChat(w http.ResponseWriter, r *http.Request) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	if err := h.repo.ClearProjectAIConversations(r.Context(), project.ID, user.ID); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
