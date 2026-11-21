package kanban

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestNormalizeAIChatMessageMaxLen(t *testing.T) {
	ok2000 := strings.Repeat("あ", 2000)
	if _, ok := NormalizeAIChatMessage(ok2000, 2000); !ok {
		t.Fatal("2000 runes at max 2000 should pass")
	}
	if _, ok := NormalizeAIChatMessage(ok2000+"あ", 2000); ok {
		t.Fatal("2001 runes at max 2000 should fail")
	}
	// maxLen <= 0 falls back to hard-coded default
	longDefault := strings.Repeat("a", maxAIChatMessageLen)
	if _, ok := NormalizeAIChatMessage(longDefault, 0); !ok {
		t.Fatal("default max should accept maxAIChatMessageLen")
	}
	if utf8.RuneCountInString(longDefault+"x") <= maxAIChatMessageLen {
		t.Fatal("precondition")
	}
	if _, ok := NormalizeAIChatMessage(longDefault+"x", -1); ok {
		t.Fatal("over default max should fail")
	}
}
