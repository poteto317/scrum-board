package kanban

import (
	"context"
	"errors"
	"net/http"
	"sort"
)

func (h handler) loadItemACLState(ctx context.Context, item Item) (ItemACLState, error) {
	st := aclStateFromItem(item)
	if item.ViewAccess != ViewAccessRestricted && item.EditAccess != EditAccessRestricted {
		return st, nil
	}
	m, err := h.repo.ListACLEntriesForItems(ctx, []int64{item.ID})
	if err != nil {
		return st, err
	}
	acl := m[item.ID]
	st.ViewUserIDs = acl.ViewUserIDs
	st.EditUserIDs = acl.EditUserIDs
	return st, nil
}

func requestUserPtr(r *http.Request) *User {
	if u, ok := CurrentUser(r.Context()); ok {
		return &u
	}
	return nil
}

func (h handler) enrichItemForReply(ctx context.Context, item *Item, user *User) error {
	st, err := h.loadItemACLState(ctx, *item)
	if err != nil {
		return err
	}
	applyViewerACLFlags(item, st, user)
	return h.filterRelatedItemsForViewer(ctx, item, user)
}

func (h handler) filterRelatedItemsForViewer(ctx context.Context, item *Item, user *User) error {
	if len(item.RelatedItems) == 0 {
		return nil
	}
	out := make([]RelatedItem, 0, len(item.RelatedItems))
	for _, rel := range item.RelatedItems {
		if rel.Kind != relatedKindItem {
			out = append(out, rel)
			continue
		}
		peer, err := h.repo.GetItemByNumber(ctx, rel.Number, rel.ProjectID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				// Missing peer: omit rather than leak ids.
				continue
			}
			return err
		}
		st, err := h.loadItemACLState(ctx, peer)
		if err != nil {
			return err
		}
		if CanView(st, user) {
			out = append(out, rel)
		}
	}
	item.RelatedItems = out
	return nil
}

// applyViewerACLFlags sets canEdit/canManage and manage-only acl on the item copy.
func applyViewerACLFlags(item *Item, st ItemACLState, user *User) {
	item.ViewerCanEdit = CanEdit(st, user)
	item.ViewerCanManage = CanManage(st, user)
	item.ACL = nil
	if !item.ViewerCanManage {
		return
	}
	acl := ItemACL{ViewUserIDs: st.ViewUserIDs, EditUserIDs: st.EditUserIDs}
	if acl.ViewUserIDs == nil {
		acl.ViewUserIDs = []int64{}
	}
	if acl.EditUserIDs == nil {
		acl.EditUserIDs = []int64{}
	}
	item.ACL = &acl
}

func (h handler) requireView(w http.ResponseWriter, r *http.Request, item Item) (ItemACLState, *User, bool) {
	var userPtr *User
	if u, ok := CurrentUser(r.Context()); ok {
		userPtr = &u
	}
	st, err := h.loadItemACLState(r.Context(), item)
	if err != nil {
		fail(w, err)
		return st, userPtr, false
	}
	if !CanView(st, userPtr) {
		if userPtr == nil {
			reply(w, 401, map[string]string{"message": msgLoginRequired})
		} else {
			reply(w, 403, map[string]string{"message": msgViewForbidden})
		}
		return st, userPtr, false
	}
	return st, userPtr, true
}

func (h handler) requireEdit(w http.ResponseWriter, r *http.Request, item Item) (*User, bool) {
	st, userPtr, ok := h.requireView(w, r, item)
	if !ok {
		return nil, false
	}
	if !CanEdit(st, userPtr) {
		reply(w, 403, map[string]string{"message": msgEditForbidden})
		return nil, false
	}
	return userPtr, true
}

// replyIfCannotEdit writes 401/403 when view/edit fails. Shared by requireEdit and requireEditOnLoadedItems.
func replyIfCannotEdit(w http.ResponseWriter, st ItemACLState, userPtr *User) bool {
	if !CanView(st, userPtr) {
		if userPtr == nil {
			reply(w, 401, map[string]string{"message": msgLoginRequired})
		} else {
			reply(w, 403, map[string]string{"message": msgViewForbidden})
		}
		return false
	}
	if !CanEdit(st, userPtr) {
		reply(w, 403, map[string]string{"message": msgEditForbidden})
		return false
	}
	return true
}

func (h handler) requireActiveEdit(w http.ResponseWriter, r *http.Request, item Item) (*User, bool) {
	user, ok := h.requireEdit(w, r, item)
	if !ok {
		return nil, false
	}
	if item.ArchivedAt != nil {
		reply(w, http.StatusConflict, map[string]string{"message": "アーカイブを解除してから変更してください。"})
		return nil, false
	}
	return user, true
}

