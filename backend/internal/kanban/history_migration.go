package kanban

import (
	"context"
	"time"
)

func (r MySQLRepository) prepareHistory(ctx context.Context) error {
	_, err := r.DB.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS card_history (
 id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY, card_id BIGINT NOT NULL,
 kind VARCHAR(20) NOT NULL, occurred_at DATETIME(6) NOT NULL, recorded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 changes JSON NOT NULL, note TEXT NOT NULL, evidence_url VARCHAR(2048) NOT NULL,
 event_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
 UNIQUE KEY history_import(card_id,event_key), INDEX history_order(card_id,occurred_at,id),
 CONSTRAINT fk_history_card FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`)
	return err
}
func (r MySQLRepository) InitializeHistory(ctx context.Context) error {
	if err := r.prepareHistory(ctx); err != nil {
		return err
	}
	rows, err := r.DB.QueryContext(ctx, "SELECT id FROM cards ORDER BY id")
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
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
	if err = tx.QueryRowContext(ctx, "SELECT id FROM cards WHERE id=? FOR UPDATE", id).Scan(&locked); err != nil {
		return dbError(err)
	}
	var exists bool
	if err = tx.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM card_history WHERE card_id=?)", id).Scan(&exists); err != nil {
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
		for _, field := range []string{"title", "description", "status", "prUrls", "assignee"} {
			changes = append(changes, HistoryChange{Field: field, After: values[field]})
		}
		err = insertHistory(ctx, tx, id, HistoryEvent{Kind: "baseline", OccurredAt: time.Now().UTC(), Changes: changes, Note: "履歴機能導入時の状態です。導入前の変更順序や初期内容を示すものではありません。"}, "baseline-v1")
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
