# AIチャット右ドック＋専用画面（#148）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AIチャットを右端フルハイトのドックにし、全画面アイコンから `/ai-chat` 専用画面へ遷移できるようにする（API 変更なし）。

**Architecture:** `AiChatFab` の浮きパネルを右ドックに作り替え、`App` が `AiChatFab.open` を見て `.app-main` を押し縮める。`ProjectAiChat` に `layout` 入力を足して一覧を伸ばす。新コンポーネント `AiChatPage` とルート `/ai-chat` を追加する。

**Tech Stack:** Angular（standalone components, signals）、既存 `ProjectAiChat` / `AiChatFab` / `ProjectSession`、Vitest/`ng test`。

**Spec:** `docs/superpowers/specs/2026-11-26-card148-ai-chat-panel-design.md`

## Global Constraints

- API / DB / OpenAPI は触らない。
- ドック開閉の正は `AiChatFab.open`。`AiChatContext` に `dockOpen` を複製しない（L-542）。
- `/ai-chat` は `authGuard`。未ログイン案内はページに出さない。
- 全画面ナビは **成功後だけ** ドックを閉じる。失敗時は開いたまま（L-001 / L-058 / L-408）。
- 知見パック: L-001, L-058, L-157, L-397, L-408, L-522, L-542, L-792, L-990。
- `/feature` 中はコミットしない。

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/ai-chat-fab.{ts,html,css,spec.ts}` | 右ドック UI、全画面ナビ、開閉・Esc |
| `frontend/src/app/project-ai-chat.{ts,html,css,spec.ts}` | `layout` 入力、一覧の伸縮 |
| `frontend/src/app/ai-chat-page.{ts,html,css,spec.ts}` | 専用画面（新規） |
| `frontend/src/app/app.routes.ts` | `/ai-chat` ルート |
| `frontend/src/app/app.{ts,html,css}` | Fab 参照・`ai-chat-dock-open`・押し縮め |
| `frontend/src/app/ai-chat-target.ts` / spec | FAB 表示ルートは現状維持（`/ai-chat` は含めない） |

---

### Task 1: `ProjectAiChat` の layout

**Files:**
- Modify: `frontend/src/app/project-ai-chat.ts`
- Modify: `frontend/src/app/project-ai-chat.html`（必要なら）
- Modify: `frontend/src/app/project-ai-chat.css`
- Modify: `frontend/src/app/project-ai-chat.spec.ts`

- [x] **Step 1: 失敗するテスト** — `layout` 省略時は従来クラス、`layout='dock'|'page'` のときホスト／ルートに修飾クラスが付く（または `.ai-chat-list` が max-height 28rem を持たない）ことを期待するテストを書く。
- [x] **Step 2: 実行して失敗を確認** — `cd frontend && npx ng test --watch=false --include='**/project-ai-chat.spec.ts'`
- [x] **Step 3: 実装** — `layout = input<'fab' | 'dock' | 'page'>('fab')`（signal input。既定 `fab` で現行見た目）。ホストに `layout()` 由来のクラスを付け、`dock`/`page` では `.ai-chat` を flex カラム、`.ai-chat-list` の `max-height` を外して `flex: 1; min-height: 0; overflow: auto`。スタイルは **`project-ai-chat.css` のみ**（グローバル無修飾クラスを足さない。L-792）。
- [x] **Step 4: テスト再実行して通す**

---

### Task 2: `AiChatFab` を右ドック化＋全画面

**Files:**
- Modify: `frontend/src/app/ai-chat-fab.{ts,html,css,spec.ts}`

- [x] **Step 1: 失敗するテスト**
  - 開くとパネルにドック用クラス／ロールがあり、全画面ボタンがある。
  - 全画面クリックで `router.navigate(['/ai-chat'])` が呼ばれ、**成功 Promise の後**に `open` が false。
  - navigate が false / reject 相当なら `open` が true のまま、ボタンが再有効。
  - 既存の Esc・プロジェクト切替で閉じる・入口フォーカスのテストが退行しない。
  - ドック表示かつ textarea にフォーカスがあるとき、Esc でパネルを閉じない（L-522）。
  - `closePanel` はパネル内フォーカスを先に `blur` してから `open=false`、その後入口へ focus（L-397 / L-157。既存の順序を崩さないことを spec で固定）。
- [x] **Step 2: テスト実行→失敗確認**
- [x] **Step 3: 実装**
  - CSS は **`ai-chat-fab.css` のみ**（L-792）: 浮きカードをやめ、`position: fixed; top: 67px; right: 0; bottom: 0; width: var(--ai-chat-dock-width); z-index: 12`。`--ai-chat-dock-width: min(28rem, 40vw)`、`@media (max-width: 639px) { --ai-chat-dock-width: min(100vw, 28rem); }`。入口ボタン `z-index: 13`。
  - ヘッダーに「全画面」ボタン（`aria-label` 明確）。`expanding` signal で disabled。
  - `expandToPage()`: `expanding=true` → `const ok = await this.router.navigate(['/ai-chat'])` → ok なら `closePanel({restoreFocus:false})`、否なら `expanding=false`（ドック開いたまま）。
  - `onDocumentKeydown`: Esc で閉じる前に、`activeElement` が `textarea` / `input` / `select` / `contentEditable` なら return（L-522）。
  - `ProjectAiChat` に `[layout]="'dock'"`。
- [x] **Step 4: テスト通す**

---

### Task 3: `AiChatPage` とルート

**Files:**
- Create: `frontend/src/app/ai-chat-page.{ts,html,css,spec.ts}`
- Modify: `frontend/src/app/app.routes.ts`

- [x] **Step 1: 失敗するテスト**
  - `!bootstrapped || switching` → 待機表示（チャット無し・未選択案内無し）。
  - `bootstrapped && !switching && !activeId` → 未選択案内。
  - `bootstrapped && !switching && activeId>0` → `ProjectAiChat` が `layout='page'` で出る。**`focusItem` 入力は渡さない**（反映ボタンが出ない）。
  - 「戻る」: `history.length>1` なら `Location.back`、なければ `/` へ navigate（実装に合わせモック）。
  - 本体表示後、戻るリンクまたは見出しにフォーカスが移る。
  - `AiChatPage` テンプレートに未ログイン向け文言・分岐が無い（プロジェクト未選択案内のみ）。
- [x] **Step 2: 失敗確認**
- [x] **Step 3: 実装** — `authGuard` 付き `{ path: 'ai-chat', loadComponent: () => import('./ai-chat-page').then(m => m.AiChatPage) }`。ページはシェル内（`showChrome`）に載るのでヘッダーはそのまま。`ProjectAiChat` には `[projectId]` と `[layout]="'page'"` のみ（`focusItem` 省略）。
- [x] **Step 4: テスト通す**
- [x] **Step 5: `ai-chat-target.spec.ts`** — `isAiChatRoute` が `/`・`/backlog`・`/items/1` で true、`/ai-chat` と `/items/1/solution` で false。
- [x] **Step 6: ルートのガード** — 既存の `auth.guard` / routes 系 spec のパターンに合わせ、`/ai-chat` に `authGuard` が付いていることを固定（未ログインはページを描画せずガード任せ）。

---

### Task 4: シェルの押し縮め

**Files:**
- Modify: `frontend/src/app/app.{ts,html,css}`
- Modify: 既存の app 系 spec があれば更新、無ければ `ai-chat-fab` 結合で足りる範囲に留める

- [x] **Step 1: 失敗するテスト** — Fab が open のとき `.app-body` に `ai-chat-dock-open` が付く（クラス有無）。Fab 未マウント（`showAiChatFab` false）では付かない。
- [x] **Step 2: 失敗確認**
- [x] **Step 3: 実装**
  - Fab は現状どおり `.app-body` の**外**（兄弟）。テンプレート `#aiChatFab` を兄弟から `.app-body` にバインドしない。
  - `app.ts`: `aiChatFab = viewChild(AiChatFab)` と `dockOpen = computed(() => this.aiChatFab()?.open() === true)`。
  - `app.html`: `.app-body` に `[class.ai-chat-dock-open]="dockOpen()"`。
  - `app.css`（祖先付きのみ。L-792）: `.app-body.ai-chat-dock-open { --ai-chat-dock-width: min(28rem, 40vw); }` と `@media (max-width: 639px)`、`.app-body.ai-chat-dock-open .app-main { padding-right: var(--ai-chat-dock-width); }`。
- [x] **Step 4: テスト通す**

---

### Task 5: 回帰検証

- [x] **Step 1:** `cd frontend && npm test -- --watch=false --include='**/ai-chat*.spec.ts' --include='**/project-ai-chat*.spec.ts'`（プロジェクトの慣例に合わせ `ng test` / `npm test`）
- [x] **Step 2:** 失敗があれば修正して再実行。バックエンドは変更なしのため Go テストは不要。
- [x] **Step 3:** 手動観点（報告用）: ボード・**バックログ**・詳細でドック開閉、詳細で focusItem 反映ボタン、`/ai-chat` 直開き、ナビ失敗モックはユニットでカバー済みと明記。

---

## 完了条件（受け入れとの対応）

1〜8 は設計書の受け入れ条件。特に「ナビ失敗でドックが残る」「`/ai-chat` で FAB 無し」「3 状態」はテストで固定する。
