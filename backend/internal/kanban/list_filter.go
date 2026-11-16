package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
)

// ListFilter is the workspace-shared list filter prefs payload.
type ListFilter struct {
	Query     string  `json:"query"`
	StatusIDs []int64 `json:"statusIds"`
}

func emptyListFilter() ListFilter {
	return ListFilter{Query: "", StatusIDs: []int64{}}
}

// parseStoredListFilter maps DB columns to ListFilter. Corrupt status JSON yields empty filter without mutation.
func parseStoredListFilter(query string, statusJSON []byte) ListFilter {
	out := emptyListFilter()
	out.Query = query
	if len(statusJSON) == 0 {
		return out
	}
	var ids []int64
	if err := json.Unmarshal(statusJSON, &ids); err != nil || ids == nil {
		return emptyListFilter()
	}
	out.StatusIDs = ids
	return out
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

func (r MySQLRepository) GetListFilter(ctx context.Context) (ListFilter, error) {
	var query string
	var statusJSON []byte
	err := r.DB.QueryRowContext(ctx, `SELECT query_text, status_ids FROM workspace_list_filter WHERE id = 1`).Scan(&query, &statusJSON)
	if err == sql.ErrNoRows {
		return emptyListFilter(), nil
	}
	if err != nil {
		return ListFilter{}, err
	}
	return parseStoredListFilter(query, statusJSON), nil
}

func (r MySQLRepository) PutListFilter(ctx context.Context, in ListFilter) (ListFilter, error) {
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return ListFilter{}, err
	}
	cols, err := listOrderedColumns(ctx, tx)
	_ = tx.Rollback()
	if err != nil {
		return ListFilter{}, err
	}
	known := make(map[int64]struct{}, len(cols))
	for _, c := range cols {
		known[c.ID] = struct{}{}
	}
	out := ListFilter{
		Query:     strings.TrimSpace(in.Query),
		StatusIDs: normalizeStatusIDs(in.StatusIDs, known),
	}
	if out.StatusIDs == nil {
		out.StatusIDs = []int64{}
	}
	raw, err := json.Marshal(out.StatusIDs)
	if err != nil {
		return ListFilter{}, err
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO workspace_list_filter (id, query_text, status_ids) VALUES (1, ?, CAST(? AS JSON))
ON DUPLICATE KEY UPDATE query_text = VALUES(query_text), status_ids = VALUES(status_ids)`, out.Query, string(raw))
	if err != nil {
		return ListFilter{}, err
	}
	return out, nil
}
