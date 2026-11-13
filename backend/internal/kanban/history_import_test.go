package kanban

import (
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
