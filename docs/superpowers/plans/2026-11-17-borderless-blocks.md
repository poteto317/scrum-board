# 入力の枠をなくす Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.  
> **Spec:** `docs/superpowers/specs/2026-11-17-borderless-blocks-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-037, L-044, L-397, L-453, L-454, L-473, L-474, L-790, L-792, L-835, L-836

**Goal:** 詳細画面のタイトル／説明を枠なしの Notion 風ページにし、説明を改行区切りの段落ブロックで編集する（作成フォームは現状維持）。

**Architecture:** `description` は従来の string のまま。純関数で `string[]` ブロックと相互変換。`DescriptionBlocksEditor` が枠なし textarea ブロック列を扱い、変更は `form.controls.description` のみへ `setValue`（既存 `ItemAutosave`）。閲覧用 `description-view` は廃止。プロパティは構造化 UI のまま枠を抑える。

**Tech Stack:** Angular 21 / TypeScript / 既存 Vitest。新エディタライブラリなし。

## Global Constraints

- 詳細画面のみ。`#card-description` / `#backlog-card-description` は変更しない。
- API／DB 変更なし。上限は serialize 後 10000（L-836）。
- ブロックモデルは `string[]`。要素内 `\n` は入力直後に normalize。
- IME: `isComposing || keyCode === 229` で Enter 分割しない（L-474）。
- DOM 差替前に serialize/setValue（L-397）。blur に保存を依存しない。
- sideDirty（dueAt 等）規則は触らない（L-790）。description は form 欄。
- 詳細ページの枠消しは修飾クラスで行い、グローバル無修飾セレクタに移さない（L-792）。
- ブロック内に `<a>` を入れ子にしない（L-835）。
- `/feature` 中はコミットしない。

## ファイルマップ

| 領域 | パス |
|------|------|
| 純関数 | Create: `frontend/src/app/description-blocks.ts` + `description-blocks.spec.ts` |
| ブロック UI | Create: `frontend/src/app/description-blocks-editor.ts` + `.html` + `.css` + `.spec.ts` |
| リンク状態 | Modify: `description-editor.ts`（`editing` トグル削除または常時編集に簡略） |
| 詳細 | Modify: `item-detail.ts` / `.html` / `.css` / `.spec.ts` |
| グローバル枠 | Modify: 必要なら `item-detail.css` のみで打ち消し（`styles.css` の全局 border は触らないか、詳細親配下だけ上書き） |

---

### Task 1: description-blocks 純関数

**Files:** `description-blocks.ts` / `description-blocks.spec.ts`

**Interfaces:**
```ts
export const DESCRIPTION_MAX_LEN = 10000; // DESCRIPTION_LINK_MAX_LEN と同値を import 再利用可
/** 長さは既存 textLimit / insertDescriptionLink と同じく [...s].length（UTF code point） */
export function descriptionLength(text: string): number;
export function parseDescriptionBlocks(text: string): string[];
// text === '' → ['']; else text.split('\n')
export function serializeDescriptionBlocks(blocks: string[]): string;
// blocks.join('\n')
export function normalizeDescriptionBlocks(blocks: string[]): string[];
// 各要素に \n があれば展開し、flat。空配列なら ['']
export function splitDescriptionBlock(blocks: string[], index: number, caret: number): string[] | null;
// 分割後 descriptionLength(serialize) > MAX なら null（L-044）
export function mergeDescriptionBlockWithPrevious(blocks: string[], index: number): { blocks: string[]; caret: number } | null;
// index===0 または唯一ブロックなら null。結合後も長さチェック
/** ブロック index 内の [start,end) にリンクを挿入。成功時は新 blocks とフォーカス先 blockIndex + ブロック内 caret。長超は null */
export function insertLinkInDescriptionBlocks(
  blocks: string[], index: number, start: number, end: number, label: string, url: string,
): { blocks: string[]; blockIndex: number; caret: number } | null;
```

- [x] **Step 1: 失敗するテスト** — 空↔`['']` 往復、`"a\nb"`、末尾 `\n`、リンク記法を含む文字列の往復、normalize が要素内 `\n` を展開、split/merge の長さ拒否、唯一ブロックの merge 拒否、`insertLinkInDescriptionBlocks` が 2 番目ブロックでも正しい位置に入り serialize 往復できる／長さ超は null
- [x] **Step 2: RED** — `cd frontend && npx vitest run src/app/description-blocks.spec.ts`
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** — 同上

**Done when:** 純関数テスト緑。

---

### Task 2: DescriptionBlocksEditor

**Files:** `description-blocks-editor.ts` / `.html` / `.css` / `.spec.ts`

