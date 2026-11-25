# ANTHROPIC_API_KEY Secret Manager 化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 本番の `ANTHROPIC_API_KEY` を Secret Manager + `--set-secrets` で保持し、キー付きデプロイで AI を `configured: true` にする（#140）。

**Architecture:** アプリは現状どおり env 読取。`deploy-gcp.sh` が非空キーを SM に載せ Cloud Run へマウント。空なら SET_SECRETS から除外（既存マウント解除）＋残平文 remove。Go/FE 変更なし。

**Tech Stack:** bash (`scripts/deploy-gcp.sh`), gcloud Secret Manager / Cloud Run, Markdown (README / `.env.example`)

**Spec:** [docs/superpowers/specs/2026-11-25-anthropic-api-key-secret-manager-design.md](../specs/2026-11-25-anthropic-api-key-secret-manager-design.md)

**知見:** L-017, L-029, L-1002, L-1004

---

## File map

| File | Responsibility |
| --- | --- |
| `scripts/deploy-gcp.sh` | SECRET_ID、任意 ensure/Accessor/SET_SECRETS、平文除去・assert |
| `scripts/check-deploy-anthropic-optional.sh` | 空 OPT の bash 3.2+set -u と deploy 契約のスモーク |
| `.github/workflows/secret-scan.yml` | deploy-guards に上記 check を追加 |
| `README.md` | デプロイ節を SM 正本に更新、ガード一覧 |
| `.env.example` | 任意・空可。本番 SM 詳細は README 参照 |

---

### Task 1: deploy-gcp.sh に ANTHROPIC SM 配線

**Files:**
- Modify: `scripts/deploy-gcp.sh`

- [x] **Step 1: ヘッダコメントと SECRET_ID**
- [x] **Step 2: 非空時 ensure + Accessor + SET_SECRETS**
- [x] **Step 3: 平文除去と Anthropic assert（パスワード枝とは独立）**
- [x] **Step 4: 静的検証** (`bash -n` ok、空/非空 SET_SECRETS ランタイム確認、classify plain/secret/missing)
- [x] **Step 5: （feature ではコミットしない）**

---

### Task 2: README と .env.example

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [x] **Step 1: README デプロイ節**
- [x] **Step 2: .env.example**
- [x] **Step 3: 契約 Grep**（`SM 化対象外` 無し、リソース名あり）

---

### Task 3: 本番適用と受け入れ検証

**Files:** なし（運用）

- [ ] **Step 1: キー取得**

  環境変数または個人ストアから `ANTHROPIC_API_KEY` を用意。値をログ・チャット・リポジトリに書かない。

- [ ] **Step 2: クリーンツリーでデプロイ**

  実装コミット後（後続 commit-ja 連鎖）または検証可能なツリーで、必須秘密 + 非空 `ANTHROPIC_API_KEY` を export し `./scripts/deploy-gcp.sh`。

  注: `deploy-gcp.sh` はクリーン git を要求。feature 単体では未コミットのため、**本番適用は commit 後の連鎖（または一時 stash しない運用）で行う**。本プランの受け入れはデプロイ成功 + 下記検証。

- [ ] **Step 3: describe + login + usage（非空・本番 Done）**

  ```bash
  gcloud run services describe scrum-board \
    --region="$GCP_REGION" --project="$GCP_PROJECT" \
    --format='yaml(spec.template.spec.containers[0].env)' \
    | grep -A5 'name: ANTHROPIC_API_KEY'
  # secretKeyRef があること。value: 平文が無いこと。キー値自体は表示・保存しない。
  ```

  Cookie 取得（`-u` は実パスワード。コマンドライン履歴に残る点に注意し、値自体はエコー・チャットに出さない。password JSON も stdin）:

  ```bash
  curl -sS -u "$AUTH_USER:$AUTH_PASSWORD" -c /tmp/sb.ck -b /tmp/sb.ck \
    -H 'Content-Type: application/json' \
    --data-binary @- "$SERVICE_URL/api/auth/login" <<EOF
  {"loginName":"$AUTH_USER","password":"$ADMIN_OR_CURRENT_PASSWORD"}
  EOF
  curl -sS -u "$AUTH_USER:$AUTH_PASSWORD" -b /tmp/sb.ck "$SERVICE_URL/api/ai/usage"
  # configured: true（レスポンスに API キーは含まれない）
  ```

- [ ] **Step 4: 空キー分岐の確認（本番再デプロイは必須ではない）**

  ソースに条件付き `SET_SECRETS+=",ANTHROPIC_API_KEY=..."` 行があるのは正常。確認は **ランタイム**:

  - ユニット相当: `MOUNT_ANTHROPIC=0` のとき組み立て後の `SET_SECRETS` 文字列に `ANTHROPIC_API_KEY=` が含まれないこと（一時 echo や自己テスト。値は出さない）
  - またはステージングで `ANTHROPIC_API_KEY` 空デプロイ後の describe: キー欠落、平文 `value:` なし（L-1004）

  本番 Done の主経路は Step 2–3（キー付き）。空分岐確認で本番 AI をオフにしない。

---

## 非目標（プランに含めない）

- Settings UI / 永続化 API
- `ANTHROPIC_MODEL` の SM 化
- Go / OpenAPI 変更
