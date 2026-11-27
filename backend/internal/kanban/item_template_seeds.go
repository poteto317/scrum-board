package kanban

// defaultItemTemplateSeeds are inserted when a project has zero templates (GET path).
func defaultItemTemplateSeeds() []ItemTemplateInput {
	return []ItemTemplateInput{
		{
			Name:          "バグ報告",
			TitleTemplate: "[バグ] ",
			DescriptionTemplate: "## 再現手順\n\n1. \n\n## 期待する結果\n\n\n\n## 実際の結果\n\n\n\n## 環境\n\n- ",
		},
		{
			Name:          "調査タスク",
			TitleTemplate: "[調査] ",
			DescriptionTemplate: "## 調査目的\n\n\n\n## 分かっていること\n\n\n\n## 調べること\n\n- [ ] \n\n## 結論・次のアクション\n\n",
		},
	}
}
