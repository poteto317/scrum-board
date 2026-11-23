package kanban

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestExpandRecurringText(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatal(err)
	}
	// 2026-11-24 Tue 09:00 JST
	tue := time.Date(2026, 11, 24, 9, 0, 0, 0, tokyo)
	// week start Sunday 2026-11-22
	if got := expandRecurringText("週次 {{weekStart}}", tue, tokyo); got != "週次 2026-11-22" {
		t.Fatalf("tue weekStart: %q", got)
	}
	sat := time.Date(2026, 11, 28, 9, 0, 0, 0, tokyo)
	if got := expandRecurringText("x {{weekStart}}", sat, tokyo); got != "x 2026-11-22" {
		t.Fatalf("sat same week: %q", got)
	}
	if got := expandRecurringText("d {{date}}", tue, tokyo); got != "d 2026-11-24" {
		t.Fatalf("date: %q", got)
	}
	long := "説明 {{weekStart}} と {{date}} 終わり"
	if got := expandRecurringText(long, tue, tokyo); got != "説明 2026-11-22 と 2026-11-24 終わり" {
		t.Fatalf("both: %q", got)
	}
	unk := "{{ weekStart }} {{WeekStart}} {{unknown}} {{weekStart"
	if got := expandRecurringText(unk, tue, tokyo); got != unk {
		t.Fatalf("unknown left: %q", got)
	}
	plain := "静的タイトル"
	if got := expandRecurringText(plain, tue, tokyo); got != plain {
		t.Fatalf("plain: %q", got)
	}

	// TZ: UTC Monday 2026-11-23 14:00 = Tuesday 2026-11-24 00:00 JST? 
	// 2026-11-23 15:00 UTC = 2026-11-24 00:00 JST
	utcMonEve := time.Date(2026, 11, 23, 15, 0, 0, 0, time.UTC)
	if got := expandRecurringText("{{date}}|{{weekStart}}", utcMonEve, tokyo); got != "2026-11-24|2026-11-22" {
		t.Fatalf("tz cross tokyo: %q", got)
	}
	if got := expandRecurringText("{{date}}|{{weekStart}}", utcMonEve, time.UTC); got != "2026-11-23|2026-11-22" {
		t.Fatalf("tz cross utc: %q", got)
	}
}

func TestMaterializeRecurringFireRejectsOverlongTitle(t *testing.T) {
	at := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	// 195 runes + {{date}} (10) = 205 > 200
	tpl := strings.Repeat("あ", 195) + "{{date}}"
	rule := RecurringRule{Title: tpl, Description: "", Timezone: "UTC"}
	_, _, err := materializeRecurringFire(rule, at)
	if !errors.Is(err, ErrRecurring) {
		t.Fatalf("want ErrRecurring got %v", err)
	}
}

func TestMaterializeRecurringFireRejectsBadTimezone(t *testing.T) {
	at := time.Date(2026, 11, 24, 9, 0, 0, 0, time.UTC)
	rule := RecurringRule{Title: "x", Description: "", Timezone: "Not/AZone"}
	_, _, err := materializeRecurringFire(rule, at)
	if !errors.Is(err, ErrRecurring) {
		t.Fatalf("want ErrRecurring got %v", err)
	}
}
