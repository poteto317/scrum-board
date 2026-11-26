package kanban

import "strings"

const (
	// projectAIConversationTitleRunes is how much of the first message becomes the title.
	projectAIConversationTitleRunes = 40
	// projectAIConversationTitleEmpty names a conversation whose first message has no text.
	projectAIConversationTitleEmpty = "新しい会話"
	// projectAIConversationTitleAdopted names a conversation made at startup from messages
	// that had none, when there is no user message among them to take the title from.
	projectAIConversationTitleAdopted = "これまでの会話"
)

// projectAIConversationTitle makes a conversation's title from its first message: runs of
// white space become one space, the ends are trimmed, and what is beyond 40 characters is
// replaced by "…". It always fits title VARCHAR(120).
func projectAIConversationTitle(message string) string {
	text := strings.Join(strings.Fields(message), " ")
	if text == "" {
		return projectAIConversationTitleEmpty
	}
	runes := []rune(text)
	if len(runes) <= projectAIConversationTitleRunes {
		return text
	}
	return string(runes[:projectAIConversationTitleRunes]) + "…"
}
