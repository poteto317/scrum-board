# scrum-board-mcp

既存スクラムかんばん HTTP API の薄いラッパとして動く、stdio MCP サーバーです。Claude Code / Codex などからボード操作できます。

## 必要条件

- **Node.js 18+**
- 動いているボード（既定: `http://127.0.0.1:4200`）

## セットアップ

```bash
cd mcp
npm install
npm run build
```

ビルド成果物は `dist/index.js` です。

## 環境変数

| 変数 | 必須 | 説明 |
|------|------|------|
| `SCRUM_BOARD_BASE_URL` | 任意 | ボード API のベース URL。未設定時は `http://127.0.0.1:4200`。末尾スラッシュは除去される |
| `SCRUM_BOARD_AUTH_USER` | 任意 | Basic Auth ユーザー。`SCRUM_BOARD_AUTH_PASSWORD` と両方あるときだけ `Authorization` を送る |
| `SCRUM_BOARD_AUTH_PASSWORD` | 任意 | Basic Auth パスワード。片方だけだと認証ヘッダは送らない |

ローカル受け入れは認証なしで足ります。本番 nginx 向けにだけ上記を設定してください。

## Claude Code / Codex 設定例

`<repo>` をこのリポジトリの絶対パスに置き換えてください。

```json
{
  "mcpServers": {
    "scrum-board": {
      "command": "node",
      "args": ["<repo>/mcp/dist/index.js"],
      "env": {
        "SCRUM_BOARD_BASE_URL": "http://127.0.0.1:4200"
      }
    }
  }
}
```

Basic Auth が必要な場合は `env` に `SCRUM_BOARD_AUTH_USER` / `SCRUM_BOARD_AUTH_PASSWORD` を足します。

## ツール一覧

アイテム操作の入力は公開 `number` / 列名のみ（内部 item `id` は取らない）。`projectId` 省略時はサーバの active project に委ねます。

| ツール | 用途 | 主な引数 |
|--------|------|----------|
| `list_projects` | プロジェクト一覧 | なし |
| `get_board` | 列・アイテム・settings | なし |
| `set_active_project` | アクティブプロジェクト切替 | **必須** `activeProjectId` |
| `get_item` | 番号で取得 | **必須** `number`；任意 `projectId` |
| `create_item` | 作成（列名を board から id 解決） | **必須** `title`, `description`, `column`；任意 `projectId`, `assignee` |
| `update_status` | 列名で移動 | **必須** `number`, `status`；任意 `projectId` |
| `update_assignee` | 担当者変更（空文字でクリア） | **必須** `number`, `assignee`；任意 `projectId` |
| `update_item` | フィールド部分更新 | **必須** `number`；任意 `projectId`（**解決用のみ**）とパッチ（`title` / `description` / `dueAt` / `closeReason` / `prUrls`）のうち 1 つ以上 |

`update_item` は get→`number`（と指定時 `projectId`）照合→正の内部 `id` で PATCH→応答の `id`/`number` 再照合します。`projectId` 引数は検索スコープのみ（所属変更は MCP MVP 外）。列移動は `update_status`、担当は `update_assignee` を使います。

失敗時は `isError: true` とし、`HTTP <status>` や `network_error` / `invalid_json` / `identity_mismatch` / `column_not_found` / `no_patch_fields` などの短い固定文のみ返します（秘密・生ボディは出しません）。

## 不足 API

1. **`PATCH /api/items/by-number/{number}` の汎用部分更新が無い** — タイトル・説明・dueAt・closeReason・projectId・prUrls 等は内部 id の `PATCH /api/items/{id}` が必要。MCP は get→number 照合→id→PATCH で回避。
2. （必要なら実装後に増えたギャップも同じ節へ追記。API 実装は別カード。）
