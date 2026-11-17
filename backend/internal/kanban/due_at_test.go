package kanban

import (
	"testing"
	"time"
)

func TestNormalizeDueAt(t *testing.T) {
	t.Parallel()

	got, err := NormalizeDueAt("2026-11-17T08:30:45Z")
	if err != nil {
		t.Fatalf("Z: %v", err)
	}
	want := time.Date(2026, 11, 17, 8, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("Z truncate: got %v want %v", got, want)
	}

	got, err = NormalizeDueAt("2026-11-17T17:30:00+09:00")
	if err != nil {
		t.Fatalf("offset: %v", err)
	}
	want = time.Date(2026, 11, 17, 8, 30, 0, 0, time.UTC)
	if !got.Equal(want) {
		t.Fatalf("offset→UTC: got %v want %v", got, want)
	}

	for _, bad := range []string{
		"",
		"2026-11-17T08:30:00",
		"2026-11-17",
		"2026-02-31T08:30:00Z",
		"not-a-date",
	} {
		if _, err := NormalizeDueAt(bad); err == nil {
			t.Fatalf("expected reject for %q", bad)
		}
	}
}
