# カード 171: 試行制限の接続元 IP を Cloud Run の前段の背後でも利用者ごとに分ける（設計）

- カード: https://scrum-board-ajs5phscdq-an.a.run.app/items/171?project=1
- 種別: セキュリティ（中）
- 関連: カード 170（PR #165。Basic の経路の試行回数制限。SECURITY.md の既知の制限 1・4 に、この問題を書いた）

## 本番で確かめたこと（2026-11-28）

`gcloud logging read`（scrum-board-prod、サービス scrum-board）の nginx のアクセスログと、Cloud Run のリクエストログの `httpRequest.remoteIp` を突き合わせた。

- nginx の `$remote_addr`（アクセスログの先頭）は、どのリクエストも `169.254.169.126`（Cloud Run の前段の内部アドレス）だった。
- 同じ行の末尾の `$http_x_forwarded_for` は、利用者の IP 1 つ（`153.216.191.73`）で、Cloud Run の `remoteIp` と一致した。

したがってカードの疑いは事実である。現状は次のとおり。

- nginx の `limit_req`（`$binary_remote_addr` がキー）は、全利用者で 1 つの枠（API 全体で 10r/s、ログインで 1r/s）を分け合っている。
- nginx は API へ `X-Real-IP: $remote_addr` を渡し、API の `clientIP` はそれを最優先で使う。そのためログインと Basic の IP のキーは全員 `169.254.169.126` になり、誰かが 5 回失敗すると全員が 15 分ログインできない。

## 完了条件（カードより）

- 利用者ごとに別の IP で制限が掛かる。
- 他人の失敗で自分のログインが止まらない。

ここでの「他人」は、別の接続元 IP の利用者を指す。同じ出口 IP を共有する利用者（NAT・社内 LAN・携帯の CGNAT）どうしは IP のキーを共有するので、1 人が 5 回失敗するとその IP の全員が 15 分ロックされる。nginx の `limit_req` も同じ IP の中では共有される。これらはこのカードの範囲外とし、既知の制限として残す。

## 方針

### 1. nginx で実際の利用者の IP を復元する（`deploy/nginx.conf`）

`server` ブロックの外（http コンテキスト。`limit_req_zone` と同じ階層）に次を置く。

```nginx
# Cloud Run's front end connects from 169.254.0.0/16 and puts the client IP in X-Forwarded-For.
# Trust only that hop so $remote_addr (limit_req keys, X-Real-IP to the API) is the real client.
set_real_ip_from 169.254.0.0/16;
real_ip_header X-Forwarded-For;
real_ip_recursive on;
```

- 公式の `nginx:1.28-alpine` は `ngx_http_realip_module` を含む（`nginx -V` の `--with-http_realip_module`）。実装時に `docker run --rm <image> nginx -V` で確かめる。
- `real_ip_recursive on` では、`X-Forwarded-For` を右から見て、信頼する範囲（169.254.0.0/16）に入らない最初のアドレスを使う。利用者が自分で `X-Forwarded-For: 1.2.3.4` を付けて送っても、前段がその右に実際の接続元を足すか置き換えるので、右端の実際の IP が選ばれる。左側の偽の値は使われない。
- 信頼するのは 169.254.0.0/16（リンクローカル。インターネットからは届かない）だけにする。前段の接続元がこの範囲から変わった場合は、realip が効かず今と同じ挙動に戻るだけで、悪くはならない。
- これで `$remote_addr` と `$binary_remote_addr` が利用者の IP になり、`limit_req` と `X-Real-IP` の両方が利用者ごとに分かれる。`proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for` はそのままにする（realip 後の `$remote_addr` が足されるので、API に渡る `X-Forwarded-For` は `client, client` になるが、API は `X-Real-IP` を優先するので影響しない）。API 側の `clientIP` は `X-Real-IP` を最優先で使うので、変更しない（L-1029）。
- ローカルの Compose 用の `frontend/nginx.conf` は前段が無いので変えない。

### 2. ログイン名だけでのロックをやめ、「ログイン名＋接続元」の組で数える（`login_rate_limit.go`）

