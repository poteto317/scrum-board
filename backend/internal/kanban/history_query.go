package kanban

import (
	"context"
	"encoding/json"
	"time"
)

func (r MySQLRepository) History(ctx context.Context, number, before int64) (HistoryPage, error) {
	page := HistoryPage{Events: []HistoryEvent{}}
	c, err := r.GetCardByNumber(ctx, number)
	if err != nil {
		return page, err
	}
	query := "SELECT id,kind,occurred_at,recorded_at,changes,note,evidence_url FROM card_history WHERE card_id=?"
	args := []any{c.ID}
	if before > 0 {
		var at time.Time
		if err = r.DB.QueryRowContext(ctx, "SELECT occurred_at FROM card_history WHERE id=? AND card_id=?", before, c.ID).Scan(&at); err != nil {
			return page, dbError(err)
		}
		query += " AND (occurred_at<? OR (occurred_at=? AND id<?))"
		args = append(args, at, at, before)
	}
	rows, err := r.DB.QueryContext(ctx, query+" ORDER BY occurred_at DESC,id DESC LIMIT 51", args...)
	if err != nil {
		return page, err
	}
	defer rows.Close()
	for rows.Next() {
		var e HistoryEvent
		var payload []byte
		if err = rows.Scan(&e.ID, &e.Kind, &e.OccurredAt, &e.RecordedAt, &payload, &e.Note, &e.EvidenceURL); err != nil {
			return page, err
		}
		if err = json.Unmarshal(payload, &e.Changes); err != nil {
			return page, err
		}
		page.Events = append(page.Events, e)
	}
	if err = rows.Err(); err != nil {
		return page, err
	}
	if len(page.Events) > 50 {
		page.Events = page.Events[:50]
		page.NextBefore = page.Events[49].ID
	}
	return page, nil
}
