package kanban

import (
	"fmt"
	"time"
)

// NormalizeDueAt accepts RFC3339 with Z or a numeric offset only.
// Empty, timezone-less, date-only, and invalid calendar values are rejected.
// The result is UTC truncated to the minute (seconds always 00).
func NormalizeDueAt(s string) (time.Time, error) {
	if s == "" {
		return time.Time{}, fmt.Errorf("invalid dueAt")
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("invalid dueAt")
	}
	var y, mon, d, hh, mm, ss int
	n, err := fmt.Sscanf(s, "%d-%d-%dT%d:%d:%d", &y, &mon, &d, &hh, &mm, &ss)
	if err != nil || n != 6 {
		return time.Time{}, fmt.Errorf("invalid dueAt")
	}
	ty, tm, td := t.Date()
	th, tmin, tsec := t.Clock()
	if ty != y || int(tm) != mon || td != d || th != hh || tmin != mm || tsec != ss {
		return time.Time{}, fmt.Errorf("invalid dueAt")
	}
	return TruncateDueAtMinute(t), nil
}

// TruncateDueAtMinute normalizes an instant to UTC with seconds always 00.
func TruncateDueAtMinute(t time.Time) time.Time {
	return t.UTC().Truncate(time.Minute)
}

func dueAtHistoryValue(t *time.Time) string {
	if t == nil {
		return ""
	}
	return TruncateDueAtMinute(*t).Format("2006-01-02T15:04:05Z")
}
