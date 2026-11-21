# プロジェクト URL でボードを開く（#86）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [x]`) syntax. Commit は `/feature` 中はしない。

**Goal:** ログイン済みで `/?project=<id>` を開くとそのプロジェクトのボードになる。不正・未知は黙って落ちずエラー表示。ヘッダ／作成後の切替成功後は URL の `project` を同期。

**Architecture:** FE のみ。純関数でクエリ解析 → `App` が `ProjectSession.load` 成功後（`bootstrapped`）にボードルートだけ 1 回 `switchTo`。outbound は既存切替成功時に `Router.navigate`（merge + replaceUrl）。BE／OpenAPI 変更なし。

**Tech Stack:** Angular、既存 `ProjectSession.switchTo`、Vitest

**Design:** `docs/superpowers/specs/2026-11-22-project-url-deep-link-design.md`

**知見:** L-001, L-044, L-037, L-040, L-842, L-860

**Commits:** `/feature` 中はコミットしない。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/project-query.ts` (+spec) | `parseProjectQueryParam`、`resolveProjectDeepLinkAction`、`withProjectQueryParam`、定数 |
| `frontend/src/app/app.ts` (+spec 追加) | inbound 1 回適用、outbound URL 同期 |
| `frontend/src/app/project-session.ts` (+spec) | `syncActiveFromBoard` は `switching` 中 no-op（L-860） |
| `README.md` | 「ボード共有 URL」1 節 |

---

### Task 1: クエリ解析（純関数）

- [x] **Step 1:** `project-query.ts` を追加。
  - `export type ProjectQueryParse = { kind: 'absent' } | { kind: 'invalid' } | { kind: 'ok'; id: number }`。
  - `export const PROJECT_QUERY_NOT_FOUND = '指定のプロジェクトが見つかりません。'`（このファイルのみで定義）。
  - `export function parseProjectQueryParam(input: string | readonly string[] | null | undefined): ProjectQueryParse`。
  - 規則（設計どおり）:
    - 欠落・`null`・`undefined`・空配列 → `absent`
    - 配列長 ≥ 2 → `invalid`（先頭採用しない）
    - 単一値: trim。`/^\d+$/` かつ `Number` が有限の正の整数（≥1）→ `ok`。それ以外（`01`・`+1`・`1.0`・空・非数字・≤0）→ `invalid`
  - `parseActiveProjectId` は number 専用のまま触らない（API 応答用）。
- [x] **Step 2:** `project-query.spec.ts`: absent / ok(`2`) / invalid(`abc`,`01`,`+1`,`1.0`,`0`,`-1`,`''`,空白のみ) / 重複配列 / 前後空白付き有効数字。

### Task 2: App inbound 適用

- [x] **Step 1:** `App` に `private projectDeepLinkApplied = false`。
- [x] **Step 2:** 適用契機は **1 つに固定**: `constructor` 内の `effect` で `projectSession.bootstrapped()` が true になった最初の回だけ `applyProjectDeepLink()` を呼び、直後に `projectDeepLinkApplied = true`。`bootstrapped` 再 flip や NavigationEnd では再適用しない（設計: load 成功直後・1 回のみ）。
- [x] **Step 3:** `applyProjectDeepLink`:
  1. 現在 URL のパスがボード（`''` または `/`。クエリ除く）でなければ return。
  2. `router.parseUrl(this.router.url)` の `queryParams.project`（配列化し得る）を `parseProjectQueryParam` へ。
  3. `absent` → return。
  4. `invalid` → `projectSession.error.set(PROJECT_QUERY_NOT_FOUND)`、return（`switchTo` 無し、`activeId` 不変）。
  5. `ok`: 一覧に id が無ければ同じく固定文言、`activeId` 不変、return。
  6. 既に `activeId === id` → `switchTo` 不要（`activeId` 維持）。
  7. それ以外 → **必ず** `projectSession.switchTo(id)` のみ。`activeId.set`／settings PATCH 直呼び禁止（L-037/L-040/L-842: 世代・busy→楽観の順は既存 `switchTo` に任せる）。失敗時は既存 error（固定文言に上書きしない）。inbound 成功では URL 同期しない（クエリは既に正しい）。
- [x] **Step 4:** `app.spec.ts`:
  - ボード + 有効 id（フィクスチャで **初期 `activeId` を別 id** にし同値スキップを避ける）→ `switchTo` ちょうど 1 回。
  - 同値（`activeId ===` クエリ id）→ `switchTo` 0 回。
  - 不正／重複 → `switchTo` 無し + 固定文言 + **`activeId` 不変**。
  - 未知 id → 同上（`activeId` 不変）。
  - 欠落 → 何もしない。
  - `/items/1?project=2` → `switchTo` 無し。
  - `/backlog?project=2` → `switchTo` 無し。
  - `bootstrapped` 前は走らない／フラグ後の 2 回目は走らない。

### Task 3: outbound URL 同期

- [x] **Step 1:** `syncProjectQueryToUrl(id: number)`: `withProjectQueryParam` で UrlTree の query を merge し `navigateByUrl(..., { replaceUrl: true })`（App root では `navigate([], merge)` が効かないため）。
- [x] **Step 2:** `onProjectOptionSelect`: `switchTo(id).subscribe({ next: (resolved) => syncProjectQueryToUrl(resolved) })`。**要求 id ではなく next の resolved** を使う。error では sync しない（L-001）。
- [x] **Step 3:** `switchToCreatedProject`: 同様に `next: (resolved) => syncProjectQueryToUrl(resolved)`。
- [x] **Step 4:** テストを **経路別に**:
  - `onProjectOptionSelect` 成功 → navigate（merge+replaceUrl、`project` = resolved）。
  - `onProjectOptionSelect` 失敗 → navigate 無し。
  - `switchToCreatedProject` 成功 → navigate。
  - `switchToCreatedProject` 失敗 → navigate 無し。
- [x] **Step 5（L-037/L-040/L-842）:** App は `switchTo` の next でのみ sync。stale／busy 負けは `switchTo` が next を出さない契約に依存。Task5 で `project-session.spec.ts` の切替・世代・busy 系を実行。

### Task 4: README

- [x] **Step 1:** `README.md` に「ボード共有 URL」節: 例 `/?project=2`、ログイン必須、不正・未知はエラー、ヘッダ切替で URL が更新される旨を短く。

### Task 5: 検証（L-860 含む）

- [x] **Step 1:** board の poll 経路は触らない。`project-session.syncActiveFromBoard` のみ `switching` 中 no-op を追加（L-860／deep-link race）。合格条件: 当該回帰テスト＋`project-session.spec.ts` が通る。`board.ts` に差分が無いこと。
- [x] **Step 2:** FE テスト全体（または Task1–3 + Step1 列挙）が通る。
- [x] **Step 3:** BE／OpenAPI 差分が無いことを `git diff --stat` で確認。

---

## レビュー記録

### 第 1 周（要件との対応）2026-11-22

対応: 適用契機を bootstrapped effect 1 回に固定。`/backlog` スキップテスト。AC5 をヘッダ／作成後で分離。不正・未知で `activeId` 不変 assert。L-037/040 は next のみ sync＋既存 switchTo 契約。AC6 は board/session 非差分＋既存 spec 列挙実行を合格条件に。

### 第 2 周（タスク整合と知見）2026-11-22

対応: L-842 を Task2/3/5 に明記（inbound は switchTo のみ）。型名 `ProjectQueryParse` と定数を Task1 に固定。同値スキップと 1 回テストのフィクスチャ前提を分離。sync は next の resolved id を使用。
