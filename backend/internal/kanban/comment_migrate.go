package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (item_comments).
const itemCommentsDDL = `CREATE TABLE IF NOT EXISTS item_comments (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT NOT NULL,
  author VARCHAR(60) NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_comment_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  INDEX comments_item_created (item_id, created_at, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeComments creates item_comments when missing (idempotent CREATE TABLE IF NOT EXISTS).
func (r MySQLRepository) InitializeComments(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, itemCommentsDDL)
	if err != nil {
		return fmt.Errorf("create item_comments: %w", err)
	}
	return nil
}
