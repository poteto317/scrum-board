# スクラムかんばん MCP（アイテム #8）

## 背景

カード要件: ローカルで動く Claude Code / Codex などからボードを操作できる MCP を用意する。足りない API があっても**今は API を増やさず**、カード説明へ追記する。

現状: HTTP API（`docs/api.md`）はエージェント向けの by-number ステータス／担当者変更・ボード取得などを備えるが、MCP サーバー実装は無い（`docs/api.md` も MCP は別機能と明記）。本番 Basic Auth は nginx、ローカル API は認証なし。

## 決めたこと（推奨案を採用）

設計の確認事項は推奨案つきでまとめて問う想定だが、本フローでは未回答を承認とせず推奨を採用して確定する（feature.md）。

| 事項 | 採用 |
|------|------|
| 置き場 | リポジトリ直下 `mcp/`（Go API・Angular FE と分離）。パッケージ名 `scrum-board-mcp` |
| ランタイム | **Node.js + TypeScript** + 公式 `@modelcontextprotocol/sdk`（stdio）。Claude Code / Codex の `mcpServers` 設定と相性が良い |
| トランスポート | **stdio のみ**（MVP）。HTTP/SSE は対象外 |
| 接続先 | 環境変数 `SCRUM_BOARD_BASE_URL`（既定 `http://127.0.0.1:4200`）。受け入れは**認証なしローカル**で満たす。Basic Auth 付き URL 向けに任意で `SCRUM_BOARD_AUTH_USER` / `SCRUM_BOARD_AUTH_PASSWORD`（未設定なら送らない）。認証設計の刷新はしない |
| ツール集合（MVP） | 下表。既存 API の薄いラッパのみ。DB 直書き・スクレイピングはしない |
| 足りない API | **実装しない**。カード #8 の description 末尾に「不足 API」節を追記し、MCP README にも同じ一覧を書く |
| プロジェクト | 下表「`projectId`」列。切替は `set_active_project` |
| 秘密 | 認証情報・WWW-Authenticate・生の例外 message・生レスポンスボディをツール応答・ログに出さない（L-017 / L-031）。失敗文は HTTP ステータス（分かれば）＋固定の短い理由コードのみ |
| 検証 | `mcp/` のユニットテスト（HTTP を mock）+ README の Claude Code / Codex 設定例。E2E で実ボード必須にはしない |
| 失敗伝達 | HTTP 非 2xx・ネットワーク失敗・JSON 不正は **MCP ツール失敗**（`isError: true`）。上記の秘密ルールに従う（L-001 / L-017） |

### MCP ツール → HTTP と引数

共通規則:

- **アイテム**のツール入力に内部 item `id` は取らない（応答 JSON に `id` があっても入力は公開 `number` 中心。L-018 / L-035）。
- **列**は名前（`status` / `column`）で指定し、MCP が `GET /api/board` の `columns` から id へ解決する。エージェントに列の内部 id を要求しない。
- `projectId` は正の整数。省略時はサーバの active project に委ねる（API と同じ）。
- `number` は公開タスク番号（正の整数）。

| ツール名 | 用途 | HTTP | 引数 | `projectId` |
|----------|------|------|------|-------------|
| `list_projects` | プロジェクト一覧 | `GET /api/projects` | なし | 無し |
| `get_board` | 列・アイテム・settings（解決後アクティブ） | `GET /api/board` | なし | 無し（切替は `set_active_project`） |
| `set_active_project` | アクティブプロジェクト切替 | `PATCH /api/board/settings` `{"activeProjectId"}` | **必須** `activeProjectId: number` | 無し（本体が切替） |
| `get_item` | 番号で取得 | `GET /api/items/by-number/{n}[?projectId=]` | **必須** `number`；任意 `projectId` | 任意クエリ |
| `create_item` | 作成 | `POST /api/items` | 下表「create_item」 | 任意（ボディ。省略時は active） |
| `update_status` | 列名で移動 | `PATCH …/by-number/{n}/status` | **必須** `number`, `status`（列名）；任意 `projectId` | 任意クエリ |
| `update_assignee` | 担当者 | `PATCH …/by-number/{n}/assignee` | **必須** `number`, `assignee`（空文字でクリア）；任意 `projectId` | 任意クエリ |
| `update_item` | フィールド部分更新 | 下表「update_item 手順」 | **必須** `number`；任意 `projectId`（**解決用クエリのみ**）＋パッチ 1 キー以上 | 任意クエリ（解決のみ。所属変更は MCP MVP 外） |

#### `create_item`（着手〜Review に足りる最小）

