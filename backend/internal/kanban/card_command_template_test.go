package kanban

import "testing"

func TestDedupeTemplateIDs(t *testing.T) {
	got := dedupeTemplateIDs([]int64{3, 1, 3, 2, 1})
	want := []int64{3, 1, 2}
	if len(got) != len(want) {
		t.Fatalf("got %v want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v want %v", got, want)
		}
	}
	empty := dedupeTemplateIDs(nil)
	if empty == nil || len(empty) != 0 {
		t.Fatalf("nil input want empty slice, got %#v", empty)
	}
}
