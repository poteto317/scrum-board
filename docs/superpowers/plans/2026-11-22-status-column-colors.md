# ステータス列の色分け（#110）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Commit は `/feature` 中はしない。

**Goal:** Doing を青系、現行 Doing の金を Review へ移し、Todo と Review を区別できるようにする（列ドット・カードバッジ・プロジェクト listbox ドット）。

**Architecture:** FE の CSS と列修飾クラスのみ。`board.html` に `.review`、共有 `styles.css` の status-dot、`board.css` の card-status。BE 変更なし。

**Tech Stack:** Angular、既存 Vitest

**Design:** `docs/superpowers/specs/2026-11-22-status-column-colors-design.md`

**知見:** L-792, L-060

**Commits:** `/feature` 中はコミットしない。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `frontend/src/app/board.html` | `[class.review]` 追加 |
| `frontend/src/styles.css` | Doing ドットを青、Review ドットに旧金（両祖先） |
| `frontend/src/app/board.css` | `.doing` / `.review` の card-status 色 |
| `frontend/src/app/board.spec.ts` | Review 列クラス・card-status 配線 |
| `frontend/src/app/app.spec.ts` | listbox ドット配線の回帰（既存） |
| `docs/superpowers/specs/2026-11-20-project-status-dots-design.md` | #110 正で色・非目標・UI コメントを改訂 |

---

### Task 1: ボード列クラス（L-060 board 半分）

- [x] **Step 1:** `board.html` の `kanban-column` に `[class.review]="column.name === 'Review'"` を追加（Doing / Done と同列）。
- [x] **Step 2:** `board.spec.ts` に Review 列フィクスチャで `.kanban-column.review` が付くこと、かつ `.kanban-column.review .card-status` が存在することを assert（AC2 / L-060）。

### Task 2: status-dot 色（L-792）

- [x] **Step 1:** `styles.css` の `.kanban-column.doing .status-dot` / `.project-select-list .doing .status-dot` を border `#4a7ab0` / background `#6b9ac9` に変更。
- [x] **Step 2:** 同ファイルに `.kanban-column.review .status-dot` / `.project-select-list .review .status-dot` を追加し、border `#b99342` / background `#cfb56b`。
- [x] **Step 3:** 完了条件: `rg -n 'kanban-column\.(doing|review) \.status-dot|project-select-list \.(doing|review) \.status-dot' frontend/src/styles.css` で **4 行**（kanban×2 + list×2。子孫結合子の空白付き）が揃うこと。

### Task 3: card-status 色

- [x] **Step 1:** `board.css` の `.doing .card-status` を color `#2f4f6a` / background `#dce8f5` に変更。
- [x] **Step 2:** `.review .card-status` を追加し color `#93712e` / background `#f6efdc`。`.done .card-status` は触らない。

### Task 4: 回帰テストと #81 設計同期（L-060 app 半分）

- [x] **Step 1:** `app.spec.ts` の既存「Doing and Review status dots」ケースが通ることを確認（`.review .status-dot` 配線・aria-label / L-060）。失敗したら直す（色 assert は必須にしない）。
- [x] **Step 2:** #81 設計 `2026-11-20-project-status-dots-design.md` の色表・セレクタ・非目標「Review 専用色」・UI 構造コメント・**受け入れの同色前提（Doing=ボード金 / Review=デフォルト灰）**を、#110 参照で改訂（旧プランは触らない）。
- [x] **Step 3:** `cd frontend && npm test`（またはプロジェクト既定）で関連 spec が通る。

### Task 5: 検証

- [x] **Step 1:** FE テスト通過（`board.spec.ts` / `app.spec.ts` 含む）。
- [x] **Step 2:** Task2 Step3 の `rg` を再実行し、4 セレクタが揃っていること（AC3）。
- [x] **Step 3:** AC4: Todo 列に `.doing`/`.review` が付かないこと、Done の card-status／status-dot ルール（`.done`）を意図せず消していないことを diff で確認。Close／カスタムはデフォルトのまま。
- [x] **Step 4:** `git diff --stat` で BE / OpenAPI 差分が無いこと。

---

## レビュー記録

### 第 1 周（要件との対応）2026-11-22
対応: AC2 の `.kanban-column.review .card-status`、#81 受け入れ同色前提、AC4・AC3 を Task5 へ。

### 第 2 周（タスク整合と知見）2026-11-22
対応: `rg` を子孫空白付きセレクタに修正、L-060 を Task1/Task4 に分割明記。
