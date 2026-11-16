package kanban

import (
	"context"
	"fmt"
)

// InitializeItemCommandTemplates creates per-card links and new-card defaults tables.
func (r MySQLRepository) InitializeItemCommandTemplates(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS card_command_templates (
  card_id BIGINT NOT NULL,
  template_id BIGINT NOT NULL,
  position INT NOT NULL DEFAULT 0,
  PRIMARY KEY (card_id, template_id),
  CONSTRAINT fk_card_command_templates_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  CONSTRAINT fk_card_command_templates_template FOREIGN KEY (template_id) REFERENCES command_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	if err != nil {
		return fmt.Errorf("create card_command_templates: %w", err)
	}
	_, err = r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS command_template_defaults (
  template_id BIGINT NOT NULL PRIMARY KEY,
  position INT NOT NULL DEFAULT 0,
  CONSTRAINT fk_command_template_defaults_template FOREIGN KEY (template_id) REFERENCES command_templates(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	if err != nil {
		return fmt.Errorf("create command_template_defaults: %w", err)
	}
	return nil
}
