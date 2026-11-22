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
  created_by_user_id BIGINT NULL,
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
	return r.migrateCommentCreatedByUserID(ctx)
}

func (r MySQLRepository) migrateCommentCreatedByUserID(ctx context.Context) error {
	var count int
	err := r.DB.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'item_comments' AND COLUMN_NAME = 'created_by_user_id'`).Scan(&count)
	if err != nil {
		return fmt.Errorf("check item_comments.created_by_user_id: %w", err)
	}
	if count > 0 {
		return nil
	}
	if _, err = r.DB.ExecContext(ctx, "ALTER TABLE item_comments ADD COLUMN created_by_user_id BIGINT NULL"); err != nil {
		return fmt.Errorf("add item_comments.created_by_user_id: %w", err)
	}
	return nil
}
