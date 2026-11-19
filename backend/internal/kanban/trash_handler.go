package kanban

import (
	"net/http"
)

func (h handler) listTrash(w http.ResponseWriter, r *http.Request) {
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	items, err := h.repo.ListTrash(r.Context(), pid)
	if err != nil {
		fail(w, err)
		return
	}
	userPtr := requestUserPtr(r)
	out := make([]TrashItem, 0, len(items))
	for _, row := range items {
		deleted, err := h.repo.GetDeletedItem(r.Context(), row.ID, pid)
		if err != nil {
			fail(w, err)
			return
		}
		st, err := h.loadItemACLState(r.Context(), deleted)
		if err != nil {
			fail(w, err)
			return
		}
		if CanView(st, userPtr) {
			out = append(out, row)
		}
	}
	reply(w, 200, map[string][]TrashItem{"items": out})
}

func (h handler) restoreItem(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	deleted, err := h.repo.GetDeletedItem(r.Context(), n, pid)
	if err != nil {
		fail(w, err)
		return
	}
	userPtr, okEdit := h.requireEdit(w, r, deleted)
	if !okEdit {
		return
	}
	c, err := h.repo.RestoreItem(r.Context(), n, pid)
	if err != nil {
		fail(w, err)
		return
	}
	if err := h.enrichItemForReply(r.Context(), &c, userPtr); err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, c)
}

func (h handler) hardDeleteTrash(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	deleted, err := h.repo.GetDeletedItem(r.Context(), n, pid)
	if err != nil {
		fail(w, err)
		return
	}
	if _, ok := h.requireEdit(w, r, deleted); !ok {
		return
	}
	if err := h.repo.HardDeleteTrashItem(r.Context(), n, pid); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(204)
}

func (h handler) purgeTrash(w http.ResponseWriter, r *http.Request) {
	n, err := h.repo.PurgeExpiredTrash(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string]int64{"purged": n})
}
