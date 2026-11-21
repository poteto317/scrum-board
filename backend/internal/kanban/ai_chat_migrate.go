package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (item_ai_messages, ai_usage).
const itemAIMessagesDDL = `CREATE TABLE IF NOT EXISTS item_ai_messages (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT NOT NULL,
  role VARCHAR(16) NOT NULL,
  body TEXT NOT NULL,
  input_tokens INT NULL,
  output_tokens INT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_ai_message_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT chk_ai_message_role CHECK (role IN ('user', 'assistant')),
  INDEX ai_messages_item_created (item_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

const aiUsageDDL = `CREATE TABLE IF NOT EXISTS ai_usage (
  id TINYINT NOT NULL PRIMARY KEY,
  request_count BIGINT NOT NULL DEFAULT 0,
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeAIChat creates item_ai_messages and ai_usage when missing (idempotent).
func (r MySQLRepository) InitializeAIChat(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, itemAIMessagesDDL); err != nil {
		return fmt.Errorf("create item_ai_messages: %w", err)
	}
	if _, err := r.DB.ExecContext(ctx, aiUsageDDL); err != nil {
		return fmt.Errorf("create ai_usage: %w", err)
	}
	if _, err := r.DB.ExecContext(ctx, `INSERT IGNORE INTO ai_usage (id, request_count, input_tokens, output_tokens) VALUES (1, 0, 0, 0)`); err != nil {
		return fmt.Errorf("seed ai_usage: %w", err)
	}
	return nil
}
