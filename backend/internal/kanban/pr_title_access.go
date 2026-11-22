package kanban

import (
	"context"
)

func itemVisibleToUser(st ItemACLState, user *User) bool {
	return CanView(st, user)
}

func (r MySQLRepository) UserCanResolvePRURL(ctx context.Context, user *User, prURL string) (bool, error) {
	if user == nil || user.Disabled || !validPRURL(prURL) {
		return false, nil
	}
	rows, err := r.DB.QueryContext(ctx, `
SELECT DISTINCT i.id
FROM items i
WHERE i.deleted_at IS NULL
  AND (
    EXISTS (SELECT 1 FROM item_pr_links l WHERE l.item_id = i.id AND l.pr_url = ?)
    OR EXISTS (SELECT 1 FROM item_history h WHERE h.item_id = i.id AND h.evidence_url = ?)
  )`, prURL, prURL)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return false, err
	}
	if len(ids) == 0 {
		return false, nil
	}
	acls, err := r.ListACLEntriesForItems(ctx, ids)
	if err != nil {
		return false, err
	}
	for _, id := range ids {
		item, err := r.GetItem(ctx, id)
		if err != nil {
			continue
		}
		st := aclStateFromItem(item)
		if acl, ok := acls[id]; ok {
			st.ViewUserIDs = acl.ViewUserIDs
			st.EditUserIDs = acl.EditUserIDs
		}
		if itemVisibleToUser(st, user) {
			return true, nil
		}
	}
	return false, nil
}