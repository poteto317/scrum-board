# URL ブックマークカード（#157）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 説明・ソリューションで段落全体が `[url](url)` のとき、サーバー取得タイトル付きのブックマークカードとして表示する。

**Architecture:** 本文形式は変えず、表示パースで `bookmark` セグメント化する。フロントは `POST /api/link-previews` でタイトルをバッチ取得する。サーバーは https 専用・SSRF ガード付きクライアントで HTML メタを取り、プロセス内キャッシュする（`PRTitleResolver` と同型だがクライアント非共有）。

**Tech Stack:** Go（`net/http`, `net`, HTML 抽出）、Angular / TypeScript（既存 description-*）、OpenAPI。

## Global Constraints

- コミットは `/feature` 中にしない（後続 `/commit-ja`）。
- 日本語 UI 文言。コード・識別子は英語。
- 設計書: `docs/superpowers/specs/2026-11-27-card157-url-bookmark-cards-design.md` が正。
- 知見: L-001, L-018, L-037, L-040, L-052, L-054, L-017, L-1034, L-1058, L-1099, L-1150, L-836。
- 検証: `cd backend && go test -race ./...`（または変更パッケージ）、`cd frontend && npm test -- --watch=false`（該当 spec）。

## File map

| ファイル | 責務 |
|--|--|
| `backend/internal/kanban/link_preview_ssrf.go` | URL 検証・公開 IP 判定・DialContext・Redirect 再検査 |
| `backend/internal/kanban/link_preview.go` | 取得・HTML タイトル抽出・キャッシュ・inflight |
| `backend/internal/kanban/link_preview_handler.go` | `POST /api/link-previews` |
| `backend/internal/kanban/handler.go` | ルート登録・resolver 配線 |
| `docs/openapi.yaml` | API 契約 |
| `frontend/src/app/description-link.ts` | `isBookmarkLink`、`DescriptionSegment` に `bookmark` |
| `frontend/src/app/description-view.ts` | 段落が候補 1 件だけのとき `bookmark` へ昇格 |
| `frontend/src/app/description-rich-text.ts` (+css) | カード UI |
| `frontend/src/app/link-preview.ts` | 世代付きバッチ取得・ホスト名フォールバック |
| `frontend/src/app/api.ts` | `linkPreviews` |
| `frontend/src/app/description-blocks-editor.ts` | `showRichPreview` に bookmark、プレビュー取得配線 |
| `frontend/src/app/item-detail.ts` / 閲覧側 | 説明・ソリューション表示での取得（既存 rich-text 利用箇所） |

---

### Task 1: SSRF ガード（サーバー）

**Files:**
- Create: `backend/internal/kanban/link_preview_ssrf.go`
- Test: `backend/internal/kanban/link_preview_ssrf_test.go`

**Produces:**
- `func validateLinkPreviewURL(raw string) (*url.URL, error)` — https のみ、userinfo 禁止、長さ ≤2048、制御文字・`()` 禁止（FE と同趣旨）
- `func isPublicIP(ip net.IP) bool`
- `func blockedLinkPreviewHostname(host string) bool` — 閉集合: `localhost`, `metadata.google.internal`, `metadata`, `kubernetes.default`, `kubernetes.default.svc`（大小無視）
- `func newLinkPreviewHTTPClient() *http.Client` — Timeout 3s、CheckRedirect≤3＋毎回 validate、DialContext で接続 IP 再検査、**認証ヘッダ無し**。本番はこの Client を Resolver がそのまま使う（RoundTripper だけ渡して SSRF を外さない）

- [ ] **Step 1:** 失敗テスト: `http://`、userinfo、`127.0.0.1`、`10.0.0.1`、`[::1]`、拒否ホスト名閉集合、`()` 含み、CGNAT `100.64.0.1`、リンクローカル、マルチキャスト、IPv6 ULA を拒否。
- [ ] **Step 2:** ホスト名解決で A/AAAA の **いずれか**が非公開なら拒否するテスト（Lookup を差し替え可能に）。DialContext が接続先 IP を再検査して非公開を拒否するテスト。
- [ ] **Step 3:** リダイレクト先がプライベート IP なら拒否（httptest 302）。外向き要求に `Cookie` / `Authorization` / Basic が付かないことを RoundTripper で固定（受け入れ 11）。
- [ ] **Step 4:** FE `normalizeDescriptionLinkUrl` の拒否例（`http:`・過長・制御文字・`()`）と同じ入力を `validateLinkPreviewURL` でも落とす対応表テスト（L-018）。
- [ ] **Step 5:** 実装して `go test ./internal/kanban/ -run LinkPreviewSSRF -count=1` を通す。

