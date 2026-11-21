# API Doc（OpenAPI）＋更新スキル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/openapi.yaml`（OpenAPI 3.1）を HTTP API 契約の正本にし、`docs/api.md` を非規範の短い案内へ縮小し、API 変更時に OpenAPI を更新する Cursor スキルをリポジトリに置く。

**Architecture:** 正本は手書き（＋既存 Markdown／ハンドラからの移し）の単一 YAML。コード生成・swag 注釈・CI ゲートは行わない。認証は `auth_middleware.go` の exempt／optional／必須に合わせて operation の `security` を付ける。README と他の現行ドキュメントの「正本」表記・深リンクを OpenAPI へ付け替える（過去の specs/plans は歴史として原則触らない）。

**Tech Stack:** OpenAPI 3.1 YAML、既存 Go `net/http` ServeMux ルート、Cursor Agent Skill（`.cursor/skills/`）

**Design:** `docs/superpowers/specs/2026-11-21-api-doc-openapi-design.md`

**知見:** 正本1か所、L-001（ステータス／認証要否の誤記禁止）、L-044（曖昧なフォールバック記述禁止）

**Commits:** `/feature` 中はコミットしない。コミットは後続 `/commit-ja`。

---

## File map

| ファイル | 責務 |
| --- | --- |
| `docs/openapi.yaml` | 契約の正本（全ルート） |
| `docs/api.md` | 正本委譲＋短い案内＋非規範 curl のみ |
| `README.md` | API 入口リンクと method/path/目的の表（規則の写しなし） |
| `docs/verification.md` 等 | 「api.md が正本」表記の付け替え |
| `.cursor/skills/update-api-doc/SKILL.md` | API 変更時の更新手順 |
| （任意）`scripts/check-openapi-routes.py` | handler と paths の突合（スキルから実行可。CI 必須にしない） |

---

### Task 1: OpenAPI 骨格と全ルートの paths

**Files:**
- Create: `docs/openapi.yaml`
- Create (optional): `scripts/check-openapi-routes.py`

- [ ] **Step 1:** `handler.go` から `METHOD path` 一覧を抽出する（既存の `mux.HandleFunc("...")`）
- [ ] **Step 2:** `docs/openapi.yaml` に `openapi: 3.1.0`、`info`、`servers`（`http://127.0.0.1:4200`）、`components.securitySchemes.cookieAuth`（`sb_session`）、`components.schemas.Error`（`{message}`）を書く。**`info` または `servers` の description に、本番 nginx の HTTP Basic はゲートウェイ層である旨を書く。Basic を operation の `security` やアプリの `securitySchemes` 必須要件に載せない**
- [ ] **Step 3:** 全ルートを `paths` に載せる。各 operation に summary、security（exempt → `security: []`、optional → security 任意＋**description に未ログイン時 401 と `viewAccess=public` の分岐**、それ以外 → cookieAuth）、代表的な responses（**実装／テストで使うステータスコードと一致させる。L-001**）。description に「黙ってフォールバック／別解釈」と読める曖昧な文言を書かない（**L-044**）。リクエスト／応答スキーマは分かる範囲で `components.schemas` を参照（旧 `docs/api.md` とテストから移す）
- [ ] **Step 4:** YAML としてパースできることを確認（`python3 -c 'import yaml; yaml.safe_load(open("docs/openapi.yaml"))'`。PyYAML が無ければ別の妥当性確認手段）
- [ ] **Step 5:** （任意）`scripts/check-openapi-routes.py` で handler のルート集合 ⊆ openapi paths を検証し、ローカルで通す

---

### Task 2: `docs/api.md` 縮小

**Files:**
- Modify: `docs/api.md`

- [ ] **Step 1:** 現行 `docs/api.md` を退避せず直接縮小する（git が履歴を保持）
- [ ] **Step 2:** 残す内容だけにする:
  1. 正本は `docs/openapi.yaml` である旨とリンク
  2. by-number と列名 `status` を使う目的の短い説明（数値制約・エラー表なし）
  3. 非規範 curl を少数（例: status PATCH、assignee PATCH）
- [ ] **Step 3:** 受け入れ: 制約表・エラー表・フィールド仕様の節が残っていないことを目視／grep

---

### Task 3: README と他文書の付け替え

**Files:**
- Modify: `README.md`
- Modify: `docs/verification.md`（および `rg` で見つかった現行利用者向け docs。`docs/superpowers/specs|plans` の過去文書は原則触らない）

- [ ] **Step 1:** README `## API` の導入文を OpenAPI へリンク
- [ ] **Step 2:** API 表から `{...}` ボディ形・詳細の規則写しを除き、method / path / 短い目的＋ OpenAPI リンクにする。**`## API` 直下の規範段落（文字数・ステータスコード列挙・照合規則など）も削除するか OpenAPI 誘導のみに縮小する**（表以外の写しも残さない）。セッション免除一覧があれば OpenAPI／実装と矛盾しないか確認
- [ ] **Step 3:** README 内の `docs/api.md#...` 深リンクを OpenAPI または縮小後 api.md へ付け替え
- [ ] **Step 4:** `rg 'api\.md|APIガイド|正本' --glob '!docs/superpowers/**'` で現行 docs を直し、「契約の正本は api.md」を残さない

---

### Task 4: 更新スキル

**Files:**
- Create: `.cursor/skills/update-api-doc/SKILL.md`

- [ ] **Step 1:** create-skill の書式に従い front matter（name / description）を書く。description に「HTTP API 追加・変更・削除時」「openapi.yaml 更新」を含める
- [ ] **Step 2:** 設計どおりの手順（handler 突合 → openapi 更新 → 認証 → README／他 docs 突合 → 任意 YAML パース）を書く。**L-044（曖昧フォールバック禁止）と L-001（ステータス／認証要否の誤記禁止）を手順に含める**
- [ ] **Step 3:** 「実装だけマージして Doc を後回しにしない」を明示

---

### Task 5: 受け入れ検証

- [ ] **Step 1:** `handler.go` 全ルートが `docs/openapi.yaml` にある
- [ ] **Step 2:** 全 operation の `security` が `auth_middleware.go` の exempt／optional／必須と一致することをチェックリスト化して確認（任意でスクリプト）
- [ ] **Step 3:** 主要 operation の responses が実装／テストのステータスコードと大きく食い違っていないことをサンプル突合（L-001）
- [ ] **Step 4:** 設計の受け入れ条件 1〜6 をチェックリストで確認
- [ ] **Step 5:** 変更はコミットしない（`/feature`）

---

## レビュー記録

### 第 1 周（要件との対応）
- [対応] Task1 に Basic ゲートウェイ記載を追加
- [対応] optional の 401／public 分岐を Step3 に具体化
- [対応] Task5 に auth_middleware との security 突合を追加

### 第 2 周（タスク整合と知見）
- [対応] Task3 に README API 規範段落の縮小を追加
- [対応] Task1／Task4 に L-044 チェックを明示
- [対応] Task5 に応答コード突合を追加
