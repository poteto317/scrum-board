# 本番へデータをデプロイ設計（カード #42）

## 背景

カード #41 で Cloud Run + Cloud SQL の空近い本番（スキーマ＋初期サンプル）を用意済み。カード #42 は **ローカル Compose MySQL に溜まったボードデータ（約 41 カード）を本番 Cloud SQL へ載せ替える**こと。手順の骨格は README「本番へのデータ移行」と #41 設計の「データ移行」節に既にある。本カードは **その手順の実行と、実行時に必要な安全策の明文化**が成果物。

## 決めたこと（ユーザー承認済み推奨）

| 事項 | 採用 |
|------|------|
| 本番データの扱い | **ローカル dump で本番 DB を置き換える**（現状は初期データのみ） |
| インポート手段 | **一時的な authorized network + `mysql` クライアント**（#41 試行と同じ） |
| オリジン置換 | インポート後に **`rewrite-origins`（先に `--dry-run`）**。`PUBLIC_ORIGIN=https://scrum-board-jkcejsb6ka-an.a.run.app` |
| 完了確認 | 本番 `GET /api/board`（Basic Auth）でカード件数がローカルと一致すること |

## スコープ

**含む**

1. ローカル `mysqldump`（`--databases`・utf8mb4・`--single-transaction`）
2. Cloud SQL（`scrumboard-mysql` / DB `scrumboard`）への上書きインポート
3. `backend/cmd/rewrite-origins` の dry-run → 本実行
4. 本番ボード件数の確認
5. 作業記録を `docs/production-deploy-status.md` の「ローカルデータの移行」を完了に更新（秘密は書かない）
6. 本カードの設計書・実装プラン（`docs/superpowers/specs|plans/2026-11-15-prod-data-deploy*.md`）の追加（秘密・dump なし）

**含まない**

- アプリコードの機能追加（既存 CLI の変更なし。README §2 の GCS 手順への全面寄せ替えは将来課題）
- Cloud SQL Auth Proxy の常設
- 本番 Basic Auth / DB パスワードのローテーション（作業用 root の再設定破棄は含む）
- ローカル DB の変更

## 手順（実行順序）

破壊的操作のため **検証 → 実行 → 再検証** の順を崩さない（L-001 / L-003）。  
ダンプは README「本番へのデータ移行」§1 に従う。インポートは README §2（GCS）ではなく、本設計の **authorized network + `mysql`（#41 試行と同じ）** を正とする。  
作業ディレクトリはリポジトリルート（`git rev-parse --show-toplevel`）。本番秘密をローカル `.env` に書き込まない（L-072）。  
手順 3〜5 の成否にかかわらず、**手順 6（authorized network 削除と一時ファイル削除）は必ず実行する**。

1. **前提確認**
   - 作業場所がリポジトリルートであること、`gcloud config get-value project` が `daily-routine-app-8a832` であること
   - ローカル: `GET http://127.0.0.1:4200/api/board` の `cards` 件数を記録（基準 `N`）
   - 本番: Basic Auth 付き `GET …/api/board` の件数を記録し、**初期サンプル規模（ローカルより大幅に少ない）**であることを確認してから上書きへ進む（L-003）
   - `gcloud sql instances describe scrumboard-mysql` で `RUNNABLE`・接続名 `daily-routine-app-8a832:asia-northeast1:scrumboard-mysql`・パブリック IP を確認
   - Cloud Run の `PUBLIC_ORIGIN` が `https://scrum-board-jkcejsb6ka-an.a.run.app` と一致
   - DB / Auth は Cloud Run 環境変数から取得し、**ログ・設計書・Git・チャットに値を出さない**（L-017 / L-028 / L-031）
2. **ダンプ**（README §1）
   - `mkdir -p backups`
   - `docker compose stop api`
   - README §1 どおり: `docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysqldump --default-character-set=utf8mb4 -uroot --single-transaction --databases "$MYSQL_DATABASE"' > "backups/scrumboard-cloud-$(date +%Y%m%d-%H%M%S).sql"`
   - 終了コード 0・ファイル非空・先頭に `CREATE DATABASE` を確認してから次へ（L-001）
   - dump は `backups/`（`.gitignore` 済み）。コミットしない
