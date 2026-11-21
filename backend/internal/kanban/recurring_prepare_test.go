package kanban

import (
	"errors"
	"testing"
	"time"
)

func TestPrepareRecurringCreateDefaultsAndTrims(t *testing.T) {
	en := false
	got, err := prepareRecurringCreate(RecurringRuleInput{
		Name:     "  週次  ",
		Title:    "  タイトル  ",
		Cron:     " 0 9 * * 1 ",
		Timezone: "",
		ColumnID: 3,
		Enabled:  &en,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "週次" || got.Title != "タイトル" {
		t.Fatalf("trim: %+v", got)
	}
	if got.Cron != "0 9 * * 1" || got.Timezone != defaultRecurringTZ {
		t.Fatalf("cron/tz: %+v", got)
	}
	if got.Enabled == nil || *got.Enabled {
		t.Fatalf("enabled want false: %+v", got.Enabled)
	}
}

func TestPrepareRecurringCreateRejectsBadInput(t *testing.T) {
	if _, err := prepareRecurringCreate(RecurringRuleInput{
		Name: "", Title: "t", Cron: "0 9 * * 1", ColumnID: 1,
	}); !errors.Is(err, ErrRecurring) {
		t.Fatalf("empty name: %v", err)
	}
	if _, err := prepareRecurringCreate(RecurringRuleInput{
		Name: "n", Title: "t", Cron: "bad", ColumnID: 1,
	}); !errors.Is(err, ErrRecurring) {
		t.Fatalf("bad cron: %v", err)
	}
	if _, err := prepareRecurringCreate(RecurringRuleInput{
		Name: "n", Title: "t", Cron: "0 9 * * 1", ColumnID: 0,
	}); !errors.Is(err, ErrColumn) {
		t.Fatalf("column: %v", err)
	}
}

func TestApplyRecurringRulePatchPureMerge(t *testing.T) {
	base := RecurringRule{
		ID: 1, ProjectID: 1, Name: "old", Title: "old-t", Description: "d",
		Cron: "0 9 * * 1", Timezone: "Asia/Tokyo", ColumnID: 1, Enabled: true,
		CreatedAt: time.Unix(1, 0).UTC(), UpdatedAt: time.Unix(1, 0).UTC(),
	}
	name := "  new  "
	cron := "0 10 * * 2"
	col := int64(2)
	en := false
	got, err := applyRecurringRulePatch(base, RecurringRulePatch{
		Name: &name, Cron: &cron, ColumnID: &col, Enabled: &en,
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Name != "new" || got.Title != "old-t" || got.Cron != "0 10 * * 2" {
		t.Fatalf("merge: %+v", got)
	}
	if got.ColumnID != 2 || got.Enabled {
		t.Fatalf("col/enabled: %+v", got)
	}
	// Existence of column 2 is caller's I/O — pure path only rejects <=0.
	bad := int64(0)
	if _, err := applyRecurringRulePatch(base, RecurringRulePatch{ColumnID: &bad}); !errors.Is(err, ErrColumn) {
		t.Fatalf("col<=0: %v", err)
	}
}

func TestValidateCronAndTimezoneIsClockIndependent(t *testing.T) {
	if err := validateCronAndTimezone("0 9 * * 1", "Asia/Tokyo"); err != nil {
		t.Fatal(err)
	}
	if err := validateCronAndTimezone("0 9 * * 1", ""); !errors.Is(err, ErrRecurring) {
		t.Fatalf("empty tz: %v", err)
	}
}

func TestApplyRecurringRulePatchDisablesWithoutRevalidatingCron(t *testing.T) {
	base := RecurringRule{
		ID: 1, ProjectID: 1, Name: "bad", Title: "t", Description: "",
		Cron: "not-a-cron", Timezone: "Asia/Tokyo", ColumnID: 1, Enabled: true,
		CreatedAt: time.Unix(1, 0).UTC(), UpdatedAt: time.Unix(1, 0).UTC(),
	}
	en := false
	got, err := applyRecurringRulePatch(base, RecurringRulePatch{Enabled: &en})
	if err != nil {
		t.Fatalf("enabled-only patch must skip cron validate: %v", err)
	}
	if got.Enabled || got.Cron != "not-a-cron" {
		t.Fatalf("got %+v", got)
	}
	badCron := "still-bad"
	if _, err := applyRecurringRulePatch(base, RecurringRulePatch{Cron: &badCron}); !errors.Is(err, ErrRecurring) {
		t.Fatalf("cron patch still validates: %v", err)
	}
}
