package kanban

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// maxItemSearchMatches is how many matches the project chat looks at. The query reads one
// more row, so that "there are more than this" is known without counting everything.
const maxItemSearchMatches = 200

// ItemSearch is the filter and order of SearchProjectItems. The zero value matches every
// living (not trashed) item of the project that any member may view, newest update first.
type ItemSearch struct {
	// Terms are ANDed. Each one is a case-insensitive substring of the title, description,
	// solution or a comment body; a term like "12" or "#12" also matches the item number.
	Terms []string
	// ColumnID keeps only items in that column.
	ColumnID *int64
	// Assignee keeps only items whose assignee equals it (case-insensitive). Empty = no filter.
	Assignee string
	// DueFrom keeps items due at or after this instant; DueTo keeps items due before this
	// instant (exclusive). Either one drops items without a due date.
	DueFrom, DueTo *time.Time
	// SortByDue orders by due date (soonest first, items without one last) instead of by update time.
	SortByDue bool
	// Viewer is who the search is for: only items this user may view are matched.
	Viewer ItemSearchViewer
}

// ItemSearchViewer is the logged-in, enabled user a search is for (the project chat has no
// anonymous callers). The zero value is a member who created nothing and is on no allowlist.
type ItemSearchViewer struct {
	UserID int64
	Admin  bool
}

// itemSearchViewer is the viewer of a search run for user.
func itemSearchViewer(user *User) ItemSearchViewer {
	if user == nil {
		return ItemSearchViewer{}
	}
	return ItemSearchViewer{UserID: user.ID, Admin: user.Role == RoleAdmin}
}

// itemSearchViewSQL is CanView (item_acl.go) as a condition on items c, for a logged-in,
// enabled viewer. It must mean exactly the same; the MySQL test compares the two case by case.
//   - public and open (an empty value reads as open): every such viewer.
//   - restricted: an admin, the creator, or a user with a view or edit entry in item_acl_entries.
//   - any other stored value: nobody.
//
// The values are compared byte by byte (the columns' collation ignores case, CanView does not).
func itemSearchViewSQL(v ItemSearchViewer) (string, []any) {
	const (
		access     = "c.view_access COLLATE utf8mb4_0900_bin"
		everyone   = access + " IN ('" + ViewAccessPublic + "','" + ViewAccessOpen + "','')"
		restricted = access + "='" + ViewAccessRestricted + "'"
	)
	if v.Admin {
		return "(" + everyone + " OR " + restricted + ")", nil
	}
	return "(" + everyone + " OR (" + restricted + " AND (c.created_by_user_id=?" +
		" OR EXISTS (SELECT 1 FROM item_acl_entries e WHERE e.item_id=c.id AND e.user_id=?" +
		" AND e.capability COLLATE utf8mb4_0900_bin IN ('" + ACLCapabilityView + "','" + ACLCapabilityEdit + "')))))", []any{v.UserID, v.UserID}
}

// projectItemSearchSQL builds the search query. projectID > 0 limits to that project; 0 means
// every project (cross-project search). LIKE uses the default escape character (backslash).
// Who may view an item is decided here, before the LIMIT: a match the viewer may not see takes
// none of the rows, so neither the row count nor "there are more" says anything about it.
func projectItemSearchSQL(projectID int64, s ItemSearch) (string, []any) {
	var b strings.Builder
	b.WriteString("SELECT " + cardFields + numberedCards + " WHERE c.deleted_at IS NULL")
	args := []any{}
	if projectID > 0 {
		b.WriteString(" AND c.project_id=?")
		args = append(args, projectID)
	}
	viewSQL, viewArgs := itemSearchViewSQL(s.Viewer)
	b.WriteString(" AND " + viewSQL)
	args = append(args, viewArgs...)
	if s.ColumnID != nil {
		b.WriteString(" AND c.column_id=?")
		args = append(args, *s.ColumnID)
	}
	if s.Assignee != "" {
		b.WriteString(" AND LOWER(c.assignee)=LOWER(?)")
		args = append(args, s.Assignee)
	}
	if s.DueFrom != nil {
		b.WriteString(" AND c.due_at>=?")
		args = append(args, s.DueFrom.UTC())
	}
	if s.DueTo != nil {
		b.WriteString(" AND c.due_at<?")
		args = append(args, s.DueTo.UTC())
	}
	for _, term := range s.Terms {
		pattern := "%" + escapeLike(term) + "%"
		b.WriteString(" AND (c.title LIKE ? OR c.description LIKE ? OR c.solution LIKE ?" +
			" OR EXISTS (SELECT 1 FROM item_comments m WHERE m.item_id=c.id AND m.body LIKE ?)")
		args = append(args, pattern, pattern, pattern, pattern)
		if number, ok := searchTermNumber(term); ok {
			b.WriteString(" OR n.item_number=?")
			args = append(args, number)
		}
		b.WriteString(")")
	}
	if s.SortByDue {
		b.WriteString(" ORDER BY c.due_at IS NULL, c.due_at ASC, c.id ASC")
	} else {
		b.WriteString(" ORDER BY c.updated_at DESC, c.id DESC")
	}
	fmt.Fprintf(&b, " LIMIT %d", maxItemSearchMatches+1)
	return b.String(), args
}

// SearchProjectItems filters and orders the project's living items (archived ones included,
// trashed ones not) that s.Viewer may view, and returns at most maxItemSearchMatches+1 of them.
func (r MySQLRepository) SearchProjectItems(ctx context.Context, projectID int64, s ItemSearch) ([]Item, error) {
	return r.searchItems(ctx, projectID, s)
}

// SearchViewableItems is SearchProjectItems across every project (no project_id filter).
func (r MySQLRepository) SearchViewableItems(ctx context.Context, s ItemSearch) ([]Item, error) {
	return r.searchItems(ctx, 0, s)
}

func (r MySQLRepository) searchItems(ctx context.Context, projectID int64, s ItemSearch) ([]Item, error) {
	query, args := projectItemSearchSQL(projectID, s)
	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("search project items: %w", err)
	}
	defer rows.Close()
	out := make([]Item, 0)
	for rows.Next() {
		item, err := scanCard(rows)
		if err != nil {
			return nil, fmt.Errorf("scan searched item: %w", err)
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("search project items: %w", err)
	}
	return out, nil
}