3. **インポート**（TCP・#41 方式）
   - 作業マシンの公網 IP を取得し、既存の `authorizedNetworks` を **全置換せず追記**する（L-072）。例: 現在の一覧を取得 → 自 IP `/32` を足して `--authorized-networks` を更新
   - SSL: インスタンスは `sslMode: ALLOW_UNENCRYPTED_AND_ENCRYPTED`（#41 試行時と同様）。クライアントは暗号化なし TCP で可。失敗時のみ `--ssl-mode=REQUIRED` を試し、それでもダメなら停止
   - **インポートユーザーは Cloud SQL `root` に固定**（`--databases` dump の `DROP`/`CREATE DATABASE` に必要。アプリユーザー `scrum` では不可）。root パスワード不明時は `gcloud sql users set-password root` で一時設定し、作業後に再設定してもよい（値は記録しない）
   - `mysql -h <Cloud SQL パブリック IP> -uroot … < dump.sql` で流し込む
   - 失敗時は手順 6 へ進み、状況報告して停止（勝手に再 import しない）
4. **rewrite-origins**
   - 同じ一時許可 IP の TCP で接続。`PUBLIC_ORIGIN` は手順 1 で Cloud Run から取得し一致確認した値を使う（リテラル固定禁止）。その他の環境変数例（値は出さない）:
     - `DB_USER=scrum` / `DB_PASSWORD=<Cloud Run の値>` / `DB_NAME=scrumboard` / `DB_ADDRESS=<パブリックIP>:3306`
     - （代替）`KANBAN_IMPORT_DSN='scrum:…@tcp(<IP>:3306)/scrumboard?parseTime=true'`
   - `cd backend && go run ./cmd/rewrite-origins --dry-run` → 成功後に本実行
   - 終了コード非 0 なら成功扱いしない（L-001）。失敗でも手順 6 は行う
5. **検証**
   - `docker compose start api` でローカル API 再開
   - 本番 `GET /api/board` のカード件数 ≈ `N`
   - ローカルにあった番号（例: 1, 2, 42）が本番に存在することを確認
6. **後始末**（成功・失敗どちらも）
   - 作業で追加した authorized network エントリだけを外す（他者の IP を消さない）
   - `/tmp` 等の資格情報ファイルを削除
   - 成功時のみ `docs/production-deploy-status.md` の移行節を DONE に更新

## リスクと対策

| リスク | 対策 |
|--------|------|
| 本番の現行データを消す | ユーザーが上書きを承認済み。本番は初期サンプルのみという前提を実行前に件数で再確認 |
| dump 失敗なのに import | 終了コードとファイル先頭を確認してから次へ（L-001） |
| 秘密の漏洩 | 資格情報をチャット・ドキュメント・コミットに載せない。コマンド出力でパスワードを echo しない |
| authorized network の取り残し | 成功・失敗どちらでも削除を試みる |
| localhost URL が残る | rewrite-origins 必須。dry-run で 0 件でも本実行して冪等確認 |

## 受け入れ条件

1. 本番ボードのカード件数が、ダンプ時点のローカル件数と実質一致する
2. `rewrite-origins` が成功終了している（dry-run 後の本実行）
3. 作業用 authorized network が残っていない
4. リポジトリに DB/Auth パスワードや dump 本体をコミットしていない
5. `docs/production-deploy-status.md` に移行実施済みが記録されている

## 対象外の再掲

コード変更による新 CLI・GCS 自動化・CI からの定期移行、README §2 の GCS 手順への寄せ替えは本カードの範囲外。

## 知見（手順 4）

関係する優先度 A: **L-001**（成否を見ないで成功扱い）、**L-003**（検証より先の破壊）、**L-017 / L-028 / L-031**（秘密の露出）、**L-072**（手順が既存設定を壊す・authorized networks の全置換禁止）。優先度 B: 運用スクリプトの終了コード取り扱い。

## レビュー済み

- 初回レビュー指摘（README とのインポート手段の食い違い、DSN 未記載、L-072/L-003 の手順落とし込み、root 固定、失敗時後始末、SSL）を本文へ反映済み。