ユーザーの判断（2026-11-28）で、ログイン名のキーを「ログイン名＋接続元 IP」の組にする。IP 単独のキーは残す。

- `loginAttemptKey(loginKey, ip)` を `"login:" + loginKey + "|" + rateLimitIPBucket(ip)` にする。`LoginAttemptLimiter` のインターフェース（`Allow(loginKey, ip, now)` など）は変えない。
- `RecordSuccess(loginKey, ip)` は、その組のキーだけを消す。IP のキーは今までどおり残す（L-1028）。
- 効果: 未ログインの第三者が誰かのログイン名に 5 回失敗させても、ロックされるのは第三者の接続元（IP のキーと、その組のキー）だけになる。本人は別の IP から入れる。カード 170 の既知の制限（エッジ Basic の再送で `AUTH_USER` のログイン名がどの接続元からもロックされる）も同時に解消する。
- 受け入れるトレードオフ: 多数の IP を持つ攻撃者は、1 つのアカウントに対して IP ごとに 15 分で 5 回まで試せる（アカウント単位の上限が無くなる）。ユーザーが選んだ方式として「決めたこと」に残す。
- 補足: 直列のリクエストでは、失敗するたびに IP のキーと組のキーは両方とも 1 増え、組のキーの回数は同じ IP のキーの回数を超えない。そのため、しきい値が同じ（5 回）で、ロック時間と TTL が同じ（15 分）である今の設定では、組のキーは IP のキーと同時か、それより後にしかロックされず、ロックの挙動は「IP ごとに 5 回で 15 分」と同じになる。並行するリクエストでは、Allow から RecordFailure までが不可分でないため（L-986）、IP のキーのロック後に組のキーだけが増えることがあり、その組が少し長くロックされうるが、実害は小さい。組のキーを残すのは、ユーザーが選んだ方式に合わせるためと、IP のしきい値を将来変えたときにも「組」での上限が独立して働くようにするため。
- フォームのログイン（`loginAttempts`）と Basic（`basicAttempts`）は同じ実装の別インスタンスなので、両方に同時に効く。
- IPv6 の接続元は、limiter のキーでは /64 に丸める（`rateLimitIPBucket`。ローカルレビューで追加）。利用者 1 人が普通は /64 を持つため、アドレスを変えるだけで IP のロックを抜けられ、アカウント単位の上限が無い今の方式では試行が実質無制限になるのを防ぐ。nginx の `limit_req` はアドレス単位のまま（範囲外）。

### 3. 変えないもの

- しきい値（5 回）、ロック時間（15 分）、TTL、prune（L-1027）。
- 応答（ログインは 401 / 429、Basic は 401 または匿名）。
- `clientIP` のヘッダの優先順位（`X-Real-IP` → `X-Forwarded-For` の先頭 → `RemoteAddr`）。nginx が `X-Real-IP` を利用者の IP で上書きするので、API が `X-Forwarded-For` を読む経路は本番では通らない。

## 影響範囲

- `deploy/nginx.conf`: realip の 3 行を追加する。
- `scripts/check-nginx-real-ip.sh`（新規）: `deploy/nginx.conf` の `set_real_ip_from` が 169.254.0.0/16 の 1 行だけで、`real_ip_header X-Forwarded-For;` と `real_ip_recursive on;` もそれぞれ 1 行だけ（location での上書きを許さない）、3 つとも最初の server ブロックより前（http レベル）にあることを検証する。既存の `check-nginx-*.sh` と同じ形（`-h` / `--selftest`）にし、`.github/workflows` の deploy-guards（`bash -n`・本体・`--selftest`）と `README.md` のガードスクリプトの一覧に追加する。
- `backend/internal/kanban/login_rate_limit.go`: キーの組み立てを変え、IPv6 を /64 に丸める `rateLimitIPBucket` を足し、インターフェースのコメント（「RecordSuccess clears the login-key counter only」）を組のキーに合わせて直す。
- テスト（詳細は「テスト」の節）:
  - `login_rate_limit_test.go`: `TestLoginAttemptLimiterIndependentKeys` は「同じログイン名なら別の IP もロックされる」を期待しているので、逆の期待に書き換える。`TestLoginAttemptLimiterSuccessClearsPairNotIP` は、組のキーが消えたことを `byKey` で直接確かめる形に書き換える。
  - `basic_auth_rate_limit_test.go`: `TestBasicAuthLoginKeyLockAppliesAcrossIPs` を逆の期待に改め、名前を変える。`TestBasicAuthSuccessClearsLoginKeyNotIP` の IP B の手順は、新しいキーでは成功しなくても通ってしまい何も確かめないので削り、IP のキーが残ることを確かめる後半だけを残す（名前も合わせて変える）。
