package main

import (
	"strings"
	"testing"
)

const record = `{"number":1,"cardId":1,"createdAt":"2026-11-11T00:00:00Z","key":"k","occurredAt":"2026-11-12T00:00:00Z","changes":[],"note":"n","evidenceUrl":""}`

func TestLoadManifest(t *testing.T) {
	many := "[" + strings.Repeat(record+",", maxManifestRecords) + record + "]"
	padded := "[" + record + strings.Repeat(" ", maxManifestBytes) + "]"
	for name, tc := range map[string]struct {
		input string
		want  string // empty means accepted
	}{
		"one record":        {"[" + record + "]", ""},
		"unknown key":       {`[` + strings.Replace(record, `"evidenceUrl"`, `"evidence"`, 1) + `]`, "invalid manifest JSON"},
		"trailing data":     {"[" + record + "] []", "trailing manifest data"},
		"not an array":      {record, "invalid manifest JSON"},
		"empty array":       {"[]", "manifest must contain"},
		"too many records":  {many, "manifest must contain"},
		"over the size cap": {padded, "at most 2 MiB"},
		"malformed JSON":    {"[" + record, "invalid manifest JSON"},
		"max records is ok": {"[" + strings.Repeat(record+",", maxManifestRecords-1) + record + "]", ""},
	} {
		records, err := loadManifest(strings.NewReader(tc.input))
		switch {
		case tc.want == "" && err != nil:
			t.Fatalf("%s: rejected: %v", name, err)
		case tc.want == "" && len(records) == 0:
			t.Fatalf("%s: no records", name)
		case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
			t.Fatalf("%s: err=%v, want %q", name, err, tc.want)
		}
	}
}
