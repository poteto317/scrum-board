package kanban

import (
	"strings"
	"testing"
)

func TestPRURLLength(t *testing.T) {
	prefix := "https://github.com/"
	suffix := "/repo/pull/1"
	url := prefix + strings.Repeat("a", 2048-len(prefix)-len(suffix)) + suffix
	if !validPRURL(url) {
		t.Fatal("2048 bytes must be accepted")
	}
	if validPRURL(url + "1") {
		t.Fatal("2049 bytes must be rejected")
	}
}
