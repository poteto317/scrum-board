# 設計: Cloud Run 秘密の Secret Manager 化

- 日付: 2026-11-22
- 対象: scrum-board #90
- ステータス: 承認済み（/feature 自動承認）

## 背景と問題

`scripts/deploy-gcp.sh` が `DB_PASSWORD` / `AUTH_PASSWORD` / `ADMIN_INITIAL_PASSWORD` を `--env-vars-file` で渡すため、Cloud Run リビジョン設定に平文で残る。README は Secret Manager 推奨だが、手順は平文注入だけ。

影響: プロジェクトでサービス設定を読める人が DB・Basic・初期 admin 秘密を読める。

## 完了条件（受け入れ）

検証対象は **サービスの最新リビジョン（現在トラフィックが向くテンプレート）** とする。過去リビジョンのメタデータに残る平文の完全消去は非目標（運用で不要リビジョン削除を推奨）。

- 最新リビジョンの設定に、対象パスワードが **平文の環境変数（`value:`）として出ない**（secret 参照であること）。
- `deploy-gcp.sh` が Secret Manager へ載せ、`--set-secrets` でマウントする。
- README に、Secret Manager 前提のデプロイ手順（作成・IAM・`--set-secrets`）がある。平文 `--env-vars-file` だけの手順を正本にしない。
- **本チケットの Done には、現行本番サービス（`scrum-board`）を最新リビジョンが secret 参照になるよう移行する作業を含む**（スクリプト変更のみでは完了にしない）。

検証: 移行後、`gcloud run services describe ... --format=yaml(spec.template.spec.containers[0].env)` に対象 3 キーの平文 `value:` が無く、secret 参照であること。

## 決めたこと（推奨案を採用）

| 事項 | 採用 | 却下 |
| --- | --- | --- |
| 対象秘密 | `DB_PASSWORD`, `AUTH_PASSWORD`, `ADMIN_INITIAL_PASSWORD` | 非秘密（`DB_USER` 等）まで SM 化 |
| 注入方式 | Secret Manager + Cloud Run `--set-secrets` | 平文 env のまま / 別の KMS ラッパー |
| シークレット名 | 値はシェル変数 `DB_PASSWORD` 等。SM **リソース名**は下表（`SECRET_ID_*` で上書き可） | 1 シークレットに JSON 詰め／上書き変数名に「値」を連想させる `SECRET_DB_PASSWORD` |
| `ensure_secret` | 未作成なら作成し、デプロイのたびに **新バージョンを add**（入力 env を載せる）。**最新版を読み戻して比較しない**（デプロイ実行主体に `secretAccessor`／versions.access を増やさない） | 読み比べてスキップ（デプロイ主体の読取権限が必要になる） |
| スクリプトの役割 | `ensure_secret` + ランタイム SA に `secretAccessor` + 平文 env 除去 + `--set-secrets` | 手動 UI のみ |
| 非秘密 env | `--env-vars-file`（`DB_USER`, `DB_NAME`, `DB_SOCKET`, `PUBLIC_ORIGIN`, `AUTH_USER`） | 全部 SM |
| 既存平文の除去 | `deploy` の後に `services update --remove-env-vars=...`（`--env-vars-file` と同 invoke 不可） | 古いリビジョンの歴史改ざん（不可） |
| 移行後のローテ | README に手順。検証は最新リビジョンに平文が無いことまで。値の強制ローテは推奨運用 | PR 内で必須の DB パスワード変更 |
| ANTHROPIC_API_KEY | 本チケット対象外 | 同時に SM 化 |

SM リソース名:

| 値の入力（シェル） | SM リソース名の既定 | リソース名の上書き |
| --- | --- | --- |
| `DB_PASSWORD` | `scrum-board-db-password` | `SECRET_ID_DB_PASSWORD` |
| `AUTH_PASSWORD` | `scrum-board-auth-password` | `SECRET_ID_AUTH_PASSWORD` |
| `ADMIN_INITIAL_PASSWORD` | `scrum-board-admin-initial-password` | `SECRET_ID_ADMIN_INITIAL_PASSWORD` |

## アプローチ比較（要約）

1. **SM + `--set-secrets`（採用）** — 完了条件を直接満たす。GCP 標準。
2. **外部シークレットストアのみ文書化** — スクリプトが平文のままでは完了条件未達。
3. **ビルド時埋め込み** — イメージ／履歴に残り悪化。

