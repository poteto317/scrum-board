package kanban

import "testing"

func TestPresetAssigneesContract(t *testing.T) {
	want := []string{"Cursor", "Claude", "Codex", "Antigravity"}
	if len(PresetAssignees) != len(want) {
		t.Fatalf("PresetAssignees=%v want %v (sync with frontend ASSIGNEE_PRESETS)", PresetAssignees, want)
	}
	for i, name := range want {
		if PresetAssignees[i] != name {
			t.Fatalf("PresetAssignees=%v want %v (sync with frontend ASSIGNEE_PRESETS)", PresetAssignees, want)
		}
	}
}

func TestNormalizeAssignee(t *testing.T) {
	cases := []struct {
		in, want string
		ok       bool
	}{
		{"", "", true},
		{"  ", "", true},
		{"cursor", "Cursor", true},
		{"CLAUDE", "Claude", true},
		{"Codex", "Codex", true},
		{"antigravity", "Antigravity", true},
		{"mash", "mash", true},
		{string(make([]rune, 61)), "", false},
		{"a\nb", "", false},
		{"x\x00y", "", false},
	}
	for _, tc := range cases {
		got, ok := NormalizeAssignee(tc.in)
		if ok != tc.ok || got != tc.want {
			t.Fatalf("NormalizeAssignee(%q)=(%q,%v) want (%q,%v)", tc.in, got, ok, tc.want, tc.ok)
		}
	}
}
