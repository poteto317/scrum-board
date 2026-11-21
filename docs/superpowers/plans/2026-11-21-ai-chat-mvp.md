# AI チャット MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アイテム詳細で Claude と会話でき、履歴をサーバ保存し、設定ページでアプリ集計の利用状況とキー有無を見られるようにする。チャット API は本文を書かない。

**Architecture:** BE に `item_ai_messages` と利用累計、Anthropic 呼び出し（既存 SDK・refined と同一セマフォ）。FE は ItemDetail の AI パネルと `/settings`。適用は FE→既存 item/comment API。契約は `docs/openapi.yaml`。

**Tech Stack:** Go net/http + MySQL、Anthropic SDK（既存）、Angular standalone、OpenAPI

**Design:** `docs/superpowers/specs/2026-11-21-ai-chat-mvp-design.md`

**知見:** L-001, L-044, 上流エラー非漏洩, OpenAPI 正本, L-408, update-api-doc

**Commits:** `/feature` 中はコミットしない。

**数値（本プランで固定）:**
- ユーザー1メッセージ: Unicode 最大 **4000** 文字（コメント本文と同程度）
- 履歴コンテキスト: 直近 **20** 往復まで（超過分は古い方から送らない）
- アイテムあたり保存メッセージ上限: **200**（超過時は古い順に削除してから追記）
- 同時実行: refined と共有（`maxConcurrentFormats = 4`）
- アイテム削除: soft delete 中は履歴を残す。**hard delete（ゴミ箱 purge／完全削除）で FK CASCADE** により消去
---

## File map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/*`（schema・repo・handler） | テーブル・CRUD・ACL・usage・ルート |
| `backend/internal/aiformat` または新 `aichat` | Claude 会話呼び出し（Format とは別 IF） |
| `frontend/.../item-ai-chat.*` | 詳細パネル |
| `frontend/.../settings.*` | `/settings` |
| `docs/openapi.yaml` | 契約 |
| `.cursor/skills/update-api-doc` | ルート追加時に従う |

---

### Task 1: DB とリポジトリ

- [x] **Step 1:** 既存のスキーマ準備（Ensure／起動時 DDL）の置き場所を特定し、`item_ai_messages`（`item_id` FK → items **ON DELETE CASCADE**）と `ai_usage`（1行累計）を冪等に追加する
- [x] **Step 2:** List／Append（200 超は古い順削除）／Clear／AddUsage。hard delete でメッセージが消えることを統合テストで固定
- [x] **Step 3:** 検証を通す

---

### Task 2: Claude 会話＋文脈＋セマフォ共有

- [x] **Step 1:** 会話用 IF（messages in → assistant text + usage tokens）。失敗は refined 同様に上流文言を隠す
- [x] **Step 2:** **文脈ビルダ**: 当該 item の title／description／comments（閲覧可＝編集可前提なので取得可）を system／先頭 user に載せる。履歴は保存全件から **直近 20 往復**だけモデルに送る（保存上限 200 とは別）
- [x] **Step 3:** wiring でキーがあるときだけ注入。handler の slots を POST ai-chat からも acquire（同一セマフォ）
- [x] **Step 4:** 偽 Anthropic で成功／429／未設定 503。文脈に title 等が含まれることをリクエスト断言で固定

---

### Task 3: HTTP API＋OpenAPI

- [x] **Step 1:** GET/POST/DELETE `.../ai-chat`、GET `/api/ai/usage`。空・過長・**未知フィールド**は 400（L-044／`DisallowUnknownFields`）
- [x] **Step 2:** ハンドラテスト列挙: 未ログイン 401、閲覧のみ（canEdit なし）403、POST キー無し 503、GET/DELETE キー無し 200、usage はログイン可、未知フィールド 400
- [x] **Step 3:** POST 成功経路で `AddUsage` を呼び、加算後の `GET /api/ai/usage` を断言する
- [x] **Step 4:** POST 成功後も description／comments が変わらないことを API テストで固定（受け入れ 4）
- [x] **Step 5:** `docs/openapi.yaml` 更新＋`check-openapi-routes.py`（update-api-doc スキル）

---

### Task 4: FE AI パネル

- [x] **Step 1:** `canEdit` 時のみパネル。履歴表示・送信・クリア
- [x] **Step 2:** 「説明に反映」「コメント追加」は確認後に既存 API（L-408: repeat 抑止）。適用／送信失敗時は UI を成功確定せずエラー表示（L-001）
- [x] **Step 3:** コンポーネントテスト（成功経路＋適用失敗で非確定）

---

### Task 5: FE `/settings`

- [x] **Step 1:** ルート＋ページ。`GET /api/ai/usage` 表示、未設定案内
- [x] **Step 2:** ヘッダーから到達（`open_settings` を catalog に足すか、ユーザーメニュー近傍の固定リンク。header-menu 許可 ID 規則に従う）
- [x] **Step 3:** テスト

---

### Task 6: 受け入れ

- [x] **Step 1:** 設計の受け入れ 1–6 をチェック
- [x] **Step 2:** `go test`／`ng test` の関連を通す
- [x] **Step 3:** コミットしない

---

## レビュー記録

### 第 1 周（要件との対応）
- [対応] 文脈ビルダ・20往復切り出し・hard delete CASCADE・ACL/キー分岐テスト・本文非変更の API テストを追記

### 第 2 周（タスク整合・知見）
- [対応] L-001 を受け入れ4から外し Task 4 の適用失敗 UI へ紐づけ／L-044 未知フィールドを Task 3 に明示／POST 成功時 AddUsage＋usage GET 断言を Task 3 に連結
