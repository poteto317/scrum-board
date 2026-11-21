# AI チャット MVP 範囲決定（#47）Implementation Plan

> **For agentic workers:** 本カードはコード機能追加ではなく、決定の文書化と後続カード整合が成果物。

**Goal:** #47 の完了条件を満たす。設計正本を確定し、#47 説明と #48–#59 の状態／説明を矛盾なく更新する。

**Architecture:** 既存 `docs/superpowers/specs/2026-11-21-ai-chat-mvp-design.md` を正本。実装は PR #71 済みのため新規コードは原則不要。

**Tech Stack:** Markdown 設計／プラン、Scrumboard HTTP API（Basic auth）

**Board API（説明・列の更新手順）:**
1. `GET /api/items/by-number/{n}?projectId=1` で内部 `id`・現行 `description`・`columnId` を取得
2. `PATCH /api/items/{id}` に `{"description":"..."}` で説明を更新（既存文を残しつつ先頭／末尾に追記可）
3. Done にするカードのみ続けて `PATCH /api/items/by-number/{n}/status?projectId=1` に `{"status":"Done"}`
4. 再 `GET .../by-number/{n}?projectId=1` で title／projectId／description／columnId を確認

**Design:** `docs/superpowers/specs/2026-11-21-ai-chat-mvp-design.md`

**知見:** L-001, L-044, 文書正本（OpenAPI／設計書）

**Commits:** `/feature` 中はコミットしない。

---

### Task 1: 設計書を #47 正本として確定

- [x] **Step 1:** 設計書に #47 リンク・後続対応表・非目標を反映（推奨決定どおり）
- [x] **Step 2:** 設計 2 周レビューに耐える記述か自己確認

---

### Task 2: #47 アイテム説明を更新

- [x] **Step 1:** by-number GET → 内部 id 取得 → `PATCH /api/items/{id}` で決定要約＋設計書パスを説明に書く（既存背景は残してよい）
- [x] **Step 2:** 再 GET で title／projectId／説明反映を確認

---

### Task 3: #48–#59 を対応表どおり更新

- [x] **Step 1:** Done 対象（48,49,50,53,55,57,59）: 各番号で by-number GET → description に「PR #71／本設計」追記 → `.../status` を Done
- [x] **Step 2:** Todo 後続（51,52,54,56,58）: by-number GET → description 先頭に MVP 外／一部済みを追記（status は Todo 維持）
- [x] **Step 3:** 各番号を再 GET し、列と説明が対応表と一致することを確認

---

### Task 4: 受け入れ

- [x] **Step 1:** 設計の受け入れ 1–4 をチェック
- [x] **Step 2:** コミットしない

---

## レビュー記録

- 第1周（タスク漏れ・順序）: 指摘なし
- 第2周（手順具体性・API）: description PATCH 手順を Tech Stack／Task 2–3 に追記
- 結果: 妨げ解消。プラン確定
