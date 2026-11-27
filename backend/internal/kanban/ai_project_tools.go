package kanban

// Tools of the project chat. The read tools (search_items, get_item) only read, and only what
// the asking user may view. When cross-project search is off they stay inside the URL project;
// when on they cover every project. Trashed items do not exist for them; archived ones do.
//
// The proposal tools (propose_*) change nothing: they collect proposals that are stored with
// the answer and applied by the user on the screen (ai_project_tool_proposals.go). Proposals
// always target the URL project only.
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
func projectChatTools(crossProject bool) []ChatTool {
	str := func(desc string) map[string]any { return map[string]any{"type": "string", "description": desc} }
	searchDesc := "このプロジェクトのアイテムを検索する。結果は {total, truncated, items} で、items は {number, projectId, projectName, title, status, assignee, dueAt, archived, updatedAt, snippet}。" +
		"total が items の件数より多いときは offset で続きを取れる。truncated が true のときは、全件は見ていない。本文やコメントを読むには get_item を使う。"
	getDesc := "このプロジェクトのアイテム 1 件を番号で開き、タイトル・説明・ソリューション・状態・担当・期限・コメント（新しい 30 件）を返す。"
	getProps := map[string]any{
		"number": map[string]any{"type": "integer", "description": "アイテムの番号（#12 なら 12）。"},
	}
	getRequired := []string{"number"}
	if crossProject {
		searchDesc = "閲覧できる全プロジェクトのアイテムを検索する。結果は {total, truncated, items} で、items は {number, projectId, projectName, title, status, assignee, dueAt, archived, updatedAt, snippet}。" +
			"total が items の件数より多いときは offset で続きを取れる。truncated が true のときは、全件は見ていない。本文やコメントを読むには get_item（projectId 必須）を使う。"
		getDesc = "閲覧できるプロジェクトのアイテム 1 件を projectId と番号で開き、タイトル・説明・ソリューション・状態・担当・期限・コメント（新しい 30 件）を返す。projectId は必須。"
		getProps["projectId"] = map[string]any{"type": "integer", "description": "アイテムが属するプロジェクトの ID。"}
		getRequired = []string{"number", "projectId"}
	}
	proposeScope := ""
	if crossProject {
		proposeScope = "提案は現在のプロジェクトのアイテムだけ。他プロジェクトの番号では提案しない。"
	}
	return []ChatTool{
		{
			Name:        toolSearchItems,
			Description: searchDesc,
			InputSchema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
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
			Description: getDesc,
			InputSchema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties":           getProps,
				"required":             getRequired,
			},
		},
		{
			Name: toolProposeStatusChange,
			Description: "アイテム 1 件のステータス（列）の変更を提案する。アイテムは変わらない。利用者が画面で適用したときに変わる。" +
				"利用者が頼んだときだけ使う。結果は {proposed, kind}。" + proposeScope,
			InputSchema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"number": map[string]any{"type": "integer", "description": "アイテムの番号（#12 なら 12）。"},
					"status": str("移動先の列の名前（例: Todo、Doing、Done）。"),
				},
				"required": []string{"number", "status"},
			},
		},
		{
			Name: toolProposeDescriptionEdit,
			Description: "アイテム 1 件の説明の書き換えを提案する。アイテムは変わらない。利用者が画面で差分を見て適用したときに変わる。" +
				"利用者が頼んだときだけ使う。先に get_item で今の説明を読む。結果は {proposed, kind}。" + proposeScope,
			InputSchema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"number":      map[string]any{"type": "integer", "description": "アイテムの番号（#12 なら 12）。"},
					"description": str("置き換え後の説明の全文（10000 文字以内）。変える部分だけではなく、全体を書く。"),
				},
				"required": []string{"number", "description"},
			},
		},
		{
			Name: toolProposeItemCreate,
			Description: "アイテムの新規作成を提案する。作られるのは Todo の列（列は選べない）。利用者が画面で適用したときに作られる。" +
				"利用者が頼んだときだけ使う。結果は {proposed, kind}。",
			InputSchema: map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"properties": map[string]any{
					"title":       str("タイトル（1〜200 文字）。"),
					"description": str("説明（10000 文字以内）。省略すると空。"),
				},
				"required": []string{"title"},
			},
		},
	}
}
