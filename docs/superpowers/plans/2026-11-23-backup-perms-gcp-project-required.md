# #109 バックアップ権限と GCP_PROJECT 必須化 — 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新規 DB ダンプが所有者のみ読め、`GCP_PROJECT` 未設定ではデプロイ／Scheduler 確保スクリプトが止まる。

**Architecture:** README のバックアップ例に `umask 077`、3 シェルから本番プロジェクト ID フォールバックを削除、CI ガードで再混入を防ぐ。アプリコードは触らない。

**Tech Stack:** bash、README Markdown、GitHub Actions（既存 deploy-guards）

**Design:** `docs/superpowers/specs/2026-11-23-backup-perms-gcp-project-required-design.md`

**知見:** L-001（unset を成功扱いしない）、L-1004 とは独立（本カードは暗黙プロジェクト既定）

---

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `README.md` | umask・GCP_PROJECT 必須の文書 |
| `scripts/deploy-gcp.sh` | フォールバック撤去 |
| `scripts/ensure-trash-purge-scheduler.sh` | 同上＋コメント |
| `scripts/ensure-recurring-run-scheduler.sh` | 同上＋コメント |
| `scripts/check-no-gcp-project-fallback.sh` | 回帰ガード（新規） |
| `.github/workflows/secret-scan.yml` | ガード呼び出し |
| `backups/*.sql`（未追跡） | 削除 |
| 手元 `.env`（未追跡） | `chmod 600` |

---

### Task 1: GCP_PROJECT フォールバック撤去

**Files:**
- Modify: `scripts/deploy-gcp.sh`
- Modify: `scripts/ensure-trash-purge-scheduler.sh`
- Modify: `scripts/ensure-recurring-run-scheduler.sh`

- [x] **Step 1:** 各ファイルの `GCP_PROJECT="${GCP_PROJECT:-daily-routine-app-8a832}"` を削除する（変数は環境からそのまま使う。続く `require GCP_PROJECT` を残す）
- [x] **Step 2:** 両 `ensure-*.sh` 先頭コメントの `Optional overrides: GCP_PROJECT` を、必須である旨に直す
- [x] **Step 3:** 検証

```sh
env -u GCP_PROJECT bash -c './scripts/deploy-gcp.sh' ; echo exit:$?
# expect: non-zero, stderr contains GCP_PROJECT（他の require より先でも可）
# 同様に ensure-trash-purge-scheduler.sh / ensure-recurring-run-scheduler.sh
# （他必須 env が無くても GCP_PROJECT 欠落で落ちること）
```

---

### Task 2: 回帰ガード + CI

**Files:**
- Create: `scripts/check-no-gcp-project-fallback.sh`
- Modify: `.github/workflows/secret-scan.yml`

- [x] **Step 1:** 3 スクリプトを対象に `GCP_PROJECT:-daily-routine-app-8a832`（または同型）が無いことを検査する bash を書く。見つかれば非 0。任意 `--selftest`: 一時ファイルにフォールバック行を入れて非 0 になることを確かめる
- [x] **Step 2:** `secret-scan.yml` の deploy-guards に `bash -n`・本体・`--selftest` を追加（他ガードと同列）
- [x] **Step 3:** `./scripts/check-no-gcp-project-fallback.sh` と `--selftest` がともに成功

---

### Task 3: README

**Files:**
- Modify: `README.md`

- [x] **Step 1:** ローカル更新前バックアップ例と、本番データ移行 §1 のダンプ例の両方で、`mkdir -p backups` の直前に `umask 077` を入れる
- [x] **Step 2:** 本番デプロイ関連の「例: daily-routine… / 上書き可」をやめ、`export GCP_PROJECT=YOUR_GCP_PROJECT_ID` 形式にし「スクリプトに本番既定は無い」と書く
- [x] **Step 3:** 手元 `.env` は `chmod 600` 推奨を 1 行追加
- [x] **Step 4:** 受け入れ5: 本番デプロイ関連節で `rg 'daily-routine-app-8a832|上書き可' README.md` がヒットしない（またはヒットがプレースホルダ説明以外でない）ことを確認

---

### Task 4: 手元クリーンアップ（コミット対象外）

- [x] **Step 1:** `rm -f backups/*.sql`（ディレクトリは残してよい）
- [x] **Step 2:** `[ -f .env ] && chmod 600 .env`
- [x] **Step 3:** `ls backups` に `.sql` が無いことを確認

---

### Task 5: 結合スモーク

- [x] **Step 1:** `umask 077; mkdir -p /tmp/sb-umask-test; touch /tmp/sb-umask-test/x.sql; ls -l /tmp/sb-umask-test/x.sql` → group/other に r 無し
- [x] **Step 2:** `./scripts/check-no-gcp-project-fallback.sh`（＋`--selftest`）と `./scripts/check-nginx-tls-headers.sh` が通る
- [x] **Step 3:** 受け入れ3再確認: 3 脚本それぞれ `env -u GCP_PROJECT` で非 0、stderr に `GCP_PROJECT`
- [x] **Step 4:** `feature` ではコミットしない（後続 `/commit-ja`）
