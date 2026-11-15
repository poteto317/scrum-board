package main

import (
	"os"
	"strings"
	"testing"
)

func TestRun_EmptyPublicOrigin(t *testing.T) {
	err := run(func(string) string { return "" }, nil)
	if err == nil || !strings.Contains(err.Error(), "PUBLIC_ORIGIN") {
		t.Fatalf("err=%v", err)
	}
}

func TestRun_UnexpectedArgs(t *testing.T) {
	err := run(func(k string) string {
		if k == "PUBLIC_ORIGIN" {
			return "https://x.example"
		}
		return ""
	}, []string{"extra"})
	if err == nil || !strings.Contains(err.Error(), "unexpected") {
		t.Fatalf("err=%v", err)
	}
}

func TestRun_InvalidFlag(t *testing.T) {
	err := run(func(k string) string {
		if k == "PUBLIC_ORIGIN" {
			return "https://x.example"
		}
		return ""
	}, []string{"-unknown"})
	if err == nil || !strings.Contains(err.Error(), "invalid arguments") {
		t.Fatalf("err=%v", err)
	}
}

func TestRun_DatabaseUnavailable(t *testing.T) {
	if os.Getenv("KANBAN_IMPORT_DSN") != "" {
		t.Skip("KANBAN_IMPORT_DSN is set")
	}
	err := run(func(k string) string {
		switch k {
		case "PUBLIC_ORIGIN":
			return "https://x.example"
		case "DB_ADDRESS":
			return "127.0.0.1:1"
		}
		return ""
	}, []string{"--dry-run"})
	if err == nil || !strings.Contains(err.Error(), "database unavailable") {
		t.Fatalf("err=%v", err)
	}
}

func TestRun_DryRunZeroMatchesExitOK(t *testing.T) {
	dsn := os.Getenv("KANBAN_TEST_DSN")
	if dsn == "" {
		t.Skip("KANBAN_TEST_DSN unset")
	}
	err := run(func(k string) string {
		switch k {
		case "PUBLIC_ORIGIN":
			return "https://prod.example"
		case "KANBAN_IMPORT_DSN":
			return dsn
		}
		return ""
	}, []string{"--dry-run"})
	if err != nil {
		t.Fatalf("expected exit 0 path (nil err), got %v", err)
	}
}
