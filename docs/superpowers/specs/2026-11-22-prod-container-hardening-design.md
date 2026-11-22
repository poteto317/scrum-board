# 本番コンテナ hardening（#103）

## 決めたこと

| 事項 | 採用 |
|------|------|
| API プロセス | `app` ユーザーで起動（`su`）。`/server` は `root:app` + `chmod 550`。nginx/htpasswd は entrypoint 冒頭のみ root |
| ベースイメージ | `node` / `golang` / `nginx` を **digest 固定** |
| デプロイタグ | `git rev-parse HEAD` を Artifact Registry に pushし、**Cloud Run は SHA タグを参照**（`:latest` も併記 push 可） |
| HTTP 起動確認 | `wget` をやめ `curl -sf`（1 パッケージに統一） |
| 検証 | `scripts/check-deploy-image-hardening.sh` |

## 受け入れ条件

Dockerfile に digest と `app` 用の権限設定があり、deploy スクリプトが SHA タグを push/deploy する。