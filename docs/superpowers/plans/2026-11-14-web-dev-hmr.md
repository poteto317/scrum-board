# Docker Compose 開発用画面（web-dev / 自動反映）実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **`/feature` 実行中はコミットしない。**

**Goal:** Compose の `dev` profile で `web-dev`（`ng serve`）を起動し、ソース保存で画面を自動反映できるようにする。

**Architecture:** 既定の `web`（Nginx）は維持し、`profiles: ["dev"]` の `web-dev` を追加。同一 `WEB_PORT` のため同時起動しない。コンテナ内は `proxy.docker.json` で `api:8080` へプロキシする。

**Tech Stack:** Docker Compose、Node 24、Angular CLI `ng serve`、npm scripts。

**Spec:** `docs/superpowers/specs/2026-11-14-web-dev-hmr-design.md`

## Global Constraints

- アプリ本体（Angular 機能・Go API・DB）は変更しない。
- 既定の `docker compose up` で `web-dev` を起動しない（profile 必須）。
- `web` と `web-dev` を同じポートで同時に上げない。
- L-048 / L-059 / L-072 / L-591 / L-760 を満たすこと。
- `/feature` のため各タスク末尾で git commit しない。

## File Map

| ファイル | 責務 |
| --- | --- |
| `compose.yaml` | `web-dev` サービスと `frontend_node_modules` ボリューム |
| `frontend/package.json` | `start:docker` スクリプト |
| `frontend/proxy.docker.json` | コンテナ内 `/api` → `api:8080` |
| `scripts/dev-web.sh` | `web` 停止後に `web-dev` を起動 |
| `README.md` | Docker 推奨開発経路とホスト経路の案内 |
| `docs/verification.md` | 実機検証の記録（あれば追記） |

---

### Task 1: Compose `web-dev` とプロキシ・スクリプト

**Files:**
- Modify: `compose.yaml`
- Modify: `frontend/package.json`
- Create: `frontend/proxy.docker.json`
- Create: `scripts/dev-web.sh`

**Interfaces:**
- Consumes: 既存 `api` サービス名、`WEB_PORT`
- Produces: `npm run start:docker`、`./scripts/dev-web.sh`

- [x] **Step 1: `compose.yaml` に `web-dev`（profile `dev`）と `frontend_node_modules` を追加する**
- [x] **Step 2: `proxy.docker.json` と `start:docker` を追加する**（`--proxy-config proxy.docker.json`、`--host 0.0.0.0`、`--poll 2000`）
- [x] **Step 3: `scripts/dev-web.sh` を追加し実行可能にする**（ルートへ cd → `stop web` → `up -d db api web-dev`。`down -v` は使わない）

---

### Task 2: README 更新（L-591）とポート衝突の明示

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: Task 1 の起動方法
- Produces: 利用者が迷わない手順

- [x] **Step 1: 「コードを編集しながら開発する」節を Docker 推奨 → ホストの順に更新する**
- [x] **Step 2: ポート衝突の注意を追記する** — `docker compose --profile dev up` をサービス名なしで実行すると `web` と `web-dev` が同時起動しうるため、`stop web` または `./scripts/dev-web.sh` を使う旨を明記する
- [x] **Step 3: リポジトリ内の古い「静的 web のみ」前提手順を grep する** — README / `frontend/README.md` を更新。`docs/api.md` 等は `:4200` 経由の API 例のみで矛盾なし

---

### Task 3: 実機検証（L-059 / L-760）と回帰

**Files:**
- Modify（任意）: `docs/verification.md`

**Interfaces:**
- Consumes: Task 1–2 の成果
- Produces: 受け入れ条件の確認結果

- [x] **Step 1: `web-dev` 起動済みを確認し、ログで `ng serve` 完了を見る**（healthcheck 無し）
- [x] **Step 2: `curl` で http://127.0.0.1:4200/api/board が 200 かつ JSON**（L-760）
- [x] **Step 3: ブラウザーでボード表示を確認し、CSS 変更で `Changes detected. Rebuilding` を確認**
- [x] **Step 4: `docker compose config --services` に `web-dev` 無し / `--profile dev` で有り**
- [x] **Step 5: `npm test -- --watch=false`（75）と `npm run build` 通過**
- [x] **Step 6: `docs/verification.md` に追記**

---

## 引き継ぎメモ

Task 1〜3 は完了済み。受け入れ条件の実機確認（`/api/board` JSON・CSS 変更の再ビルド・profile なしで `web-dev` 非起動・test/build）も済んでいる。
