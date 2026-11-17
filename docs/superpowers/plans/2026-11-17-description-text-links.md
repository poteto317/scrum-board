# 説明テキストへのリンク Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-description-text-links-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-018, L-037, L-040

**Goal:** 詳細の説明で表示名＋https URL の Markdown リンクを追加でき、選択テキストへの付与と、非編集時の安全なクリック描画ができる。

**Architecture:** description 文字列に `[label](url)` を埋め込む（API/DB 変更なし）。純粋関数で URL 検証・挿入・セグメント分割。詳細 UI は描画ビュー／textarea 切替＋リンクダイアログ。ダイアログ open は `busy()` に含めライブ再取得を止める。

**Tech Stack:** Angular / vitest（バックエンド変更なし）

## Global Constraints

- https のみ（`^https://`、制御文字なし、≤2048）。関連の `isHttpUrl` より厳格。
- 表示名必須（trim 後非空、`]` 不可）。
- 挿入 URL ＝ 検証通過文字列 ＝ 描画 `href`（L-018）。`new URL().href` で書き換えない。
- リンククリックは外部遷移のみ。編集開始は別操作。
- 挿入後の description が 10000 文字超なら拒否（既存上限）。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| URL／Markdown 純粋関数 | Create: `frontend/src/app/description-link.ts`／`description-link.spec.ts` |
| 説明編集セッション | Create: `frontend/src/app/description-editor.ts`（editing＋リンクダイアログ状態） |
| 詳細 UI | Modify: `item-detail.ts`／`.html`／`.css`／`.spec.ts` — ツールバー、描画ビュー、ダイアログ、`busy()` に open を追加 |
| （触らない） | backend、ボード／バックログ、related／PR |

---

### Task 1: 純粋関数 — 検証・挿入・セグメント化

**Files:**
- Create: `frontend/src/app/description-link.ts`
- Create: `frontend/src/app/description-link.spec.ts`

**Interfaces:**
```ts
/** trim 後の許可 URL。不合格なら null（この戻り値だけを insert／href に使う・L-018） */
export function normalizeDescriptionLinkUrl(value: string): string | null;
/** trim 後の表示名。空や `]` 含むなら null */
export function normalizeDescriptionLinkLabel(value: string): string | null;
/** 検証済み url＋label から `[label](url)`。失敗なら null */
export function formatDescriptionLink(label: string, url: string): string | null;
/** selectionStart/End をリンクに置換。maxLen 既定 10000。超または検証失敗なら null */
export function insertDescriptionLink(
  text: string,
  start: number,
  end: number,
  label: string,
  url: string,
  maxLen: number = 10000,
): { text: string; caret: number } | null;
export type DescriptionSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; label: string; url: string };
export function parseDescriptionLinks(text: string): DescriptionSegment[];
```

- [x] **Step 1: 失敗するテスト** — `description-link.spec.ts`:
  - `normalizeDescriptionLinkUrl`: https OK（戻り＝trim 後同一）；http／javascript／相対／空／2049／改行／タブ → null
  - label: trim 空・`]` 含む → null；正常 → trim 済み
  - `insertDescriptionLink`: 選択置換・カーソル挿入；検証失敗 → null（元文不変）
  - **10000 超**: 既定 maxLen で挿入後全文が上限超なら null
  - **L-018**: normalize の戻りを insert → parse し、セグメント `url` が **同一文字列**
  - `parseDescriptionLinks`: 通常テキスト；1リンク；前後テキスト；非 https は text のまま；`<script>` は text セグメント
- [x] **Step 2: RED** — `npx ng test --watch=false --include=src/app/description-link.spec.ts`
- [x] **Step 3: 実装** — 上記 API。パーサは `[` `](` `)` 単純スキャン。URL 不合格は text のまま（L-002）。insert は `normalizeDescriptionLinkUrl` の戻りをそのまま `(…)` に書く（`new URL().href` 不使用）
- [x] **Step 4: GREEN** — 同テスト通過