**Interfaces:**
```ts
@Component({ selector: 'app-description-blocks-editor', ... })
export class DescriptionBlocksEditor {
  readonly value = input.required<string>();
  readonly disabled = input(false);
  readonly textChange = output<string>(); // serialize 結果
  readonly compositionChange = output<boolean>(); // true=start / false=end → 親が autosave.composition('description', v)
  readonly linkRequest = output<{ blockIndex: number; start: number; end: number; selectedText: string }>();
  readonly lengthError = signal(''); // 10000 超で既存同文。操作不適用時もここ（FormControl に不正値を書かない）
  focusBlock(blockIndex: number, caret: number): void; // リンク成功後のキャレット復帰用
  // 内部: blocks = signal<string[]>
  // value 変化（別カード等）で parse し直す。自前の textChange 起因のエコーは世代で無視（L-037）
  // Enter: !(isComposing||keyCode===229) なら split。適用前に textChange 発行してからフォーカス移動（L-397）
  // Backspace at 0: merge。同様に先に textChange
  // input/paste: normalize → 長さ超なら操作前に戻し lengthError（L-044）
  // リンクボタン: フォーカス中ブロックの selection で linkRequest（絶対 offset に変換しない）
}
```

- [x] **Step 1: 失敗するテスト** — Enter 分割、**`isComposing` の Enter 非分割**と **`keyCode===229` の Enter 非分割を別テスト**、先頭 Backspace 結合、**差替操作で blur ハンドラ無しでも textChange が先に飛ぶ（L-397）**、paste 改行 normalize、10000 超で lengthError＋blocks 不変、value 入力切替で再 parse
- [x] **Step 2: RED**
- [x] **Step 3: 実装** — 枠なし `.block-input` textarea（自動伸縮）。ツールバーにリンクボタン → `linkRequest`
- [x] **Step 4: GREEN**

**Done when:** エディタ単体テスト緑（L-397 / L-474 のケース含む）。

---

### Task 3: ItemDetail 接続・枠なし UI・view 廃止

**Files:** `item-detail.*` / `description-editor.ts` / specs

**Interfaces:**
- `description-view` と編集トグル UI を削除。常時 `app-description-blocks-editor`
- `textChange` → `form.controls.description.setValue(text, { emitEvent: true })` のみ（L-454）。長さエラーは editor の `lengthError` と FormControl invalid の両方を表示してよいが、拒否した操作の値は FormControl に書かない
- `compositionChange` → `autosave.composition('description', v)`
- リンク状態（`DescriptionEditor` 改修）:
  ```ts
  begin(sel: { blockIndex: number; start: number; end: number; selectedText: string }): void;
  /** 成功時は serialize 済み text + フォーカス先。失敗は error セットして null（L-001） */
  apply(blocks: string[]): { text: string; blockIndex: number; caret: number } | null;
  // 内部で insertLinkInDescriptionBlocks を呼ぶ。旧 insertDescriptionLink(全文絶対) 経路は詳細から外す
  ```
  ItemDetail: `linkRequest` → `begin`。確定時 `apply(editor.blocks 相当)` → 成功なら `setValue(text)` + `flush` + `blocksEditor.focusBlock(blockIndex, caret)`。失敗は form 不変
- タイトル: `.page-title` で枠・背景を打ち消し大見出し風
- メイン／プロパティ: 強い `detail-card` 枠を弱めるクラス（例 `.detail-page-doc` / `.properties-list`）
- 閲覧 view セグメント試験は削除。ブロック＋リンク試験へ置換（L-835 再導入禁止）

- [x] **Step 1: 失敗する／更新するテスト** — view トグル試験を削除。ブロック接続・autosave 送信・カード切替同期・**2 ブロック目へのリンク成功で setValue+flush**・**リンク失敗で form 不変**・作成フォーム `#card-description` が board に残ることを固定
- [x] **Step 2: RED** — 関連 `item-detail.spec.ts` 等
- [x] **Step 3: 実装**
- [x] **Step 4: GREEN** — `cd frontend && npm test -- --watch=false`（またはプロジェクト慣例の vitest 全件）と、変更に関係する lint/型が通ること

**Done when:** 詳細が枠なしブロック編集、作成フォーム不変、全体 FE テスト緑。

---

### Task 4: 全体検証

- [x] `cd frontend && npm test -- --watch=false`
- [x] 必要なら `cd backend && go test ./...`（FE のみ変更ならスキップ可だが、リポジトリ慣例で触っていなければ FE のみで可）
- [x] 手動観点（記載のみ・コミットなし）: 詳細で枠が無い、Enter/Backspace、IME、作成モーダルは従来

**Done when:** 検証コマンド成功。
