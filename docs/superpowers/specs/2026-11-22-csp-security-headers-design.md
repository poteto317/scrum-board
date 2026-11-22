# セキュリティヘッダー CSP（#102）

## 決めたこと

| 事項 | 採用 |
|------|------|
| 配信 | `deploy/nginx.conf`（本番）と `frontend/nginx.conf`（compose）の `add_header` |
| CSP | `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; form-action 'self'; worker-src 'self' blob:` |
| style unsafe-inline | Angular コンポーネントスタイルに必要 |
| server_tokens | `off`（server ブロック） |
| index.html | 同内容の `meta http-equiv`（ng serve 等の防御層） |
| 検証 | `scripts/check-nginx-tls-headers.sh` を拡張して CSP・server_tokens を grep |

## 受け入れ条件

本番テンプレに CSP と `server_tokens off` があり、チェックスクリプトが通る。

## 知見

- **L-044**: 外部 CDN なし、同一オリジンのみ。