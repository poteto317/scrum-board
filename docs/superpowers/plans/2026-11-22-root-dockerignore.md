# ルート `.dockerignore` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 本番 `docker build`（ルートコンテキスト）から手元の `node_modules`・秘密・ダンプ等を除外する。

**Architecture:** リポジトリルートに `.dockerignore` を置き、必須 7 パターンを行完全一致で宣言する。`scripts/check-root-dockerignore.sh` で必須／禁止パターンを検査し、`secret-scan.yml` の deploy-guards ジョブから呼ぶ。Dockerfile は変更しない。

**Tech Stack:** Docker ignore 構文、bash、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-11-22-root-dockerignore-design.md`

## Global Constraints

- `/feature` 中はコミットしない
- **同 PR で** `.dockerignore`・`scripts/check-root-dockerignore.sh`・`secret-scan.yml` 配線の 3 成果物を揃える（設計 AC）
- 先頭 `/` 付きの必須同名パターン、`*` / `**` / `**/*`、`!` 再包含、必要パスを落とす行は置かない
- `frontend/.dockerignore` / `backend/.dockerignore` は触らない
- 知見: L-028, L-064, L-336（dockerignore では `.env*` で example も除外可）, L-1004（本変更は別経路）

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `.dockerignore` | ルートビルドコンテキストの除外宣言 |
| `scripts/check-root-dockerignore.sh` | 必須行・禁止行の回帰検査 |
| `.github/workflows/secret-scan.yml` | deploy-guards から検査を実行 |

---

### Task 1: ルート `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [x] **Step 1: ルート `.dockerignore` を作成する**

内容（必須 7 行＋任意行。先頭スラッシュ無し。`!` 無し）:

```
# Production build context for deploy/Dockerfile (repo root).
# Patterns without a leading slash match in any subdirectory.
node_modules
dist
.angular
.env*
backups
.git
.claude
.superpowers
.worktrees
.DS_Store
backend/server
```

- [x] **Step 2: 目視で必須 7 行が先頭 `/` 無し・行完全一致であることを確認する**

Run: `grep -E '^(node_modules|dist|\.angular|\.env\*|backups|\.git|\.claude)$' .dockerignore | wc -l`  
Expected: `7`

---

### Task 2: チェックスクリプト

**Files:**
- Create: `scripts/check-root-dockerignore.sh`

- [x] **Step 1: スクリプトを作成する**

`scripts/check-deploy-image-hardening.sh` と同系統（`set -euo pipefail`、`fail`、ルート相対）。挙動:

1. `$ROOT/.dockerignore` がファイルとして存在する。
2. コメント行（`#` 開始）と空行を除いた各行を集合として読む。
3. 必須: `node_modules` `dist` `.angular` `.env*` `backups` `.git` `.claude` がすべて含まれる。
4. 禁止（いずれかがあれば fail）:
   - `/node_modules` `/dist` `/.angular` `/.env*` `/backups` `/.git` `/.claude`
   - `*` `**` `**/*`
   - `frontend` `frontend/` `frontend/*` `backend` `backend/` `backend/*` `deploy` `deploy/` `deploy/*`
   - `frontend/package.json` `frontend/package-lock.json` `backend/go.mod` `backend/go.sum` `deploy/nginx.conf` `deploy/entrypoint.sh`
   - いずれかの行が `!` で始まる
5. 成功時: `ok: root .dockerignore` を stdout に出す。

実装の骨格（macOS 既定 bash 3.2 互換。`mapfile` 不使用）:

```bash
#!/usr/bin/env bash
# Fail if root .dockerignore regresses (#104).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DI="$ROOT/.dockerignore"

fail() { echo "check-root-dockerignore: $1" >&2; exit 1; }

[[ -f "$DI" ]] || fail "missing $DI"

lines=()
while IFS= read -r raw || [[ -n "$raw" ]]; do
  trimmed="${raw%"${raw##*[![:space:]]}"}"
  [[ -z "$trimmed" || "$trimmed" == \#* ]] && continue
  lines+=("$trimmed")
done < "$DI"

has() {
  local needle="$1" line
  for line in "${lines[@]}"; do
    [[ "$line" == "$needle" ]] && return 0
  done
  return 1
}

for req in node_modules dist .angular '.env*' backups .git .claude; do
  has "$req" || fail "missing required pattern: $req"
done

for bad in \
  /node_modules /dist /.angular '/.env*' /backups /.git /.claude \
  '*' '**' '**/*' \
  frontend 'frontend/' 'frontend/*' backend 'backend/' 'backend/*' deploy 'deploy/' 'deploy/*' \
  frontend/package.json frontend/package-lock.json backend/go.mod backend/go.sum \
  deploy/nginx.conf deploy/entrypoint.sh
do
  has "$bad" && fail "forbidden pattern: $bad"
done

for line in "${lines[@]}"; do
  case "$line" in
    !*) fail "negation not allowed: $line" ;;
  esac
done

echo "ok: root .dockerignore"
```

- [x] **Step 2: 構文チェックと実行**

Run:

```bash
bash -n scripts/check-root-dockerignore.sh
./scripts/check-root-dockerignore.sh
```

Expected: exit 0、`ok: root .dockerignore`

- [x] **Step 3: 失敗経路を一時改変で確認し、控えから復元する**

```bash
cp .dockerignore /tmp/dockerignore.104.bak
# (a) 必須欠落
grep -v '^node_modules$' .dockerignore > .dockerignore.tmp && mv .dockerignore.tmp .dockerignore
./scripts/check-root-dockerignore.sh; test $? -ne 0
cp /tmp/dockerignore.104.bak .dockerignore
# (b) 禁止パターン
printf '%s\n' 'node_modules' 'dist' '.angular' '.env*' 'backups' '.git' '.claude' '/node_modules' > .dockerignore
./scripts/check-root-dockerignore.sh; test $? -ne 0
cp /tmp/dockerignore.104.bak .dockerignore
# (c) negation
printf '%s\n' 'node_modules' 'dist' '.angular' '.env*' 'backups' '.git' '.claude' '!frontend/node_modules' > .dockerignore
./scripts/check-root-dockerignore.sh; test $? -ne 0
cp /tmp/dockerignore.104.bak .dockerignore
```

Expected: (a)(b)(c) いずれも exit ≠ 0、最後に正常 `.dockerignore` が戻っている。

---

### Task 3: CI 配線

**Files:**
- Modify: `.github/workflows/secret-scan.yml`

- [x] **Step 1: deploy-guards ステップに追加する**

`Verify deploy/nginx regression guards` の `run:` に次を足す（既存 4 行の直後）:

```yaml
          bash -n scripts/check-root-dockerignore.sh
          ./scripts/check-root-dockerignore.sh
```

- [x] **Step 2: ワークフロー YAML にスクリプト名が含まれることを確認する**

Run: `grep -n check-root-dockerignore .github/workflows/secret-scan.yml`  
Expected: `bash -n` と実行の 2 行

- [x] **Step 3: deploy-guards 相当をローカルで一括実行する**

```bash
bash -n scripts/check-deploy-image-hardening.sh
bash -n scripts/check-nginx-tls-headers.sh
bash -n scripts/check-root-dockerignore.sh
./scripts/check-deploy-image-hardening.sh
./scripts/check-nginx-tls-headers.sh
./scripts/check-root-dockerignore.sh
```

Expected: すべて exit 0

---

## 知見

- L-028 → Task 1 の `.env*` / Task 2 の必須検査（秘密がビルド入力に乗らない）
- L-064 → Task 1 の `dist` / `.angular` / `node_modules`（手元成果物の混入防止）
- L-336 → Task 1 で `.env*` により `.env.example` も除外してよい（git 追跡とは別）
- L-1004 → 本変更は Secret Manager とは独立のコンテキスト漏洩経路（スコープ外と明記済み）

## レビュー記録

### 第 1 周（要件との対応）

- [対応] 同 PR 3 成果物を Global Constraints に明記
- [対応] 禁止パターン / `!` の失敗確認 Step を追加
- [対応] 復元を `cp` 退避に統一
- [対応] deploy-guards 一括ローカル実行 Step を追加
- [対応] 本節でレビュー記録を埋める

### 第 2 周（タスクの整合と知見）

- [対応] `mapfile` を bash 3.2 互換の `while read` に置換
- [対応] §知見を設計の映射どおり Task に対応づけ
