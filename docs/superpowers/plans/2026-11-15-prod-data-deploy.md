# 本番へデータをデプロイ実装プラン（カード #42）

> **For agentic workers:** 設計書 `docs/superpowers/specs/2026-11-15-prod-data-deploy-design.md` に従う。**アプリコードは変更しない。** コミットは `/feature` では行わない。秘密（DB/Auth パスワード）をログ・ドキュメント・チャットに出さない。

**Goal:** ローカル MySQL のボードデータを Cloud SQL へ載せ、`rewrite-origins` 後に本番ボード件数がローカル基準と一致する。

**Architecture:** dump（Compose）→ TCP import（Cloud SQL root + 一時 authorized network）→ `rewrite-origins`（`scrum` + `PUBLIC_ORIGIN`）→ 件数検証 → authorized network 削除。

**Tech stack:** Docker Compose, mysqldump, gcloud, mysql client, Go `cmd/rewrite-origins`

**知見:** L-001, L-003, L-017, L-028, L-031, L-072

---

## ファイルマップ

| パス | 責務 |
|------|------|
| `backups/scrumboard-cloud-*.sql` | ローカル dump（gitignore・コミットしない） |
| `docs/production-deploy-status.md` | 移行 DONE の記録のみ更新 |
| （実行のみ）`backend/cmd/rewrite-origins` | 既存 CLI |

---

### Task 1: 前提確認と基準件数

**Steps:**

1. `cd "$(git rev-parse --show-toplevel)"`。`gcloud config get-value project` が `daily-routine-app-8a832`。
2. ローカル `GET http://127.0.0.1:4200/api/board` → `cards` 件数 `N` を記録。
3. Cloud Run から `AUTH_*` / `DB_*` / `PUBLIC_ORIGIN` を取得し `/tmp` mode 600 のみへ（値は表示しない）。**ローカル `.env` には書かない**（L-072）。
4. `PUBLIC_ORIGIN` が `https://scrum-board-jkcejsb6ka-an.a.run.app` と一致することを確認。不一致なら停止。
5. 本番 Basic Auth 付き board 件数 `P` を記録。`P << N`（初期サンプル）でなければ停止（L-003）。
6. `gcloud sql instances describe scrumboard-mysql` で `RUNNABLE`・接続名 `daily-routine-app-8a832:asia-northeast1:scrumboard-mysql`・パブリック IP・既存 authorizedNetworks を記録。

**Done when:** `N`・`P`・パブリック IP・既存 networks・PUBLIC_ORIGIN 一致が確認でき、上書きしてよい。

---

### Task 2: ローカル dump

**Steps:**

1. `mkdir -p backups`
2. `docker compose stop api`
3. README §1 どおり mysqldump を `backups/scrumboard-cloud-$(date +%Y%m%d-%H%M%S).sql` へ
4. `echo $?` 相当で成功確認、`wc -c` 非空、`head` に `CREATE DATABASE` があること
5. 失敗なら api を start して停止（import しない）

**Done when:** 検証済み dump ファイルパスが決まっている。

---

### Task 3: authorized network 追記 + Cloud SQL import

**Steps:**

1. 公網 IP 取得（例: `curl -4 -s ifconfig.me`）
2. 既存 networks に自 IP `/32` を **追記**して `gcloud sql instances patch scrumboard-mysql --authorized-networks=...`（全消し禁止・L-072）
3. Cloud SQL `root` で接続確認。不可なら `gcloud sql users set-password root --host=% --password=...`（値非表示）
4. ホストに `mysql` が無ければ `docker run --rm -i mysql:8.4 mysql -h …` で同等。`MYSQL_PWD=…` 経由で `mysql -h <IP> -uroot --default-character-set=utf8mb4 < dump.sql`。失敗時は `--ssl-mode=REQUIRED` を一度試し、それでもダメなら Task 5 へ
5. 終了コード確認。成功時は任意で `SELECT COUNT(*) FROM cards` 相当を root で確認。失敗なら **必ず Task 5** の後に報告

**Done when:** import 終了コード 0（または Task 5 後に停止報告済み）。

---

### Task 4: rewrite-origins + 本番検証

**Steps:**

1. Task 1 で確認した `PUBLIC_ORIGIN` を export（固定リテラルではなく取得値）
2. `DB_USER=scrum` `DB_PASSWORD=…` `DB_NAME=scrumboard` `DB_ADDRESS=<IP>:3306`（代替: `KANBAN_IMPORT_DSN`）
3. `cd backend && go run ./cmd/rewrite-origins --dry-run`（exit 0。一致 0 件でも次へ）
4. `go run ./cmd/rewrite-origins`（exit 0。冪等確認のため dry-run 0 件でも本実行）
5. 失敗時も **必ず Task 5** を実行してから停止報告（L-001）
6. `docker compose start api`
7. 本番 board 件数 ≈ `N`、カード番号 1 / 2 / 42 が存在

**Done when:** 検証 OK（または Task 5 後に停止報告済み）。

---

### Task 5: 後始末と status 更新

**必須:** Task 3・4 の成否にかかわらず実行する。

**Steps:**

1. 作業で追加した authorized network のみ削除（既存エントリは残す）
2. `/tmp` の資格情報ファイル削除。シェルから `DB_PASSWORD` / `AUTH_PASSWORD` / `MYSQL_PWD` を unset
3. `git status` で `backups/`・秘密ファイルが追跡対象になっていないことを確認（受け入れ 4）
4. 成功時のみ: `docs/production-deploy-status.md` の移行節を実施済みに更新（日時・件数・手段。秘密なし）
5. ローカル api が止まっていれば start

**Done when:** networks が作業前相当、秘密ファイルなし、成功時は status 更新済み。

---

## 検証コマンド（まとめ）

```sh
# ローカル件数
curl -sS http://127.0.0.1:4200/api/board | python3 -c 'import sys,json; print(len(json.load(sys.stdin)["cards"]))'
# 本番件数（Basic Auth は環境から。値を echo しない）
# rewrite-origins dry-run / 本実行の exit code
```

## サブエージェントレビュー済み

- 初回: PUBLIC_ORIGIN 一致確認・SSL・rewrite 失敗時後始末・dry-run 0 件でも本実行・`.env` 禁止・受け入れ 4 の git status を追記済み。
