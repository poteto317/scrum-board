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

// viewableProjectItems keeps, in order, the items of the project that are not trashed and
// that the user may view. entries are the allowlists of the restricted items; an item
// without an entry has an empty allowlist.
//
// Trash and project are checked here; who may view is the same attachACLState +
// filterVisibleItems the board and the lists use, so the rule lives in one place. They work
// on a copy: the caller's items are left as they are.
func viewableProjectItems(items []Item, entries map[int64]ItemACL, projectID int64, user *User) []Item {
	inProject := make([]Item, 0, len(items))
	for _, it := range items {
		if it.DeletedAt == nil && it.ProjectID == projectID {
			inProject = append(inProject, it)
		}
	}
	attachACLState(inProject, entries)
	return filterVisibleItems(inProject, user)
}
