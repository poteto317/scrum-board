# 設計: ANTHROPIC_API_KEY の Secret Manager 化

- 日付: 2026-11-25
- 対象: scrum-board #140
- ステータス: 承認済み（/feature 自動承認・方針は Plan モードで確定）
- 前提: [#90 Cloud Run 秘密の Secret Manager 化](./2026-11-22-cloud-run-secret-manager-design.md)（当時 `ANTHROPIC_API_KEY` は対象外）

## 背景と問題

本番 AI（起票整形・チャット）はプロセス環境変数 `ANTHROPIC_API_KEY` の有無で有効化される（[`wiring.go`](../../../backend/cmd/server/wiring.go)）。未設定時は 503 `ai_not_configured`。

[#90](./2026-11-22-cloud-run-secret-manager-design.md) で DB/AUTH/ADMIN 等は Secret Manager + `--set-secrets` に移したが、`ANTHROPIC_API_KEY` は対象外のまま。README は Cloud Run 平文 env の任意設定を案内している。カード #140「サーバー側で保持をして、動作できるようにする」は、この鍵をサーバー側の秘密ストアで保持し本番 AI を有効にすること。

## 完了条件（受け入れ）

検証対象は **サービスの最新リビジョン**（#90 と同じ）。

- `ANTHROPIC_API_KEY` を渡してデプロイしたとき、最新リビジョンで当該キーが **平文 `value:` ではなく secret 参照**であること。
- `scripts/deploy-gcp.sh` が非空の `ANTHROPIC_API_KEY` を SM へ載せ、`--set-secrets` でマウントする。
- **空のとき:** 今回の `--set-secrets` 一覧に `ANTHROPIC_API_KEY` を含めない（Cloud Run は一覧を置換するため、**既存の secret マウントも外れる** → AI 503）。あわせて最新リビジョンに平文 `value:` が残っていれば `--remove-env-vars=ANTHROPIC_API_KEY` する（L-1004）。SM 上の過去バージョン削除は非目標。
- README / `.env.example` が「平文 Cloud Run env 任意・SM 対象外」ではなく、**SM が正本（任意・非空時）** と揃う（L-1002）。
- **本チケットの Done には、キーを渡して現行本番 `scrum-board` を再デプロイし、AI が `configured: true` になること**を含む（スクリプト変更のみでは完了にしない）。
- 秘密値をログ・エコー・チャット・PR に出さない（L-017 / L-029 / L-1004）。

検証:

1. `gcloud run services describe ... --format=yaml(spec.template.spec.containers[0].env)` で `ANTHROPIC_API_KEY` が secret 参照。
2. Basic + アプリ login 後に `GET /api/ai/usage` が `configured: true`（credits は使わない）。

## 決めたこと

| 事項 | 採用 | 却下 |
| --- | --- | --- |
| 保存場所 | 既存 SM + Cloud Run `--set-secrets`（#90 と同型） | Settings UI からのキー書き込み、DB/アプリ内シークレットストア |
| ランタイム | 現状どおり env 読取（変更なし） | アプリが SM SDK で直接取得 |
| 任意性 | ローカル Compose は空可。deploy は **非空のときだけ** SM 化 | 常時 `require ANTHROPIC_API_KEY`（AI 無しデプロイを壊す） |
| 空デプロイ | SET_SECRETS から除外（既存マウント解除）＋残平文は remove | 空でも既存マウントを温存／平文を放置 |
| SM リソース名 | 既定 `scrum-board-anthropic-api-key`（`SECRET_ID_ANTHROPIC_API_KEY` で上書き可） | 他秘密と JSON 詰め |
| `ensure_secret` | #90 と同じ（作成＋毎回 versions add、読み戻し比較なし） | 読み戻して比較し、同一なら versions add をスキップする案 |
| 平文除去 | 非空マウント時も空時も、describe で平文なら `--remove-env-vars=ANTHROPIC_API_KEY` | 旧リビジョン歴史の改ざん |
| `ANTHROPIC_MODEL` | 非秘密のまま（本チケット対象外） | 同時 SM 化 |

## アプローチ比較（要約）

1. **SM + `--set-secrets`（採用）** — #90 の延長。受け入れを直接満たす。アプリコード不要。
2. **Settings UI + サーバ永続化** — 「設定」文言には合うが、秘密ストアと ACL・監査をアプリ層に新設する。範囲过大。
3. **運用で平文 env のみ** — 「サーバー側保持」は満たすが SM 対象外のまま L-1004 が残る。

## 振る舞い

### `deploy-gcp.sh`

1. `SECRET_ID_ANTHROPIC_API_KEY` 既定を定義。
2. ビルド／push 後、`ANTHROPIC_API_KEY` が非空なら:
   - `ensure_secret`
   - ランタイム SA に `secretAccessor`
   - `SET_SECRETS` に `ANTHROPIC_API_KEY=${SECRET_ID}:latest` を追加
3. 空なら上記をスキップし、`SET_SECRETS` に含めない（必須 4 秘密の扱いとパスワード assert は現状維持。`--set-secrets` 置換により既存の Anthropic マウントは外れる）。
4. デプロイ後の env yaml 分類:
   - 必須パスワード 3 キーは既存 `classify_password_env_yaml` のまま assert。
   - `ANTHROPIC_API_KEY` が平文 `value:` なら `--remove-env-vars`（非空・空どちらでも）。
   - **非空マウント時**は最終的に secret 参照であることを assert。**空時**はキー欠落を成功とし、平文が残っていればエラー。
5. 完了エコーにシークレット **リソース名**のみ（値は出さない）。先頭コメントを更新。

### README / `.env.example`

- デプロイ節: `ANTHROPIC_API_KEY` は任意。設定するなら SM へ載せる一時入力であり Cloud Run 平文には残らない。
- リソース名既定と `SECRET_ID_ANTHROPIC_API_KEY`。
- 「SM 対象外・平文 env」の一文を削除／置換。
- ローカル Compose の空可は維持。デプロイ契約（任意・非空時 SM）を明示（L-1002）。

### アプリ

- Go / OpenAPI / Settings UI の `configured` 意味は変更しない。

### 本番への適用（Done 必須）

更新した `deploy-gcp.sh` で、非空の `ANTHROPIC_API_KEY` を渡して現行 `scrum-board` をデプロイする。値は環境または個人ストアから取得し、リポジトリ・ログ・チャットに書かない。

## 非目標

- Settings からのキー入力・永続化 API
- `ANTHROPIC_MODEL` の SM 化
- Basic / DB / Scheduler 秘密の再設計
- 旧リビジョン履歴からの平文完全消去の保証

## テスト方針

- `bash -n scripts/deploy-gcp.sh`
- env-vars-file 生成ブロックに `ANTHROPIC_API_KEY` を書かないこと（レビュー／grep）
- 本番: describe で secret 参照 + `GET /api/ai/usage` の `configured: true`（値は出さない）

## 知見

- L-017 / L-029 / L-1004: 秘密をログ・平文 env に出さない
- L-1002: README / `.env.example` / スクリプトの「任意・非空時 SM」契約を揃える
