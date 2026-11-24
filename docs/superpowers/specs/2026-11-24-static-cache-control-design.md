# 静的ファイルのキャッシュ指定（#121）設計

## 背景

nginx は、ハッシュ付きの JS / CSS にも `index.html` にも `Cache-Control` を付けていない。存在しないファイルも、`try_files $uri $uri/ /index.html` ですべて `index.html` を返す。

- 再訪のたびに、全ファイルの確認リクエストが出る。
- `index.html` が古いままキャッシュされると、次のデプロイのあと、消えたファイルを要求する。応答は `index.html`（HTML）で、JS として読めず、強制再読み込みするまで画面が壊れる。

## 決めたこと

`deploy/nginx.conf`（本番）と `frontend/nginx.conf`（compose）の両方に、同じ変更を入れる。

- `map $uri $static_cache_control` で値を決める。
  - `/api/` で始まる: 空（API 自身の `Cache-Control` を邪魔しない。空の値のヘッダーは出ない）。
  - 末尾が `.js` / `.mjs` / `.css`: `public, max-age=31536000, immutable`（Angular の出力はファイル名にハッシュが付く）。
  - それ以外（`index.html`、SPA のルート、`favicon.ico`、`/health`）: `no-cache`（毎回確認。nginx の ETag / Last-Modified で 304 になる）。
- `add_header Cache-Control $static_cache_control;` を **server 直下**に 1 回だけ書く。
  - `location` の中に `add_header` を書くと、server 直下の `nosniff`・CSP・HSTS が引き継がれない。server 直下なら書き直しが要らず、既存の `location` も変えずに済む。
  - `always` は付けない。付けると、存在しない `.js` の 404 まで 1 年キャッシュされる。`always` なしなら 200/201/204/206/301/302/303/304/307/308 にだけ付く。
- 末尾が `.js` / `.mjs` / `.css` で `/api/` 以外のパスは `location ~* ^/(?!api/).+\.(?:js|mjs|css)$ { try_files $uri =404; }` で、無ければ 404 にする（`index.html` を返さない）。

## 受け入れ条件

1. ハッシュ付きの JS / CSS の応答に `Cache-Control: public, max-age=31536000, immutable` が付く。
2. `index.html`、`/`、SPA のルートの応答に `Cache-Control: no-cache` が付く。
3. 存在しない `.js` / `.css` は 404 になり、`Cache-Control` は付かない。
4. 既存のセキュリティヘッダー（nosniff・CSP・HSTS）と `/api/` の応答は変わらない。
5. `scripts/check-nginx-cache.sh` が上記の設定の契約（map の規則の順序、`add_header` が server 直下にあること、404 の `location`）を検査し、`--selftest` を持つ。CI の `deploy-guards` に本体と `--selftest` を載せ、README の一覧に追記する。既存の `check-nginx-gzip.sh`・`check-nginx-tls-headers.sh` も通る。

## 拡張子を足すとき

`.woff2` など js/css 以外を長期キャッシュにする場合は、両方の `nginx.conf` で `map` の正規表現と `js|mjs|css` の `location` を同じ拡張子に揃え、`check-nginx-cache.sh` の正規表現も直す。

## 範囲外

- `favicon.ico` など、ハッシュの無い静的ファイルの長期キャッシュ（`no-cache` のままで 304 になる）。
- フロントエンドのビルド設定（Angular の出力はすでにハッシュ付き）。
- Service Worker、CDN の設定。`public` は `Authorization` 付きの応答を共有キャッシュに保存してよいと示す。Cloud Run に直接つなぐ今は影響がないが、CDN やプロキシを前に置くときは見直す。

## 実装プラン

変更が小さい（nginx 設定 2 ファイルと検査スクリプト）ため、実装プランは作らず、設計書のレビューも省いた。
