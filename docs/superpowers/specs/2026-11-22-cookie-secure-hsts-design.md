# 本番 Cookie Secure と HSTS（#94）— 設計

- カード: [#94 セキュリティ[低] 本番でセッション Cookie に Secure が付かず、HSTS もない](https://scrum-board-jkcejsb6ka-an.a.run.app/items/94?project=1)
- 日付: 2026-11-22

## 背景

- 本番同居イメージは Cloud Run → nginx（平文 listen）→ Go API（`127.0.0.1:8081`）。
- `deploy/nginx.conf` が `proxy_set_header X-Forwarded-Proto $scheme;` としており、nginx 内は常に `http`。Cloud Run が付けたクライアント側の `https` が上書きされる。
- API の `setSessionCookie` / `clearSessionCookie` は `r.TLS != nil` または `X-Forwarded-Proto: https` のときだけ `Secure` を付ける。前者は平文 upstream では偽、後者は上書きで常に `http` → **本番でも Secure が付かない**。
- `Strict-Transport-Security` は未設定。`*.run.app` は HSTS プリロードで実害は出にくいが、独自ドメインでは平文 HTTP でセッション Cookie（14 日）と Basic 資格情報が漏れうる。

## 決めたこと

| 事項 | 採用（推奨） |
|------|------|
| Secure の直し方 | **nginx が受け取った `X-Forwarded-Proto` を引き継ぐ**（空なら `$scheme`）。Go の判定ロジックは現状維持 |
| 引き継ぎ実装 | `conf.d` は `http` 内 include なので、テンプレ先頭に `map $http_x_forwarded_proto $forwarded_proto` を置き、`proxy_set_header X-Forwarded-Proto $forwarded_proto;`。`envsubst '${PORT}'` のみ置換のため `$…` nginx 変数は壊さない |
| HSTS | nginx の `server` に `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;`。クライアントへの応答は Cloud Run の HTTPS 終端経由。平文ローカルではブラウザが HSTS を無視する（仕様） |
| PUBLIC_ORIGIN で Secure を強制 | **採らない**（票の「または」）。根因はヘッダ上書き。二重経路はテストと運用を増やす |
| Go 変更 | 振る舞い変更なし。`X-Forwarded-Proto: https` で login／logout の Set-Cookie に Secure が付く回帰テストを追加（現状プレーン HTTP のみ固定） |
| 完了条件の検証 | (1) 単体テスト: Forwarded-Proto https で login／logout とも Secure、無し／http では非 Secure。(2) conf / envsubst 後に `map`・`proxy_set_header … $forwarded_proto`・HSTS があり、`proxy_set_header X-Forwarded-Proto $scheme` が無い（map 内 `'' $scheme` は可）。(3) 任意で最小 `http{ include … }` ラッパの `nginx -t`。実 Cloud Run の curl は非目標 |

### 検討したが採らなかった案

- **Go が `PUBLIC_ORIGIN` の https なら常に Secure**: 根因を残したままになり、独自ドメイン＋誤った PUBLIC_ORIGIN で再び外れる。nginx 修正で足りる。
- **HSTS を https のときだけ出す map**: ローカル平文ではブラウザが無視するため必須ではない。常時 `always` で単純にする。
- **includeSubDomains を外す**: 独自ドメインのサブドメイン保護のため付ける（単一ホスト運用でも害は小さい）。

## 目的と受け入れ条件

1. `deploy/nginx.conf` に `map $http_x_forwarded_proto $forwarded_proto`（空→`$scheme`）と `proxy_set_header X-Forwarded-Proto $forwarded_proto;` があり、**`proxy_set_header X-Forwarded-Proto $scheme` が無い**（map 内フォールバックの `$scheme` は残す）。
2. API は `X-Forwarded-Proto: https` の **login と logout** で Set-Cookie に `Secure` を付ける（平文のみのリクエストでは付けない・既存テスト維持）。
3. 同 conf に `add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;` がある。
4. `envsubst '${PORT}'` 展開後も `$forwarded_proto` / `map` / HSTS が残る（任意: 最小 `http{ include }` ラッパで `nginx -t`。断片単体の `-t` は使わない）。

## 非目標

- Cloud Run 上での実リクエスト再現（票もコード読解ベース）
- Basic Auth の別経路の暗号化変更
- Cookie の `SameSite` / TTL の変更
- Go での PUBLIC_ORIGIN 連動 Secure

## 実装概要

1. `deploy/nginx.conf`: `map` + `X-Forwarded-Proto $forwarded_proto` + HSTS `add_header`。
2. `auth_handler_test.go`（または近傍）: Forwarded-Proto https で Secure、無し／http で非 Secure。
3. 可能なら `nginx -t` をテンプレ展開後に走らせる手順をプランに書く（CI に無ければ手動／ローカル検証）。

## 関連知見

| ID | 扱い |
| --- | --- |
| L-018 | **守る**: 検証に使う解釈（クライアントの https）と実行に渡す解釈（`$scheme`）が食い違わないよう、転送ヘッダを正とする |
| L-061 | **参考**: Secure と HSTS の両方の入口を同じ変更で塞ぐ |

## 第 2 周レビューで直せない／範囲外として記録したもの

（レビュー後に追記）
