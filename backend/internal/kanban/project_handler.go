package kanban

import (
	"errors"
	"net/http"
	"strconv"
)

func projectPathID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	n, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil || n <= 0 {
		invalid(w, "プロジェクトIDが不正です。")
		return 0, false
	}
	return n, true
}

func failProject(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		reply(w, 404, map[string]string{"message": "プロジェクトが見つかりません。"})
		return
	}
	fail(w, err)
}

func (h handler) listProjects(w http.ResponseWriter, r *http.Request) {
	projects, err := h.repo.ListProjects(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	if projects == nil {
		projects = []Project{}
	}
	reply(w, 200, map[string][]Project{"projects": projects})
}

func (h handler) createProject(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	// Name rules live in CreateProject / normalizeProjectName (repo). No duplicate check here.
	p, err := h.repo.CreateProject(r.Context(), in.Name)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 201, p)
}

func (h handler) updateProject(w http.ResponseWriter, r *http.Request) {
	n, ok := projectPathID(w, r)
	if !ok {
		return
	}
	var in struct {
		Name string `json:"name"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, err := h.repo.UpdateProject(r.Context(), n, in.Name)
	if err != nil {
		failProject(w, err)
		return
	}
	reply(w, 200, p)
}

func (h handler) deleteProject(w http.ResponseWriter, r *http.Request) {
	n, ok := projectPathID(w, r)
	if !ok {
		return
	}
	if err := h.repo.DeleteProject(r.Context(), n); err != nil {
		failProject(w, err)
		return
	}
	w.WriteHeader(204)
}
