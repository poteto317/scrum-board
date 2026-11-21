---
name: update-api-doc
description: >-
  Update the Scrum Board HTTP API contract in docs/openapi.yaml when adding,
  changing, or removing API routes or request/response shapes in this repo.
  Use whenever backend/internal/kanban/handler.go (or related handlers) change,
  or when API docs would otherwise drift from the implementation.
---

# Update API Doc（OpenAPI）

このリポジトリの HTTP API **契約正本**は `docs/openapi.yaml`（OpenAPI 3.1）です。`docs/api.md` は非規範の短い案内だけです。実装だけマージして Doc を後回しにしない。

## いつ使うか

- `backend/internal/kanban/handler.go` の `mux.HandleFunc` を追加・変更・削除したとき
- リクエスト／応答／ステータスコード／認証要否が変わるとき
- 既存 API の契約を直すレビュー指摘に対応するとき

## 手順

1. **ルート一覧**  
   `handler.go` の `HandleFunc("METHOD path")` を列挙する。

2. **`docs/openapi.yaml` を更新**  
   - paths に抜け・古い path／method が無いこと  
   - スキーマ・description・代表的な responses を契約に合わせる  
   - **L-001:** ステータスコードと認証要否を誤記しない  
   - **L-044:** 「黙ってフォールバック／別解釈」と読める曖昧な description を書かない  

3. **認証（`auth_middleware.go`）**  
   - `sessionExempt` → `security: []`（login／logout／health／public-config／trash purge／recurring run）  
   - `sessionOptional`（一部 item GET・添付）→ `security: []` ＋ description に未ログイン 401 と `viewAccess=public` の分岐  
   - それ以外 → `cookieAuth`（Cookie 名 `sb_session`）  
   - 本番 nginx Basic はゲートウェイ層。operation の `security` に載せない（`info`／`servers` の説明のみ）

4. **他文書の突合（同じ変更で）**  
   - README の認証説明が OpenAPI／middleware と矛盾していないか（詳細一覧は OpenAPI に委譲）  
   - README `## API` の入口リンク。表は**主要入口の抜粋**（全ルート網羅は OpenAPI のみ。表を 68 行に膨張させない）  
   - `rg 'api\\.md|APIガイド|正本' --glob '!docs/superpowers/**'` で、契約正本がまだ `api.md` になっていないか確認  
   - 触った operation が `JsonValue` のままなら、分かる範囲で具体 schema／requestBody に置き換える  

5. **任意チェック**  
   ```sh
   python3 scripts/check-openapi-routes.py   # PyYAML が必要
   ```

6. **完了条件**  
   handler の全ルートが OpenAPI にあり、security ポリシーが middleware と一致し、README／verification 等の正本表記が OpenAPI を指していること。
