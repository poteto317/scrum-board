# Cloud Run Secret Manager 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 本番パスワードを Secret Manager 経由にし、最新 Cloud Run リビジョンに平文 env として出ないようにする。

**Architecture:** `deploy-gcp.sh` が 3 秘密を SM に載せ、`--set-secrets` + `--remove-env-vars` でデプロイ。非秘密のみ `--env-vars-file`。本番移行は同スクリプトのみ。

**Tech Stack:** bash, gcloud, Secret Manager, Cloud Run

**Spec:** `docs/superpowers/specs/2026-11-22-cloud-run-secret-manager-design.md`

## Global Constraints

- 秘密値をログ・echo・コミットに出さない（L-017 / L-029）
- AUTH と ADMIN は別シークレット（L-1001）
- README / `.env.example` とスクリプトの契約を一致（L-1002）
- `/feature` 中はコミットしない
- 本番移行は Done 必須

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `scripts/deploy-gcp.sh` | ensure_secret、Accessor、set-secrets、平文除去 |
| `README.md` | SM 正本の手順・検証・スモーク・ローテ |
| `.env.example` | SECRET_ID_* と毎回 require の契約 |

---

## Task 1: deploy-gcp.sh

**Files:** Modify `scripts/deploy-gcp.sh`

- [x] **Step 1:** 先頭コメントとデプロイ後エコーを SM 正本に更新（秘密は `***`。Basic のみ／login 分離の案内）。
- [x] **Step 2:** 既存の 3 パスワード `require` と `ADMIN_INITIAL_PASSWORD` ≠ `AUTH_PASSWORD` を **維持**。`SECRET_ID_DB_PASSWORD` / `SECRET_ID_AUTH_PASSWORD` / `SECRET_ID_ADMIN_INITIAL_PASSWORD` の既定値を設定。
- [x] **Step 3:** 必要なら `gcloud services enable secretmanager.googleapis.com`（幂等）。`ensure_secret(id, value)` — 無ければ `gcloud secrets create "$id" --replication-policy=automatic`。常に `printf %s "$value" | gcloud secrets versions add "$id" --data-file=-`（read しない）。失敗時も値を出さない。
- [x] **Step 4:** 3 秘密に対し ensure_secret。ランタイム SA を resolve し各 secret に `secretAccessor`（幂等）。
- [x] **Step 5:** env-vars-file から 3 パスワード行を削除。
- [x] **Step 6:** `gcloud run deploy` に `--set-secrets=...`（`--env-vars-file` と併記）。平文 `value:` が残っているときだけ `services update --remove-env-vars=...`（secret 参照を消さない。同一 invoke 不可のため分離）。
- [x] **Step 7:** `bash -n scripts/deploy-gcp.sh`。env-vars-file 生成ブロックに 3 パスワード yaml 行が無いことを `rg` で確認。

---

## Task 2: README / .env.example

- [x] **Step 1:** README デプロイ節を SM 正本に書き換え（`secretmanager.googleapis.com` 有効化、export は SM 入力、Cloud Run 平文に載らない、SECRET_ID_*、Accessor、毎回 require、ローテ推奨、describe 検証）。
- [x] **Step 2:** スモークを Basic のみ 401 / login+Cookie 成功に分離（L-1001）。
- [x] **Step 3:** `.env.example` に SECRET_ID_* と「deploy 毎回 require・シード後もキー残し」を書く。

---

## Task 3: 本番移行と検証（Done 必須）

- [x] **Step 1:** 必要な env を用意し（値はチャットに出さない）、更新済み `./scripts/deploy-gcp.sh` を実行。Docker 不可なら設計どおりスクリプト経路を維持しつつ、同一ロジックで image 再利用可能な場合はスクリプト内の build 失敗時に既存 image を使うオプトは **作らない** — Cloud Build 等、既存の本番デプロイ手段で **同じスクリプトを走らせる**。Docker が使える環境で実行する。
- [x] **Step 2:** describe で最新 env に 3 キーの平文 `value:` が無く secret 参照であることを確認（出力をログに残すときは値を伏せる）。
- [x] **Step 3:** `/health` 200、Basic のみ `/api/board` 401、login+Cookie で成功。

---

## 知見

- L-029, L-017, L-1002, L-1001（手順とスクリプトの秘密の置き場一致は L-1002）
