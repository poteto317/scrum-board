package kanban

import (
	"context"
	"fmt"
)

// InitializeCommandTemplates creates command_templates when it is missing.
// The column list matches the design DDL. Charset follows the other kanban tables
// so a 60-rune name survives even when the server default is not utf8mb4.
func (r MySQLRepository) InitializeCommandTemplates(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS command_templates (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(60) NOT NULL,
  template VARCHAR(2000) NOT NULL,
  position INT NOT NULL DEFAULT 0,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	if err != nil {
		return fmt.Errorf("create command_templates: %w", err)
	}
	return nil
}
