package kanban

import (
	"context"
	"fmt"
)

// InitializeItemTemplates creates item_templates when it is missing.
func (r MySQLRepository) InitializeItemTemplates(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS item_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  project_id BIGINT NOT NULL,
  name VARCHAR(60) NOT NULL,
  title_template VARCHAR(200) NOT NULL,
  description_template TEXT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  KEY idx_item_templates_project_position (project_id, position, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	if err != nil {
		return fmt.Errorf("create item_templates: %w", err)
	}
	return nil
}
