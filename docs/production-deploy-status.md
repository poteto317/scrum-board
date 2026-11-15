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
| 公開 URL | https://scrum-board-jkcejsb6ka-an.a.run.app |
| Artifact Registry | `asia-northeast1-docker.pkg.dev/daily-routine-app-8a832/scrum-board/app:latest` |
| Basic Auth ユーザー | `kanban`（パスワードは Cloud Run 環境変数のみ。Git・本ファイルには記載しない） |

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

ローカル dump → Cloud SQL インポート → `backend/cmd/rewrite-origins`（`--dry-run` 後本実行）は README「本番へのデータ移行」を参照。本番試行では初期 SQL のみ投入（ローカル dump は未実施）。