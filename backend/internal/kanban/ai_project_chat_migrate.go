package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (project_ai_messages).
const projectAIMessagesDDL = `CREATE TABLE IF NOT EXISTS project_ai_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  project_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL,
  body TEXT NOT NULL,
  input_tokens INT NULL,
  output_tokens INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_project_ai_message_project FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  CONSTRAINT fk_project_ai_message_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT chk_project_ai_message_role CHECK (role IN ('user', 'assistant')),
  INDEX project_ai_messages_scope (project_id, user_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeProjectAIChat creates project_ai_messages when missing (idempotent).
// The table references users, so this must run after InitializeUsers
// (InitializeAIChat runs before it and cannot create this table).
func (r MySQLRepository) InitializeProjectAIChat(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, projectAIMessagesDDL); err != nil {
		return fmt.Errorf("create project_ai_messages: %w", err)
	}
	return nil
}
