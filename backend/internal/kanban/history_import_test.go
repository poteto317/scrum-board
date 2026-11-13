package kanban

import (
	"testing"
	"time"
)

func TestHistoricalRecordValidation(t *testing.T) {
	base := HistoricalRecord{Number: 1, CardID: 1, CreatedAt: time.Now(), OccurredAt: time.Now(), Key: "valid-key", Note: "source"}
	if !validHistoricalRecord(base) {
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
		if validHistoricalRecord(v) {
			t.Fatalf("invalid import accepted: %+v", v)
		}
	}
}
