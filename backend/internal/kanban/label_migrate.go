package kanban

import (
	"context"
	"fmt"
)

// Keep in sync with database/init/001_schema.sql (labels).
// name_key holds LabelNameKey(name); 720 = 40 scalars * 18 (largest NFKC expansion).
const labelsDDL = `CREATE TABLE IF NOT EXISTS labels (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
 name VARCHAR(40) NOT NULL,
 name_key VARCHAR(720) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
 color CHAR(7) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_labels_name_key (name_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// Keep in sync with database/init/001_schema.sql (item_labels). Must come after labels and items.
const itemLabelsDDL = `CREATE TABLE IF NOT EXISTS item_labels (
 item_id BIGINT NOT NULL,
 label_id BIGINT NOT NULL,
 PRIMARY KEY (item_id, label_id),
 INDEX idx_item_labels_label_item (label_id, item_id),
 CONSTRAINT fk_item_labels_item FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
 CONSTRAINT fk_item_labels_label FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeLabels creates labels and item_labels when they are missing.
func (r MySQLRepository) InitializeLabels(ctx context.Context) error {
	if _, err := r.DB.ExecContext(ctx, labelsDDL); err != nil {
		return fmt.Errorf("create labels: %w", err)
	}
	if _, err := r.DB.ExecContext(ctx, itemLabelsDDL); err != nil {
		return fmt.Errorf("create item_labels: %w", err)
	}
	return nil
}
