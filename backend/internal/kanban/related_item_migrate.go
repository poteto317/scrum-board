package kanban

import (
	"context"
	"fmt"
)

const cardRelatedItemsDDL = `CREATE TABLE IF NOT EXISTS card_related_items (
 card_id BIGINT NOT NULL,
 position INT NOT NULL,
 kind VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
 related_card_id BIGINT NULL,
 url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NULL,
 label VARCHAR(120) NOT NULL DEFAULT '',
 PRIMARY KEY (card_id, position),
 UNIQUE KEY uq_card_related_card (card_id, related_card_id),
 UNIQUE KEY uq_card_related_url (card_id, url),
 CONSTRAINT fk_card_related_owner FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
 CONSTRAINT fk_card_related_peer FOREIGN KEY(related_card_id) REFERENCES cards(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`

// InitializeRelatedItems creates card_related_items if missing (additive).
func (r MySQLRepository) InitializeRelatedItems(ctx context.Context) error {
	var locked int
	if err := r.DB.QueryRowContext(ctx, "SELECT GET_LOCK('scrumboard_card_related_items_migrate', 30)").Scan(&locked); err != nil {
		return err
	}
	if locked != 1 {
		return fmt.Errorf("card_related_items migrate lock busy")
	}
	defer r.DB.ExecContext(ctx, "SELECT RELEASE_LOCK('scrumboard_card_related_items_migrate')")
	_, err := r.DB.ExecContext(ctx, cardRelatedItemsDDL)
	return err
}
