# htpasswd 標準入力化（#105）設計

## 背景

`deploy/entrypoint.sh` が `htpasswd -bc` で Basic 用 `.htpasswd` を作るため、`AUTH_PASSWORD` がプロセス一覧の引数に露出する。ハッシュも既定の apr1（MD5 系）。

## 目的

- パスワードを **プロセス引数に載せない**（受け入れ条件）。
- 可能なら **bcrypt**（`-B`）で保存する。
- `.htpasswd` の権限を絞る（nginx の worker が読める最小）。

## スコープ外

- Basic 認証方式の廃止、Secret Manager 配線の変更。
- Go 側パスワード処理（#105 以前の分離済み）。

## 決めたこと

| 項目 | 選択 |
|------|------|
| 入力 | `printf '%s\n' "$AUTH_PASSWORD" \| htpasswd -i ...`（`-b` 禁止） |
| ハッシュ | `-B -C 10`（本番イメージは `nginx:1.28-alpine` + `apache2-utils`、bcrypt 検証済み） |
| 新規作成 | 起動ごとに `-c` で再生成（コンテナは無状態） |
| 権限 | `umask 077`、作成後 `chown root:nginx` + `chmod 640`（worker が読める） |
| ガード | 既存 `check-deploy-image-hardening.sh` に禁止/必須パターンを追加 |

## 検証

- `./scripts/check-deploy-image-hardening.sh`
- ローカルで `htpasswd -i -B` が bcrypt 行（`$2y$`）を出すこと（Docker で確認済み）