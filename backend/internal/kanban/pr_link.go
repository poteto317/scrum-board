package kanban

import "context"

// InitializePRLinks is additive: existing card data and task numbers are untouched.
func (r MySQLRepository) InitializePRLinks(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS card_pr_links (
 card_id BIGINT NOT NULL PRIMARY KEY,
 pr_url VARCHAR(2048) NOT NULL,
 CONSTRAINT fk_card_pr_links_card FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	return err
}