## 振る舞い

### `deploy-gcp.sh`

1. 従来どおり非秘密と 3 パスワード env を `require`（ローカル／CI から SM へ載せる材料）。`ADMIN_INITIAL_PASSWORD` ≠ `AUTH_PASSWORD` は維持。
2. ヘルパ `ensure_secret NAME VALUE`: 無ければ作成。あれば `versions add` で新バージョンのみ（**read しない**）。値を stdout/ログに出さない（L-017 / L-029）。パイプ／一時ファイルは直後に削除。
3. Cloud Run **ランタイム** SA（サービスに紐づくもの。未設定ならプロジェクトの Compute 既定 SA）へ各シークレットに `roles/secretmanager.secretAccessor` を付与（幂等）。デプロイ実行主体の権限はシークレット作成／versions.add に必要なもの（読取は不要）。
4. `--env-vars-file` から 3 パスワード行を削除（非秘密のみ）。
5. **デプロイ呼び出し**（gcloud は `--env-vars-file` と `--remove-env-vars` を同一 invoke で禁ずるため 2 段）:
   ```bash
   gcloud run deploy "$SERVICE_NAME" \
     ...既存の非秘密フラグ... \
     --env-vars-file="$ENV_VARS_FILE" \
     --set-secrets="DB_PASSWORD=${SECRET_ID_DB_PASSWORD}:latest,AUTH_PASSWORD=${SECRET_ID_AUTH_PASSWORD}:latest,ADMIN_INITIAL_PASSWORD=${SECRET_ID_ADMIN_INITIAL_PASSWORD}:latest"
   # only if describe shows plaintext value: for password keys (not secretKeyRef)
   gcloud run services update "$SERVICE_NAME" \
     --remove-env-vars=DB_PASSWORD,AUTH_PASSWORD,ADMIN_INITIAL_PASSWORD
   ```
   `--remove-env-vars` は平文が残るときだけ。secret 参照を消さない。
6. 先頭コメントとエコー案内を SM 前提に更新。秘密値は `***` のみ。

### README / `.env.example`

- デプロイ節: SM が正本。`export` した 3 パスワードは「スクリプトが SM に載せる一時入力」であり Cloud Run 平文には載らない。
- **L-1002:** 3 パスワードは `deploy-gcp.sh` が **毎回 require**（シード後もキーを残す）。`.env.example` も同契約。
- シークレット **リソース名**の既定と `SECRET_ID_*` 上書き。
- ランタイム SA への Accessor。
- 移行後のローテ推奨（Basic / DB / admin 初期）。
- 検証コマンド（最新リビジョン describe で平文 `value:` が無いこと）。
- **L-1001:** スモークは「Basic のみ → アプリ 401」「login は `ADMIN_INITIAL_PASSWORD`（または変更後の admin パスワード）」と分ける。

### 本番への適用（Done 必須）

実装後、**更新した `deploy-gcp.sh` のみ**で現行 `scrum-board` を移行する（別ワンショットや手組み `services update` は作らない）。古いリビジョンに平文が残っても、最新が secret 参照なら受け入れ可。不要リビジョン削除は README の推奨運用。

## 非目標

- Basic 廃止、IAM ユーザー認証
- 既存リビジョン履歴からの平文完全消去の保証
- Scheduler ジョブの Basic ヘッダの SM 化（別チケット可）
- `ANTHROPIC_API_KEY` の SM 化

## テスト方針

- スクリプトの静的確認: `bash -n`。env-vars-file にパスワードキーを書かないこと（レビュー／grep）。
- 移行後: `gcloud run services describe` で最新テンプレートの対象 3 キーが secret 参照で、平文 `value:` が無い。
- スモーク（値をログ・チャットに出さない）:
  1. `/health` → 200
  2. Basic（`AUTH_*`）のみで `/api/board` → アプリ 401（L-1001）
  3. Basic + login（`ADMIN_INITIAL_PASSWORD` または現 admin パスワード）+ Cookie で `/api/board` → 成功

## 知見

- L-029 / L-017: 秘密をログ・エラーに出さない。
- L-1002: README / `.env.example` とスクリプトの契約を揃える（両方 SM、毎回 require）。
- L-1001: AUTH と ADMIN は別シークレットのまま。
