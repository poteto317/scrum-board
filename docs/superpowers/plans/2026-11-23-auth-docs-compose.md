# 認証文書と Compose 初期 admin Implementation Plan

**Goal:** 文書を現行認証に合わせ、新規 DB でも Compose 起動できるようにする。

**Spec:** `docs/superpowers/specs/2026-11-23-auth-docs-compose-design.md`

### Task 1: SECURITY.md

- [x] 現行 auth（session / app Basic / roles / ACL / nginx Basic）と L-1001 を英語で記載

### Task 2: compose + .env.example

- [x] API に `AUTH_USER` / `ADMIN_INITIAL_PASSWORD` を追加
- [x] `.env.example` の「認証なし」を直しローカル seed 変数を追加

### Task 3: README

- [x] 「認証なし」の矛盾節を現行に合わせて修正

### Task 4: 検証

- [x] `docker compose config` と grep で矛盾文言チェック