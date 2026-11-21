package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (item_attachments).
const itemAttachmentsDDL = `CREATE TABLE IF NOT EXISTS item_attachments (
  id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  item_id BIGINT NOT NULL,
  comment_id BIGINT NULL,
  field VARCHAR(16) NOT NULL,
  object_key VARCHAR(512) NOT NULL,
  content_type VARCHAR(64) NOT NULL,
  byte_size INT NOT NULL,
  original_name VARCHAR(200) NOT NULL,
  created_by_user_id BIGINT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_attachment_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  CONSTRAINT fk_attachment_comment FOREIGN KEY (comment_id) REFERENCES item_comments(id) ON DELETE CASCADE,
  UNIQUE KEY uq_attachment_object_key (object_key),
  INDEX attachments_item_id (item_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeItemAttachments creates item_attachments when missing (idempotent).
func (r MySQLRepository) InitializeItemAttachments(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, itemAttachmentsDDL)
	if err != nil {
		return fmt.Errorf("create item_attachments: %w", err)
	}
	return nil
}
