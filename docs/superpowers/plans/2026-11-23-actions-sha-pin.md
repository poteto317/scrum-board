# GitHub Actions SHA 固定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `secret-scan.yml` の Action 参照をコミット SHA に固定し、Dependabot とシェルガードで回帰を防ぐ。

**Architecture:** 既知の `v4` / `v2` タグ先 SHA で 3 行をピンし、`check-workflow-action-pins.sh` で `uses:` 行の形式を検査、`dependabot.yml` で github-actions を週次更新。`deploy-guards` job に既存 3 本と同じ配線で 4 本目を追加。

**Tech Stack:** GitHub Actions、bash、Dependabot v2

**Spec:** `docs/superpowers/specs/2026-11-23-actions-sha-pin-design.md`

## Global Constraints

- `/feature` 中はコミットしない
- 同 PR で pin・dependabot・guard・`secret-scan.yml`・README を揃える
- ガードはネットワークを使わない（フォーマット検査のみ）
- 知見: L-1040

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `.github/workflows/secret-scan.yml` | Action の SHA ピンと guard 呼び出し |
| `.github/dependabot.yml` | github-actions の週次更新 |
| `scripts/check-workflow-action-pins.sh` | `uses:` 行の SHA 形式検査 |
| `README.md` | deploy-guards 4 本の説明 |

---

### Task 1: Dependabot

**Files:**
- Create: `.github/dependabot.yml`

- [x] **Step 1:** `version: 2` で `package-ecosystem: github-actions`、`directory: /`、`schedule: interval: weekly` を設定する。

---

### Task 2: チェックスクリプト

**Files:**
- Create: `scripts/check-workflow-action-pins.sh`

- [x] **Step 1:** `secret-scan.yml` を読み、`uses:` 行ごとに `@[0-9a-f]{40}` のみ許可（大小文字は小文字想定）。違反時は非 0。

- [x] **Step 2:** `--selftest` で合格・不合格フィクスチャを検証する。

- [x] **Step 3:** `bash -n scripts/check-workflow-action-pins.sh` と `./scripts/check-workflow-action-pins.sh` と `--selftest` を実行する。

---

### Task 3: ワークフローと README

**Files:**
- Modify: `.github/workflows/secret-scan.yml`
- Modify: `README.md`

- [x] **Step 1:** 3 つの `uses:` を設計表の SHA に差し替え（checkout 2 箇所は同一 SHA、コメント `# v4` / `# v2`）。

- [x] **Step 2:** `deploy-guards` に `bash -n`・実行・`--selftest` を追記（他 3 本の後、dockerignore selftest の前後は既存順序を維持）。

- [x] **Step 3:** README の「3本」を「4本」にし、新スクリプト名を列挙する。

- [x] **Step 4:** ローカル一括:

```sh
bash -n scripts/check-deploy-image-hardening.sh
bash -n scripts/check-nginx-tls-headers.sh
bash -n scripts/check-root-dockerignore.sh
bash -n scripts/check-workflow-action-pins.sh
./scripts/check-deploy-image-hardening.sh
./scripts/check-nginx-tls-headers.sh
./scripts/check-root-dockerignore.sh
./scripts/check-workflow-action-pins.sh
./scripts/check-root-dockerignore.sh --selftest
./scripts/check-workflow-action-pins.sh --selftest
```

Expected: すべて exit 0。

---

### Task 4: リポジトリ検証

- [x] **Step 1:** プロジェクトの `npm test` または既存 CI 向けスクリプトがあれば実行（本変更は主に bash / yaml のみ）。