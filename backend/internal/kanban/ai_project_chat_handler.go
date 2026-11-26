package kanban

// Routes of /api/projects/{id}/ai-chat: who is asking about which project, and reading and
// clearing the caller's own history. The POST (asking the model) is in ai_project_chat_post.go.

import "net/http"

// projectChatScope resolves the caller and the project of /api/projects/{id}/ai-chat.
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

func (h handler) listProjectAIChat(w http.ResponseWriter, r *http.Request) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	list, err := h.repo.ListProjectAIMessages(r.Context(), project.ID, user.ID)
	if err != nil {
		fail(w, err)
		return
	}
	if list == nil {
		list = []ProjectAIMessage{}
	}
	reply(w, http.StatusOK, map[string]any{"messages": list})
}

func (h handler) clearProjectAIChat(w http.ResponseWriter, r *http.Request) {
	user, project, ok := h.projectChatScope(w, r)
	if !ok {
		return
	}
	if err := h.repo.ClearProjectAIMessages(r.Context(), project.ID, user.ID); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
