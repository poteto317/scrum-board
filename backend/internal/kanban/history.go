package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

type HistoryChange struct {
	Field  string `json:"field"`
	Before string `json:"before"`
	After  string `json:"after"`
}
type HistoryEvent struct {
	ID          int64           `json:"id"`
	Kind        string          `json:"kind"`
	OccurredAt  time.Time       `json:"occurredAt"`
	RecordedAt  time.Time       `json:"recordedAt"`
	Changes     []HistoryChange `json:"changes"`
	Note        string          `json:"note"`
	EvidenceURL string          `json:"evidenceUrl"`
}
type HistoryPage struct {
	Events     []HistoryEvent `json:"events"`
	NextBefore int64          `json:"nextBefore"`
}

func insertHistory(ctx context.Context, tx *sql.Tx, id int64, event HistoryEvent, key any) error {
	payload, err := json.Marshal(event.Changes)
	if err != nil {
		return err
	}
	// A string, not []byte: a binary-charset value is rejected by the JSON column when parameters are interpolated client-side.
	_, err = tx.ExecContext(ctx, `INSERT INTO card_history(card_id,kind,occurred_at,changes,note,evidence_url,event_key)
 VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, id, event.Kind, event.OccurredAt, string(payload), event.Note, event.EvidenceURL, key)
	return err
}
func historyValues(ctx context.Context, tx *sql.Tx, c Card) (map[string]string, error) {
	var name string
	if err := tx.QueryRowContext(ctx, "SELECT name FROM board_columns WHERE id=?", c.ColumnID).Scan(&name); err != nil {
		return nil, err
	}
	return map[string]string{"title": c.Title, "description": c.Description, "status": name, "prUrls": prURLsJSON(c.PRURLs)}, nil
}
func appendHistory(ctx context.Context, tx *sql.Tx, before *Card, after Card, kind string) error {
	values, err := historyValues(ctx, tx, after)
	if err != nil {
		return err
	}
	old := map[string]string{}
	if before != nil {
		old, err = historyValues(ctx, tx, *before)
		if err != nil {
			return err
		}
	}
	changes := []HistoryChange{}
	for _, field := range []string{"title", "description", "status", "prUrls"} {
		if before == nil || old[field] != values[field] {
			changes = append(changes, HistoryChange{field, old[field], values[field]})
		}
	}
	if len(changes) == 0 {
		return nil
	}
	return insertHistory(ctx, tx, after.ID, HistoryEvent{Kind: kind, OccurredAt: after.UpdatedAt, Changes: changes}, nil)
}
