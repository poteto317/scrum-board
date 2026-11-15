# 本番デプロイ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** GCP（Cloud Run + Cloud SQL）上で Basic Auth 付きのかんばんを公開し、`{{url}}`／リンクコピーが `PUBLIC_ORIGIN` になり、DB 内 localhost ボード URL を置換する。

**Architecture:** 同居コンテナ（nginx + Go API）。nginx が Basic Auth と `/health`（Cloud Run は `/healthz` 予約のため）。API が `GET /api/public-config`。FE は publicOrigin 優先でコピー。置換はワンショット CLI。デプロイは `gcloud` 手順。

**Tech Stack:** Go, Angular, nginx, MySQL 8, Cloud Run, Cloud SQL, Docker

**Spec:** `docs/superpowers/specs/2026-11-15-production-deploy-design.md`

## Global Constraints

- ローカル Compose 既定は認証なし・`PUBLIC_ORIGIN` なしのまま
- 本番エントリのみ `AUTH_USER` / `AUTH_PASSWORD` / `PUBLIC_ORIGIN` 必須（空なら exit 1）
- Cloud SQL 接続は Unix ソケットのみ
- `/feature` 中はコミットしない
- 秘密を Git に載せない

## File map（予定）

| パス | 責務 |
|------|------|
| `backend/.../public_config*.go` | `GET /api/public-config` |
| `frontend/.../public-origin*.ts` + copy 経路 | origin 解決 |
| `deploy/nginx.conf` / `deploy/Dockerfile` / `deploy/entrypoint.sh` | 同居・Auth・/health・起動ガード |
| `backend/cmd/rewrite-origins` | 置換 CLI |
| `docs/` / `README.md` / `.env.example` | 手順・変数名 |
| `scripts/deploy-gcp.sh` | gcloud デプロイ補助 |

---

### Task 1: public-config API

- [x] 失敗テスト: 未設定 → `{"publicOrigin":""}` 200。設定時は trim した origin（末尾 `/` 除去）
- [x] 実装・ルート登録・`go test` PASS

### Task 2: FE の PUBLIC_ORIGIN 優先コピー

- [x] `PublicOrigin`（または同等）が起動時に `GET /api/public-config` を取り、成功かつ非空ならそれを使い、成功かつ空なら `location.origin`、**失敗ならコピー時に失敗メッセージ**（空成功と混同しない）
- [x] `copy-command-feedback` / `copy-link-feedback` が origin 解決を使うよう更新＋テスト
- [x] `ng test` 関連 PASS

### Task 3: Cloud SQL Unix ソケット接続

- [x] API の DB 接続が `DB_SOCKET`（または同等）指定時に Unix ソケットへ切り替わる（未指定時は現行 tcp）
- [x] テストでソケット／tcp の分岐を固定
- [x] 本番 env にソケットパス例を README へ

### Task 4: 本番同居イメージ（Auth + /health + PORT）

- [x] `deploy/nginx.conf`: Basic Auth、`location = /health` は auth 外 200、`/api/` → `127.0.0.1:8081`
- [x] nginx は **Cloud Run の `$PORT`（既定 8080）で listen**（コンテナ内 API は別ポート例: 8081）
- [x] `deploy/entrypoint.sh`: `AUTH_*` / `PUBLIC_ORIGIN` 必須チェック → htpasswd → API 裏起動 → nginx foreground
- [x] `deploy/Dockerfile`: FE build + Go build + nginx
- [x] ローカルでイメージビルドが通ること

### Task 5: オリジン置換 CLI

- [x] `rewrite-origins`: `--dry-run` / 本実行
- [x] `PUBLIC_ORIGIN` 空・未設定 → 更新せず非0。接続失敗・引数不正 → 非0。一致 0 件の成功 → 0
- [x] ログは一致件数と更新件数を分ける（dry-run は一致のみ）
- [x] 対象カラムは設計どおり。テストで置換と終了コードを固定

### Task 6: データ移行手順（dump → Cloud SQL）

- [x] README に mysqldump（または同等）取得 → Cloud SQL インポート → 置換 CLI の順を書く
- [x] インポート後に置換を走らせる注意（`PUBLIC_ORIGIN` 必須）を明記

### Task 7: GCP 手順とデプロイ試行

- [x] README「本番デプロイ」: Cloud SQL、Cloud Run、Secret、ソケット、デプロイ、スマホ確認、停止・コスト
- [x] `.env.example` に変数名のみ
- [x] `scripts/deploy-gcp.sh` でビルド・push・deploy
- [x] 可能なら実デプロイし URL を記録。失敗時は残課題を明記

### Task 8: 検証まとめ

- [x] `go test`（該当）と FE 関連テスト
- [x] 設計の受け入れ条件を照合
- [x] プランのチェックを完了にする
