package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
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
	_, err = tx.ExecContext(ctx, `INSERT INTO item_history(item_id,kind,occurred_at,changes,note,evidence_url,event_key)
 VALUES(?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id`, id, event.Kind, event.OccurredAt, string(payload), event.Note, event.EvidenceURL, key)
	return err
}
func relatedItemsJSON(items []RelatedItem) string {
	if items == nil {
		items = []RelatedItem{}
	}
	type hist struct {
		Kind      string `json:"kind"`
		Number    int64  `json:"number,omitempty"`
		ProjectID int64  `json:"projectId,omitempty"`
		URL       string `json:"url,omitempty"`
		Label     string `json:"label,omitempty"`
	}
	rows := make([]hist, 0, len(items))
	for _, it := range items {
		rows = append(rows, hist{Kind: it.Kind, Number: it.Number, ProjectID: it.ProjectID, URL: it.URL, Label: it.Label})
	}
	payload, err := json.Marshal(rows)
	if err != nil {
		return "[]"
	}
	return string(payload)
}

func historyValues(ctx context.Context, tx *sql.Tx, c Item) (map[string]string, error) {
	var name string
	if err := tx.QueryRowContext(ctx, "SELECT name FROM board_columns WHERE id=?", c.ColumnID).Scan(&name); err != nil {
		return nil, err
	}
	return map[string]string{
		"title": c.Title, "description": c.Description, "solution": c.Solution, "status": name,
		"prUrls": prURLsJSON(c.PRURLs), "relatedItems": relatedItemsJSON(c.RelatedItems), "assignee": c.Assignee,
		"closeReason": c.CloseReason, "favorite": strconv.FormatBool(c.Favorite), "dueAt": dueAtHistoryValue(c.DueAt),
		"archivedAt": historyTimeValue(c.ArchivedAt),
	}, nil
}
func appendHistory(ctx context.Context, tx *sql.Tx, before *Item, after Item, kind string) error {
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
	for _, field := range []string{"title", "description", "solution", "status", "prUrls", "relatedItems", "assignee", "closeReason", "favorite", "dueAt", "archivedAt"} {
		if before == nil || old[field] != values[field] {
			changes = append(changes, HistoryChange{field, old[field], values[field]})
		}
	}
	if len(changes) == 0 {
		return nil
	}
	return insertHistory(ctx, tx, after.ID, HistoryEvent{Kind: kind, OccurredAt: after.UpdatedAt, Changes: changes}, nil)
}

func historyTimeValue(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.UTC().Format(time.RFC3339Nano)
}
