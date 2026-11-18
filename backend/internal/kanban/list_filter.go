package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
)

// ListFilter is one view's list filter prefs.
type ListFilter struct {
	Query     string  `json:"query"`
	StatusIDs []int64 `json:"statusIds"`
}

// WorkspaceListFilters holds independent board and backlog filters.
type WorkspaceListFilters struct {
	Board   ListFilter `json:"board"`
	Backlog ListFilter `json:"backlog"`
}

func emptyListFilter() ListFilter {
	return ListFilter{Query: "", StatusIDs: []int64{}}
}

func emptyWorkspaceListFilters() WorkspaceListFilters {
	return WorkspaceListFilters{Board: emptyListFilter(), Backlog: emptyListFilter()}
}

func cloneListFilter(in ListFilter) ListFilter {
	out := ListFilter{Query: in.Query, StatusIDs: []int64{}}
	if in.StatusIDs != nil {
		out.StatusIDs = append([]int64(nil), in.StatusIDs...)
	}
	return out
}

func normalizeListFilter(in ListFilter, known map[int64]struct{}) ListFilter {
	out := ListFilter{
		Query:     strings.TrimSpace(in.Query),
		StatusIDs: normalizeStatusIDs(in.StatusIDs, known),
	}
	if out.StatusIDs == nil {
		out.StatusIDs = []int64{}
	}
	return out
}

// parseStoredListFilter maps DB columns to ListFilter. Corrupt status JSON yields empty filter without mutation.
func parseStoredListFilter(query string, statusJSON []byte) ListFilter {
	f, ok := parseStoredListFilterOK(query, statusJSON)
	if !ok {
		return emptyListFilter()
	}
	return f
}

func normalizeStatusIDs(ids []int64, known map[int64]struct{}) []int64 {
	seen := make(map[int64]struct{}, len(ids))
	out := make([]int64, 0, len(ids))
	for _, id := range ids {
		if _, ok := known[id]; !ok {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}

// resolveTodoColumnID picks the first column whose trimmed name equals "todo" (case-insensitive) by position then id.
func resolveTodoColumnID(cols []Column) (int64, bool) {
	bestID := int64(0)
	bestPos := 0
	found := false
	for _, c := range cols {
		if !strings.EqualFold(strings.TrimSpace(c.Name), "todo") {
			continue
		}
		if !found || c.Position < bestPos || (c.Position == bestPos && c.ID < bestID) {
			bestID = c.ID
			bestPos = c.Position
			found = true
		}
	}
	return bestID, found
}

func defaultWorkspaceListFilters(cols []Column) WorkspaceListFilters {
	out := emptyWorkspaceListFilters()
	if id, ok := resolveTodoColumnID(cols); ok {
		out.Backlog.StatusIDs = []int64{id}
	}
	return out
}

func (r MySQLRepository) knownColumnIDs(ctx context.Context) (map[int64]struct{}, []Column, error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, err
	}
	cols, err := listOrderedColumns(ctx, tx)
	_ = tx.Rollback()
	if err != nil {
		return nil, nil, err
	}
	known := make(map[int64]struct{}, len(cols))
	for _, c := range cols {
		known[c.ID] = struct{}{}
	}
	return known, cols, nil
}

func (r MySQLRepository) GetListFilter(ctx context.Context) (WorkspaceListFilters, error) {
	known, cols, err := r.knownColumnIDs(ctx)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	defaults := defaultWorkspaceListFilters(cols)

	var boardQ, backlogQ string
	var boardJSON, backlogJSON []byte
	err = r.DB.QueryRowContext(ctx, `
SELECT board_query_text, board_status_ids, backlog_query_text, backlog_status_ids
FROM workspace_list_filter WHERE id = 1`).Scan(&boardQ, &boardJSON, &backlogQ, &backlogJSON)
	if err == sql.ErrNoRows {
		return defaults, nil
	}
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	board, boardOK := parseStoredListFilterOK(boardQ, boardJSON)
	backlog, backlogOK := parseStoredListFilterOK(backlogQ, backlogJSON)
	if !boardOK {
		board = defaults.Board
	}
	if !backlogOK {
		backlog = defaults.Backlog
	}
	return WorkspaceListFilters{
		Board:   normalizeListFilter(board, known),
		Backlog: normalizeListFilter(backlog, known),
	}, nil
}

func parseStoredListFilterOK(query string, statusJSON []byte) (ListFilter, bool) {
	if len(statusJSON) == 0 {
		return ListFilter{Query: query, StatusIDs: []int64{}}, true
	}
	var ids []int64
	if err := json.Unmarshal(statusJSON, &ids); err != nil || ids == nil {
		return emptyListFilter(), false
	}
	return ListFilter{Query: query, StatusIDs: ids}, true
}

func (r MySQLRepository) PutListFilter(ctx context.Context, in WorkspaceListFilters) (WorkspaceListFilters, error) {
	known, _, err := r.knownColumnIDs(ctx)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	out := WorkspaceListFilters{
		Board:   normalizeListFilter(in.Board, known),
		Backlog: normalizeListFilter(in.Backlog, known),
	}
	boardRaw, err := json.Marshal(out.Board.StatusIDs)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	backlogRaw, err := json.Marshal(out.Backlog.StatusIDs)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO workspace_list_filter (id, board_query_text, board_status_ids, backlog_query_text, backlog_status_ids)
VALUES (1, ?, CAST(? AS JSON), ?, CAST(? AS JSON))
ON DUPLICATE KEY UPDATE
  board_query_text = VALUES(board_query_text),
  board_status_ids = VALUES(board_status_ids),
  backlog_query_text = VALUES(backlog_query_text),
  backlog_status_ids = VALUES(backlog_status_ids)`,
		out.Board.Query, string(boardRaw), out.Backlog.Query, string(backlogRaw))
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	return out, nil
}
