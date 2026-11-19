package kanban

import (
	"context"
	"fmt"
	"strings"
)

// ListACLEntriesForItems returns allowlists keyed by item id.
func (r MySQLRepository) ListACLEntriesForItems(ctx context.Context, itemIDs []int64) (map[int64]ItemACL, error) {
	out := make(map[int64]ItemACL, len(itemIDs))
	if len(itemIDs) == 0 {
		return out, nil
	}
	placeholders := make([]string, len(itemIDs))
	args := make([]any, len(itemIDs))
	for i, id := range itemIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	q := `SELECT item_id, user_id, capability FROM item_acl_entries WHERE item_id IN (` + strings.Join(placeholders, ",") + `)`
	rows, err := r.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var itemID, userID int64
		var cap string
		if err := rows.Scan(&itemID, &userID, &cap); err != nil {
			return nil, err
		}
		acl := out[itemID]
		switch cap {
		case ACLCapabilityView:
			acl.ViewUserIDs = append(acl.ViewUserIDs, userID)
		case ACLCapabilityEdit:
			acl.EditUserIDs = append(acl.EditUserIDs, userID)
		}
		out[itemID] = acl
	}
	return out, rows.Err()
}

// ReplaceItemACL replaces policy columns and allowlist entries in one transaction.
func (r MySQLRepository) ReplaceItemACL(ctx context.Context, id int64, viewAccess, editAccess string, viewIDs, editIDs []int64) (Item, error) {
	if err := ValidateViewAccess(viewAccess); err != nil {
		return Item{}, ErrInvalidACL
	}
	if err := ValidateEditAccess(editAccess); err != nil {
		return Item{}, ErrInvalidACL
	}
	viewIDs = dedupeIDs(viewIDs)
	editIDs = dedupeIDs(editIDs)
	// edit implies view in stored entries
	viewSet := map[int64]struct{}{}
	for _, id := range viewIDs {
		viewSet[id] = struct{}{}
	}
	for _, id := range editIDs {
		if _, ok := viewSet[id]; !ok {
			viewIDs = append(viewIDs, id)
			viewSet[id] = struct{}{}
		}
	}

	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return Item{}, err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.ExecContext(ctx, `UPDATE items SET view_access=?, edit_access=? WHERE id=? AND deleted_at IS NULL`,
		viewAccess, editAccess, id)
	if err != nil {
		return Item{}, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return Item{}, err
	}
	if n == 0 {
		return Item{}, ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM item_acl_entries WHERE item_id=?`, id); err != nil {
		return Item{}, err
	}
	for _, uid := range viewIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO item_acl_entries(item_id,user_id,capability) VALUES(?,?,?)`,
			id, uid, ACLCapabilityView); err != nil {
			return Item{}, dbError(err)
		}
	}
	for _, uid := range editIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO item_acl_entries(item_id,user_id,capability) VALUES(?,?,?)`,
			id, uid, ACLCapabilityEdit); err != nil {
			return Item{}, dbError(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return Item{}, err
	}
	item, err := r.GetItem(ctx, id)
	if err != nil {
		return Item{}, err
	}
	aclMap, err := r.ListACLEntriesForItems(ctx, []int64{id})
	if err != nil {
		return Item{}, err
	}
	acl := aclMap[id]
	if acl.ViewUserIDs == nil {
		acl.ViewUserIDs = []int64{}
	}
	if acl.EditUserIDs == nil {
		acl.EditUserIDs = []int64{}
	}
	item.ACL = &acl
	return item, nil
}

func dedupeIDs(ids []int64) []int64 {
	seen := map[int64]struct{}{}
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

func attachACLState(items []Item, entries map[int64]ItemACL) {
	for i := range items {
		acl := entries[items[i].ID]
		if acl.ViewUserIDs == nil {
			acl.ViewUserIDs = []int64{}
		}
		if acl.EditUserIDs == nil {
			acl.EditUserIDs = []int64{}
		}
		// Keep on item for evaluation only; callers strip before reply unless manage.
		cp := acl
		items[i].ACL = &cp
	}
}

func filterVisibleItems(items []Item, user *User) []Item {
	out := make([]Item, 0, len(items))
	for _, it := range items {
		st := aclStateFromItem(it)
		if CanView(st, user) {
			it.ACL = nil // never on list responses
			out = append(out, it)
		}
	}
	return out
}

func ensureUsersExist(ctx context.Context, r Repository, ids []int64) error {
	for _, id := range ids {
		if _, err := r.GetUser(ctx, id); err != nil {
			return fmt.Errorf("%w: user %d", ErrInvalidACL, id)
		}
	}
	return nil
}
