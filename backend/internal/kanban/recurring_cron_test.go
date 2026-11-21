package kanban

import (
	"errors"
	"testing"
	"time"
)

func TestNextFireAfterValidCron(t *testing.T) {
	after := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)
	next, err := nextFireAfter("0 9 * * 1", "Asia/Tokyo", after)
	if err != nil {
		t.Fatal(err)
	}
	if next.IsZero() || !next.After(after) {
		t.Fatalf("next=%v after=%v", next, after)
	}
}

func TestNextFireAfterRejectsBadCron(t *testing.T) {
	after := time.Now().UTC()
	cases := []string{"", "0 9 * * * *", "not a cron", "* * *"}
	for _, spec := range cases {
		if _, err := nextFireAfter(spec, "Asia/Tokyo", after); err == nil || !errors.Is(err, ErrRecurring) {
			t.Fatalf("cron %q: err=%v", spec, err)
		}
	}
}

func TestNextFireAfterRejectsBadTimezone(t *testing.T) {
	after := time.Now().UTC()
	if _, err := nextFireAfter("0 9 * * 1", "", after); err == nil || !errors.Is(err, ErrRecurring) {
		t.Fatalf("empty tz: %v", err)
	}
	if _, err := nextFireAfter("0 9 * * 1", "Not/AZone", after); err == nil || !errors.Is(err, ErrRecurring) {
		t.Fatalf("unknown tz: %v", err)
	}
	if err := validateCronAndTimezone("0 9 * * 1", "Asia/Tokyo"); err != nil {
		t.Fatal(err)
	}
	if err := validateCronAndTimezone("0 9 * * 1", ""); err == nil || !errors.Is(err, ErrRecurring) {
		t.Fatalf("validate empty tz: %v", err)
	}
}

func TestShouldFireUsesCreatedAtWhenLastFiredNil(t *testing.T) {
	created := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 11, 21, 1, 0, 0, 0, time.UTC)
	// Daily at 00:00 UTC: next after created is 2026-11-21 00:00 UTC <= now → fire.
	fire, err := shouldFire("0 0 * * *", "UTC", nil, created, now)
	if err != nil || !fire {
		t.Fatalf("fire=%v err=%v", fire, err)
	}
	// Before next tick → skip.
	early := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	fire, err = shouldFire("0 0 * * *", "UTC", nil, created, early)
	if err != nil || fire {
		t.Fatalf("expected skip: fire=%v err=%v", fire, err)
	}
}

func TestShouldFireUsesLastFiredAtWhenSet(t *testing.T) {
	created := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)
	last := time.Date(2026, 11, 20, 0, 0, 0, 0, time.UTC)
	now := time.Date(2026, 11, 20, 12, 0, 0, 0, time.UTC)
	// Next after last is 2026-11-21 00:00 > now → skip.
	fire, err := shouldFire("0 0 * * *", "UTC", &last, created, now)
	if err != nil || fire {
		t.Fatalf("expected skip: fire=%v err=%v", fire, err)
	}
}

func TestShouldFireTimezoneDifferenceTokyoVsUTC(t *testing.T) {
	// cron 15:00 local; T0 just before Tokyo's 15:00; now shortly after Tokyo 15:00 (=06:00 UTC).
	t0 := time.Date(2026, 11, 21, 5, 0, 0, 0, time.UTC)
	now := time.Date(2026, 11, 21, 6, 30, 0, 0, time.UTC)
	tokyoFire, err := shouldFire("0 15 * * *", "Asia/Tokyo", &t0, t0, now)
	if err != nil {
		t.Fatal(err)
	}
	utcFire, err := shouldFire("0 15 * * *", "UTC", &t0, t0, now)
	if err != nil {
		t.Fatal(err)
	}
	if !tokyoFire || utcFire {
		t.Fatalf("tokyoFire=%v utcFire=%v want tokyo only", tokyoFire, utcFire)
	}
}

func TestShouldFireOneTickOnlyEvenAfterMultipleIntervals(t *testing.T) {
	// Weekly Monday 09:00 UTC; created ~3 weeks ago; only one next <= now (no catch-up multi-fire).
	created := time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC) // Monday
	now := time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)    // three weeks later
	fire, err := shouldFire("0 9 * * 1", "UTC", nil, created, now)
	if err != nil || !fire {
		t.Fatalf("fire=%v err=%v", fire, err)
	}
	next, err := nextFireAfter("0 9 * * 1", "UTC", created)
	if err != nil {
		t.Fatal(err)
	}
	// Single next tick — not multiple scheduled times returned.
	if next.After(now) {
		t.Fatalf("expected a due next, got %v", next)
	}
	// After that single fire time, the following week is the subsequent next.
	following, err := nextFireAfter("0 9 * * 1", "UTC", next)
	if err != nil {
		t.Fatal(err)
	}
	if !following.After(next) || following.Sub(next) < 6*24*time.Hour {
		t.Fatalf("following=%v next=%v", following, next)
	}
}
