# AIチャット直前メッセージ編集・やり直し（#163） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 直前の user メッセージを編集して再送信し、以降の会話を置き換える。モデル失敗・保存失敗のいずれでも DB 不変（truncate は成功 TX 内のみ）。

**Architecture:** POST `/ai-chat` に `replaceFromMessageId`。モデル入力はメモリ上で切り、成功保存 TX で DELETE id>= ＋ Append。FE は editing 状態と API 引数のみ追加。

**Tech Stack:** Go/MySQL, Angular, Vitest, OpenAPI

## Global Constraints

- 設計: `docs/superpowers/specs/2026-11-27-card163-ai-chat-edit-resend-design.md`
- 知見: L-001, L-058, L-157, L-408, L-824, L-1250, L-1251, L-1252, L-792
- `/feature` 中はコミットしない。OpenAPI を同じ変更で更新

---

## File map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/ai_project_chat_post.go` | replace 検証・history 切詰・保存経路 |
| `backend/internal/kanban/ai_project_conversation_append.go` | `ReplaceAndAppendProjectAITurn` |
| `backend/internal/kanban/model.go` | iface |
| `backend/internal/kanban/ai_project_chat_memory_test.go` ほか | memoryRepo / stub |
| `docs/openapi.yaml` | 契約 |
| `frontend/src/app/api.ts` | `replaceFromMessageId` |
| `frontend/src/app/project-ai-chat.*` | 編集 UI・send |
| `*_test.go` / `*.spec.ts` | 回帰 |

---

### Task 1: Repo — truncate + append in one TX

**Files:** `model.go`, `ai_project_conversation_append.go`, `ai_project_chat_memory_test.go`, repo tests

- [ ] **Step 1:** 失敗するテスト: replaceFrom で id>= 削除後に新ターンが残る。proposals CASCADE。INSERT 失敗時は旧行が残る（TX ロールバック）。
- [ ] **Step 2:** `ReplaceAndAppendProjectAITurn(ctx, projectID, userID, conversationID, replaceFromMessageID, turn)`（lock → DELETE id>= → insert turn → touch）。
- [ ] **Step 3:** `go test` 該当パッケージ。

---

### Task 2: Handler — decode + history filter + store path

**Files:** `ai_project_chat_post.go`, request type, handler tests, openapi

- [ ] **Step 1:** `replaceFromMessageId` を decode。400: `newConversation` 併用、`conversationId` 無し、メッセージ無し／他ユーザー／他会話／role≠user、非 last user。
- [ ] **Step 2:** history を `id < replaceFrom` にフィルタしてモデルへ。
- [ ] **Step 3:** 成功時だけ ReplaceAndAppend。通常時は既存 Append。
- [ ] **Step 4:** OpenAPI に型・任意・上記 400 を契約化。
- [ ] **Step 5:** handler テスト: モデル失敗時は Replace/DELETE 未呼出・履歴不変（L-001）。

---

### Task 3: FE — API + edit UI + send

**Files:** `api.ts`, `project-ai-chat.ts/html/css`, specs

- [ ] **Step 1:** `postProjectAIChat(..., replaceFromMessageId?: number)`。編集再送信は **正の conversationId 必須**（`'new'` 禁止）。
- [ ] **Step 2:** `startEdit`: draft＝元本文、`editingFromMessageId` セット、フォーカス。編集ボタン（`detail>1` 無視）。キャンセル: draft 空＋editing 解除。再送信ラベル。会話切替・`startNew` で editing 解除。
- [ ] **Step 3:** `send`: 送信開始でローカル truncate しない。成功時のみ editing 解除・draft 空・応答 messages 差替。失敗時は editing/draft/messages 維持。
- [ ] **Step 4:** テスト: 編集表示条件、キャンセルで draft 空、再送信が conversationId＋replaceFromMessageId、失敗時維持、送信開始 stick、**編集開始では強制スクロールしない**。
- [ ] **Step 5:** `ng test` 該当。コミットしない。

---

## 完了条件

- 受け入れ 1–5
- BE/FE テスト緑、OpenAPI 更新済み
