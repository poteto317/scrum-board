# 本番デプロイ設計

## 背景

カード #41「本番デプロイ」。スマホ／タブレットから同じかんばんを見たい。環境は未決だったが、現行が MySQL であることと Google AI Pro の GCP クレジット（月額相当）を優先し、GCP を第一候補とする。現状 API に認証がなく、Compose は `127.0.0.1` のみ公開（`docs/api.md`）。インターネットへ出す前に認証が必須。

## 決めたこと（推奨を採用）

| 事項 | 採用 |
|------|------|
| ホスティング | **GCP: Cloud Run + Cloud SQL for MySQL**（Vercel+Supabase/Firebase は見送り） |
| アクセス制御 | **共有 Basic Auth**（ユーザー／パスワード。未設定なら本番起動失敗） |
| localhost 置換 | **DB 内テキストの `http://127.0.0.1:4200` / `http://localhost:4200` を本番オリジンへ置換** |
| `{{url}}` | **本番オリジンになること**（下記） |
| 完了条件 | **本番に載せ、認証付きでボードを開ける** |

### `{{url}}` の本番オリジン

現状フロントは `window.location.origin` で `cardDetailUrl` を組み立てている。次を仕様化する。

1. **本番では `PUBLIC_ORIGIN` 必須**（例: `https://scrum-xxxxx-an.a.run.app`）。未設定なら本番エントリポイントは起動失敗
2. 受け渡しは **`GET /api/public-config`** → `{ "publicOrigin": "<PUBLIC_ORIGIN または空文字>" }` のみ（ビルド時埋め込みはしない）
3. フロントのコピー（リンク／コマンドの `{{url}}`）は、`publicOrigin` が非空ならそれを優先し、空なら `window.location.origin`
4. ローカル Compose は `PUBLIC_ORIGIN` 未設定 → API は `publicOrigin: ""` → 従来どおり `location.origin`

## アーキテクチャ

```
[スマホ/PC] --HTTPS--> Cloud Run (nginx: 静的FE + /api proxy + Basic Auth)
                            |
                            +--> 同一サービス内の Go API（LISTEN 内部のみ）
                            |
                            v
                     Cloud SQL MySQL 8.x（Unix ソケット）
```

- **1 Cloud Run サービス**に FE（nginx）と API（Go）を同居させる（コストと運用を単純化）。既存 `frontend/nginx.conf` の `/api/` プロキシを踏襲し、upstream を同コンテナの localhost API にする。
- **Cloud SQL** は既存スキーマのまま。接続は **Cloud Run の Cloud SQL 接続（Unix ソケット）のみ**（別プロセスの Auth Proxy は使わない）。
- **Basic Auth** は nginx で `/api` を含む通常パスに適用。認証情報は Cloud Run 環境変数または Secret（Git に載せない）
- **起動ガードの切替:** 本番エントリポイント（例: `deploy/entrypoint.sh` / 本番 Dockerfile `CMD`）だけが `AUTH_USER`・`AUTH_PASSWORD`・`PUBLIC_ORIGIN` の非空を要求し、欠ければ exit 1。ローカル Compose の既存 `api` / `web` エントリはチェックしない（認証なし・`PUBLIC_ORIGIN` なしのまま）
- **ヘルスチェック:** Cloud Run のプローブは **`GET /health` のみ Basic Auth 除外**（nginx で `location = /health` を auth 外・200 固定）。それ以外は認証必須。プローブに認証を付けない。**注:** Cloud Run は `/healthz` など末尾 `z` の一部パスを予約するため `/health` を使う
- **AI 起票**（`ANTHROPIC_API_KEY`）は任意。本番でも未設定なら既存どおり当該 API のみ 503。設定する場合は料金上限を Anthropic 側で管理

## データ移行

1. ローカル（または現行 DB）から `mysqldump`（またはアプリのエクスポート手段があればそれ）で取得
2. Cloud SQL へインポート
3. **オリジン置換**（ワンショット CLI）: **`PUBLIC_ORIGIN` 非空必須**（空・未設定なら更新せず終了コード非0）。次のカラムだけを対象に、`http://127.0.0.1:4200` と `http://localhost:4200`（末尾スラッシュ有無どちらも）を `PUBLIC_ORIGIN`（末尾スラッシュなし）へ置換する。  
   - `cards.description`  
   - `cards.title`  
   - `card_history.note`  
   - `card_history.evidence_url`（localhost ボード URL が入っている場合のみ。GitHub URL はパターン外のため無変更）  

   - `command_templates.template`（`{{url}}` プレースホルダはそのまま。展開済み localhost のみ置換）  
   **除外:** PR URL 列、数値・日時列  
4. ログは「一致件数」と「更新件数」を分ける。**DB 接続失敗・引数不正は非0終了**（一致 0 件の成功と混同しない）。`--dry-run` は更新せず一致件数のみ（成功の空は exit 0）

## デプロイ成果物（リポジトリ）

実装プランでは次の責務ブロックに分ける（1 PR でよいがコミット／タスクは分割）。

1. **アプリ:** 同居 Docker・nginx Basic Auth・`/health`・`GET /api/public-config`・FE のコピー経路・起動ガード・ユニットテスト  
2. **データ移行:** dump／インポート手順とオリジン置換 CLI  
3. **GCP 運用:** `gcloud` 手順・README（認証・料金・停止・スマホでの開き方）・`.env.example` の変数名のみ

## コスト想定

- 低トラフィック個人利用を前提。Cloud SQL 最小クラス（例: `db-f1-micro`）＋ Cloud Run の少ないリクエストが月額クレジット枠に収まるかを手順で確認し、超えそうなら停止手順を README に書く
- 実額はリージョンとストレージに依存するため、デプロイ時に見積を確認する

## 受け入れ条件

1. 本番 URL を開き、Basic Auth 後にボードが見られる（スマホ可）
2. 認証なし／誤パスワードでは API・画面とも拒否
3. 本番画面でコマンド／リンクコピーすると、組み立て URL のオリジンが設定した `PUBLIC_ORIGIN` と一致する（`GET /api/public-config` 経由）
4. DB 内の対象カラムの localhost ボード URL が本番オリジンに置換済み（該当が無ければ置換 0 件でよい）
5. ローカル Compose の既定（127.0.0.1・認証なし・`PUBLIC_ORIGIN` なし）は維持
6. Cloud Run ヘルスチェック（`/health`）は認証なしで 200
## 対象外

- Vercel / Supabase / Firebase への移行
- 複数ユーザー・OAuth・ロール分け（共有パスワードで足りる）
- CDN・カスタムドメイン（後続可。まずは `*.run.app`）
- Anthropic キーの必須化
- リポジトリの Public 化（別チェック）

## 知見

- L-462: 本番で認証未設定フォールバックを置かない（空なら起動失敗）
- L-002: 置換 CLI の接続失敗／引数不正と「一致 0 件」を同じ成功にしない。FE のコピーは通信失敗時も `location.origin` へフォールバックする（#43。空成功と同じ結果だが、失敗はキャッシュせず次の resolve で再取得）
- 公開ネットワークへの無認証 API は現行 docs の禁止事項

## リスクと緩和

| リスク | 緩和 |
|--------|------|
| Cloud SQL がクレジットを食う | 最小インスタンス、不要時停止手順 |
| Secret の Git 混入 | Secret Manager / 実行時 env。public-release-check |
| 実デプロイに課金・権限が要る | 手順とスクリプトをリポに残し、`gcloud` で作成。失敗時は残課題をカード／PR に明記 |
