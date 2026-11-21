package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (recurring_rules).
const recurringRulesDDL = `CREATE TABLE IF NOT EXISTS recurring_rules (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 project_id BIGINT NOT NULL,
 name VARCHAR(80) NOT NULL,
 title VARCHAR(200) NOT NULL,
 description TEXT NOT NULL,
 cron VARCHAR(64) NOT NULL,
 timezone VARCHAR(64) NOT NULL,
 column_id BIGINT NOT NULL,
 enabled TINYINT(1) NOT NULL DEFAULT 1,
 last_fired_at DATETIME(3) NULL,
 created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
 updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
 CONSTRAINT fk_recurring_rules_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
 INDEX recurring_rules_project_id (project_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeRecurringRules creates recurring_rules if missing (additive; L-456).
func (r MySQLRepository) InitializeRecurringRules(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_recurring_rules_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("recurring_rules migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_recurring_rules_migrate')")
	if _, err := r.DB.ExecContext(ctx, recurringRulesDDL); err != nil {
		return fmt.Errorf("create recurring_rules: %w", err)
	}
	return nil
}
