package kanban

import (
	"strings"
	"unicode"
)

// fencedBlock puts user-written text into a code fence that the text cannot close: the fence
// is one backtick longer than the longest run of backticks inside (and at least 3). A fence is
// only closed by a line of at least as many backticks, so every line of text stays data.
// Every user-written text placed in a prompt goes through this.
func fencedBlock(text string) string {
	longest, run := 0, 0
	for _, r := range text {
		if r != '`' {
			run = 0
			continue
		}
		run++
		longest = max(longest, run)
	}
	fence := strings.Repeat("`", max(3, longest+1))
	return fence + "\n" + text + "\n" + fence
}

// promptLabel makes a user-chosen name safe to place on one line: line breaks and control
// characters are dropped, and a code fence inside the name is defused.
func promptLabel(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsControl(r) || r == '\u2028' || r == '\u2029' {
			continue
		}
		b.WriteRune(r)
	}
	return strings.ReplaceAll(strings.TrimSpace(b.String()), "```", "'''")
}
