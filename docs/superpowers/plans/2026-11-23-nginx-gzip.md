# nginx gzip 圧縮 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番・ローカル nginx で API JSON と静的 JS/CSS 等を gzip 圧縮し、契約スクリプトと CI で退行を防ぐ。

**Architecture:** 圧縮は nginx のみ。`deploy/nginx.conf` と `frontend/nginx.conf` に同一方針の `gzip_*` と **`location /api/` のみ**の `proxy_buffers` を入れる。Go は触らない。設定欠落は `scripts/check-nginx-gzip.sh`（`--selftest` 付き）と既存 TLS ガードで固定する。

**Tech Stack:** nginx、bash 契約スクリプト、GitHub Actions `deploy-guards`

**設計書:** `docs/superpowers/specs/2026-11-23-nginx-gzip-design.md`

**気をつける知見:** L-1051, L-1039, L-015

---

## ファイル一覧

| ファイル | 責務 |
|---|---|
| `deploy/nginx.conf` | 本番 gzip + `/api/` proxy_buffers |
| `frontend/nginx.conf` | ローカル同等（既存 CSP 維持・HSTS 非追加） |
| `scripts/check-nginx-gzip.sh` | 両 conf の必須行・数値 + `--selftest` |
| `.github/workflows/secret-scan.yml` | deploy-guards に検査追加 |
| `README.md` | ローカル検証手順にスクリプト追記 |

---

### Task 1: 契約スクリプト（失敗する検査を先に）

**Files:**
- Create: `scripts/check-nginx-gzip.sh`
- Modify: `.github/workflows/secret-scan.yml`
- Modify: `README.md`（検証コマンドの節）

- [ ] **Step 1: スクリプトを書く**

  - 引数なし: `deploy/nginx.conf` と `frontend/nginx.conf` の両方で次を要求する  
    - `gzip on;`
    - `gzip_proxied any;`
    - `gzip_vary on;`
    - `gzip_min_length 256;`（数値固定）
    - `gzip_comp_level 5;`（数値固定）
    - `gzip_types` に設計スニペットの全種: `text/plain` `text/css` `text/xml` `application/json` `application/javascript` `text/javascript` `application/xml` `image/svg+xml`（カード必須4種を含む）
    - **`location /api/` ブロック内のみ**に  
      `proxy_buffering on;` / `proxy_buffer_size 128k;` / `proxy_buffers 8 256k;` / `proxy_busy_buffers_size 512k;`  
      抽出: `location /api/` で始まり `location =` ではないブロック（deploy の `location = /api/auth/login` は除外）。frontend は同名ブロック1つ。awk で当該ブロック範囲だけ検査する。
  - `--selftest`: 必須行を欠いた一時 conf で本体が非ゼロになることを確認してから exit 0（L-1051）。
  - `set -euo pipefail`、`-h` / `--help`。`chmod +x`

- [ ] **Step 2: 現状 conf で失敗することを確認**

  ```bash
  ./scripts/check-nginx-gzip.sh ; echo exit:$?
  ```

  期待: 非ゼロ。

- [ ] **Step 3: CI と README**

  - `secret-scan.yml` の `deploy-guards` に  
    `bash -n scripts/check-nginx-gzip.sh`、  
    `./scripts/check-nginx-gzip.sh --selftest`、  
    `./scripts/check-nginx-gzip.sh` を追加。
  - README の deploy-guards 列挙に `./scripts/check-nginx-gzip.sh`（と `--selftest`）を追記。

- [ ] **Step 4: selftest のみ先に通す**

  ```bash
  ./scripts/check-nginx-gzip.sh --selftest
  ```

---

### Task 2: nginx 設定

**Files:**
- Modify: `deploy/nginx.conf`
- Modify: `frontend/nginx.conf`

- [ ] **Step 1: deploy**

  Task 1 と同じ gzip_types 全種と数値で `server` 内に gzip、**`location /api/` のみ**に 4 つの buffer。login には buffers を足さない。既存 HSTS/CSP/Forwarded-Proto/`auth_basic off` を消さない。

- [ ] **Step 2: frontend**

  Task 1 と同じ gzip / buffers。既存の CSP 全文（`add_header Content-Security-Policy "default-src 'self'; …`）を一字変えず維持し、HSTS を新規追加しない。

- [ ] **Step 3: 検証**

  ```bash
  ./scripts/check-nginx-gzip.sh --selftest
  ./scripts/check-nginx-gzip.sh
  ./scripts/check-nginx-tls-headers.sh
  bash -n scripts/check-nginx-gzip.sh
  grep -F "add_header Content-Security-Policy \"default-src 'self';" frontend/nginx.conf
  ! grep -q 'Strict-Transport-Security' frontend/nginx.conf
  ```

---

### Task 3: デプロイ後の完了確認（受入 #8）

コード変更なし。デプロイ可能なタイミングで実施し、結果を PR 本文または作業メモに残す。

- [ ] **Step 1: `/api/board`**

  アプリセッション cookie またはアプリ Basic で  
  `curl -sSI -H 'Accept-Encoding: gzip' …/api/board` → `Content-Encoding: gzip`

- [ ] **Step 2: `main-*.js`**

  edge Basic（`-u`）で `index.html` 参照の `main-*.js` を 1 本以上同様に確認。

- [ ] **Step 3: `/health` は使わない**

---

## 完了の定義

- [ ] 両 nginx conf に設計どおりの gzip（数値含む）と `/api/` buffers
- [ ] frontend の CSP 維持・HSTS 非追加
- [ ] `check-nginx-gzip.sh`（本番検査 + `--selftest`）と `check-nginx-tls-headers.sh` が緑
- [ ] CI `deploy-guards` と README 更新
- [ ] Go に圧縮を入れていない
- [ ] 受入 #8 の手動確認を実施した（またはデプロイ前なら PR に「デプロイ後確認」チェックリストを残した）