---

### Task 2: タイトル解決とキャッシュ

**Files:**
- Create: `backend/internal/kanban/link_preview.go`
- Test: `backend/internal/kanban/link_preview_test.go`

**Consumes:** Task 1 の `newLinkPreviewHTTPClient` / validate  
**Produces:**
- `type LinkPreviewResolver struct { client *http.Client; ... }`
- `func NewLinkPreviewResolver() *LinkPreviewResolver` — 内部で必ず `newLinkPreviewHTTPClient()` を使う（本番経路）。
- `func newLinkPreviewResolverWithClient(c *http.Client) *LinkPreviewResolver` — **テスト専用**。本番配線から呼ばない。
- `func (r *LinkPreviewResolver) Resolve(ctx context.Context, rawURL string) (title string, ok bool)`
- 定数: 成功 TTL 10m、失敗 TTL 1m、成功保持上限 1h、cache max 512、max concurrent 8、body max 512KiB、title max 200 rune
- 抽出順: og:title → twitter:title → `<title>`。HTML 実体デコード・空白畳み。`Content-Type` が `text/html` または `+html` を含むときのみ成功候補。非 2xx → ok=false
- SWR + stale-if-error（必須）
- Transport / Client は PR 用と共有しない
- 失敗ログに応答本文全文・資格情報を出さない（L-017）。テストではロガー差し替えまたは観測用フックで担保

- [ ] **Step 1:** httptest で HTML（og:title）成功・失敗 TTL・同一 URL inflight 共有（`newLinkPreviewResolverWithClient`）。
- [ ] **Step 2:** SWR: 成功 TTL 切れでも即時に旧 title を返し背景再取得すること。stale-if-error: 背景失敗でも成功確定から 1h 内は成功 title を維持し失敗キャッシュで上書きしないこと。
- [ ] **Step 3:** twitter:title / `<title>` フォールバック、`application/xhtml+xml` 等 `+html`、実体デコード、200 rune 切詰め、切詰め後空・非 HTML・本文超過 → ok=false。
- [ ] **Step 4:** 実装してテストを通す。ログに本文が混ざらないことを固定。

---

### Task 3: `POST /api/link-previews` + OpenAPI

**Files:**
- Create: `backend/internal/kanban/link_preview_handler.go`
- Modify: `backend/internal/kanban/handler.go`（フィールド追加、`mux.HandleFunc("POST /api/link-previews", …)`、コンストラクタで **`NewLinkPreviewResolver()`**＝Task 1 client 内蔵）
- Modify: `docs/openapi.yaml`
- Test: `backend/internal/kanban/link_preview_handler_test.go`

**Produces:**
- リクエスト `{ "urls": string[] }`。正規化成功後の **ユニーク集合**が最大 20（重複は落とす。同一 URL 複数入力でも `previews` キーは 1）。正規化成功 URL は必ず `{ok:true,title}` または `{ok:false}`。正規化失敗はキー無し。
- ログイン必須（既存 auth ミドルウェアと同じ）。
- 不正 JSON / 非配列は 400。ユニーク集合が 20 超は **400**。
- 正規化後 URL は **並列** `Resolve`（同時数は Resolver のスロット 8）。全エントリを揃えてから 200 を返す。並列であることをテストで固定（直列 20×3s にならないこと）。

- [ ] **Step 1:** ハンドラテスト（認証あり・バッチ・不正 URL キー無し・ok:false・重複入力でキー 1・21 ユニークで 400・複数 URL が並列解決されること）。
- [ ] **Step 2:** 実装 + OpenAPI 更新。
- [ ] **Step 3:** `go test -race ./internal/kanban/ -count=1`（または関連パッケージ）。

---

### Task 4: フロント — セグメントと段落昇格

**Files:**
- Modify: `frontend/src/app/description-link.ts`
- Modify: `frontend/src/app/description-view.ts`（`taskLabel` の switch に `bookmark`）
- Test: `frontend/src/app/description-link.spec.ts`, `description-view.spec.ts`
- Test: コメント経路の回帰（`item-comments` または rich-text 利用箇所の spec）— 同型 `[url](url)` が **link のまま**

