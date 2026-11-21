package kanban

import (
	"context"
	"fmt"
)

const sprintsDDL = `CREATE TABLE IF NOT EXISTS sprints (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 project_id BIGINT NOT NULL,
 name VARCHAR(120) NOT NULL,
 goal TEXT NOT NULL,
 start_date DATE NOT NULL,
 end_date DATE NOT NULL,
 status VARCHAR(16) NOT NULL,
 velocity INT NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_sprints_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT,
 INDEX sprints_project_status (project_id, status),
 INDEX sprints_project_start (project_id, start_date DESC, id DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

const sprintItemsDDL = `CREATE TABLE IF NOT EXISTS sprint_items (
 sprint_id BIGINT NOT NULL,
 item_id BIGINT NOT NULL,
 position INT NOT NULL,
 PRIMARY KEY (sprint_id, item_id),
 CONSTRAINT fk_sprint_items_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
 CONSTRAINT fk_sprint_items_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 INDEX sprint_items_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeSprints creates sprints / sprint_items if missing (additive; L-456 / L-791).
func (r MySQLRepository) InitializeSprints(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_sprints_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("sprints migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_sprints_migrate')")
	if _, err := r.DB.ExecContext(ctx, sprintsDDL); err != nil {
		return fmt.Errorf("create sprints: %w", err)
	}
	if _, err := r.DB.ExecContext(ctx, sprintItemsDDL); err != nil {
		return fmt.Errorf("create sprint_items: %w", err)
	}
	return nil
}
