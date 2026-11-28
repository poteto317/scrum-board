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
	LabelIDs  []int64 `json:"labelIds"`
}

// WorkspaceListFilters holds independent board and backlog filters.
type WorkspaceListFilters struct {
	Board   ListFilter `json:"board"`
	Backlog ListFilter `json:"backlog"`
}

func emptyListFilter() ListFilter {
	return ListFilter{Query: "", StatusIDs: []int64{}, LabelIDs: []int64{}}
}

func emptyWorkspaceListFilters() WorkspaceListFilters {
	return WorkspaceListFilters{Board: emptyListFilter(), Backlog: emptyListFilter()}
}

func cloneListFilter(in ListFilter) ListFilter {
	out := ListFilter{Query: in.Query, StatusIDs: []int64{}, LabelIDs: []int64{}}
	if in.StatusIDs != nil {
		out.StatusIDs = append([]int64(nil), in.StatusIDs...)
	}
	if in.LabelIDs != nil {
		out.LabelIDs = append([]int64(nil), in.LabelIDs...)
	}
	return out
}

func normalizeListFilter(in ListFilter, knownCols, knownLabels map[int64]struct{}) ListFilter {
	out := ListFilter{
		Query:     strings.TrimSpace(in.Query),
		StatusIDs: normalizeKnownIDs(in.StatusIDs, knownCols),
		LabelIDs:  normalizeKnownIDs(in.LabelIDs, knownLabels),
	}
	if out.StatusIDs == nil {
		out.StatusIDs = []int64{}
	}
	if out.LabelIDs == nil {
		out.LabelIDs = []int64{}
	}
	return out
}

// parseStoredListFilter maps DB columns to ListFilter. Corrupt JSON yields empty filter without mutation.
func parseStoredListFilter(query string, statusJSON, labelJSON []byte) ListFilter {
	f, ok := parseStoredListFilterOK(query, statusJSON, labelJSON)
	if !ok {
		return emptyListFilter()
	}
	return f
}

func normalizeKnownIDs(ids []int64, known map[int64]struct{}) []int64 {
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

func (r MySQLRepository) columnsWithKnownIDs(ctx context.Context) (map[int64]struct{}, []Column, error) {
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

func (r MySQLRepository) listFilterKnownSets(ctx context.Context) (knownCols map[int64]struct{}, cols []Column, knownLabels map[int64]struct{}, err error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, nil, nil, err
	}
	defer tx.Rollback()
	cols, err = listOrderedColumns(ctx, tx)
	if err != nil {
		return nil, nil, nil, err
	}
	knownCols = make(map[int64]struct{}, len(cols))
	for _, c := range cols {
		knownCols[c.ID] = struct{}{}
	}
	knownLabels, err = knownLabelIDs(ctx, tx)
	if err != nil {
		return nil, nil, nil, err
	}
	return knownCols, cols, knownLabels, nil
}

func (r MySQLRepository) GetListFilter(ctx context.Context) (WorkspaceListFilters, error) {
	knownCols, cols, knownLabels, err := r.listFilterKnownSets(ctx)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	defaults := defaultWorkspaceListFilters(cols)

	var boardQ, backlogQ string
	var boardStatusJSON, backlogStatusJSON, boardLabelJSON, backlogLabelJSON []byte
	err = r.DB.QueryRowContext(ctx, `
SELECT board_query_text, board_status_ids, board_label_ids, backlog_query_text, backlog_status_ids, backlog_label_ids
FROM workspace_list_filter WHERE id = 1`).Scan(&boardQ, &boardStatusJSON, &boardLabelJSON, &backlogQ, &backlogStatusJSON, &backlogLabelJSON)
	if err == sql.ErrNoRows {
		return defaults, nil
	}
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	board, boardOK := parseStoredListFilterOK(boardQ, boardStatusJSON, boardLabelJSON)
	backlog, backlogOK := parseStoredListFilterOK(backlogQ, backlogStatusJSON, backlogLabelJSON)
	if !boardOK {
		board = defaults.Board
	}
	if !backlogOK {
		backlog = defaults.Backlog
	}
	return WorkspaceListFilters{
		Board:   normalizeListFilter(board, knownCols, knownLabels),
		Backlog: normalizeListFilter(backlog, knownCols, knownLabels),
	}, nil
}

func parseStoredIDArray(raw []byte) ([]int64, bool) {
	if len(raw) == 0 {
		return []int64{}, true
	}
	var ids []int64
	if err := json.Unmarshal(raw, &ids); err != nil || ids == nil {
		return nil, false
	}
	return ids, true
}

func parseStoredListFilterOK(query string, statusJSON, labelJSON []byte) (ListFilter, bool) {
	statusIDs, ok := parseStoredIDArray(statusJSON)
	if !ok {
		return emptyListFilter(), false
	}
	labelIDs, ok := parseStoredIDArray(labelJSON)
	if !ok {
		return emptyListFilter(), false
	}
	return ListFilter{Query: query, StatusIDs: statusIDs, LabelIDs: labelIDs}, true
}

func (r MySQLRepository) PutListFilter(ctx context.Context, in WorkspaceListFilters) (WorkspaceListFilters, error) {
	knownCols, _, knownLabels, err := r.listFilterKnownSets(ctx)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	out := WorkspaceListFilters{
		Board:   normalizeListFilter(in.Board, knownCols, knownLabels),
		Backlog: normalizeListFilter(in.Backlog, knownCols, knownLabels),
	}
	boardStatusRaw, err := json.Marshal(out.Board.StatusIDs)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	boardLabelRaw, err := json.Marshal(out.Board.LabelIDs)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	backlogStatusRaw, err := json.Marshal(out.Backlog.StatusIDs)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	backlogLabelRaw, err := json.Marshal(out.Backlog.LabelIDs)
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO workspace_list_filter (id, board_query_text, board_status_ids, board_label_ids, backlog_query_text, backlog_status_ids, backlog_label_ids)
VALUES (1, ?, CAST(? AS JSON), CAST(? AS JSON), ?, CAST(? AS JSON), CAST(? AS JSON))
ON DUPLICATE KEY UPDATE
  board_query_text = VALUES(board_query_text),
  board_status_ids = VALUES(board_status_ids),
  board_label_ids = VALUES(board_label_ids),
  backlog_query_text = VALUES(backlog_query_text),
  backlog_status_ids = VALUES(backlog_status_ids),
  backlog_label_ids = VALUES(backlog_label_ids)`,
		out.Board.Query, string(boardStatusRaw), string(boardLabelRaw),
		out.Backlog.Query, string(backlogStatusRaw), string(backlogLabelRaw))
	if err != nil {
		return WorkspaceListFilters{}, err
	}
	return out, nil
}
