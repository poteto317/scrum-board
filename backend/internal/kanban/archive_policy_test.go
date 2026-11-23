package kanban

import (
	"testing"
	"time"
)

func TestIsArchiveDueUsesInclusiveCutoff(t *testing.T) {
	cutoff := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	before := cutoff.Add(-time.Nanosecond)
	after := cutoff.Add(time.Nanosecond)

	tests := []struct {
		name string
		at   *time.Time
		want bool
	}{
		{name: "missing effective time"},
		{name: "before cutoff", at: &before, want: true},
		{name: "exactly at cutoff", at: &cutoff, want: true},
		{name: "after cutoff", at: &after},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isArchiveDue(tt.at, cutoff); got != tt.want {
				t.Fatalf("isArchiveDue(%v, %v) = %t, want %t", tt.at, cutoff, got, tt.want)
			}
		})
	}
}
