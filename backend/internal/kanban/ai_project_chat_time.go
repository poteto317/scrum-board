package kanban

import "time"

// The project chat reads and writes dates in Asia/Tokyo: today's date in the prompt, the
// dueFrom / dueTo days of a search, and every time in a tool result.

// tokyo is the zone the chat's dates are read and written in. Fixed: Japan has no daylight saving time.
var tokyo = time.FixedZone("Asia/Tokyo", 9*60*60)

func tokyoTime(t time.Time) string { return t.In(tokyo).Format(time.RFC3339) }

func tokyoTimePtr(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := tokyoTime(*t)
	return &s
}

// parseTokyoDate reads YYYY-MM-DD as the start of that day in Asia/Tokyo.
func parseTokyoDate(s string) (time.Time, bool) {
	t, err := time.ParseInLocation("2006-01-02", s, tokyo)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}
