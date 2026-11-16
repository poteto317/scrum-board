package kanban

import (
	"context"
	"fmt"
)

const cardRelatedItemsDDL = `CREATE TABLE IF NOT EXISTS item_related_items (
 item_id BIGINT NOT NULL,
 position INT NOT NULL,
 kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 related_item_id BIGINT NULL,
 url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NULL,
 label VARCHAR(120) NOT NULL DEFAULT '',
 PRIMARY KEY (item_id, position),
 UNIQUE KEY uq_item_related_item (item_id, related_item_id),
 UNIQUE KEY uq_item_related_url (item_id, url),
 CONSTRAINT fk_item_related_owner FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE,
 CONSTRAINT fk_item_related_peer FOREIGN KEY(related_item_id) REFERENCES items(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeRelatedItems creates item_related_items if missing (additive).
func (r MySQLRepository) InitializeRelatedItems(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_item_related_items_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("item_related_items migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_item_related_items_migrate')")
	_, err := r.DB.ExecContext(ctx, cardRelatedItemsDDL)
	if err != nil {
		return err
	}
	_, err = r.DB.ExecContext(ctx, `UPDATE item_related_items SET kind='item' WHERE kind='card'`)
	return err
}
