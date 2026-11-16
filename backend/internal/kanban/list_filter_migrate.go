package kanban

import (
	"context"
	"fmt"
)

const workspaceListFilterDDL = `CREATE TABLE IF NOT EXISTS workspace_list_filter (
  id TINYINT NOT NULL PRIMARY KEY,
  query_text VARCHAR(200) NOT NULL DEFAULT '',
  status_ids JSON NOT NULL,
  CONSTRAINT chk_workspace_list_filter_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeListFilter creates the singleton workspace list-filter prefs table.
func (r MySQLRepository) InitializeListFilter(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_workspace_list_filter_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("workspace_list_filter migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_workspace_list_filter_migrate')")
	_, err := r.DB.ExecContext(ctx, workspaceListFilterDDL)
	if err != nil {
		return fmt.Errorf("create workspace_list_filter: %w", err)
	}
	return nil
}
