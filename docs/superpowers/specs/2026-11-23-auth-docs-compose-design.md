# 認証文書と Compose 初期 admin（#108）

## 背景

`SECURITY.md`・README の一部・`compose.yaml` 冒頭・`.env.example` が「API に認証はない」と書くが、実装はセッションログイン、admin/member、アイテム ACL がある。空の users では `AUTH_USER` + `ADMIN_INITIAL_PASSWORD` が必須で、Compose が渡さないと新規 DB で API 起動に失敗する。

## 受け入れ条件

1. `SECURITY.md` が現行の認証・認可（Cookie セッション、アプリ Basic、ロール、ACL、本番 nginx Basic）とローカル／本番の注意を書く。**L-1001:** edge Basic（`AUTH_*`）とアプリ初期 admin（`ADMIN_INITIAL_PASSWORD`）の分離と同値禁止を明記する。
2. `compose.yaml` の API サービスに `AUTH_USER` / `ADMIN_INITIAL_PASSWORD` を渡し、空 DB でもシードできる（`AUTH_PASSWORD` を載せる場合は admin と別値）。
3. `.env.example` が「認証なし」をやめ、ローカル用の初期 admin 変数を示す（本番用コメントと区別。同値を示唆しない）。
4. README の「認証なし」記述を現行に合わせる（最短起動節は既に正しい部分を維持し、矛盾する節だけ直す）。

## 決めたこと

| 事項 | 選択 |
|------|------|
| Compose 既定 | `AUTH_USER=admin`、`ADMIN_INITIAL_PASSWORD=local_dev_admin`（≥8 文字）。`AUTH_PASSWORD` はキーを `${AUTH_PASSWORD:-}` で渡してよいが既定は空（ローカルに nginx Basic 無し。値を入れるなら admin と別値） |
| SECURITY.md 言語 | 英語を維持しつつ内容を現行実装に合わせる |
| スコープ外 | 認証実装の変更、公開免除 API 一覧の完全列挙（OpenAPI へ誘導） |

## 知見

- L-1001: Basic と admin 初期パスワードを分離（文書・Compose 例で同値にしない）
- L-203: 文書と実装の食い違いを直す

## 検証

- 対象ファイルから「API に認証はない」等の矛盾文言が消えること
- Compose / `.env.example` のローカル例で `ADMIN_INITIAL_PASSWORD` ≠ `AUTH_PASSWORD`（後者を載せる場合）
- `docker compose config` で API に `AUTH_USER` と `ADMIN_INITIAL_PASSWORD` が載ること