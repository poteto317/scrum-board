package kanban

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestHistoricalRecordValidation(t *testing.T) {
	base := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: time.Now(), OccurredAt: time.Now(), Key: "valid-key", Note: "source"}
	if !validHistoricalRecord(base, time.Now()) {
		t.Fatal("valid metadata rejected")
	}
	for _, mutate := range []func(*HistoricalRecord){
		func(v *HistoricalRecord) { v.CardID = 0 }, func(v *HistoricalRecord) { v.CreatedAt = time.Time{} },
		func(v *HistoricalRecord) { v.OccurredAt = time.Time{} }, func(v *HistoricalRecord) { v.Key = "bad key" },
		func(v *HistoricalRecord) { v.Note = "" }, func(v *HistoricalRecord) { v.EvidenceURL = "javascript:alert(1)" },
		func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "unknown"}} },
		func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "status"}, {Field: "status"}} },
	} {
		v := base
		mutate(&v)
		if validHistoricalRecord(v, time.Now()) {
			t.Fatalf("invalid import accepted: %+v", v)
		}
	}
}

func TestHistoricalRecordRejectsFutureOccurredAt(t *testing.T) {
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	record := func(at time.Time) HistoricalRecord {
		return HistoricalRecord{Number: 1, CardID: 1, CreatedAt: now.Add(-time.Hour), OccurredAt: at, Key: "valid-key", Note: "source"}
	}
	for name, tc := range map[string]struct {
		at   time.Time
		want bool
	}{
		"now":                  {now, true},
		"within clock skew":    {now.Add(importClockSkew), true},
		"past clock skew":      {now.Add(importClockSkew + time.Second), false},
		"one year ahead":       {now.AddDate(1, 0, 0), false},
		"mistyped far future":  {time.Date(2062, 11, 12, 0, 0, 0, 0, time.UTC), false},
		"before createdAt ok":  {now.Add(-2 * time.Hour), true},
		"nanosecond in skew":   {now.Add(importClockSkew).Add(time.Nanosecond), true},
		"microsecond past max": {now.Add(importClockSkew).Add(time.Microsecond), false},
	} {
		if got := validHistoricalRecord(record(tc.at), now); got != tc.want {
			t.Fatalf("%s: valid=%v, want %v", name, got, tc.want)
		}
	}
}

