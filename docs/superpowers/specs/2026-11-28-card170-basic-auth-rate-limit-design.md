# カード 170: API の Basic 認証の経路に試行回数の制限を入れる（設計）

- カード: https://scrum-board-ajs5phscdq-an.a.run.app/items/170?project=1
- 種別: セキュリティ（中）

## 背景と問題

API は `Authorization: Basic` でも `users` のパスワードを照合する（`backend/internal/kanban/auth_middleware.go` の `userFromBasicAuth`）。
試行回数の制限（`handler.loginAttempts`、5 回失敗で 15 分ロック）を使っているのは `POST /api/auth/login` だけで、Basic の経路は `Allow` も `RecordFailure` も呼ばない。
さらに利用者が存在しない・無効のときは bcrypt の照合をせずに返す。

その結果、

1. `GET /api/board` などに Basic を付けて繰り返し送ると、ログインのロックを通らずにパスワードを試せる（歯止めは nginx の `limit_req` 10r/s だけ）。
2. 利用者の有無で応答時間が変わり、ログイン名の存在が分かる。

## 完了条件（カードより）

- Basic での連続した失敗が、ログインと同じ条件（ログイン名と接続元、5 回失敗で 15 分ロック）で制限される。
- 利用者名の有無（存在しない・無効・存在する）で応答時間が変わらない（どれも bcrypt の照合を 1 回行う）。
- ロック中は bcrypt を実行せずに 401 を返す。

## 方針

### 1. Basic 専用の試行回数リミッタを使う

`handler` に `basicAttempts LoginAttemptLimiter` を追加し、`NewHandler` で `NewMemoryLoginAttemptLimiter()` を入れる。
しきい値・ロック時間・TTL・キー（ログイン名の小文字化と `clientIP(r)`）は `POST /api/auth/login` と同じ実装（`memoryLoginAttemptLimiter`）をそのまま使う。

フォームのログインと **カウンタは共有しない**。理由:

- 本番のエッジ Basic（nginx、`AUTH_USER` / `AUTH_PASSWORD`）は、ログイン名が初期 admin と同じで、パスワードは別（L-1001）。`/api/` は nginx で `auth_basic off` だが、ブラウザがエッジ Basic のキャッシュした資格情報を同一オリジンの `/api/` への XHR に付ける場合がある（`userFromBasicAuth` のコメントのとおり mobile Safari は再送する。付けないブラウザもある）。付けた場合、ログイン前の `GET /api/auth/me` などが「admin + 違うパスワード」の Basic 失敗になる。
- カウンタを共有すると、その場合にログイン画面を数回開くだけで admin のログイン名と、その接続元 IP（NAT の共有出口を含む）がフォームのログインでもロックされ、誰もログインできなくなる。
- ブラウザが付けない場合でも、別カウンタにして失うものは無い（攻撃者の試行回数の上限が 5 回から 10 回 / 15 分になるだけ）。よって前提の成否にかかわらず別カウンタとする。
- 別カウンタなら、ロックされるのは Basic の経路だけで、Cookie セッションとフォームのログインは影響を受けない。攻撃者が試せる回数も「ログイン 5 回 + Basic 5 回 / 15 分」に抑えられる。

既知の副作用（許容する）: 上のエッジ Basic の再送が起きる環境では、ブラウザのログイン前の XHR だけで、その接続元 IP が Basic の経路で 15 分ロックされうる。同じ IP（NAT の共有出口を含む）から `curl -u login:password` を使う CLI 利用者は、正しい資格情報でも 401 になる。さらにエッジ Basic のログイン名は `AUTH_USER`（初期 admin）と同じなので、そのログイン名のカウンタもロックされ、このキーは全接続元で共通のため、その利用者の `-u` は別の IP からもロックされうる（第三者が誤った Basic を 5 回送っても起こせる）。回避策は `POST /api/auth/login` で Cookie を得て `-b` で送ること（フォームのログインはロックされない）。IP のロックを外すと、ログイン名を変えながらの総当たりを止められないため、IP のキーも残す。この副作用は `docs/api.md` と `SECURITY.md` に書く。

テスト用に `WithBasicAuthAttemptLimiter(l LoginAttemptLimiter) Option` を追加する（nil なら既定のまま。`WithLoginAttemptLimiter` と同じ形）。

あわせて `handler` に照合関数 `checkPassword func(hash, password string) bool` を持たせ、`NewHandler` で `CheckPassword` を入れる。テストからは同じパッケージの非公開 Option `withPasswordChecker(f)`（nil なら既定のまま）で差し替える。これは短絡で照合を飛ばす形に戻る退行をテストで固定するため（L-085）。フォームのログイン（`login` ハンドラ）も同じ `h.checkPassword` を使うように揃える（挙動は変わらない）。

