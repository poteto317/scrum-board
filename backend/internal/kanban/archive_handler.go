package kanban

import "net/http"

func (h handler) archiveRepository(w http.ResponseWriter) (ArchiveRepository, bool) {
	repo, ok := h.repo.(ArchiveRepository)
	if !ok {
		reply(w, http.StatusServiceUnavailable, map[string]string{"message": "アーカイブ機能を利用できません。"})
		return nil, false
	}
	return repo, true
}

func (h handler) archiveProjectID(r *http.Request) (int64, error) {
	projectID, scoped, err := optionalQueryProjectID(r)
	if err != nil {
		return 0, err
	}
	if scoped {
		return projectID, nil
	}
	return h.activeProjectForByNumber(r.Context())
}

func (h handler) listArchivedItems(w http.ResponseWriter, r *http.Request) {
	repo, ok := h.archiveRepository(w)
	if !ok {
		return
	}
	projectID, err := h.archiveProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	items, err := repo.ListArchivedItems(r.Context(), projectID)
	if err != nil {
		fail(w, err)
		return
	}
	visible, err := h.filterBoardItems(r.Context(), items, requestUserPtr(r))
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, map[string][]Item{"items": visible})
}

func (h handler) restoreArchivedItem(w http.ResponseWriter, r *http.Request) {
	id, ok := id(w, r)
	if !ok {
		return
	}
	repo, ok := h.archiveRepository(w)
	if !ok {
		return
	}
	projectID, err := h.archiveProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	item, err := h.repo.GetItem(r.Context(), id)
	if err != nil {
		fail(w, err)
		return
	}
	if item.ProjectID != projectID || item.ArchivedAt == nil {
		fail(w, ErrNotFound)
		return
	}
	user, ok := h.requireEdit(w, r, item)
	if !ok {
		return
	}
	restored, err := repo.RestoreArchivedItem(r.Context(), id, projectID)
	if err != nil {
		fail(w, err)
		return
	}
	if err = h.enrichItemForReply(r.Context(), &restored, user); err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, restored)
}

func (h handler) autoArchive(w http.ResponseWriter, r *http.Request) {
	if !h.requireJobRunnerAuth(w, r) {
		return
	}
	repo, ok := h.archiveRepository(w)
	if !ok {
		return
	}
	count, err := repo.ArchiveDoneItems(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, http.StatusOK, map[string]int{"archived": count})
}
