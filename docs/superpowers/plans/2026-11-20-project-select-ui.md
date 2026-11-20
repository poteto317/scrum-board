# プロジェクトセレクト UI 改善 Implementation Plan

> **For agentic workers:** 本リポジトリの `/feature` ではコミットしない。実装後の commit は後続の `/commit-ja` に任せる。Steps は checkbox で進捗管理する。

**Goal:** ヘッダーのプロジェクト切替を下開きのカスタム listbox にし、一覧先頭を現在プロジェクトにする。

**Architecture:** 表示順の純関数を切り出し、`app.html` の native `<select>` をトリガー + listbox に置換。切替・先読み・busy は既存 `ProjectSession` / `App` メソッドを維持。

**Tech Stack:** Angular（standalone）、Vitest、既存 CSS 変数。

**Spec:** `docs/superpowers/specs/2026-11-20-project-select-ui-design.md`

## Global Constraints

- 上方向フリップ禁止。下余白不足時は `max-height` + リスト内スクロール。
- 表示順のみ変更。API `position` は触らない。
- 先読みはトリガーの focus／pointerdown のみ。
- 選択・ハイライトは project.id（L-035）。開中に id 消失なら末尾 clamp、空／activeId null なら閉じる。
- キーボード: 閉時 Enter／Space／ArrowDown で開く・ArrowUp 無視。開時 Arrow は移動のみ・Enter で決定して閉じる・Space は決定せず閉じる・Escape で閉じる。
- 閉じたあと（Escape／決定／キーボード）はフォーカスをトリガーへ戻す。外側クリックで閉じた場合のフォーカス移動は任意。
- `switching`／`projectModalOpen`／`saving` 中はトリガー disabled（現行 select 同等）。
- ARIA: トリガー `aria-haspopup="listbox"` + `aria-expanded`、一覧 `role="listbox"`、各案 `role="option"` + `aria-selected`、ラベル「プロジェクト」。
- BE・DB 変更なし。コミットしない。

## File map

| File | Responsibility |
|------|----------------|
| `frontend/src/app/project-select-display.ts` | `projectsForSelectDisplay` 純関数 |
| `frontend/src/app/project-select-display.spec.ts` | 表示順の単体テスト |
| `frontend/src/app/app.ts` | open 状態、キーボード、外側クリック、選択→`switchTo`、ハイライト id |
| `frontend/src/app/app.html` | トリガー + listbox マークアップ |
| `frontend/src/app/app.css` | トリガー／パネル見た目・下配置・z-index |
| `frontend/src/app/app.spec.ts` | 既存 select 前提を更新 + 新受け入れテスト |

---

### Task 1: 表示順ヘルパ

**Files:**
- Create: `frontend/src/app/project-select-display.ts`
- Create: `frontend/src/app/project-select-display.spec.ts`

**Interfaces:**
- Produces: `projectsForSelectDisplay(projects: Project[], activeId: number | null): Project[]`
- 内部で position/id ソート（`project-session` の `sortProjects` と同順）。循環 import を避けるためソートはヘルパ内に複製するか、`sortProjects` を export して共有（どちらか一方。共有するなら `project-session.ts` から export）。

- [x] **Step 1:** 失敗するテスト: active が末尾でも戻り値[0] が active。activeId null なら position 順のみ。active が list に無いなら position 順のまま。
- [x] **Step 2:** 実装してテストを通す。
- [x] **Step 3:** `cd frontend && npx vitest run src/app/project-select-display.spec.ts`

---

### Task 2: カスタム listbox UI + 配線

**Files:**
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.css`

**Interfaces:**
- Consumes: `projectsForSelectDisplay`
- Produces: `projectMenuOpen` signal、`highlightedProjectId`、`openProjectMenu` / `closeProjectMenu` / `onProjectOptionSelect(id)`、既存 `onProjectChange` 相当を id 直接受けに変更可
- 先読み: 既存 `onProjectSelectPrefetch` をトリガーの `(focus)` `(pointerdown)` に残す
- Escape / document mousedown: `HeaderMenu` と同様（スイッチールート外なら閉じる）
- パネル CSS: `position:absolute; top:100%; left:0; z-index` > header の 5。上方向用クラス無し

- [x] **Step 1:** HTML を button#project-select-trigger + ul#project-select-list に差し替え。プレースホルダ分岐は維持。`for` は trigger id。ARIA（haspopup／expanded／listbox／option／selected）とラベル「プロジェクト」を付与。
- [x] **Step 2:** `app.ts` に開閉・ハイライト・キーボード（Global Constraints の行列）・外側クリック・選択時 `switchTo`（失敗で表示を active に戻す）を実装。`computed` で表示リスト。`switching`／モーダル／`saving` 中は disabled。close（Escape／決定）後はトリガーへ focus。
- [x] **Step 3:** CSS で下開き・max-height・スクロール・トリガー見た目を現行 select に近づける。
- [x] **Step 4:** 開中に activeId null / projects 空 → 閉じる。projects 更新でハイライト id 再解決（消えたら末尾）。

---

### Task 3: app.spec 更新と受け入れテスト

**Files:**
- Modify: `frontend/src/app/app.spec.ts`

- [x] **Step 1:** `#project-select` を HTMLSelectElement 前提にしている箇所を trigger / listbox に更新（value・options・change イベント）。
- [x] **Step 2:** 追加: active が末尾でも open 後先頭 option が active 名。
- [x] **Step 3:** 追加: open 後 `panel.getBoundingClientRect().top >= trigger.getBoundingClientRect().bottom`。
- [x] **Step 4:** 追加: option クリックで `patchBoardSettings({ activeProjectId })`（または switchTo 経路）。Escape／外側 mousedown で閉じる。
- [x] **Step 5:** 追加: switching 中（または saving／modal）に trigger disabled。ARIA 属性の存在。閉時 ArrowUp では開かない／開時 Space では patch せず閉じる／Escape 後フォーカスがトリガー。
- [x] **Step 6:** `cd frontend && npx vitest run src/app/app.spec.ts src/app/project-select-display.spec.ts`

---

### Task 4: 検証

- [x] **Step 1:** `cd frontend && npm test`（またはプロジェクト既定の FE テストコマンド）を通し、失敗があれば修正して再実行。
- [x] **Step 2:** 設計の受け入れ 1–9 をチェックリストとして目視確認（コード／テストで満たせない項目が残れば止めて報告）。

## 知見チェック

- L-001 / L-035 / L-002 / L-040 / L-842 — 設計書どおり UI 差し替えに留め、`switchTo` 契約は変えない。
