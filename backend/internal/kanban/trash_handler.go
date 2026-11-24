package kanban

import (
	"log/slog"
	"net/http"
)

func (h handler) listTrash(w http.ResponseWriter, r *http.Request) {
	pid, err := h.resolveByNumberProjectID(r)
	if err != nil {
		fail(w, err)
		return
	}
	entries, err := h.repo.ListTrash(r.Context(), pid)
	if err != nil {
		fail(w, err)
		return
	}
	reply(w, 200, map[string][]TrashItem{"items": filterTrashForViewer(entries, requestUserPtr(r))})
}

// filterTrashForViewer keeps the trash rows the viewer may see.
func filterTrashForViewer(entries []TrashEntry, user *User) []TrashItem {
	out := make([]TrashItem, 0, len(entries))
	for _, entry := range entries {
		if CanView(entry.ACL, user) {
			out = append(out, entry.TrashItem)
		}
	}
	return out
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
	keys, keyErr := h.repo.ListAttachmentObjectKeysByItemID(r.Context(), deleted.ID)
	if keyErr != nil {
		slog.Error("list attachment keys before hard delete", "itemId", deleted.ID, "error", keyErr)
	}
	if err := h.repo.HardDeleteTrashItem(r.Context(), n, pid); err != nil {
		fail(w, err)
		return
	}
	if keyErr == nil {
		// Hard-deleted: rows are gone; keys are orphans.
		h.purgeBlobsBestEffort(r, keys)
	}
	w.WriteHeader(204)
}

func (h handler) purgeTrash(w http.ResponseWriter, r *http.Request) {
	if !h.requireJobRunnerAuth(w, r) {
		return
	}
	keys, keyErr := h.repo.ListAttachmentObjectKeysForExpiredTrash(r.Context(), 0)
	if keyErr != nil {
		slog.Error("list attachment keys before trash purge", "error", keyErr)
	}
	n, err := h.repo.PurgeExpiredTrash(r.Context())
	if err != nil {
		fail(w, err)
		return
	}
	if keyErr == nil {
		// Skip keys that still exist (item restored between list and purge).
		h.purgeOrphanAttachmentBlobs(r, keys)
	}
	reply(w, 200, map[string]int64{"purged": n})
}