- 文書:
  - `SECURITY.md`:
    - 21 行の表（App HTTP Basic の行）の「per login name and per client IP」を「per client IP and per login-name + client-IP pair」に直す。
    - 既知の制限 1（エッジ Basic の再送）: 前半の「the client IP can get Basic-locked … CLI users behind the same IP then get 401」と回避策（`-b`）は残す。`AUTH_USER` のログイン名のカウンタが全接続元で共通にロックされる、という文だけを消す。
    - 既知の制限 4（共有 IP）: 「全利用者で共通になりうる」という内容を、「nginx の realip で Cloud Run の前段（169.254.0.0/16）だけを信頼して利用者の IP を復元する。同じ出口 IP（NAT など）を共有する利用者どうしは、引き続きロックと `limit_req` を共有する」に書き換える。
    - 既知の制限 5（照合順序。L-1355）: IP のキーが上限を決めるので、表記ゆれで得られる追加の試行は無い、と書き直す。
  - `docs/api.md` 43 行の段落: 「ログイン名ごと・接続元 IP ごと」を「接続元 IP ごと（ログイン名と接続元の組を含む）」に直す。「本番では接続元 IP が全利用者で共通になる場合があります」を「同じ出口 IP（NAT など）を共有する利用者どうしはロックを共有します」に置き換える。`AUTH_USER` のログイン名が別の接続元からもロックされるという文は外す。「同じ接続元のブラウザが…ロックされた場合は `-b`」は残す。
  - `docs/openapi.yaml` の `basicAuth` の説明（「ログイン名・接続元ごとに 15 分ロック」）と、`/api/auth/login` の説明に同様の記述があれば直す。

## テスト

1. `login_rate_limit_test.go`
   - `TestLoginAttemptLimiterIndependentKeys` を書き換える: IP A で alice が 5 回失敗したあと、IP B からの `Allow("alice", ...)` は true、IP A からの `Allow("bob", ...)` は false（IP のロック）。
   - `TestLoginAttemptLimiterSuccessClearsPairNotIP` を書き換える: IP A で alice が 4 回失敗 → `RecordSuccess("alice", A)` のあと、`byKey` に組のキー（`loginAttemptKey("alice", A)`）が無く、IP のキー（`ipAttemptKey(A)`）の失敗回数が 4 のまま残っていることを直接確かめる。続けて 1 回失敗すると IP A がロックされる（L-1028）。今のしきい値では組のキーの消去を `Allow` からは観測できないため、`byKey` を見る（同じパッケージのテストなので見られる）。
   - `TestLoginAttemptLimiterSuccessClearsOnlyOwnPair`: IP B からの成功で IP B の組だけが消え、IP A の組の失敗は残る（SRP リファクタリングで追加）。
   - `TestLoginAttemptLimiterBucketsIPv6By64` と `TestRateLimitIPBucket`: 同じ /64 の別アドレスは IP のロックを共有し、別の /64 は共有しない。IPv4・IPv4 射影・不正な値の扱い（ローカルレビューで追加）。
