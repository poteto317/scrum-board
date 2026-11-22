# 初期 admin パスワードと Basic 認証の分離 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 新規シード時に初期 admin のパスワードを `ADMIN_INITIAL_PASSWORD` から設定し、Basic（`AUTH_PASSWORD`）と同じ値では admin ログインできないようにする。

**Architecture:** `SeedAdminFromEnv` のハッシュ材料を `AUTH_PASSWORD` から `ADMIN_INITIAL_PASSWORD` へ切替え。users=0 では `AUTH_USER` + `ADMIN_INITIAL_PASSWORD` 必須。`AUTH_PASSWORD` が非空かつ同一なら fail-closed。nginx / `entrypoint.sh` は触らない。`deploy-gcp.sh` と README / `.env.example` で注入と手順を分ける。

**Tech Stack:** Go, MySQL テスト, bcrypt, Cloud Run env (`deploy-gcp.sh`)

**Spec:** `docs/superpowers/specs/2026-11-22-admin-seed-password-separation-design.md`

## Global Constraints

- users=0 で `ADMIN_INITIAL_PASSWORD` 欠如 → 起動失敗（`AUTH_PASSWORD` フォールバック禁止）
- パスワード値をエラー文言に出さない（L-017）
- `AUTH_USER` のみ TrimSpace。パスワードは Trim しない（L-752 意図的例外）
- 既存 users の自動書き換えなし
- `/feature` 中はコミットしない

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/user.go` | `SeedAdminFromEnv` の変数切替・同一値拒否 |
| `backend/internal/kanban/users_migrate_test.go` | シード単体テスト更新・追加 |
| `scripts/deploy-gcp.sh` | `require` + env-vars-file 注入 |
| `.env.example` | 変数例と注意書き |
| `README.md` | デプロイ・login 例の分離 |

---

## Task 1: SeedAdminFromEnv テスト更新（TDD）

**Files:**
- Modify: `backend/internal/kanban/users_migrate_test.go`
- Modify: `backend/internal/kanban/user.go`

- [x] **Step 1:** `TestSeedAdminFromEnvMySQL` の env を `AUTH_USER` + `ADMIN_INITIAL_PASSWORD`（admin 用）+ 別値の `AUTH_PASSWORD` に変更。ハッシュ照合は `ADMIN_INITIAL_PASSWORD`。`AUTH_PASSWORD` では `CompareHashAndPassword` が失敗することを断言。同一テスト内で再シード後も `COUNT(*)==1` を維持（既存アサーションを残す）。
- [x] **Step 2:** 欠如テストを強化: (a) 全空 → エラー（`AUTH_USER` または `ADMIN_INITIAL_PASSWORD` を含む、値リーク無し）。(b) `AUTH_USER`+`AUTH_PASSWORD` あり・`ADMIN_INITIAL_PASSWORD` 空 → エラーかつ文言に `ADMIN_INITIAL_PASSWORD`（`AUTH_PASSWORD` フォールバック検知、L-462）。
- [x] **Step 3:** 新規 `TestSeedAdminFromEnvRejectsSameAsAUTHPassword` — 両パスワード同一でエラー。`errors.Is(err, ErrAuthSeed)`（または `%w` wrap）と固定文言（値なし）を断言。エラー文字列に平文パスワードが含まれないこと（L-017）。
- [x] **Step 4:** 新規（L-752）: 空白のみの `ADMIN_INITIAL_PASSWORD`（例 `"   "`）は「設定済み」としてシード成功。このケースでは `AUTH_PASSWORD` を空、または `"   "` 以外の別値に固定し、同一値拒否で偽失敗しないようにする。別ケースで `"secret"` vs `"secret "` が別扱い（シード成功）を断言。
- [x] **Step 5:** 既存 `TestSeedAdminFromEnvNoOpWhenUsersExistWithoutAUTH` は維持。
- [x] **Step 6:** テスト失敗確認 → `user.go` で `ErrAuthSeed` wrap・固定文言・値非リークを実装 → 再実行成功。

```bash
cd backend && go test ./internal/kanban/ -run 'SeedAdminFromEnv' -count=1
```

---

## Task 2: deploy / ドキュメント

**Files:**
- Modify: `scripts/deploy-gcp.sh`
- Modify: `.env.example`
- Modify: `README.md`

- [x] **Step 1:** `deploy-gcp.sh` に `require ADMIN_INITIAL_PASSWORD` を追加し、env-vars-file に `echo "ADMIN_INITIAL_PASSWORD: $(yaml_env_value "$ADMIN_INITIAL_PASSWORD")"` を `AUTH_*` と同列で追加。
- [x] **Step 2:** `.env.example` に `ADMIN_INITIAL_PASSWORD=` と「Basic と別値・シード後変更可」のコメント。
- [x] **Step 3:** README の export / login curl 例を Basic と admin で分離。Secret Manager 利用時は `AUTH_PASSWORD` と `ADMIN_INITIAL_PASSWORD` を **別シークレット** にする旨を一文追記。

検証: スクリプトの `require` / yaml 行を目視。README の login が `$AUTH_PASSWORD` のみになっていないこと。SM 別シークレットの記載があること。

---

## Task 3: 全体検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`（関連パッケージが通ること）
- [x] **Step 2:** L-017: シード失敗パスのエラー／ログ文言にパスワード値が含まれないこと（テスト内の平文フィクスチャ自体は可）

---

## 知見チェック（プラン反映）

- L-462: Task 1 欠如 fail-closed
- L-017: エラー・ログに値を出さない
- L-752: AUTH_USER Trim、パスワード非 Trim
