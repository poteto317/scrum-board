# nginx による API / 静的配信の gzip 圧縮

## 背景

カード #113 は、本番・ローカルの nginx に gzip が無く、Go API 側にも圧縮が無いため、`GET /api/board`（全アイテムの説明・ソリューション込み、画面表示中 5 秒ポーリング）と JS/CSS が無圧縮で配られている問題を扱う。見積もりではアイテム数百件で応答が大きく、モバイル回線と Cloud Run の下り転送に効く。

Cloud Run の Google Frontend が自動で gzip しているかは、**本文が `gzip_min_length` を超える応答**で確認する（`/health` は 2 バイト程度のため判定に使わない）。実装前の観測では、少なくともコンテナ設定に gzip が無く、完了確認はデプロイ後に認証付きの `/api/board` とハッシュ付き JS で `Content-Encoding: gzip` を見る。

## 決めたこと

| 事項 | 採用 |
|---|---|
| 圧縮の場所 | **nginx のみ**（`deploy/nginx.conf` と `frontend/nginx.conf`）。Go ハンドラには圧縮ミドルウェアを入れない（二重圧縮・CPU の二重消費を避ける） |
| 対象 Content-Type | `application/json`、`application/javascript`、`text/javascript`、`text/css`、`text/plain`、`text/xml`、`application/xml`、`image/svg+xml` |
| プロキシ応答 | `gzip_proxied any` を必須（上流 Via があっても **プロキシ経由の応答**を圧縮）。静的 JS/CSS の圧縮は `gzip on` + `gzip_types` による（`gzip_proxied` は静的の必須条件ではない） |
| 最小長 | `gzip_min_length 256`（極小応答の圧縮コストを避ける。`/health` は検証対象外） |
| 圧縮レベル | `gzip_comp_level 5` |
| API バッファ | **`location /api/` のみ**に `proxy_buffering on` と十分な `proxy_buffers` / `proxy_buffer_size`。login（`location = /api/auth/login`）は小さな JSON のため buffer 拡大は不要 |
| 静的アセット | ビルド成果の on-the-fly gzip。`.gz` 事前生成や `gzip_static` は対象外 |
| 画像・バイナリ | JPEG/PNG/WebP 等は `gzip_types` に入れない |
| 契約ガード | `scripts/check-nginx-gzip.sh` を新設し、`deploy` と `frontend` の両 conf で必須行を検査。`--selftest` で必須行欠落 fixture が失敗することを固定し、CI `deploy-guards` に載せる（L-1051） |
| 既存契約 | `deploy/nginx.conf` の TLS 関連（HSTS・Forwarded-Proto）・CSP・`server_tokens`・`/api` の `auth_basic off` を壊さない。`frontend/nginx.conf` は現状ある CSP 等を維持（HSTS はもともと無いので追加しない） |

## 目的と受け入れ条件

1. 本番 `deploy/nginx.conf` で gzip が有効で、カード指定の `gzip_types`（JSON・JS・CSS・`image/svg+xml`）が載る。手動完了確認の対象は #8 の board と JS のみ（SVG は設定契約で担保）。
2. `gzip_proxied any` と `gzip_vary on` があり、Cloud Run 経由の **API プロキシ応答**が圧縮される。
3. `location /api/` の proxy バッファが大きな board JSON を想定した値になっている（login ブロックは対象外）。
4. ローカル用 `frontend/nginx.conf` にも同等の gzip と `location /api/` の buffer が入る。
5. Go コードに圧縮ミドルウェアを追加しない。
6. `deploy/nginx.conf` の既存契約（HSTS・CSP・Forwarded-Proto・`auth_basic off` on `/api`）と、`frontend/nginx.conf` の既存 CSP 等を壊さない。
7. CI で gzip 関連の必須行欠落が `--selftest` 込みで失敗する。
8. 完了確認（デプロイ後・パス別）:
   - `GET /api/board`: アプリセッション cookie またはアプリ Basic（edge Basic だけでは不足。`/api/` は `auth_basic off`）。`Accept-Encoding: gzip` で `Content-Encoding: gzip`。
   - JS: edge Basic（`-u`）で `index.html` が参照するスクリプトのうち、ビルド成果の `main-*.js`（ハッシュ付き）を 1 本以上。`Accept-Encoding: gzip` で `Content-Encoding: gzip`。
   - `/health` は gzip 完了判定に使わない。

## 設定方針

`deploy/nginx.conf` の `server` 内:

```nginx
gzip on;
gzip_comp_level 5;
gzip_min_length 256;
gzip_vary on;
gzip_proxied any;
gzip_types
    text/plain
    text/css
    text/xml
    application/json
    application/javascript
    text/javascript
    application/xml
    image/svg+xml;
```

`location /api/` に:

```nginx
proxy_buffering on;
proxy_buffer_size 128k;
proxy_buffers 8 256k;
proxy_busy_buffers_size 512k;
```

`frontend/nginx.conf` も同じ gzip と `location /api/` の buffer を揃える。

## 非対象

- Go の `compress/gzip` ミドルウェアや Brotli
- `gzip_static` / ビルド時 `.gz` 生成
- board API のペイロード削減（フィールド省略・差分ポーリング）
- Cloud Run 側の CDN 設定変更
- login ブロックへの `proxy_buffers` 追加

## テスト方針

- `scripts/check-nginx-gzip.sh` が両 conf で `gzip on`、`gzip_proxied any`、`gzip_vary on`、必須 `gzip_types`（カード記載の JSON / JS / CSS / SVG を含む）、`location /api/` 内の `proxy_buffers` を検出する。
- `--selftest` 必須: 必須行を欠いた一時 fixture で非ゼロ終了することを CI で実行する（L-1051）。既存 `check-nginx-tls-headers.sh` に selftest が無いことは本カードでは広げない。
- gzip 編集後も既存 `./scripts/check-nginx-tls-headers.sh` を通し、deploy の CSP/HSTS/Forwarded-Proto/`auth_basic off` を回帰する（L-1039）。
- `deploy-guards` に bash -n と本スクリプト（本番 conf 検査 + `--selftest`）を追加する。
- README のローカル検証 / deploy-guards の説明に `check-nginx-gzip.sh` を追記する。
- 手動完了は受け入れ #8 のパス別手順に従う。

## 注意する知見

- L-1051: 設定ガードは成功系に加え必須欠落の selftest を置く。
- L-1039 / 既存 nginx 契約: gzip 追加で CSP・HSTS・Forwarded-Proto・`auth_basic off` を消さない。
- L-015: 要求外の Go 圧縮や board ペイロード変更を暗黙に入れない。
