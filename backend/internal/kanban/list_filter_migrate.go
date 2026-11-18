package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

const workspaceListFilterDDL = `CREATE TABLE IF NOT EXISTS workspace_list_filter (
  id TINYINT NOT NULL PRIMARY KEY,
  board_query_text VARCHAR(200) NOT NULL DEFAULT '',
  board_status_ids JSON NOT NULL,
  backlog_query_text VARCHAR(200) NOT NULL DEFAULT '',
  backlog_status_ids JSON NOT NULL,
  CONSTRAINT chk_workspace_list_filter_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeListFilter creates/migrates the singleton workspace list-filter prefs table and seeds defaults.
func (r MySQLRepository) InitializeListFilter(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_workspace_list_filter_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("workspace_list_filter migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_workspace_list_filter_migrate')")

	hasLegacy, err := r.listFilterHasColumn(ctx, "query_text")
	if err != nil {
		return err
	}
	hasBoard, err := r.listFilterHasColumn(ctx, "board_query_text")
	if err != nil {
		return err
	}

	if !hasBoard && !hasLegacy {
		if _, err := r.DB.ExecContext(ctx, workspaceListFilterDDL); err != nil {
			return fmt.Errorf("create workspace_list_filter: %w", err)
		}
	}
	// Resume legacy migrate whenever old columns remain (idempotent ADD/COPY/DROP).
	if hasLegacy {
		if err := r.migrateLegacyListFilter(ctx); err != nil {
			return err
		}
	}

	return r.ensureListFilterRow(ctx)
}

func (r MySQLRepository) listFilterHasColumn(ctx context.Context, column string) (bool, error) {
	var n int
	err := r.DB.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'workspace_list_filter' AND COLUMN_NAME = ?`, column).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

func (r MySQLRepository) migrateLegacyListFilter(ctx context.Context) error {
	for _, stmt := range []string{
		`ALTER TABLE workspace_list_filter ADD COLUMN board_query_text VARCHAR(200) NOT NULL DEFAULT ''`,
		`ALTER TABLE workspace_list_filter ADD COLUMN board_status_ids JSON NULL`,
		`ALTER TABLE workspace_list_filter ADD COLUMN backlog_query_text VARCHAR(200) NOT NULL DEFAULT ''`,
		`ALTER TABLE workspace_list_filter ADD COLUMN backlog_status_ids JSON NULL`,
	} {
		if _, err := r.DB.ExecContext(ctx, stmt); err != nil && !isDupColumnErr(err) {
			return fmt.Errorf("add split list-filter columns: %w", err)
		}
	}

	todoID, err := r.lookupTodoColumnID(ctx)
	if err != nil {
		return err
	}
	backlogIDs := []int64{}
	if todoID > 0 {
		backlogIDs = []int64{todoID}
	}
	backlogRaw, err := json.Marshal(backlogIDs)
	if err != nil {
		return err
	}

	_, err = r.DB.ExecContext(ctx, `
UPDATE workspace_list_filter SET
  board_query_text = query_text,
  board_status_ids = status_ids,
  backlog_query_text = '',
  backlog_status_ids = CAST(? AS JSON)
WHERE id = 1`, string(backlogRaw))
	if err != nil {
		return fmt.Errorf("copy legacy list-filter: %w", err)
	}

	for _, stmt := range []string{
		`ALTER TABLE workspace_list_filter DROP COLUMN query_text`,
		`ALTER TABLE workspace_list_filter DROP COLUMN status_ids`,
	} {
		if _, err := r.DB.ExecContext(ctx, stmt); err != nil && !isUnknownColumnErr(err) {
			return fmt.Errorf("drop legacy list-filter columns: %w", err)
		}
	}

	// Ensure NOT NULL on new JSON columns after backfill.
	for _, stmt := range []string{
		`ALTER TABLE workspace_list_filter MODIFY board_status_ids JSON NOT NULL`,
		`ALTER TABLE workspace_list_filter MODIFY backlog_status_ids JSON NOT NULL`,
	} {
		if _, err := r.DB.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("finalize list-filter columns: %w", err)
		}
	}
	return nil
}

func (r MySQLRepository) ensureListFilterRow(ctx context.Context) error {
	var id int
	err := r.DB.QueryRowContext(ctx, `SELECT id FROM workspace_list_filter WHERE id = 1`).Scan(&id)
	if err == nil {
		return nil
	}
	if err != sql.ErrNoRows {
		return err
	}
	todoID, err := r.lookupTodoColumnID(ctx)
	if err != nil {
		return err
	}
	backlogIDs := []int64{}
	if todoID > 0 {
		backlogIDs = []int64{todoID}
	}
	emptyRaw, err := json.Marshal([]int64{})
	if err != nil {
		return err
	}
	backlogRaw, err := json.Marshal(backlogIDs)
	if err != nil {
		return err
	}
	_, err = r.DB.ExecContext(ctx, `
INSERT INTO workspace_list_filter (id, board_query_text, board_status_ids, backlog_query_text, backlog_status_ids)
VALUES (1, '', CAST(? AS JSON), '', CAST(? AS JSON))`, string(emptyRaw), string(backlogRaw))
	if err != nil {
		return fmt.Errorf("seed workspace_list_filter: %w", err)
	}
	return nil
}

func (r MySQLRepository) lookupTodoColumnID(ctx context.Context) (int64, error) {
	_, cols, err := r.knownColumnIDs(ctx)
	if err != nil {
		return 0, err
	}
	id, ok := resolveTodoColumnID(cols)
	if !ok {
		return 0, nil
	}
	return id, nil
}

func isDupColumnErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "duplicate column")
}

func isUnknownColumnErr(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "check that it exists")
}
