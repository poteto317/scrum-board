# アイテム追加ダイアログの誤閉じ防止 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** ボード／バックログの追加ダイアログで、外側クリックと下部キャンセルによる誤閉じを防ぎ、× と Esc だけに閉じる入口を絞る。

**Architecture:** UI のみ。`board.html` / `backlog.html` の対象 `<dialog>` から backdrop クリック閉じを外し、フォーム下部の「キャンセル」を削除する。TS / API は触らない。挙動はコンポーネントテストで固定する。

**Tech Stack:** Angular 21、Vitest、既存 `appModal` ディレクティブ

**Spec:** `docs/superpowers/specs/2026-11-15-add-dialog-accidental-close-design.md`

## Global Constraints

- 詳細の削除確認・コマンド管理ダイアログは変更しない
- Esc と × は閉じる（保存中の × disabled は既存どおり）
- API / DB 変更なし
- `/feature` 中はコミットしない

## File map

| ファイル | 責務 |
|----------|------|
| `frontend/src/app/board.html` | ボード追加 dialog の外側クリック／キャンセル削除 |
| `frontend/src/app/backlog.html` | バックログ追加 dialog の同様変更 |
| `frontend/src/app/board.spec.ts` | 外側クリックで閉じない・キャンセル無し・× で閉じる |
| `frontend/src/app/backlog.spec.ts` | 同上 |

---

### Task 1: ボード — 失敗するテストを先に書く

**Files:**
- Modify: `frontend/src/app/board.spec.ts`

- [x] **Step 1: 失敗テストを追加する**

  既存の dialog 系と同様に、ケース内で `HTMLDialogElement.prototype.showModal`（必要なら `close`）を mock してから開く。

  カード（`openCard`）後:

  1. `dialog.modal-backdrop` をクリックしても `modal()` が `'card'` のまま
  2. ダイアログ内に「キャンセル」テキストのボタンが無い
  3. `aria-label="閉じる"` のボタンをクリックすると `modal()` が `null`

  列（`openColumn` 相当）後: 1・2 を同様に行い、外側クリック後も `modal()` が `'column'` のままであること（`'card'` と取り違えない）。

- [x] **Step 2: テストを実行し、現状実装で失敗することを確認する**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/board.spec.ts'
```

Expected: 新規ケースが FAIL（外側クリックで閉じる／キャンセルが残っている）。`showModal` 未定義による例外で止まらないこと。

- [x] **Step 3: `board.html` を直す**

  - `<dialog ... (click)="close()" ...>` から `(click)="close()"` を削除
  - カードフォーム・列フォームの「キャンセル」ボタンを削除（主ボタンのみ残す）
  - `(cancel)`・×・内側 `stopPropagation`・Esc は維持

- [x] **Step 4: テストを再実行し PASS を確認する**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/board.spec.ts'
```

---

### Task 2: バックログ — 同じパターン

**Files:**
- Modify: `frontend/src/app/backlog.spec.ts`
- Modify: `frontend/src/app/backlog.html`

- [x] **Step 1: 失敗テストを追加する**（外側クリックで閉じない・キャンセル無し・× で閉じる）。`showModal` mock は既存 backlog dialog テストと同パターン。

- [x] **Step 2: 実行して FAIL を確認**（例外ではなくアサーション失敗であること）

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/backlog.spec.ts'
```

- [x] **Step 3: `backlog.html` を `board.html` と同じ方針で直す**

- [x] **Step 4: PASS を確認**

---

### Task 3: 回帰とドキュメント確認

- [x] **Step 1: board + backlog をまとめて再実行**

```bash
cd frontend && VITEST_MAX_WORKERS=1 npx ng test --watch=false --include='**/board.spec.ts' --include='**/backlog.spec.ts'
```

- [x] **Step 2: 設計書の対象外（詳細ダイアログ）を触っていないことを diff で確認**

- [x] **Step 3: プランのチェックボックスを完了にする**

## 検証メモ

- 手動（任意）: 入力中に外側クリックしても内容が残る、×／Esc で閉じる
- コミットは後続の `/commit-ja` で行う
