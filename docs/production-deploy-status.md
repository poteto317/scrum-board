# 本番デプロイ試行記録（2026-11-15）

## ステータス: DONE

## 成果

| 項目 | 値 |
| --- | --- |
| GCP プロジェクト | `daily-routine-app-8a832` |
| リージョン | `asia-northeast1` |
| Cloud SQL | `scrumboard-mysql`（MySQL 8.4、`db-f1-micro`、`--edition=enterprise`） |
| 接続名 | `daily-routine-app-8a832:asia-northeast1:scrumboard-mysql` |
| Cloud Run サービス | `scrum-board` |
| 公開 URL | `https://<your-cloud-run-url>`（実 URL・認証情報はリポジトリ外の Cloud Run 環境変数等で管理する） |
| Artifact Registry | `asia-northeast1-docker.pkg.dev/daily-routine-app-8a832/scrum-board/app:latest` |
| Basic Auth ユーザー | `<basic-user>`（パスワードは Cloud Run 環境変数 `AUTH_PASSWORD` のみ。Git・本ファイルには記載しない） |

### スモーク（試行時）

- `GET /api/board`（Basic Auth あり）: **200**（列・サンプルカード JSON）
- `GET /api/public-config`（Basic Auth あり）: **200**（`publicOrigin` がサービス URL と一致）
- `GET /api/board`（認証なし）: **401**
- `GET /health`（認証なし）: **200**（Cloud Run は `/healthz` を予約するためパスを `/health` に変更）

`PUBLIC_ORIGIN` はデプロイ後に `gcloud run services update ... --update-env-vars PUBLIC_ORIGIN=<サービス URL>` で更新済み。

## 実施した作業

1. API 有効化: `run`, `sqladmin`, `artifactregistry`, `servicenetworking`
2. Cloud SQL インスタンス・DB `scrumboard`・ユーザー `scrum` 作成
3. スキーマ `database/init/001_schema.sql` をパブリック IP + 一時的な authorized network 経由でインポート
4. `scripts/deploy-gcp.sh` で amd64 イメージをビルド・push・Cloud Run デプロイ

## 残課題・注意

1. **秘密情報**: DB / Auth パスワードは試行時に生成し Cloud Run にのみ設定。ローテーションはコンソールまたは `gcloud run services update` で行う。
2. **スキーマ取り込み**: 本番では GCS `gcloud sql import` または Cloud SQL Auth Proxy + `gcloud auth application-default login` を推奨（試行では ADC 未設定のため TCP インポートを使用）。
3. **コスト**: `scrumboard-mysql` は RUNNABLE のまま。**試験終了後は README の停止・削除手順を実行すること。**
4. **Apple Silicon**: イメージは `docker build --platform linux/amd64` が必須（スクリプトに反映済み）。
5. **ヘルスパス**: Cloud Run 予約のため `/health`（`/healthz` 不可）。

## ローカルデータの移行

**移行ステータス: DONE（2026-11-15）** — カード #42

詳細手順の正本: README「本番へのデータ移行」§1（dump）+ `docs/superpowers/specs/2026-11-15-prod-data-deploy-design.md`（TCP インポート。README §2 の GCS ではない）。

| 項目 | 値 |
| --- | --- |
| 手段 | ローカル `mysqldump` → Cloud SQL パブリック IP + authorized network + Docker `mysql` クライアント（root）→ `rewrite-origins` |
| ローカル件数 | 41 |
| 本番件数（移行後） | 41（Basic Auth 付き `GET /api/board`） |
| `rewrite-origins` | dry-run 1 match → 本実行 1 row updated |
| dump | `backups/scrumboard-cloud-*.sql`（gitignore・非コミット。作業後 `git status` で未追跡を確認） |
| authorized network | 当回は既存 IP で足りたため追記・削除操作は不要（設計の追記→削除手順は未使用） |
| root 一時パスワード | 作業後に再設定し破棄 |
| スモーク | Basic Auth 付き board 件数 41、カード番号 1 / 2 / 42 存在確認、`GET /api/public-config` の `publicOrigin` 一致、認証なし `/api/board` が 401 |

秘密（DB / Auth / root 一時パスワード）はドキュメント・Git に記載しない。
