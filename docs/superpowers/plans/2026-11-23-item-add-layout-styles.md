# #138 アイテム追加レイアウト／スタイル — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax.

**Goal:** `dialog.modal-backdrop` 開時に中央寄せフレックスを復元し、ボードカードのコマンド／リンク重なりを回帰固定し、削除確認ダイアログの未定義クラスを既存ユーティリティへ揃える。

**Architecture:** 共有モーダル契約は `styles.css` の `dialog.modal-backdrop[open]` で UA `display:block` に勝つ。カード quick-actions は **第一選択どおり `board.css` 維持＋テスト固定**（グローバル無修飾移設禁止）。削除確認は HTML リネームのみ。

**採用経路（カード重なり）:** `board.css` 第一選択（祖先付きグローバル補強は不要な限りやらない）

**Spec:** `docs/superpowers/specs/2026-11-23-item-add-layout-styles-design.md`

**知見:** L-792

## ファイル担当

| ファイル | 責務 |
| --- | --- |
| `frontend/src/styles.css` | `dialog.modal-backdrop[open]` の flex 中央寄せ（正本） |
| `frontend/scripts/check-dialog-modal-open-css.mjs` | styles.css 契約の文字列ガード（`npm run test:css-contract`） |
| `frontend/src/app/item-comments.html` | `modal-actions`→`form-actions`、`danger`→`danger-button` |
| `frontend/src/app/description-blocks-editor.html` | 同上 |
| `frontend/src/app/board.spec.ts` | `#138` layout describe: dialog flex 挙動＋quick-actions position |
| （任意）`frontend/src/app/board.css` | 第一選択で足りない場合のみ調整。無修飾グローバル移設はしない |

---

### Task 1: 開いた dialog の flex 復元（TDD）

**Files:** `frontend/src/styles.css`, `frontend/src/app/board.spec.ts`

- [ ] **Step 1: 失敗するテスト** — 既存 `board.spec.ts` の `mountBoard` / `stubDialog` + `openItem(1)` を再利用し、`dialog.modal-backdrop` を開く。優先: `styles.css` に `dialog.modal-backdrop[open]` と `display: flex` / `align-items: center` / `justify-content: center` が含まれることを文字列 assert（グローバル規則の契約固定）。任意: 環境で `getComputedStyle` が信頼できる場合は `display/alignItems/justifyContent` も見る

- [ ] **Step 2: テスト実行（失敗確認）**

```bash
cd frontend && npm test -- --include=src/app/board.spec.ts --watch=false
```

- [ ] **Step 3: 実装** — `styles.css` に:

```css
dialog.modal-backdrop[open] {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
```

- [ ] **Step 4: テスト再実行（成功）**

---

### Task 2: カード quick-actions の重なり固定

**Files:** `frontend/src/app/board.spec.ts`, 必要なら `board.css`

- [ ] **Step 1: テスト** — カード表示済みフィクスチャで `.task-card .card-quick-actions .copy-card-link`。jsdom はコンポーネント CSS を getComputedStyle に載せない前提（board-card-reorder-state の注意と同趣旨）なので、`board.css` 文字列に `.task-card .card-quick-actions .copy-card-link` と `position: static` があることを assert。補強後も同一 assert で可

- [ ] **Step 2: 失敗時のみ** `board.css` を調整。`styles.css` へ無修飾 `.task-card …` を移さない。足りなければ `.board-page .task-card …` のみ（L-792）

- [ ] **Step 3: テスト成功**

---

### Task 3: 削除確認ダイアログのクラス揃え

**Files:** `item-comments.html`, `description-blocks-editor.html`（および既存スペックがあれば更新）

- [ ] **Step 1:** `modal-actions` → `form-actions`、`danger` → `danger-button`

- [ ] **Step 2:** 関連テストがあれば更新して通す

---

### Task 4: 通し検証

- [ ] `npm test -- --include=src/app/board.spec.ts --watch=false`（必要なら comments / description-blocks も含む）
- [ ] 手動: ボード追加ダイアログ中央寄せ、**バックログ追加ダイアログ中央寄せ**、カードコマンド／リンク非重なり、**コメントまたは説明ブロック削除確認（form-actions／danger-button）**、プロジェクト作成ダイアログ中央寄せ（1画面）
- [ ] 手動: 列ヘッダー「＋」とコマンドの重なりは **未再現なら対象外**（再現時のみ確認）
- [ ] backlog 自動テストは必須にしない（AC1 バックログは手動で足りる）