### 2. 照合の手順（`verifyCredentials` に集約）

SRP リファクタリングで、下記の手順は `auth_handler.go` の共通関数 `verifyCredentials(r, limiter, loginName, password, now) (User, credentialResult)`（結果は `credentialAccepted` / `credentialRejected` / `credentialLocked`）に集約した。`userFromBasicAuth` は資格情報の取り出しと「Accepted 以外は未認証」への変換だけ、`login` は取り出し・401 / 429・セッション発行だけを受け持つ。limiter は Basic が `h.basicAttempts`、ログインが `h.loginAttempts`。経路ごとに手順を複製しないこと（L-095）。

```text
userName, pass, ok := r.BasicAuth()
!ok / TrimSpace(userName) == "" / pass == ""   → 未認証（カウントしない。パスワードの試行ではない）
loginName := TrimSpace(userName); loginKey := ToLower(loginName); ip := clientIP(r); now := time.Now().UTC()
!basicAttempts.Allow(loginKey, ip, now)        → 未認証（bcrypt を実行しない・DB も引かない）
user, err := repo.GetUserByLoginName(ctx, loginName)
okUser := err == nil && !user.Disabled
match := h.checkPassword(loginPasswordHash(user, err), pass)   // 不在・無効でもダミーのハッシュで必ず 1 回照合する
!okUser || !match → basicAttempts.RecordFailure(loginKey, ip, now); 未認証
成功 → basicAttempts.RecordSuccess(loginKey, ip); 認証済み
```

- ダミーのハッシュは既存の `loginPasswordHash` / `loginDummyHash`（`user.go`）を使い、ログインと同じコストにする。
- `GetUserByLoginName` が `ErrNotFound` 以外のエラー（DB 障害）を返した場合も、ログインと同じく失敗として扱う（ダミー照合 + `RecordFailure`）。ログインの `login` ハンドラと挙動を揃える意図であり、障害が続く間に正当な Basic 利用者がロックされうることは許容する。
- 成功時は login キーのカウンタだけを消し、IP のカウンタは残す（L-1028。`RecordSuccess` の既存の仕様）。

### 3. 未認証になったあとの扱い（応答）

`withSessionAuth` の流れは変えない。Basic が未認証（失敗・ロック中とも）のとき:

- `sessionOptional` の経路（公開アイテムの詳細など）は匿名として続ける。
- それ以外は従来どおり 401 `msgLoginRequired`。

ロック中を 429 にしない理由: `sessionOptional` の経路（公開アイテムの匿名閲覧）を止めないため。ロック中かどうかで応答本文・ステータスは変わらない。

### 4. 評価順は変えない

有効な Cookie セッションがある場合は Basic を評価しない（現状どおり）。よって Cookie でログイン済みの利用者のリクエストに付いたエッジ Basic は、カウンタを進めない。

## 影響範囲

- `backend/internal/kanban/auth_middleware.go`: `userFromBasicAuth` を `verifyCredentials` 呼び出しに書き換え。
- `backend/internal/kanban/handler.go`: `basicAttempts`・`checkPassword` フィールド、`NewHandler` の初期化、`WithBasicAuthAttemptLimiter`・`withPasswordChecker`。
- `backend/internal/kanban/auth_handler.go`: 共通の `verifyCredentials` と `credentialResult` を新設し、`login` をそれを使う形に書き換え（挙動は不変）。
- テスト: `backend/internal/kanban/auth_handler_test.go`（または新規の `basic_auth_rate_limit_test.go`）。
- 文書:
  - `SECURITY.md` の App HTTP Basic の行に「Basic も 5 回失敗で 15 分ロック（ログインとは別カウンタ）」を追記し、既知の制限として下記を書く（L-213。実装時にはレビューで判明した共有 IP・照合順序・プロセス内メモリを加え 5 点）。
    1. エッジ Basic の再送で、同じ接続元 IP の CLI の Basic と、`AUTH_USER` のログイン名の CLI の Basic（このキーは全接続元で共通のため、別の IP からも）がロックされうること（回避策は Cookie、または `AUTH_USER` 以外の利用者を使うこと）。
    2. 許可判定（`Allow`）と失敗の記録（`RecordFailure`）が別のロック区間で、間に DB と bcrypt を挟むため、並行に送られたリクエストは 5 回目の失敗が記録される前に通りうること（L-986）。ログインも同じで、ログインは nginx の `api_login`（1r/s、burst 5）、Basic は `api_general`（10r/s、burst 20）が上限になる。
  - `docs/api.md` の curl 例の節に、Basic のロック（5 回失敗で 15 分、ログインとは別カウンタ）と、ロック時の回避策（`POST /api/auth/login` で得た Cookie を `-b` で送る）を追記。

