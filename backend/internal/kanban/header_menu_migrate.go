package kanban

import (
	"context"
	"fmt"
)

const workspaceHeaderMenuDDL = `CREATE TABLE IF NOT EXISTS workspace_header_menu (
  id TINYINT NOT NULL PRIMARY KEY,
  payload JSON NOT NULL,
  CONSTRAINT chk_workspace_header_menu_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeHeaderMenu creates the singleton workspace header-menu prefs table.
func (r MySQLRepository) InitializeHeaderMenu(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_workspace_header_menu_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("workspace_header_menu migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_workspace_header_menu_migrate')")

	if _, err := r.DB.ExecContext(ctx, workspaceHeaderMenuDDL); err != nil {
		return fmt.Errorf("create workspace_header_menu: %w", err)
	}
	return nil
}