func TestHistoricalRecordLimits(t *testing.T) {
	now := time.Date(2026, 11, 13, 12, 0, 0, 0, time.UTC)
	valid := func() HistoricalRecord {
		return HistoricalRecord{Number: 1, CardID: 1, CreatedAt: now.Add(-time.Hour), OccurredAt: now, Key: "valid-key", Note: "source"}
	}
	long := func(n int) string { return strings.Repeat("あ", n) }
	for name, tc := range map[string]struct {
		mutate func(*HistoricalRecord)
		want   bool
	}{
		"number zero":            {func(v *HistoricalRecord) { v.Number = 0 }, false},
		"number negative":        {func(v *HistoricalRecord) { v.Number = -1 }, false},
		"year 999":               {func(v *HistoricalRecord) { v.OccurredAt = time.Date(999, 1, 1, 0, 0, 0, 0, time.UTC) }, false},
		"year 1000":              {func(v *HistoricalRecord) { v.OccurredAt = time.Date(1000, 1, 1, 0, 0, 0, 0, time.UTC) }, true},
		"key 128 chars":          {func(v *HistoricalRecord) { v.Key = strings.Repeat("k", 128) }, true},
		"key 129 chars":          {func(v *HistoricalRecord) { v.Key = strings.Repeat("k", 129) }, false},
		"note 4000 chars":        {func(v *HistoricalRecord) { v.Note = long(4000) }, true},
		"note 4001 chars":        {func(v *HistoricalRecord) { v.Note = long(4001) }, false},
		"four changes": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{
				{Field: "title"}, {Field: "description"}, {Field: "status"},
				{Field: "prUrls", Before: "[]", After: "[]"},
			}
		}, true},
		"five changes": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{
				{Field: "title"}, {Field: "description"}, {Field: "status"},
				{Field: "prUrls", Before: "[]", After: "[]"}, {Field: "x"},
			}
		}, false},
		"title before 200":       {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "title", Before: long(200)}} }, true},
		"title before 201":       {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "title", Before: long(201)}} }, false},
		"title after 201":        {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "title", After: long(201)}} }, false},
		"description 10000":      {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "description", After: long(10000)}} }, true},
		"description before big": {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "description", Before: long(10001)}} }, false},
		"description after big":  {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "description", After: long(10001)}} }, false},
		"status 60":              {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "status", After: long(60)}} }, true},
		"status 61":              {func(v *HistoricalRecord) { v.Changes = []HistoryChange{{Field: "status", After: long(61)}} }, false},
		"prUrls empty": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "prUrls", Before: "[]", After: "[]"}}
		}, true},
		"prUrls one": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "prUrls", Before: "[]", After: `["https://github.com/a/b/pull/1"]`}}
		}, true},
		"prUrls legacy field": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "prUrl", Before: "", After: "https://github.com/a/b/pull/1"}}
		}, false},
		"prUrls empty element": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "prUrls", Before: "[]", After: `[""]`}}
		}, false},
		"prUrls null element": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "prUrls", Before: "[]", After: `[null]`}}
		}, false},
		"prUrls too long": {func(v *HistoricalRecord) {
			v.Changes = []HistoryChange{{Field: "prUrls", Before: "[]", After: strings.Repeat("a", 65537)}}
		}, false},
	} {
		v := valid()
		tc.mutate(&v)
		if got := validHistoricalRecord(v, now); got != tc.want {
			t.Fatalf("%s: valid=%v, want %v", name, got, tc.want)
		}
	}
}

func fieldChanges(fields ...string) []HistoryChange {
	out := []HistoryChange{}
	for _, f := range fields {
		out = append(out, HistoryChange{Field: f})
	}
	return out
}

func TestHistoryJSONContract(t *testing.T) {
	page := HistoryPage{NextBefore: 7, Events: []HistoryEvent{{ID: 1, Kind: "restored", OccurredAt: time.Unix(1, 0).UTC(), RecordedAt: time.Unix(2, 0).UTC(), Changes: []HistoryChange{{Field: "status", Before: "Todo", After: "Done"}}, Note: "n", EvidenceURL: "https://github.com/a/b/pull/1"}}}
	data, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	var generic map[string]any
	if err = json.Unmarshal(data, &generic); err != nil {
		t.Fatal(err)
	}
	if _, ok := generic["nextBefore"]; !ok || len(generic) != 2 {
		t.Fatalf("page keys: %s", data)
	}
	event := generic["events"].([]any)[0].(map[string]any)
	for _, key := range []string{"id", "kind", "occurredAt", "recordedAt", "changes", "note", "evidenceUrl"} {
		if _, ok := event[key]; !ok {
			t.Fatalf("event key %q missing: %s", key, data)
		}
	}
	if len(event) != 7 {
		t.Fatalf("unexpected event keys: %s", data)
	}
	change := event["changes"].([]any)[0].(map[string]any)
	for _, key := range []string{"field", "before", "after"} {
		if _, ok := change[key]; !ok || len(change) != 3 {
			t.Fatalf("change key %q missing: %s", key, data)
		}
	}
	// The import manifest uses the same camelCase names as the API.
	record := `{"number":1,"cardId":2,"createdAt":"2026-01-01T00:00:00Z","key":"k","occurredAt":"2026-01-02T00:00:00Z","changes":[],"note":"n","evidenceUrl":"https://github.com/a/b/pull/1"}`
	var decoded HistoricalRecord
	if err = json.Unmarshal([]byte(record), &decoded); err != nil || decoded.CardID != 2 || decoded.EvidenceURL == "" || decoded.Key != "k" || decoded.Note != "n" {
		t.Fatalf("manifest keys: %+v %v", decoded, err)
	}
}
