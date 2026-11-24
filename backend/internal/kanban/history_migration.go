package kanban

import (
	"context"
	"time"
)

func (r MySQLRepository) prepareHistory(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS item_history (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, item_id BIGINT NOT NULL,
 kind VARCHAR(20) NOT NULL, occurred_at DATETIME(6) NOT NULL, recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 changes JSON NOT NULL, note TEXT NOT NULL, evidence_url VARCHAR(2048) NOT NULL,
 event_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
 UNIQUE KEY history_import(item_id,event_key), INDEX history_order(item_id,occurred_at,id),
 CONSTRAINT fk_history_item FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE CASCADE
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	return err
}
// itemIDsWithoutHistory lists, in id order, the items that have no history event yet
// (trash included). Start-up runs this every time, so it is one statement however many
// items exist; the per-item transaction below runs only for the ones returned here.
func (r MySQLRepository) itemIDsWithoutHistory(ctx context.Context) ([]int64, error) {
	rows, err := r.DB.QueryContext(ctx, `SELECT i.id FROM items i
 WHERE NOT EXISTS (SELECT 1 FROM item_history h WHERE h.item_id=i.id) ORDER BY i.id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
func (r MySQLRepository) InitializeHistory(ctx context.Context) error {
	if err := r.prepareHistory(ctx); err != nil {
		return err
	}
	ids, err := r.itemIDsWithoutHistory(ctx)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if err = r.baseline(ctx, id); err != nil {
			return err
		}
	}
	return nil
}
func (r MySQLRepository) baseline(ctx context.Context, id int64) error {
	tx, err := r.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var locked int64
	if err = tx.QueryRowContext(ctx, "SELECT id FROM items WHERE id=? FOR UPDATE", id).Scan(&locked); err != nil {
		return dbError(err)
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM item_history WHERE item_id=?)", id).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		c, err := loadCard(ctx, tx, "SELECT "+cardFields+numberedCards+" WHERE c.id=?", id)
		if err != nil {
			return err
		}
		values, err := historyValues(ctx, tx, c)
		if err != nil {
			return err
		}
		changes := []HistoryChange{}
		for _, field := range []string{"title", "description", "solution", "status", "prUrls", "relatedItems", "assignee", "closeReason", "favorite", "dueAt", "archivedAt"} {
			changes = append(changes, HistoryChange{Field: field, After: values[field]})
		}
		err = insertHistory(ctx, tx, id, HistoryEvent{Kind: "baseline", OccurredAt: time.Now().UTC(), Changes: changes, Note: "履歴機能導入時の状態です。導入前の変更順序や初期内容を示すものではありません。"}, "baseline-v1")
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