func (h handler) requireManage(w http.ResponseWriter, r *http.Request, item Item) (*User, bool) {
	st, err := h.loadItemACLState(r.Context(), item)
	if err != nil {
		fail(w, err)
		return nil, false
	}
	user, ok := CurrentUser(r.Context())
	if !ok {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return nil, false
	}
	if !CanManage(st, &user) {
		reply(w, 403, map[string]string{"message": msgForbidden})
		return nil, false
	}
	return &user, true
}

func (h handler) requireActiveManage(w http.ResponseWriter, r *http.Request, item Item) (*User, bool) {
	user, ok := h.requireManage(w, r, item)
	if !ok {
		return nil, false
	}
	if item.ArchivedAt != nil {
		reply(w, http.StatusConflict, map[string]string{"message": "アーカイブを解除してから変更してください。"})
		return nil, false
	}
	return user, true
}

func (h handler) filterBoardItems(ctx context.Context, items []Item, user *User) ([]Item, error) {
	ids := make([]int64, 0, len(items))
	need := false
	for _, it := range items {
		if it.ViewAccess == ViewAccessRestricted || it.EditAccess == EditAccessRestricted {
			need = true
		}
		ids = append(ids, it.ID)
	}
	if need {
		entries, err := h.repo.ListACLEntriesForItems(ctx, ids)
		if err != nil {
			return nil, err
		}
		attachACLState(items, entries)
	}
	visible := filterVisibleItems(items, user)
	if err := h.filterRelatedItemsForViewerBatch(ctx, visible, user); err != nil {
		return nil, err
	}
	return visible, nil
}

// filterRelatedItemsForViewerBatch applies filterRelatedItemsForViewer to each item.
// On error the caller must discard items (partial in-place updates are not returned).
func (h handler) filterRelatedItemsForViewerBatch(ctx context.Context, items []Item, user *User) error {
	for i := range items {
		if err := h.filterRelatedItemsForViewer(ctx, &items[i], user); err != nil {
			return err
		}
	}
	return nil
}

// requireEditOnRelatedPeerDiff rejects the request when any added or removed
// item-kind peer is not editable. Always uses msgEditForbidden (not requireEdit).
func (h handler) requireEditOnRelatedPeerDiff(w http.ResponseWriter, r *http.Request, before, after []RelatedItem) bool {
	userPtr := requestUserPtr(r)
	if userPtr == nil {
		reply(w, 401, map[string]string{"message": msgLoginRequired})
		return false
	}
	for _, rel := range relatedItemPeersDiff(before, after) {
		peer, err := h.repo.GetItemByNumber(r.Context(), rel.Number, rel.ProjectID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			fail(w, err)
			return false
		}
		st, err := h.loadItemACLState(r.Context(), peer)
		if err != nil {
			fail(w, err)
			return false
		}
		if !CanEdit(st, userPtr) {
			reply(w, 403, map[string]string{"message": msgEditForbidden})
			return false
		}
	}
	return true
}

type itemACLPatch struct {
	ViewAccess  string  `json:"viewAccess"`
	EditAccess  string  `json:"editAccess"`
	ViewUserIDs []int64 `json:"viewUserIds"`
	EditUserIDs []int64 `json:"editUserIds"`
}

func (h handler) patchItemACL(w http.ResponseWriter, r *http.Request) {
	n, ok := id(w, r)
	if !ok {
		return
	}
	item, err := h.repo.GetItem(r.Context(), n)
	if err != nil {
		fail(w, err)
		return
	}
	manager, ok := h.requireActiveManage(w, r, item)
	if !ok {
		return
	}
	var in itemACLPatch
	if !decode(w, r, &in) {
		return
	}
	if in.ViewUserIDs == nil {
		in.ViewUserIDs = []int64{}
	}
	if in.EditUserIDs == nil {
		in.EditUserIDs = []int64{}
	}
	all := append(append([]int64{}, in.ViewUserIDs...), in.EditUserIDs...)
	if err := ensureUsersExist(r.Context(), h.repo, dedupeIDs(all)); err != nil {
		reply(w, 400, map[string]string{"message": msgACLInvalid})
		return
	}
	updated, err := h.repo.ReplaceItemACL(r.Context(), n, in.ViewAccess, in.EditAccess, in.ViewUserIDs, in.EditUserIDs)
	if err != nil {
		if err == ErrInvalidACL {
			reply(w, 400, map[string]string{"message": msgACLInvalid})
			return
		}
		fail(w, err)
		return
	}
	if err := h.enrichItemForReply(r.Context(), &updated, manager); err != nil {
		fail(w, err)
		return
	}
	attachPRTitles(r.Context(), h.prTitleResolver, &updated)
	reply(w, 200, updated)
}

