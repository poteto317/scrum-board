# Description Insert Anywhere Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.  
> **Spec:** `docs/superpowers/specs/2026-11-19-description-insert-anywhere-design.md`  
> **コミットしない**（`/feature`）。

**Goal:** 説明／ソリューションのブロックエディタで、隙間クリックからテキストまたはリンク用の空段落を任意位置に挿入できるようにする。

**Architecture:** 永続形式は変えない。`insertEmptyBlockAt` を純関数で追加し、`DescriptionBlocksEditor` に隙間ヒット領域＋2項目メニュー（テキスト／リンク）を載せる。リンクは既存 `linkRequest` → `DescriptionEditor` ダイアログ。ソリューションは同ダイアログ配線を本プランで追加する。

**Tech Stack:** Angular / TypeScript / vitest（`ng test`）

## Global Constraints

- API / DB 変更なし。上限は Unicode コードポイント 10000
- 末尾の常設空行は置かない。明示挿入の空段落は許可
- Enter / Backspace / ツールバーリンクは維持
- タップ＝クリック同一経路。disabled 時は挿入不可
- `/feature` 中はコミットしない

## 知見チェック

| ID | Plan での扱い |
|----|----------------|
| L-775 | メニュー表示中も poll で blocks を不意差し替えしない（既存編集ガード＋メニュー close） |
| L-037 / L-040 | pendingEcho・カード切替でメニュー破棄・リンクダイアログ reset（説明既存＋ソリューション追加） |
| L-453 | insert → emit → linkRequest の順序をテストで固定 |
| L-012 | N/A（確認ダイアログ経路なし） |
| L-835 | メニューは role=menu／ボタン列。textarea 内に入れ子にしない |
| L-002 | リンクキャンセル＝空段落残す（失敗と混同しない） |

## ファイルマップ

| 領域 | パス |
|------|------|
| 純関数 | Modify: `frontend/src/app/description-blocks.ts`, `description-blocks.spec.ts` |
| エディタ UI | Modify: `description-blocks-editor.ts`, `.html`, `.css`, `.spec.ts` |
| リンクダイアログ | Modify: `description-editor.ts`（上限エラー文言を注入可能に。既定は現行「説明が…」） |
| 説明配線 | 既存 `item-detail` + `DescriptionEditor`（メニューリンクは `linkRequest` 再利用。変更は最小） |
| ソリューション | Modify: `item-solution.ts`, `.html`, 必要なら `.spec.ts`（DescriptionEditor＋ダイアログ＋ live refresh busy） |

---

### Task 1: `insertEmptyBlockAt` 純関数

**Files:** `description-blocks.ts`, `description-blocks.spec.ts`

**Produces:** `insertEmptyBlockAt(blocks: string[], index: number): string[] | null`

- [x] **Step 1: 失敗するテスト**（`description-blocks.spec.ts`）
  - 先頭 `i=0` / 中間 / 末尾 `i=length` に `''` が入る
  - 範囲外は null
  - 上限ぎりぎりで `\n` 追加により超える場合は null
- [x] **Step 2: RED** — `npx ng test --no-watch --include=src/app/description-blocks.spec.ts`
- [x] **Step 3: 実装** — `insertEmptyBlockAt` を追加（serialize 長で判定）
- [x] **Step 4: GREEN** — 上記 PASS

---

### Task 2: エディタの隙間メニュー（テキスト／リンク）

**Files:** `description-blocks-editor.*`

**Consumes:** `insertEmptyBlockAt`  
**Produces:** 隙間 UI・`menuIndex` signal・テキスト挿入／リンク挿入ハンドラ

