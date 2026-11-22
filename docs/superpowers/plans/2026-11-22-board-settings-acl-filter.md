# ボード設定 PATCH 応答 ACL フィルタ（#87）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Commit は `/feature` 中はしない。

**Goal:** `PATCH /api/board/settings` の free→pack 応答 `items` を `filterBoardItems` で通し、閲覧不可アイテムを漏らさない。

**Architecture:** `updateBoardSettings` のみ。既存 `filterBoardItems` を board GET と同じく呼ぶ。

**Tech Stack:** Go、既存 memoryRepo / httptest

**Design:** `docs/superpowers/specs/2026-11-22-board-settings-acl-filter-design.md`

**知見:** L-901, L-002

**Commits:** `/feature` 中はコミットしない。

**検証コマンド:** `cd backend && go test ./internal/kanban/ -count=1`

---

## File map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/handler.go` | `updateBoardSettings` で filter |
| `backend/internal/kanban/handler_test.go` | `memoryRepo` に `aclListFail error` フィールド |
| `backend/internal/kanban/users_memory_test.go` | `ListACLEntriesForItems` が `aclListFail` を返す |
| `backend/internal/kanban/board_settings_handler_test.go` | member 漏洩防止・fail 経路テスト |
| `docs/openapi.yaml` | 200 description |

---

### Task 1: 失敗するテストを先に書く（TDD）

- [x] **Step 1:** `handler_test.go` の `memoryRepo` に `aclListFail error`。`users_memory_test.go` の `ListACLEntriesForItems` 先頭で `if m.aclListFail != nil { return nil, m.aclListFail }`。
- [x] **Step 2:** `TestUpdateBoardSettingsFiltersRestrictedItems`（`board_settings_handler_test.go`）: member セッション、open + restricted（ViewAccessRestricted、viewUserIds=[admin]、Description に秘密文字列）、`CardLayout=free` → PATCH pack。応答: restricted の ID 無し、open の ID 有り、body 全体に秘密 Description 文字列が無い。
- [x] **Step 3:** `go test ./internal/kanban/ -run TestUpdateBoardSettingsFiltersRestrictedItems` が **赤**であることを確認。
- [x] **Step 4:** `TestUpdateBoardSettingsFilterFailureDoesNotLeakItems`: free→pack で **restricted を含む** items が返る状況、`aclListFail` 設定（ListACL が必ず呼ばれる）。期待: status **500** かつ JSON に `"items"` キー無し、かつ秘密 title が body に無い。200 で空 items は不合格（L-002）。

### Task 2: ハンドラ修正

- [x] **Step 1:** `updateBoardSettings`: `items != nil` のとき `filterBoardItems(r.Context(), items, requestUserPtr(r))`。err なら `fail` して return。成功時 `out["items"] = filtered`。
- [x] **Step 2:** Task1 両テスト緑。既存 `TestUpdateBoardSettingsHandler`（admin・restricted 無し）も緑。

### Task 3: OpenAPI

- [x] **Step 1:** `docs/openapi.yaml` の `PATCH /api/board/settings` 200 description を「成功。応答に `items` がある場合は、呼び出し元が閲覧可能なアイテムのみ」に更新。
- [x] **Step 2:** `cd backend && go test ./internal/kanban/ -count=1` が通る。

---

## レビュー記録

### 第 1 周（要件との対応）2026-11-22
対応: 秘密フィールド非含有、fail は 500・items キー無し、aclListFail 置き場確定、検証コマンド固定。

### 第 2 周（タスク整合と知見）2026-11-22
対応: 失敗テストに restricted 必須、`requestUserPtr` 明記、500 かつ items キー無しを両方必須。