// mergeHiddenIntoOrder keeps !CanView cards in their old slots while applying the visible reorder.
func mergeHiddenIntoOrder(oldOrder, visibleOrder []int64, hidden map[int64]struct{}) []int64 {
	out := make([]int64, 0, len(oldOrder))
	vi := 0
	for _, id := range oldOrder {
		if _, isHidden := hidden[id]; isHidden {
			out = append(out, id)
			continue
		}
		if vi < len(visibleOrder) {
			out = append(out, visibleOrder[vi])
			vi++
		}
	}
	for vi < len(visibleOrder) {
		out = append(out, visibleOrder[vi])
		vi++
	}
	return out
}

func (h handler) expandItemOrdersWithHidden(ctx context.Context, orders []ItemColumnOrder, user *User) ([]ItemColumnOrder, []int64, map[int64]Item, error) {
	board, err := h.repo.Board(ctx)
	if err != nil {
		return nil, nil, nil, err
	}
	entries, err := h.repo.ListACLEntriesForItems(ctx, itemIDsOf(board.Items))
	if err != nil {
		return nil, nil, nil, err
	}
	attachACLState(board.Items, entries)
	byID := make(map[int64]Item, len(board.Items))
	byCol := map[int64][]int64{}
	hidden := map[int64]struct{}{}
	for _, it := range board.Items {
		byID[it.ID] = it
		byCol[it.ColumnID] = append(byCol[it.ColumnID], it.ID)
		if !CanView(aclStateFromItem(it), user) {
			hidden[it.ID] = struct{}{}
		}
	}
	for col, ids := range byCol {
		sort.SliceStable(ids, func(i, j int) bool {
			a, b := byID[ids[i]], byID[ids[j]]
			if a.Position != b.Position {
				return a.Position < b.Position
			}
			return a.ID < b.ID
		})
		byCol[col] = ids
	}
	// Stable column order within byCol.
	submittedIDs := make([]int64, 0)
	expanded := make([]ItemColumnOrder, 0, len(orders))
	for _, order := range orders {
		submittedIDs = append(submittedIDs, order.ItemIDs...)
		old := byCol[order.ColumnID]
		merged := mergeHiddenIntoOrder(old, order.ItemIDs, hidden)
		cp := order
		cp.ItemIDs = merged
		if order.OffsetYs != nil && len(merged) != len(order.ItemIDs) {
			// Client OffsetYs align to visible-only payload; drop when hidden slots were inserted.
			cp.OffsetYs = nil
		}
		expanded = append(expanded, cp)
	}
	return expanded, submittedIDs, byID, nil
}

// requireEditOnLoadedItems checks CanEdit against ACL already attached on byID items.
// IDs missing from byID are skipped (ReorderItems returns 409 on set mismatch). No GetItem / ACL reload.
func (h handler) requireEditOnLoadedItems(w http.ResponseWriter, userPtr *User, byID map[int64]Item, ids []int64) bool {
	seen := map[int64]struct{}{}
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		item, ok := byID[id]
		if !ok {
			continue
		}
		if !replyIfCannotEdit(w, aclStateFromItem(item), userPtr) {
			return false
		}
	}
	return true
}

func (h handler) expandBacklogWithHidden(ctx context.Context, visible []int64, user *User) ([]int64, []int64, error) {
	cards, err := h.repo.Backlog(ctx)
	if err != nil {
		return nil, nil, err
	}
	entries, err := h.repo.ListACLEntriesForItems(ctx, itemIDsOf(cards))
	if err != nil {
		return nil, nil, err
	}
	attachACLState(cards, entries)
	old := make([]int64, 0, len(cards))
	hidden := map[int64]struct{}{}
	for _, it := range cards {
		old = append(old, it.ID)
		if !CanView(aclStateFromItem(it), user) {
			hidden[it.ID] = struct{}{}
		}
	}
	return mergeHiddenIntoOrder(old, visible, hidden), visible, nil
}

func (h handler) requireEditOnItemIDs(w http.ResponseWriter, r *http.Request, ids []int64) bool {
	seen := map[int64]struct{}{}
	for _, id := range ids {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		item, err := h.repo.GetItem(r.Context(), id)
		if err != nil {
			// Unknown / missing ids: let Reorder* return ErrItemOrderMismatch (409).
			if err == ErrNotFound {
				continue
			}
			fail(w, err)
			return false
		}
		if _, ok := h.requireEdit(w, r, item); !ok {
			return false
		}
	}
	return true
}