---

### Task 2: ダイアログ状態＋詳細 UI（描画／編集／挿入）

**Files:**
- Create: `frontend/src/app/description-editor.ts`
- Modify: `frontend/src/app/item-detail.ts` — `descriptionEditor`；`busy()` に `open()`；**ルート切替で `reset()`**；挿入で form description 更新
- Modify: `item-detail.html` — 非編集: セグメント描画＋**「編集」ボタン**；描画の**非リンク領域クリックで編集開始**；編集時: textarea＋「リンク」；リンクダイアログ（`appmodal`／`<dialog class="description-link-dialog">`）
- Modify: `item-detail.css` — 描画ビュー・リンク・ダイアログの最低限スタイル
- Modify: `item-detail.spec.ts`

**Interfaces（description-editor.ts）:**
```ts
class DescriptionEditor {
  readonly editing: Signal<boolean>;
  readonly open: Signal<boolean>;
  readonly label: Signal<string>;
  readonly url: Signal<string>;
  readonly error: Signal<string>;
  readonly selectionStart: Signal<number>;
  readonly selectionEnd: Signal<number>;
  startEdit(): void;
  endEditIfIdle(): void;
  begin(selection: { start: number; end: number; selectedText: string }): void;
  setLabel(v: string): void;
  setUrl(v: string): void;
  apply(currentDescription: string): { text: string; caret: number } | null;
  cancel(): void;
  reset(): void;
}
```

**挙動:**
- 既定は描画ビュー。編集開始は (1)「編集」ボタン (2) 描画の非リンク領域クリック。blur（**ダイアログ open 中は除く**）で描画へ戻す。
- リンクボタンは編集中のみ。`begin` に selection を渡す。
- 確定: `normalizeDescriptionLinkLabel`／`normalizeDescriptionLinkUrl` の戻りだけを `insertDescriptionLink(..., 10000)` に渡す。失敗 → error・form 不変（L-001）。成功 → setValue → autosave。
- `<a target="_blank" rel="noopener noreferrer">`。**リンククリックは遷移のみで編集に入らない**。
- `href` は parse が返した許可済み生文字列を属性バインディング。

- [x] **Step 1: 失敗するテスト**（item-detail.spec.ts）:
  - 「編集」ボタン／非リンク領域クリックで textarea が出る
  - 描画にリンクの `a[href]`；**`a` クリック後も描画のまま**（textarea 非表示）
  - 非 https の括弧はリンクにならない
  - 無選択でダイアログ両フィールド空 → 確定で `[名](https://…)` が form／update に出る
  - 選択テキスト付きで表示名が初期入力される
  - 不正 URL／空表示名／`]` 表示名で確定しても form 不変・ダイアログエラー
  - 10000 超になる挿入は拒否・form 不変
  - ダイアログ open 中は `busy()` true；**open 中 blur でも編集維持**；閉じた後 blur で描画復帰
  - **カード切替後は `open===false`**、旧 selection で insert されない
- [x] **Step 2: RED**
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** — `npx ng test --watch=false --include=src/app/item-detail.spec.ts`

---

### Task 3: 全体検証

- [x] **Step 1:** `cd frontend && npx ng test --watch=false`（またはプロジェクト慣例の FE テスト）
- [x] **Step 2:** バックエンド変更なしのため Go テストは任意。触っていなければスキップ可
- [x] **Step 3:** lint／型があれば実行。失敗したら修正してから完了

## 知見チェック（プラン反映）

| ID | プランでの扱い |
|----|----------------|
| L-001 | 検証失敗で挿入しない・エラー表示 |
| L-002 | 不正リンクを空説明にしない／text のまま |
| L-018 | 同一生文字列を挿入と href に使う（ユニットで往復一致） |
| L-037 / L-040 | ダイアログ open → `busy()`、カード切替／destroy で破棄（UI テスト） |