- [x] **Step 1: 失敗するテスト**（`description-blocks-editor.spec.ts`）
  - 隙間クリックでメニュー（テキスト／リンク）が出る。**先頭前（i=0）と末尾後（i=length）を別ケース**
  - テキスト選択 → 空ブロック挿入＋フォーカス（textChange 発火）
  - 同じ隙間からテキストを **2 回**挿入すると空段落が 2 つ増える（連打許可）
  - リンク選択 → 空ブロック挿入後に `linkRequest`（start=end=0）
  - `insertEmptyBlockAt` null → lengthError、linkRequest なし
  - disabled でメニュー非表示／開かない
  - Esc で閉じる。**メニュー外クリックで閉じる。別隙間クリックで先を閉じて新位置で開く**
  - メニュー項目がフォーカス可能（button／tabbable）。矢印キーで移動できればなお良い（最低限 tabbable）
  - **メニュー open 中に外部 `value()` 更新** → メニューが閉じる（L-775 / 切替）
  - 既存 composition / Enter / Backspace / ツールバー `requestLink` の回帰
- [x] **Step 2: RED** — `npx ng test --no-watch --include=src/app/description-blocks-editor.spec.ts`
- [x] **Step 3: 実装**
  - 各ブロック前後に gap 領域（ヒット高さ **10px**、設計の 8〜12px 内。`mousedown.preventDefault`）
  - メニュー: テキスト / リンク（`role="menu"`、項目は `role="menuitem"` の button）
  - 外側クリック／別 gap／Esc／`value()` 外部更新でメニュー close
- [x] **Step 4: GREEN** — 上記＋既存 Enter/Backspace/リンク要求／composition 回帰

---

### Task 3: ソリューションへリンクダイアログ配線

**Files:** `description-editor.ts`（＋既存 spec があれば更新）, `item-solution.ts`, `item-solution.html`, `item-solution.spec.ts`（無ければ作成／既存拡張）

**Consumes:** `DescriptionBlocksEditor.linkRequest`, `DescriptionEditor`  
**Produces:** ソリューションでもリンク確定可能。`DescriptionEditor` の上限エラー文言をフィールド名で上書き可能（例: `limitFieldLabel: 'ソリューション'` → 「ソリューションがN文字を超える…」）。ライブ再取得は `descriptionEditor.open()` 中も detail の `busy()` と同型で止める。

- [x] **Step 1: 失敗するテスト**
  - ソリューションで `linkRequest` 相当 → ダイアログ open
  - 確定で solution テキストにリンク Markdown
  - キャンセルで open=false、**空段落は残る**
  - **リンク確定失敗**（上限超過など）でも空段落は残る・ダイアログはエラー表示（文言に「ソリューション」）
  - ルート／item 切替で `DescriptionEditor.reset()`（L-037）
  - `lengthErrorMessage` がソリューション文言のまま（説明用文言に戻らない）
  - **ダイアログ open 中は live refresh が走らない**（`open()===true` を busy／enabled ガードに含める）
- [x] **Step 2: RED** — 該当 `ng test --include=...item-solution*` および description-editor 文言テスト
- [x] **Step 3: 実装** — `DescriptionEditor.apply` の固定「説明が」を設定可能に（既定は互換のため「説明」）。providers に `DescriptionEditor`、説明ページと同型のモーダル。saving／composition／**open** を live refresh 無効条件に含める。
- [x] **Step 4: GREEN**

---

### Task 4: 回帰と手動

- [x] **Step 1:** `npx ng test --no-watch --include='**/description-blocks*.spec.ts'` および item-detail / item-solution 関連。composition・ソリューション `lengthErrorMessage` が緑であることを確認
- [x] **Step 2 手動:**
  1. 説明: 間・先頭・末尾でテキスト挿入
  2. 説明: 隙間からリンク → 確定 → 表示・保存される
  3. 説明: リンクダイアログキャンセル → 空段落が残り、Backspace で前と結合できる
  4. ソリューション: テキスト／リンク同様
  5. Enter・ツールバーリンク・IME が従来どおり
  6. 上限付近で挿入が拒否されエラー表示

## サブエージェントのレビュー済み

- 第 1 周（要件対応）: 先頭/末尾隙間・閉じる条件・tabbable・L-775 value・ヒット10px・リンク失敗残存・composition/lengthError・手動・連打
- 第 2 周（整合と知見）: DescriptionEditor 文言注入・solution live refresh の open ガード
