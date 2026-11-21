package kanban

import (
	"fmt"
	"strings"
	"time"

	"github.com/robfig/cron/v3"
)

// validateCronAndTimezone checks 5-field cron and IANA timezone (L-044).
// Empty timezone is invalid; callers that want a default must omit the field before calling.
// Pure: uses a fixed epoch so validation does not depend on wall-clock time.
func validateCronAndTimezone(cronSpec, timezone string) error {
	_, err := nextFireAfter(cronSpec, timezone, time.Unix(0, 0).UTC())
	return err
}

// nextFireAfter returns the next fire time strictly after `after`, in UTC,
// evaluating the cron schedule in the given IANA timezone.
func nextFireAfter(cronSpec, timezone string, after time.Time) (time.Time, error) {
	spec := strings.TrimSpace(cronSpec)
	tz := strings.TrimSpace(timezone)
	if spec == "" {
		return time.Time{}, fmt.Errorf("%w: empty cron", ErrRecurring)
	}
	if tz == "" {
		return time.Time{}, fmt.Errorf("%w: empty timezone", ErrRecurring)
	}
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: timezone: %v", ErrRecurring, err)
	}
	sched, err := cron.ParseStandard(spec)
	if err != nil {
		return time.Time{}, fmt.Errorf("%w: cron: %v", ErrRecurring, err)
	}
	afterLocal := after.In(loc)
	next := sched.Next(afterLocal)
	if next.IsZero() {
		return time.Time{}, fmt.Errorf("%w: no next fire", ErrRecurring)
	}
	return next.UTC(), nil
}

// shouldFire reports whether the rule should create an item at now.
// T0 is lastFiredAt, or createdAt when lastFiredAt is nil.
func shouldFire(cronSpec, timezone string, lastFiredAt *time.Time, createdAt, now time.Time) (bool, error) {
	t0 := createdAt
	if lastFiredAt != nil {
		t0 = *lastFiredAt
	}
	next, err := nextFireAfter(cronSpec, timezone, t0)
	if err != nil {
		return false, err
	}
	return !next.After(now), nil
}
