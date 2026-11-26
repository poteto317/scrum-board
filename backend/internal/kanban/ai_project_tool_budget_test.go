package kanban

import (
	"strings"
	"testing"
)

func TestToolResultBudgetRoomKeepsTheReserve(t *testing.T) {
	b := newToolResultBudget()
	room, ok := b.room()
	if !ok || room != maxProjectChatToolResultChars-projectChatToolErrorReserveChars {
		t.Fatalf("fresh budget: room=%d ok=%v", room, ok)
	}
	// 文字数で数える（バイト数ではない）。
	if got := b.spend(strings.Repeat("あ", 1000)); got != strings.Repeat("あ", 1000) {
		t.Fatal("spend must return the result unchanged")
	}
	if room, _ = b.room(); room != maxProjectChatToolResultChars-projectChatToolErrorReserveChars-1000 {
		t.Fatalf("room after 1000 characters=%d", room)
	}
}

func TestToolResultBudgetStopsWhenTooLittleIsLeft(t *testing.T) {
	// 残りが「取っておく分 + 最小」ちょうどなら、まだ実行できる。1 文字でも切ったら実行しない。
	edge := maxProjectChatToolResultChars - projectChatToolErrorReserveChars - minProjectChatToolResultChars
	b := newToolResultBudget()
	b.spend(strings.Repeat("x", edge))
	if room, ok := b.room(); !ok || room != minProjectChatToolResultChars {
		t.Fatalf("at the edge: room=%d ok=%v", room, ok)
	}
	b.spend("x")
	if _, ok := b.room(); ok {
		t.Fatal("one character less than the minimum must stop the tools")
	}
	// 使い切っても負にならない。
	b.spend(strings.Repeat("x", maxProjectChatToolResultChars))
	if b.remaining != 0 {
		t.Fatalf("remaining=%d", b.remaining)
	}
	if _, ok := b.room(); ok {
		t.Fatal("an empty budget has no room")
	}
}

// 「これ以上は調べられません」を 15 回（1 メッセージで実行しうるツールの最大数）返しても、取っておいた分に収まる。
func TestToolResultBudgetReserveCoversEveryBudgetError(t *testing.T) {
	perMessage := (maxProjectChatModelCalls - 1) * MaxToolCallsPerResponse
	if need := perMessage * len([]rune(toolErrorResult(toolErrBudget))); need > projectChatToolErrorReserveChars {
		t.Fatalf("reserve %d is smaller than %d budget errors (%d characters)", projectChatToolErrorReserveChars, perMessage, need)
	}
}