| キー | 必須 | 型・意味 |
|------|------|----------|
| `title` | 必須 | string |
| `description` | 必須 | string（空可） |
| `column` | 必須 | string（列名。MCP が board から `columnId` へ解決して POST） |
| `projectId` | 任意 | number。省略時はサーバが解決した active に所属 |
| `assignee` | 任意 | string |

`dueAt` / `prUrls` / `relatedItems` / `closeReason` は create では公開しない（必要なら作成後 `update_item`）。

#### `update_item` 手順とパッチ（L-018）

1. `GET /api/items/by-number/{number}[?projectId=]` で解決する（`projectId` は検索スコープのみ。PATCH ボディには載せない）。
2. 応答の `number` が引数と一致し、正の内部 `id` があることを確認する（任意 `projectId` 指定時は応答の `projectId` も一致）。不一致・`id` 欠落はツール失敗（PATCH しない）。
3. その `id` で `PATCH /api/items/{id}` に、渡されたパッチキーだけを載せる。
4. PATCH 成功応答で `id` と `number` が解決時と一致することを確認し、不一致ならツール失敗（所属変更による再採番は本ツール対象外のため）。

MVP で公開するパッチキー（少なくとも 1 つ必須。`projectId` のみではパッチ無し扱い）:

| キー | 型・意味 |
|------|----------|
| `title` | string |
| `description` | string |
| `dueAt` | string（UTC `…Z`）または `null`（クリア） |
| `closeReason` | string |
| `prUrls` | string[] |

列移動は `update_status`、担当者は `update_assignee` に寄せる。プロジェクト間移動は MCP MVP 外（API の `PATCH /api/items/{id}` を直接使うか別カード）。

### 検討したが採らなかった案

- **Go で MCP**: 同一言語だが公式 TS SDK の方が設定例・メンテが楽。
- **全 API をツール化 / ItemInput・ItemPatch 全面公開**: 範囲が 1 プランを超える。着手〜Review に足りる最小に絞る。
- **不足 API（by-number 汎用 PATCH）を今足す**: カード明示で禁止。MCP 内で number 検証付き id 解決する。
- **本番認証設計の刷新**: 非目標。任意の Basic Auth ヘッダ送出のみ。

## 目的と受け入れ条件

1. ローカルでボード（Compose / `ng serve` 等）が動いているとき、Claude Code または Codex の MCP 設定から stdio で本サーバーを起動できる（認証なしで可）。
2. 上記ツールで少なくとも「一覧取得・番号取得・ステータス変更・担当者変更・フィールド更新・プロジェクト一覧／切替・作成」ができる。
3. 既存 HTTP API の追加・変更は行わない（不足はカードと README に追記のみ）。
4. README（`mcp/README.md`）にインストール、環境変数、設定 JSON 例、ツール一覧、不足 API を書く。
5. HTTP 非 2xx・ネットワーク失敗・応答 JSON 不正は MCP ツール結果を失敗（`isError: true`）とし、ステータスと固定の短い理由だけ返す。秘密・生ボディを含めない。
6. `update_item` は get で得た `number`（と指定時 `projectId`）が引数と一致したときだけ、その応答の `id` で PATCH する（検証に使った識別と実行対象をずらさない。L-018）。

## 非目標

- 本番専用の認証設計の刷新、OAuth
- SSE / リモート MCP ホスト
- API の新エンドポイント追加
- FE からの MCP 利用
- Angular CLI の `frontend/.vscode/mcp.json` との統合
- `relatedItems` や create 時の dueAt など、着手〜Review 以外のフィールド全面公開
- MCP 経由のプロジェクト間アイテム移動（再採番あり）

## 不足 API（カード／README へ追記する内容）

1. **`PATCH /api/items/by-number/{number}` の汎用部分更新が無い** — タイトル・説明・dueAt・closeReason・projectId・prUrls 等は内部 id の `PATCH /api/items/{id}` が必要。MCP は get→number 照合→id→PATCH で回避。
2. （必要なら実装後に増えたギャップも同じ節へ追記。API 実装は別カード。）

## 関連知見

- L-001: 操作の成否を呼び出し元へ伝える（HTTP 失敗を成功扱いにしない）
- L-017 / L-031: 失敗文言・ログに秘密を出さない
- L-018: 検証と実行で解釈をずらさない（`update_item` は get の number 照合後にその id で PATCH）
- L-035: 番号と内部 id の取り違えを避ける（ツール入力は公開 number／列名。item id は入力に出さない）

## セルフチェック

- TBD / TODO なし（ツール引数・失敗伝達・create/update キー・L-018 経路を本文に固定済み）
- 「API を足さない」とツール集合が矛盾しない
- 不足 API はカード追記で扱うと明記
- 範囲は着手〜Review 最小（Auth 刷新・relatedItems 全面は非目標）
