# 実装プラン: コメント投稿者の偽装・横取り編集の防止

設計: `docs/superpowers/specs/2026-11-22-comment-author-ownership-design.md`

## タスク

- [x] DB: `item_comments.created_by_user_id`（`InitializeComments` で ADD COLUMN、001_schema 更新）
- [x] ドメイン: `Comment.CreatedByUserID`、repo の SELECT/INSERT、memory スタブ
- [x] ハンドラ: POST/PATCH のフィールド制限、`commentAuthorFromUser`、`canModifyComment`、403
- [x] テスト: `comment_handler_test` になりすまし・横取り拒否、第 2 ユーザー session
- [x] フロント: 表示名入力削除、`createdByUserId` で編集/削除ボタン制御
- [x] OpenAPI 更新
- [x] `go test ./internal/kanban/ -count=1`