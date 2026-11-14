package kanban

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"regexp"
	"sort"
	"time"
	"unicode/utf8"
)

type HistoricalRecord struct {
	Number      int64           `json:"number"`
	CardID      int64           `json:"cardId"`
	CreatedAt   time.Time       `json:"createdAt"`
	Key         string          `json:"key"`
	OccurredAt  time.Time       `json:"occurredAt"`
	Changes     []HistoryChange `json:"changes"`
	Note        string          `json:"note"`
	EvidenceURL string          `json:"evidenceUrl"`
}

var importKey = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

// importClockSkew absorbs clock differences between the host that observed a record and this one.
// occurredAt may precede the card's createdAt (for example a PR merged before the card existed), so only the future is bounded.
const importClockSkew = 5 * time.Minute

func validHistoricalRecord(v HistoricalRecord, now time.Time) bool {
	if v.Number <= 0 || v.CardID <= 0 || v.CreatedAt.IsZero() || v.OccurredAt.IsZero() || v.OccurredAt.Year() < 1000 || v.OccurredAt.Year() > 9999 || v.OccurredAt.Truncate(time.Microsecond).After(now.Add(importClockSkew)) || !importKey.MatchString(v.Key) || len(v.Changes) > 4 || len(v.Note) == 0 || utf8.RuneCountInString(v.Note) > 4000 || !validPRURL(v.EvidenceURL) {
		return false
	}
	seen := map[string]bool{}
	for _, c := range v.Changes {
		if seen[c.Field] {
			return false
		}
		seen[c.Field] = true
		switch c.Field {
		case "title":
			if utf8.RuneCountInString(c.Before) > 200 || utf8.RuneCountInString(c.After) > 200 {
				return false
			}
		case "description":
			if utf8.RuneCountInString(c.Before) > 10000 || utf8.RuneCountInString(c.After) > 10000 {
				return false
			}
		case "status":
			if utf8.RuneCountInString(c.Before) > 60 || utf8.RuneCountInString(c.After) > 60 {
				return false
			}
		case "prUrls":
			if !validImportedPRURLs(c.Before) || !validImportedPRURLs(c.After) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func validImportedPRURLs(raw string) bool {
	if len(raw) > 65536 {
		return false
	}
	var urls []any
	if err := json.Unmarshal([]byte(raw), &urls); err != nil {
		return false
	}
	for _, item := range urls {
		s, ok := item.(string)
		if !ok || s == "" || !validPRURL(s) {
			return false
		}
	}
	return true
}
func (r MySQLRepository) ImportHistory(ctx context.Context, records []HistoricalRecord) error {
	now := time.Now().UTC()
	for _, v := range records {
		if !validHistoricalRecord(v, now) {
			return fmt.Errorf("invalid historical record")
		}
	}
	records = append([]HistoricalRecord(nil), records...)
	sort.SliceStable(records, func(i, j int) bool { return records[i].CardID < records[j].CardID })
	// Read each key after acquiring its card lock, including commits made while waiting.
	tx, err := r.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// Lock by stable card ID order to avoid deadlocks with other import batches.
	// The CLI runs during a maintenance window; live updates also lock cards before history writes.
	for _, v := range records {
		v.OccurredAt = v.OccurredAt.Truncate(time.Microsecond)
		var id int64
		var created time.Time
		err = tx.QueryRowContext(ctx, "SELECT id,created_at FROM cards WHERE id=? FOR UPDATE", v.CardID).Scan(&id, &created)
		if err != nil {
			return dbError(err)
		}
		var number int64
		if err = tx.QueryRowContext(ctx, "SELECT task_number FROM card_numbers WHERE card_id=?", id).Scan(&number); err != nil {
			return dbError(err)
		}
		if number != v.Number || !created.Equal(v.CreatedAt) {
			return fmt.Errorf("card identity mismatch for number %d", v.Number)
		}
		changes := v.Changes
		if changes == nil {
			changes = []HistoryChange{}
		}
		var existing HistoryEvent
		var payload []byte
		err = tx.QueryRowContext(ctx, "SELECT kind,occurred_at,changes,note,evidence_url FROM card_history WHERE card_id=? AND event_key=?", id, v.Key).Scan(&existing.Kind, &existing.OccurredAt, &payload, &existing.Note, &existing.EvidenceURL)
		if err == nil {
			if err = json.Unmarshal(payload, &existing.Changes); err != nil {
				return err
			}
			if existing.Kind != "restored" || !existing.OccurredAt.Equal(v.OccurredAt.Truncate(time.Microsecond)) || !reflect.DeepEqual(existing.Changes, changes) || existing.Note != v.Note || existing.EvidenceURL != v.EvidenceURL {
				return fmt.Errorf("historical key conflict for number %d", v.Number)
			}
			continue
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err = insertHistory(ctx, tx, id, HistoryEvent{Kind: "restored", OccurredAt: v.OccurredAt, Changes: changes, Note: v.Note, EvidenceURL: v.EvidenceURL}, v.Key); err != nil {
			return err
		}
	}
	return tx.Commit()
}
