package kanban

import "testing"

func assertMeasuredSQLNearConstant(t *testing.T, count20, count80 int) {
	t.Helper()
	if count20 > 40 || count80 > 40 {
		t.Fatalf("query count cap 40: n20=%d n80=%d", count20, count80)
	}
	delta := count80 - count20
	if delta < 0 {
		delta = -delta
	}
	if delta > 5 {
		t.Fatalf("|count80-count20|=%d > 5 (n20=%d n80=%d)", delta, count20, count80)
	}
}
