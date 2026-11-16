# リンク表示名 Implementation Plan

> **Spec:** `docs/superpowers/specs/2026-11-16-link-display-names-design.md`  
> **コミットしない**（`/feature`）。知見: L-002, L-017, L-031, L-037, L-040

**Goal:** アイテム詳細と変更履歴で、GitHub PR と関連リンクの主表示を URL ではなく名前（PR タイトル／アイテムタイトル／label）にする。

**Architecture:** バックエンドが GitHub API（任意 `GITHUB_TOKEN`）で PR タイトルを解決しキャッシュする。アイテム単体 GET に `prTitles` を同順で付与。履歴は `POST /api/pr-titles` バッチで同じヘルパーを使う。FE は詳細・履歴のリンクテキストを名前化し、関連 url の全文 URL 副表示をやめる。

**Tech Stack:** Go / Angular / vitest / httptest

## Global Constraints

- `prUrls: string[]` と related 永続形は変えない。`prTitles` は読み取り専用。
- ボード GET では `prTitles` を付けない。
- 失敗時は `owner/repo#N` フォールバック。全文 URL を主テキストにしない。
- トークン／GitHub 生エラーをログ・API JSON に出さない。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| PR タイトル解決 | Create: `backend/internal/kanban/pr_title.go`（+ `_test.go`） |
| バッチ API | Modify: handler 登録（既存 `handler.go` 等）、Create: `pr_title_handler_test.go` |
| アイテム GET enrichment | Modify: `model.go`（`PRTitles`）、単体 GET 応答組み立て箇所 |
| フォールバック／パース | `pr_title.go` 内。既存 PR URL 検証と文法を揃える |
| FE モデル | `frontend/src/app/models.ts`（`prTitles?: string[]`） |
| FE 詳細 | `item-detail.html` / `.ts` / `.spec.ts` |
| FE 関連表示 | `related-item.ts`（必要なら）、詳細テンプレの url 副表示削除 |
| FE 履歴 | `item-history.html` / `.ts` / `.spec.ts`（無ければ追加）、`api.ts` に `prTitles` POST |
| FE PR 表示ヘルパ | Create 可: `pr-display.ts`（`fallbackPrLabel(url)`、履歴と共有） |

---

### Task 1: Go — フォールバックとタイトル解決＋キャッシュ

**Produces:** `FallbackPRTitle(url string) string`, `PRTitleResolver`（HTTP クライアント差し替え可）, `Resolve(ctx, url) string`, プロセス内 TTL キャッシュ

- [x] URL → `owner/repo#n` の単体テスト（正常・不正は全文を返さない）
- [x] Resolver: タイムアウト ~2s、`User-Agent`、任意 `GITHUB_TOKEN`（env）、TTL ~10m キャッシュ、並列上限
- [x] モック RoundTripper で 200+title / 404 / タイムアウト相当 → タイトルまたはフォールバック
- [x] 同一 URL 再解決がキャッシュヒットすること（RoundTrip 回数）
- [x] 失敗経路で返却文字列に `Bearer` やレスポンス本文断片が混ざらないこと

**Done when:** `go test ./internal/kanban/ -run PRTitle`（または該当パッケージ）緑。

---

### Task 2: Go — アイテム GET の `prTitles` と `POST /api/pr-titles`

**Consumes:** Task 1 の Resolver  
**Produces:** GET item JSON に `prTitles`（`prUrls` と同長・同順）。`POST /api/pr-titles` `{urls:[]}` → `{titles: {url: label}}`

- [x] `Item` に `PRTitles []string \`json:"prTitles"\``（`prUrls` と同長。空文字禁止）
- [x] 単体 GET のみ enrichment（ボード組み立てでは呼ばない）。PATCH/POST はクライアントの `prTitles` を無視
- [x] バッチ: 既存 PR URL 検証と同じ文法。不正は titles に載せない（またはフォールバックのみ）。github.com PR のみ
- [x] handler テスト: GET で titles 付与（resolver モック）、バッチ成功／不正 URL、エラー JSON に秘密なし
- [x] 既存 `pr_link_handler_test` が `prTitles` 追加で壊れないよう期待を更新

**Done when:** 該当 Go テスト緑。

---

### Task 3: FE — 詳細の PR／関連表示

**Consumes:** `item.prTitles`  
**Produces:** 詳細 UI で名前主表示

- [x] `models.ts` に `prTitles?: string[]`
- [x] テンプレ: PR リンクテキストを `prTitles[i] || fallbackPrLabel(url)` に。`.pr-link-url` 削除。`title` 属性に URL 可
- [x] 関連 url: `.pr-link-url` 削除（label のみ＋↗）
- [x] aria-label（並び替え等）も表示名ベース
- [x] `item-detail.spec.ts` 更新: 全文 URL がリンクテキストに出ない／関連 url に `.pr-link-url` 無し。既存 PR/関連 add-remove/reorder 回帰も緑

**Done when:** 詳細関連 vitest 緑。

---

### Task 4: FE — 履歴の名前表示＋バッチ取得

**Consumes:** `POST /api/pr-titles`、`displayLabel`  
**Produces:** 履歴 UI の名前リスト

- [x] `Api` に `prTitles(urls: string[])` 追加
- [x] `prUrls` 履歴: パース後、バッチで titles 取得。表示は title／fallback。`href` は URL
- [x] 世代／number ガード＋カード切替・`load(before)` で購読キャンセル（L-037 / L-040）
- [x] 解決失敗・未取得は fallback（「PR 無し」と取り違えない）。空配列は「（空欄）」（L-002）
- [x] 解決前は即 `fallbackPrLabel` を出してよい
- [x] `relatedItems` 履歴: JSON パース → `<ul>`、`displayLabel`、item は `routerLink`、url は外部リンク（全文 URL 副表示なし）
- [x] レガシー `prUrl` 単数: 有効 PR URL なら同じ表示規則
- [x] 履歴 spec（新規または既存拡張）

**Done when:** 履歴＋回帰の FE テスト緑。`cd frontend && npm test` と `cd backend && go test ./...` が通る。
