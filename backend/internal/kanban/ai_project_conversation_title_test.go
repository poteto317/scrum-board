package kanban

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestProjectAIConversationTitle(t *testing.T) {
	forty := strings.Repeat("あ", 40)
	cases := []struct{ name, message, want string }{
		{"plain", "認証の方式を決めたい", "認証の方式を決めたい"},
		{"ends are trimmed", "  \n認証の方式\t ", "認証の方式"},
		{"runs of white space become one space", "認証の   方式を\n\n決めたい\tです", "認証の 方式を 決めたい です"},
		{"full-width space is white space", "認証の　　方式", "認証の 方式"},
		{"empty", "", "新しい会話"},
		{"only white space", " \n\t　 ", "新しい会話"},
		{"exactly 40 characters stay whole", forty, forty},
		{"41 characters are cut to 40 and marked", forty + "い", forty + "…"},
		{"characters are counted, not bytes", strings.Repeat("🙂", 41), strings.Repeat("🙂", 40) + "…"},
		{"the cut is made after the white space is squeezed", strings.Repeat("a ", 30), strings.TrimSpace(strings.Repeat("a ", 20)) + " …"},
		{"ascii", strings.Repeat("x", 100), strings.Repeat("x", 40) + "…"},
	}
	for _, tc := range cases {
		got := projectAIConversationTitle(tc.message)
		if got != tc.want {
			t.Errorf("%s: got %q want %q", tc.name, got, tc.want)
		}
		// title は VARCHAR(120)。
		if utf8.RuneCountInString(got) > 41 {
			t.Errorf("%s: %d characters", tc.name, utf8.RuneCountInString(got))
		}
	}
}