**Produces:**
- `export function isBookmarkLink(label: string, url: string): boolean` — `label === url && normalizeDescriptionLinkUrl(url) !== null`
- `DescriptionSegment` に `{ kind: 'bookmark'; label: string; url: string }`
- `parseDescriptionLinks` は従来どおり `link` を出す（添付以外）。
- `buildDescriptionView(text, itemNumber, blockSyntax, options?: { promoteBookmarks?: boolean })`:
  - **`promoteBookmarks === true` のときだけ**、`paragraph` で「空白 text のみ + link 1 件」かつ `isBookmarkLink` なら `bookmark` へ置換。
  - heading / list / quote / task は昇格しない。
  - 既定 `promoteBookmarks` は **false**（コメント等の既存呼び出しがカード化しない）。
- 説明・ソリューションの呼び出しだけ `promoteBookmarks: true`（`blockSyntax` true/false どちらでも、1 段落として同じ規則）。コメントはフラグを渡さない／false。

- [ ] **Step 1:** 失敗テスト（説明相当: 単独段落→bookmark、名前付きは link、リスト内は link）。
- [ ] **Step 2:** `promoteBookmarks` 省略／false で同型 URL が link のまま（コメント回帰）。
- [ ] **Step 3:** 実装して spec を通す。

---

### Task 5: カード UI + プレビュー取得

**Files:**
- Create: `frontend/src/app/link-preview.ts`, `link-preview.spec.ts`
- Modify: `frontend/src/app/api.ts` — `linkPreviews(urls: string[])`
- Modify: `frontend/src/app/description-rich-text.ts`（+スタイル）
  - `promoteBookmarks = input(false)` を追加し、内部の `buildDescriptionView(..., { promoteBookmarks: this.promoteBookmarks() })` に渡す。
  - タイトル map を `linkTitles = input<Record<string, string>>({})`（または同等）で受け取りカードに反映。**プレビュー HTTP は rich-text 内で呼ばない。**
- Modify: `frontend/src/app/description-blocks-editor.ts`
  - テンプレで `<app-description-rich-text [promoteBookmarks]="true" [linkTitles]="…">`。
  - **プレビュー取得の所有者は editor のみ**（本文／itemNumber 変化で `loadLinkPreviews`）。`showRichPreview` は現行どおり `parseDescriptionLinks` の `link|image|file` 判定で足りる（単独 `[url](url)` は既に `link`）。**`bookmark` kind を showRichPreview に足さない。**
- Modify: 説明・ソリューションの閲覧側も同じパターン（`promoteBookmarks` true + 親が titles を渡す）。`item-detail` に editor と二重の取得購読を置かない。コメントの rich-text は `promoteBookmarks` 未指定（false）。

**Produces:**
- 世代トークン: `{ itemNumber: number; bodyEpoch: number }`（または同等の直列化文字列）。`bodyEpoch` はアイテム切替で 0 に戻し、同一アイテムで本文（description/solution）が再パースされるたびに +1。チャンクを順に出すときも **開始時に控えた世代**と適用前の現行世代を比較し、不一致なら破棄（並走・後続バッチ含む）。
- `loadLinkPreviews(api, urls, generation): Observable<Record<string, string>>` — 送信前に normalize、20 件チャンク、失敗時ホスト名フォールバック、世代不一致なら適用しない
- カード: タイトル行（未取得「読み込み中」→ title or host）、副行に短縮 URL、全体が `<a target=_blank rel=noopener noreferrer>`

- [ ] **Step 1:** `link-preview.spec.ts` で正規化キー・フォールバック、および世代破棄 3 契機（切替・再パース＝epoch 増・並走バッチ）を固定。
- [ ] **Step 2:** rich-text カード描画（`promoteBookmarks`）+ editor の titles 配線テスト。`showRichPreview` は link のままで true になることを確認。
- [ ] **Step 3:** `npm test -- --watch=false` で関連 spec を通す。

---

### Task 6: 通し検証

- [ ] **Step 1:** `cd backend && go test -race ./internal/kanban/ -count=1`
- [ ] **Step 2:** `cd frontend && npm test -- --watch=false`
- [ ] **Step 3:** 設計の受け入れ 1〜11 をチェックリストで目視確認（手動で足りないものはテストで固定済みかを書く）。

## 気をつける知見（プラン反映）

- L-018: FE/BE 正規化を揃える。`previews` キーは normalize 後のみ。
- L-001: API/HTTP 失敗でタイトルを空にせずホスト名へ。
- L-037/040: generation で切替・再パース・並走バッチを破棄。
- L-052/054: client Timeout + body limit。
- L-1034/1058: 認証非付与・PR クライアント非共有。
- L-1099/1150: redirect 再 validate + Dial IP 再検査。
- L-836: title 200 / URL 2048。
- L-017: ログに本文を出さない。