2. `basic_auth_rate_limit_test.go`
   - `TestBasicAuthLoginNameLockDoesNotSpanIPs`（旧 `TestBasicAuthLoginKeyLockAppliesAcrossIPs`）: IP A から `admin` に 5 回失敗したあと、IP B から正しいパスワードで 200、IP A からは 401。
   - `TestBasicAuthSuccessKeepsIPFailures`（旧 `TestBasicAuthSuccessClearsLoginKeyNotIP`）: IP A で 4 回失敗 → 成功（200）→ 別のログイン名で 1 回失敗 → IP A から正しいパスワードでも 401。成功しても IP のキーが残ることを HTTP の層で固定する。L-1028 の limiter 単体の確認は上の 1 で行う。
3. `auth_handler_test.go`:
   - `TestAuthLoginLockDoesNotSpanIPs`（新規）: IP A（`X-Real-IP`）から alice に 5 回失敗したあと、IP B から alice の正しいパスワードで 200、IP A からは 429。完了条件をフォームのログインの経路で直接固定する（Basic のテスト 2 と同じ厳しさ。L-095）。
   - 既存のログインのテスト（`TestAuthLoginIPRateLimitBlocksOtherLogin` など）が通ること。同じ IP からの別のログイン名が 429 になることは、IP のキーで引き続き成り立つ。
4. `scripts/check-nginx-real-ip.sh`: 本体と `--selftest` が通ること。`--selftest` は次の場合に失敗することを確かめる。
   - 3 行のどれかが無い。
   - `set_real_ip_from` に 169.254.0.0/16 以外（例: `0.0.0.0/0`）がある。
   - `real_ip_header` が `X-Forwarded-For` 以外。
   - `real_ip_recursive` が `on` 以外。
   - location の中で `real_ip_header` / `real_ip_recursive` を上書きしている。
   - 3 行が server ブロックの中にある。
5. nginx の構文: 実装時に `docker run --rm -v "$PWD/deploy/nginx.conf:/etc/nginx/templates/default.conf.template" -e PORT=8080 nginx:1.28-alpine nginx -t` 相当で確かめる（エントリポイントのテンプレート展開に合わせる）。Docker が使えない場合は、確かめていないと報告する。
6. デプロイ後の確認（このカードの範囲外の運用作業。デプロイはユーザーが行う）:
   - アクセスログの先頭が利用者の IP になったことを `gcloud logging read` で確かめる。
   - `curl -H 'X-Forwarded-For: 1.2.3.4' <サービス URL>/health` などで偽の XFF を付けて送り、アクセスログの先頭が `1.2.3.4` ではなく実際の IP のままであることを確かめる（L-1029。本番で観測したのは XFF が 1 つの場合だけなので）。

## 決めたこと

- 本番の `$remote_addr` は `169.254.169.126` で全員共通だったため、nginx の realip で 169.254.0.0/16 だけを信頼する。
- ログイン名のキーは「ログイン名＋接続元」の組にする（ユーザーの選択）。アカウント単位の上限が無くなり、IP を多数持つ攻撃者は IP ごとに 15 分で 5 回まで試せるが、他人のログインを止められないことを優先する。
- API の `clientIP` は変えない（nginx が `X-Real-IP` を正しい値にする）。
- 照合順序とキーの不一致（L-1355）は別途の対応にしない。IP のキーが上限を決めるので、表記ゆれで得られる追加の試行は無い。
- デプロイと、デプロイ後の確認はユーザーが行う。
- IPv6 の接続元は limiter のキーで /64 に丸める（ローカルレビューで追加）。nginx の `limit_req` はアドレス単位のまま（範囲外）。
- 同じ出口 IP を共有する利用者どうしのロックと `limit_req` の共有は範囲外とし、既知の制限として残す。

## 関連する知見

L-1029（クライアント IP は信頼境界で確定した値を使う。前段のプラットフォームの背後では real_ip で復元する）、L-1028（成功時に IP のカウンタを消さない）、L-1027（失敗マップの掃除）、L-1354（自動で再送される資格情報でログイン名がロックされる）、L-1355（キーと照合順序の不一致）、L-095（フォームと Basic の 2 経路を同じ厳しさでテストする）、L-213（制限の前提を文書に書く）。
