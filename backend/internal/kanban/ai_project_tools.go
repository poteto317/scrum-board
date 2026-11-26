package kanban

// Tools of the project chat. Both only read, only inside the project of the URL, and only
// what the asking user may view. Trashed items do not exist for them; archived ones do.
//
// This file is what the model is told about the tools (names and input schemas). Reading an
// input and building a result live with each tool (ai_project_tool_search_items.go,
// ai_project_tool_get_item.go); running them lives in ai_project_tool_executor.go.

import "fmt"

const (
	toolSearchItems = "search_items"
	toolGetItem     = "get_item"

	sortUpdated = "updated"
	sortDue     = "due"
)

// projectChatTools is the tool list given to the model.
func projectChatTools() []ChatTool {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	return []ChatTool{
		{
			Name: toolSearchItems,
			Description: "このプロジェクトのアイテムを検索する。結果は {total, truncated, items} で、items は {number, title, status, assignee, dueAt, archived, updatedAt, snippet}。" +
				"total が items の件数より多いときは offset で続きを取れる。truncated が true のときは、全件は見ていない。本文やコメントを読むには get_item を使う。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"query":    str("検索語。空白区切りはすべて含むもの（AND）。タイトル・説明・ソリューション・コメントの部分一致。#12 のような語は番号にも一致する。省略すると絞り込まない。"),
					"status":   str("列の名前（例: Todo、Doing、Done）で絞り込む。"),
					"assignee": str("担当の名前（完全一致）で絞り込む。"),
					"dueFrom":  str("期限がこの日以降のものに絞る。YYYY-MM-DD（日本時間）。"),
					"dueTo":    str("期限がこの日以前のものに絞る。YYYY-MM-DD（日本時間）。"),
					"sort": map[string]any{
						"type": "string", "enum": []string{sortUpdated, sortDue},
						"description": "updated は更新の新しい順（既定）。due は期限の近い順（期限なしは最後）。",
					},
					"limit": map[string]any{"type": "integer", "description": fmt.Sprintf(
						"返す件数。%d〜%d、既定は %d。", searchItemsMinLimit, searchItemsMaxLimit, searchItemsDefaultLimit)},
					"offset": map[string]any{"type": "integer", "description": fmt.Sprintf(
						"先頭から飛ばす件数。0〜%d、既定は 0。", searchItemsMaxOffset)},
				},
			},
		},
		{
			Name:        toolGetItem,
			Description: "このプロジェクトのアイテム 1 件を番号で開き、タイトル・説明・ソリューション・状態・担当・期限・コメント（新しい 30 件）を返す。",
			InputSchema: map[string]any{
				"type": "object",
				"properties": map[string]any{
					"number": map[string]any{"type": "integer", "description": "アイテムの番号（#12 なら 12）。"},
				},
				"required": []string{"number"},
			},
		},
	}
}

func columnNameByID(columns []Column) map[int64]string {
	names := make(map[int64]string, len(columns))
	for _, c := range columns {
		names[c.ID] = c.Name
	}
	return names
}