フロントエンド、DB スキーマ、OpenAPI のパス定義は変更しない（応答のステータスと本文は変わらないため）。

## テスト

接続元は、特記が無ければ `httptest.NewRequest` の既定の `RemoteAddr`（`192.0.2.1:1234`）を使う。IP を変えるテストだけ `X-Real-IP` を付ける。

1. 同じログイン名で間違ったパスワードの Basic を 5 回送ると、6 回目は **正しいパスワードでも** 401（ロック）。
2. ロック中は DB も bcrypt も触らない: 偽のリミッタ（`Allow` が常に false）を注入し、`GetUserByLoginName` の呼び出し回数が 0 であることを呼び出しを数えるリポジトリのラッパーで、照合の呼び出し回数が 0 であることを `withPasswordChecker` で確かめる。
3. 存在しないログイン名・無効の利用者・DB エラー（`ErrNotFound` 以外）・間違ったパスワードのそれぞれで、偽のリミッタに `RecordFailure(loginKey, ip)` が 1 回記録される（ログイン名は小文字化されていること）。
4. 完了条件 2（不在・無効でも bcrypt を 1 回実行する）は、応答時間は測らず構造で確かめる: `withPasswordChecker` で呼び出しを記録する照合関数を注入し、「存在しない・無効・DB エラー（`ErrNotFound` 以外）・パスワード違い・成功」のどれでも照合がちょうど 1 回呼ばれること、存在しない・無効・DB エラーのときは渡されたハッシュが `loginDummyHash` であることを表形式テストで確かめる。ロック中（テスト 2）は 0 回であることも同じ仕組みで確かめる。
5. Basic のロックはフォームのログインに波及しない: Basic で 5 回失敗したあと、同じ接続元から `POST /api/auth/login` で正しい資格情報なら 200。
6. 成功時に login キーのカウンタだけが消え、IP のカウンタは残る:
   - 接続元 A で 4 回失敗 → 接続元 A で成功（200）→ 接続元 B（`X-Real-IP` を変える）で 4 回失敗 → 接続元 B で正しいパスワードなら 200（login キーが消えていなければ 8 回目でロック済みのはず）。
   - 続けて接続元 A から、別のログイン名で 1 回失敗 → 接続元 A の IP は 5 回目でロックされ、最初のログイン名の正しいパスワードでも 401（IP キーが残っている）。
7. 既存の Basic のテスト（`TestSessionMiddlewareBasicAuth`、`TestSessionOptionalBasicAuth`）が通ること。1 つのハンドラでの失敗が 5 回に届かないので変更不要の見込み。
8. 公開アイテムはロック中の Basic でも匿名として 200（`sessionOptional`）。
9. ログイン名が空・空白だけ（`TrimSpace` 後に空）・パスワードが空のときは、偽のリミッタに `Allow` も `RecordFailure` も記録されない。

## 決めたこと

- フォームのログインとはカウンタを分ける（理由は「方針 1」）。しきい値は同じ。
- ロック中も失敗時と同じ 401（または `sessionOptional` なら匿名）を返し、429 は返さない。
- 応答時間の差は、ダミーハッシュでの照合を必ず 1 回行うことで揃える。応答時間の計測テストは行わず、照合回数と渡すハッシュを `withPasswordChecker` で構造的にテストする（L-085）。
- エッジ Basic の再送による CLI の Basic のロック（接続元 IP と `AUTH_USER` のログイン名。後者は全接続元に及ぶ）は許容し、回避策（Cookie、または `AUTH_USER` 以外の利用者）を文書に書く。
- 許可判定と記録の TOCTOU（L-986）は、リミッタのインターフェースを変えてログインにも波及する修正になるため本カードの範囲外とし、`SECURITY.md` の既知の制限に書く。
- カードの「ログインと同じ制限」は、しきい値・キー・実装が同じという意味で満たし、カウンタは意図して分ける（PR の説明に明記する）。
- 複数インスタンス（Cloud Run の水平スケール）でのカウンタ共有は、フォームのログインと同じくプロセス内メモリのままとし、本カードの範囲外とする。

## 関連する知見

L-085（不在・無効でもダミー照合し短絡しないことをテストで固定）、L-986（許可判定と記録の TOCTOU）、L-095（経路間のチェックの非対称）、L-1001（エッジ Basic とアプリ admin の分離）、L-1027（失敗マップの掃除）、L-1028（成功時に IP カウンタを消さない）、L-1029（クライアント IP は `X-Real-IP` 優先）、L-213（認証・レート制限の前提を文書に書く）。
