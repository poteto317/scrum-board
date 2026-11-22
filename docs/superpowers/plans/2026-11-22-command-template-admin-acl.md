# コマンドテンプレート admin ACL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** member がコマンドテンプレートのカタログ改変・既定置換・全アイテム適用をできないようにする（API と管理 UI）。

**Architecture:** users / AI credits と同型の `CurrentUser` + `RoleAdmin` 検査をカタログ mutate 5 経路の先頭に置く。詳細の管理ダイアログは `AuthSession.isAdmin()` が真のときだけ mutate コントロールを出す。アイテム別の選択 PUT と読み取り GET は変更しない。

**Tech Stack:** Go, Angular, OpenAPI 3.1, Vitest

**Spec:** `docs/superpowers/specs/2026-11-22-command-template-admin-acl-design.md`

## Global Constraints

- L-901: defaults / apply-to-all も admin 必須（CRUD だけにしない）
- L-463: `auth.status() === 'unknown'` の間は mutate UI を出さない（`isAdmin()` は false だが、明示的に `authReady && isAdmin`）
- L-061: API と UI の両方を同じ変更セットで塞ぐ
- `/feature` 中はコミットしない
- アイテム別 PUT は `requireEdit` のまま
- コピー時本文プレビュー・更新者表示は非目標

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/auth_middleware.go` または既存 helpers | `requireAdmin(w,r) (User, bool)` を共有化するか、ハンドラ内に同型ガードを書く（既存に無ければ小さなヘルパ可） |
| `backend/internal/kanban/command_template_handler.go` | create/update/delete の先頭で admin 必須 |
| `backend/internal/kanban/card_command_template_handler.go` | replace defaults / apply-to-all の先頭で admin 必須 |
| `backend/internal/kanban/command_template_handler_test.go` | member 403・副作用なし、admin 成功 |
| `backend/internal/kanban/card_command_template_handler_test.go` | defaults / apply-to-all の member 403 |
| `frontend/src/app/item-detail.ts` | `canManageCommandCatalog` = authReady && isAdmin |
| `frontend/src/app/item-detail.html` | 管理ダイアログの mutate UI を `@if (canManageCommandCatalog())` |
| `frontend/src/app/item-detail.spec.ts` | member で mutate コントロール非表示 |
| `docs/openapi.yaml` | 該当 mutate に 403 応答を追記 |

---

## Task 1: API の admin ガード（テスト先行）

**Files:** `command_template_handler.go`, `card_command_template_handler.go`, 対応 `*_test.go`

- [x] **Step 1:** `TestCommandTemplatesAdminGuards` を書く。`CreateUser` member + `CreateSession` → `requestWithCookie` で POST/PATCH/DELETE `/api/command-templates` が 403・`msgForbidden`。事前に admin `request` で 1 件作成しておき、(a) member POST 後も GET 一覧の件数・内容が不変 (b) member PATCH/DELETE 後も GET で本文不変。
- [x] **Step 2:** defaults / apply-to-all も同様に member 403・`msgForbidden`（既存テストファイルへ追加）。member PUT defaults 後に GET defaults が不変。apply 前後でアイテム別テンプレートが変わらないこと。
- [x] **Step 3:** 失敗することを確認: `go test ./internal/kanban/ -run 'CommandTemplatesAdmin|CommandTemplateDefaultsAdmin|ApplyCommandTemplatesAdmin' -count=1`（名前は実装時に揃える）
- [x] **Step 4:** create/update/delete/replaceDefaults/applyToAll の先頭で admin 検査（未ログイン 401、非 admin 403）。`apply-to-all` の既存ログインチェックは admin 検査に統合。
- [x] **Step 5:** `go test ./internal/kanban/ -run 'CommandTemplate' -count=1` が通ることを確認（既存 CRUD は admin `request` のまま）。

---

## Task 2: 管理 UI の出し分け

**Files:** `item-detail.ts`, `item-detail.html`, `item-detail.spec.ts`

- [x] **Step 1:** `readonly canManageCommandCatalog = computed(() => this.authReady() && this.auth.isAdmin());`
- [x] **Step 2:** 管理ダイアログ内の一括チェック・編集・削除・追加フォーム・全適用・初期化ボタンを `@if (canManageCommandCatalog())` で囲む。member でも名前＋本文の一覧は見える。空カタログ注記は「管理者に追加を依頼」へ寄せる（カード側 picker の empty 文言も同様に調整可）。
- [x] **Step 3:** テスト: AuthSession を member にして管理ダイアログを開き、(1) 編集／削除／追加／全適用／初期化／一括チェックが DOM に無い (2) 既存テンプレートの名前と本文は見える。admin では従来どおり mutate コントロールがある。
- [x] **Step 4:** `cd frontend && npx vitest run src/app/item-detail.spec.ts`（関連ケース）が通ることを確認。

---

## Task 3: OpenAPI

**Files:** `docs/openapi.yaml`

- [x] **Step 1:** `POST` / `PATCH` / `DELETE /api/command-templates`、`PUT /api/command-template-defaults`、`POST /api/command-templates/apply-to-all-items` に `'403': { description: 権限なし, ... Error }` を追加。`DELETE` は現状 401 が無いので **401 と 403 の両方**を追記（他 mutate と揃える）。
- [x] **Step 2:** `.cursor/skills/update-api-doc/SKILL.md` に従いルート一覧と矛盾が無いことを確認。`python3 scripts/check-openapi-routes.py` があれば実行。

---

## Task 4: 全体検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 2:** `cd frontend && npx vitest run src/app/item-detail.spec.ts src/app/command-templates-session.spec.ts`
- [x] **Step 3:** 設計の受け入れ 1–5 をチェックリストで照合

## 第 2 周レビューで直せない／範囲外として記録したもの

（レビュー後に追記）
