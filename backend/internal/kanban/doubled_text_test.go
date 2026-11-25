package kanban

import (
	"strings"
	"testing"
)

func TestCollapseExactDoubledText(t *testing.T) {
	t.Parallel()

	out, folds, hit := collapseExactDoubledText("", 8)
	if out != "" || folds != 0 || hit {
		t.Fatalf("empty: got %q folds=%d hit=%v", out, folds, hit)
	}

	out, folds, hit = collapseExactDoubledText("あいう", 8)
	if out != "あいう" || folds != 0 || hit {
		t.Fatalf("odd: got %q folds=%d hit=%v", out, folds, hit)
	}

	out, folds, hit = collapseExactDoubledText("abcd", 8)
	if out != "abcd" || folds != 0 || hit {
		t.Fatalf("non-doubled: got %q folds=%d hit=%v", out, folds, hit)
	}

	out, folds, hit = collapseExactDoubledText("あいうあいう", 8)
	if out != "あいう" || folds != 1 || hit {
		t.Fatalf("simple doubled: got %q folds=%d hit=%v", out, folds, hit)
	}

	out, folds, hit = collapseExactDoubledText("AAAA", 8)
	if out != "A" || folds != 2 || hit {
		t.Fatalf("multi fold AAAA: got %q folds=%d hit=%v", out, folds, hit)
	}

	out, folds, hit = collapseExactDoubledText("AAAA", 1)
	if out != "AA" || folds != 1 || !hit {
		t.Fatalf("maxFolds=1: got %q folds=%d hit=%v", out, folds, hit)
	}

	long := strings.Repeat("あ", 512)
	out, folds, hit = collapseExactDoubledText(long, 8)
	if !hit || folds != 8 {
		t.Fatalf("long repeat: folds=%d hit=%v outLen=%d", folds, hit, len([]rune(out)))
	}
	if out == long {
		t.Fatal("long repeat should fold at least once")
	}
}
