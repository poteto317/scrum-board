package kanban

import "testing"

func TestSameCardIDSet(t *testing.T) {
	cases := []struct {
		name               string
		existing, requested []int64
		want               bool
	}{
		{"match", []int64{1, 2, 3}, []int64{3, 1, 2}, true},
		{"length mismatch", []int64{1, 2}, []int64{1, 2, 3}, false},
		{"unknown id", []int64{1, 2, 3}, []int64{1, 2, 99}, false},
		{"empty both", nil, nil, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameCardIDSet(tc.existing, tc.requested); got != tc.want {
				t.Fatalf("sameCardIDSet(%v,%v)=%v want %v", tc.existing, tc.requested, got, tc.want)
			}
		})
	}
}
