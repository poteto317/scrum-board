# 設計: 初期 admin パスワードと Basic 認証の分離

- 日付: 2026-11-22
- 対象: scrum-board #89
- ステータス: 承認済み（/feature 自動承認）

## 背景と問題

本番 nginx の Basic 認証（共有 1 組 `AUTH_USER` / `AUTH_PASSWORD`）と、起動時シードの初期 admin が同じ環境変数から作られる。初回パスワード変更の強制もない。

2 人目以降に Basic パスワードを渡すと、admin がアプリ側パスワードを変えていなければ同じ値で admin ログインでき、ロール・ACL が実質無効になる。

## 完了条件（受け入れ）

検証範囲は **新規シード後（users が空のデプロイ／再構築）** とする。既にシード済みの既存 DB はコード対象外（運用で admin パスワード変更）。

- 新規シード後、Basic の資格情報（`AUTH_USER` / `AUTH_PASSWORD`）だけではアプリの admin としてログインできない。
- 新規デプロイ（users が空）では、初期 admin のパスワードが Basic と別変数から設定される。
- README / `.env.example` / `deploy-gcp.sh` の手順・注入が、Basic と初期 admin の秘密を分けて書く。

## 決めたこと（推奨案を採用）

| 事項 | 採用 | 却下 |
| --- | --- | --- |
| 方針 | **初期 admin 用に `ADMIN_INITIAL_PASSWORD` を新設**し、シードはこれを使う | 初回ログイン強制変更のみ（UI・フラグ追加が重い。本チケットの「まず変数分離」を優先） |
| login_name | 従来どおり **`AUTH_USER`**（表示名も同じ） | 別 `ADMIN_INITIAL_USER`（今回の完了条件に不要） |
| nginx / htpasswd | 従来どおり **`AUTH_USER` / `AUTH_PASSWORD` のみ**（`deploy/entrypoint.sh` は変更しない） | Basic を廃止・IAM 化 |
| users=0 時の必須 | `AUTH_USER` と `ADMIN_INITIAL_PASSWORD` が非空。欠如は起動失敗（fail-closed, L-462 系） | `AUTH_PASSWORD` へのフォールバック（旧バグを温存するため禁止） |
| パスワードの正規化 | `ADMIN_INITIAL_PASSWORD` / 比較用 `AUTH_PASSWORD` は **Trim しない**（空文字のみ未設定）。L-752 の TrimSpace は **login 識別子 `AUTH_USER` にのみ適用**（パスワードは意図的例外） | パスワードも TrimSpace |
| 同一値の拒否 | シード時、`AUTH_PASSWORD` が非空かつ `ADMIN_INITIAL_PASSWORD` と **バイト一致**なら起動失敗。エラー文言にパスワード値は出さない（L-017） | 警告だけで通す |
| 既存 DB | 自動マイグレーションや一括パスワード再ハッシュは **しない**。既に同一パスワードの環境は運用で変更 | 起動時に既存 admin を書き換える |
| API Basic セッションレス案 | 本変更の対象外（別仕様）。シードだけ分離 | — |

## アプローチ比較（要約）

1. **変数分離（採用）** — シードと nginx の秘密を切る。変更点が小さく完了条件を直接満たす。
2. **初回強制変更** — フラグ列・ログイン API・UI が必要。完了条件は満たせるが本チケット範囲を超える。
3. **両方** — 防御は厚いがスコープ過大。将来余地として非目標に残す。

## 振る舞い

### `SeedAdminFromEnv`

`users` 件数 > 0 → 従来どおり no-op（`AUTH_*` / `ADMIN_*` 欠如可）。

`users` == 0:

1. `login := TrimSpace(AUTH_USER)`、`adminPass := ADMIN_INITIAL_PASSWORD`（Trim しない。パスワードは空白有意、L-752 は識別子向け。空判定のみ）。
2. `login == ""` または `adminPass == ""` → `ErrAuthSeed`（メッセージに変数名のみ。値は含めない）。
3. `basicPass := AUTH_PASSWORD` が非空かつ `adminPass == basicPass` → `ErrAuthSeed`（「must differ from AUTH_PASSWORD」等の固定文言。値は出さない）。
4. `adminPass` を bcrypt ハッシュし、`role=admin` で 1 行 INSERT。

`AUTH_PASSWORD` はシードのハッシュ材料に使わない。

### ドキュメント・設定例とデプロイ注入

- `.env.example`: `ADMIN_INITIAL_PASSWORD=` を追記し、Basic と別値にすること・シード後はアプリ側で変更可能な旨を短く書く。
- `README.md` の Cloud Run / デプロイ節: `export ADMIN_INITIAL_PASSWORD=...` を追加。login 例の `-d` パスワードは `$ADMIN_INITIAL_PASSWORD`（または「admin の現在のパスワード」）にし、Basic の `$AUTH_PASSWORD` と混同しない。
- **`scripts/deploy-gcp.sh`（必須配線）**: `require ADMIN_INITIAL_PASSWORD` を追加し、`--env-vars-file` に `ADMIN_INITIAL_PASSWORD` を注入する（`AUTH_*` と同列）。未注入のまま空 DB へデプロイするとシードで起動失敗するため、エコー例だけでなく **require + env-vars-file** まで含める。Secret Manager を使う場合は `AUTH_PASSWORD` と `ADMIN_INITIAL_PASSWORD` を別シークレットにする（スクリプトが `--set-secrets` を使うなら同様に分ける。現状が env-vars-file ならそちらに載せる）。秘密をログに平文で出さない既存方針は維持。

### 既存本番の確認（運用メモ・コード外）

カード記載どおり、本番 admin が Basic と同じ値かを確認し、同じなら admin パスワードを変更する。本 PR のコードは新規シードと文書を直す。

## 非目標

- 初回ログイン時のパスワード変更強制 UI / DB フラグ
- nginx Basic の廃止、ユーザーごとの Basic
- 既存 users 行の自動パスワード更新
- セッション認証フロー自体の変更

## テスト方針

- 単体（MySQL）: シードが `ADMIN_INITIAL_PASSWORD` をハッシュし、`AUTH_PASSWORD` では照合できないこと。
- users=0 で `ADMIN_INITIAL_PASSWORD` 欠如 → エラー（変数名あり・値なし）。
- users=0 で両パスワード同一 → エラー。
- users>0 で両変数欠如 → no-op 成功（既存テスト維持）。
- 再シードで件数が増えないこと（既存）。

## 知見との対応

- L-462: users=0 で必須欠如は fail-closed（フォールバック禁止）。
- L-017: エラーにパスワード値を出さない。
- L-752: 識別子 `AUTH_USER` のみ TrimSpace。パスワードは L-752 の「認証情報も Trim」から意図的に外し、空判定のみ（空白だけのパスワードは「設定済み」として通し、同一値比較も生バイト）。

## 触れない理由（第2周レビュー用メモ）

- 強制変更は完了条件に対して過大。変数分離で受け入れを満たす。
- 既存 DB の自動書き換えは誤って全環境の admin をロックアウトしうるため運用手順に委ねる。
