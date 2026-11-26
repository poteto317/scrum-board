package kanban

import "unicode/utf8"

const (
	// maxProjectChatToolResultChars is how many characters all tool results of one user message may have together.
	maxProjectChatToolResultChars = 40000
	// Below this much room a tool is not run any more: the model is told to answer with what it has.
	minProjectChatToolResultChars = 1000
	// Kept back for those "answer with what you have" results, so that they fit in the total too.
	// One message runs at most (maxProjectChatModelCalls-1) × MaxToolCallsPerResponse = 15 tools,
	// and one such result is about 40 characters.
	projectChatToolErrorReserveChars = 1000
)

// toolResultBudget counts down the characters of tool results one user message may still
// get. It only counts: it runs nothing and reads nothing.
type toolResultBudget struct {
	remaining int
}

func newToolResultBudget() toolResultBudget {
	return toolResultBudget{remaining: maxProjectChatToolResultChars}
}

// room is how many characters the next tool result may have. ok is false when that is too
// little to run a tool: the model is then told to answer with what it has.
func (b toolResultBudget) room() (chars int, ok bool) {
	chars = b.remaining - projectChatToolErrorReserveChars
	return chars, chars >= minProjectChatToolResultChars
}

// spend counts a result that is handed to the model, and returns it.
func (b *toolResultBudget) spend(result string) string {
	b.remaining = max(b.remaining-utf8.RuneCountInString(result), 0)
	return result
}
