package kanban

import "testing"

// 会話は 100 件まで。超えた分だけを消す（負にならない）。
func TestProjectAIConversationsOverLimit(t *testing.T) {
	for _, tc := range []struct{ count, want int }{
		{0, 0},
		{1, 0},
		{maxProjectAIConversations - 1, 0},
		{maxProjectAIConversations, 0},
		{maxProjectAIConversations + 1, 1},
		// 引き継ぎの後など、2 件以上超えていても、超えた分を全部消す。
		{maxProjectAIConversations + 2, 2},
	} {
		if got := projectAIConversationsOverLimit(tc.count); got != tc.want {
			t.Errorf("count=%d: got %d want %d", tc.count, got, tc.want)
		}
	}
}

// 1 つの会話のメッセージは、足す分を含めて 200 件まで。
func TestProjectAIMessagesOverLimit(t *testing.T) {
	for _, tc := range []struct{ count, adding, want int }{
		{0, projectAITurnMessages, 0},
		{maxAIChatStoredMessages - 3, projectAITurnMessages, 0},
		{maxAIChatStoredMessages - 2, projectAITurnMessages, 0},
		{maxAIChatStoredMessages - 1, projectAITurnMessages, 1},
		{maxAIChatStoredMessages, projectAITurnMessages, 2},
		{maxAIChatStoredMessages + 5, projectAITurnMessages, 7},
		{maxAIChatStoredMessages, 0, 0},
		{maxAIChatStoredMessages + 1, 0, 1},
	} {
		if got := projectAIMessagesOverLimit(tc.count, tc.adding); got != tc.want {
			t.Errorf("count=%d adding=%d: got %d want %d", tc.count, tc.adding, got, tc.want)
		}
	}
}
