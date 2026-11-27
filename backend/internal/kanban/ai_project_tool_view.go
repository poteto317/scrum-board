package kanban

// Which of the found items a tool may show. No I/O: the allowlists are read by the executor.

// restrictedItemIDs lists the items whose allowlist is needed to decide who may view them.
func restrictedItemIDs(items []Item) []int64 {
	var ids []int64
	for _, it := range items {
		if it.ViewAccess == ViewAccessRestricted {
			ids = append(ids, it.ID)
		}
	}
	return ids
}

// viewableProjectItems keeps, in order, the items that are not trashed and that the user may
// view. When crossProject is false, only items of projectID remain. entries are the allowlists
// of the restricted items; an item without an entry has an empty allowlist.
//
// Trash and (unless crossProject) project are checked here; who may view is the same
// attachACLState + filterVisibleItems the board and the lists use, so the rule lives in one
// place. They work on a copy: the caller's items are left as they are.
func itemInToolScope(it Item, projectID int64, crossProject bool) bool {
	if it.DeletedAt != nil {
		return false
	}
	return crossProject || it.ProjectID == projectID
}

func viewableProjectItems(items []Item, entries map[int64]ItemACL, projectID int64, user *User, crossProject bool) []Item {
	kept := make([]Item, 0, len(items))
	for _, it := range items {
		if itemInToolScope(it, projectID, crossProject) {
			kept = append(kept, it)
		}
	}
	attachACLState(kept, entries)
	return filterVisibleItems(kept, user)
}
