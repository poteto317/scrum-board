# Cookie Secure と HSTS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 本番でセッション Cookie に Secure が付き、HSTS が返るようにする（nginx の Forwarded-Proto 上書きを止め、HSTS を付与）。

**Architecture:** Cloud Run が付けた `X-Forwarded-Proto` を nginx `map` で引き継ぎ API へ渡す。Go の Secure 判定は現状のまま。HSTS は nginx `add_header … always`。

**Tech Stack:** nginx, Go testing, envsubst

**Spec:** `docs/superpowers/specs/2026-11-22-cookie-secure-hsts-design.md`

## Global Constraints

- L-018: クライアントの https 解釈と upstream へ渡す proto を一致させる
- L-061: Secure 経路と HSTS を同じ変更セットで塞ぐ
- `/feature` 中はコミットしない
- PUBLIC_ORIGIN 連動 Secure は非目標
- 実 Cloud Run curl は非目標

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `deploy/nginx.conf` | map + Forwarded-Proto 引き継ぎ + HSTS |
| `backend/internal/kanban/auth_handler_test.go` | Secure 回帰（https / http / 無し）login・logout |

---

## Task 1: nginx 設定

**Files:** `deploy/nginx.conf`

- [x] **Step 1:** テンプレ先頭（`server` の前）に:

```nginx
map $http_x_forwarded_proto $forwarded_proto {
    default $http_x_forwarded_proto;
    ''      $scheme;
}
```

- [x] **Step 2:** `proxy_set_header X-Forwarded-Proto $scheme;` を `$forwarded_proto` に変更。**禁止するのは `proxy_set_header X-Forwarded-Proto $scheme` のみ**（map 内の `'' $scheme;` フォールバックは残す）。
- [x] **Step 3:** `server` に `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` を既存セキュリティヘッダの近くへ追加。
- [x] **Step 4:** `PORT=8080 envsubst '${PORT}' < deploy/nginx.conf > /tmp/sb-nginx.conf` のあと grep で固定: `map $http_x_forwarded_proto`、`proxy_set_header X-Forwarded-Proto $forwarded_proto`、HSTS、かつ `proxy_set_header X-Forwarded-Proto $scheme` 不在。任意で最小 `events{} http { include /tmp/sb-nginx.conf; }` ラッパの `nginx -t`（断片単体の `-t` は使わない）。

---

## Task 2: Secure 回帰テスト

**Files:** `auth_handler_test.go`

- [x] **Step 1:** login リクエストに `X-Forwarded-Proto: https` を付け、`findSessionCookie` の `Secure == true` を断言。
- [x] **Step 2:** 同ヘッダで logout の Set-Cookie も Secure（clearSessionCookie 経路）。
- [x] **Step 3:** ヘッダ無し・`http` では Secure false（既存 login ケースと重複しない範囲で明示）。
- [x] **Step 4:** `go test ./internal/kanban/ -run 'AuthLogin|SessionCookie|Secure' -count=1`（名前は実装に合わせる）が通る。

---

## Task 3: 全体検証

- [x] **Step 1:** `cd backend && go test ./internal/kanban/ -count=1`
- [x] **Step 2:** `deploy/nginx.conf` を grep し、受け入れ 1・3 を確認（map / `$forwarded_proto` / HSTS / `proxy_set_header … $scheme` 不在）
- [x] **Step 3:** 設計の受け入れ 1–4 をチェックリストで照合

## 第 2 周レビューで直せない／範囲外として記録したもの

（レビュー後に追記）
