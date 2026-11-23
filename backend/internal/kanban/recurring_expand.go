package kanban

import (
	"fmt"
	"strings"
	"time"
)

const (
	recurringTokenWeekStart = "{{weekStart}}"
	recurringTokenDate      = "{{date}}"
)

// expandRecurringText replaces exact {{weekStart}} and {{date}} using at in loc.
// Unknown {{...}} (including whitespace variants and unclosed braces) are left unchanged.
// Week starts Sunday in loc; both tokens format as YYYY-MM-DD.
func expandRecurringText(template string, at time.Time, loc *time.Location) string {
	if template == "" || loc == nil {
		return template
	}
	local := at.In(loc)
	y, m, d := local.Date()
	dayStart := time.Date(y, m, d, 0, 0, 0, 0, loc)
	weekStart := dayStart.AddDate(0, 0, -int(dayStart.Weekday())) // Sunday=0
	wsY, wsM, wsD := weekStart.Date()
	dateStr := formatYMD(y, m, d)
	weekStr := formatYMD(wsY, wsM, wsD)
	out := template
	out = strings.ReplaceAll(out, recurringTokenWeekStart, weekStr)
	out = strings.ReplaceAll(out, recurringTokenDate, dateStr)
	return out
}

func formatYMD(y int, m time.Month, d int) string {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC).Format("2006-01-02")
}

// materializeRecurringFire loads rule TZ, expands title/description for `at`, then validates.
// Shared by MySQL and memory RunRecurring paths so expand+validate stay one responsibility.
// LoadLocation may run again after shouldFire; kept here so callers need not pass loc.
func materializeRecurringFire(rule RecurringRule, at time.Time) (title, description string, err error) {
	loc, err := time.LoadLocation(strings.TrimSpace(rule.Timezone))
	if err != nil {
		return "", "", fmt.Errorf("%w: timezone: %v", ErrRecurring, err)
	}
	title = expandRecurringText(rule.Title, at, loc)
	description = expandRecurringText(rule.Description, at, loc)
	if !validTitle(title) || !validDescription(description) {
		return "", "", fmt.Errorf("%w: expanded title/description", ErrRecurring)
	}
	return title, description, nil
}
