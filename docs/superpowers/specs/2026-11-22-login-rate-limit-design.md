# ログイン／Basic 試行制限・タイミング均一化 設計書

- 日付: 2026-11-22
- Scrum カード: [#95](https://scrum-board-jkcejsb6ka-an.a.run.app/items/95?project=1)（内部 id 298）
- 関連知見: L-085（認証順序・列挙の手がかりを与えない）、L-974（新しい拒否 status／理由を OpenAPI に足す）
- カード固有: `production-deploy-status.md` の公開 URL・Basic ユーザー名のスクラブ（知見 ID には紐づけない）

## 背景

現状の `POST /api/auth/login`（`handler.login`）は連続失敗の回数制限がない。`GetUserByLoginName` が失敗するか `user.Disabled` のとき、短絡評価で `CheckPassword`（bcrypt）を呼ばずに即 401 を返すため、応答時間差からアカウントの有無を推測できる。パスワードは空でなければ長さチェックがない。コンテナ内 nginx（`deploy/nginx.conf` → `default.conf.template`）に `limit_req` がなく、Basic 認証配下の `/api/` も粗いブルートフォース耐性が弱い。`docs/production-deploy-status.md` には公開 URL（`https://scrum-board-jkcejsb6ka-an.a.run.app`）と Basic ユーザー名（`kanban`）が平文で残っている。

## 受け入れ条件（カードより）

1. 連続失敗の試行回数に制限があり、超過時は一時的に拒否される。
2. ログイン失敗時の応答時間が、ユーザー名の存在有無に依存しない。

（カードの「直し方」に含まれるものも本設計の範囲とする: 最低パスワード長、nginx `limit_req`、デプロイ手順ドキュメントの秘匿情報除去。）

## 決めたこと

| 事項 | 採用 |
|------|------|
| ロック単位 | 正規化ログイン名（trim＋小文字）**と** クライアント IP の両方。どちらかが閾値超過なら拒否 |
| DB 照会の正規化 | `GetUserByLoginName` へ渡す文字列は **現行どおり `strings.TrimSpace` のみ**（大小文字は区別）。小文字化はロックキー専用 |
| 閾値 | 連続失敗 **5 回** でロック。成功でそのキーの失敗カウンタをクリア |
| ロック時間 | **15 分**（壁時計）。ロック中は bcrypt を回さず `429` |
| ロック発火時の failures | 閾値到達で `lockedUntil = now+15m` をセットし、**failures は 0 にリセット**。解除後は再び 5 回失敗で再ロック |
| 空の loginName / password | 現行どおり **即 401**（`msgLoginFailed`）。**Allow / RecordFailure / bcrypt は行わない**（空入力は連続失敗カウント対象外） |
| 実装場所 | アプリ内メモリ（プロセスローカル）。Redis 等は入れない |
| 失敗応答 | 通常失敗は `401`＋`{"message": msgLoginFailed}`（`ログインに失敗しました。`）。ロック時のみ `429`＋`{"message": msgLoginRateLimited}`（下記固定文言） |
| タイミング | ユーザー不在・無効・パスワード不一致のいずれも、同一コストの bcrypt 比較を行う（不在／無効時はパッケージ初期化時に生成したダミーハッシュと比較） |
| 最低パスワード長 | 作成・パスワード変更時に **8 文字以上**（`len([]rune(...))`）。既存の短いパスワードのログインは拒否しない |
| nginx | `deploy/nginx.conf`（`http` に include される template）先頭に `limit_req_zone` を追加し、`/api/` と `location = /api/auth/login` に `limit_req`。`limit_req_status 429`。別ホスト conf / `deploy-gcp.sh` は使わない（現行は `deploy/Dockerfile`＋`entrypoint.sh`） |
| ドキュメント | `production-deploy-status.md` の公開 URL・Basic ユーザー名をプレースホルダ化し、秘匿の注意を一文追加 |
| マルチインスタンス | 現状 Cloud Run は単一コンテナ想定。水平スケール時は IP/ユーザー単位の制限がノード分割されることを既知の制約として明記（本スコープ外） |

固定 429 メッセージ定数案:

```text
msgLoginRateLimited = "試行回数が上限に達しました。しばらくしてから再度お試しください。"
```

## 非目標

- Redis / 共有ストアによる分散レート制限
- CAPTCHA・メール通知・管理者向けロック解除 UI
- Basic 認証のユーザー／パスワード自体の変更（別カード）
- フロントのロック残り時間表示（API が 429 を返せば足りる）
- 既存ユーザーの短パスワード強制リセット

## 現状の要点

- `handler.login`（`auth_handler.go`）: trim 後空なら 401 → `GetUserByLoginName` → `err != nil \|\| Disabled \|\| !CheckPassword(...)` で短絡。不在／無効時は bcrypt なし。
- `validateUserCreate` / `UpdateUser`（`patch.Password`）: パスワードは非空のみ。
- デプロイ: `deploy/Dockerfile` が `deploy/nginx.conf` を `/etc/nginx/templates/default.conf.template` にコピー。`entrypoint.sh` が `envsubst` して `/etc/nginx/conf.d/default.conf` に展開。`limit_req` なし。
- `docs/production-deploy-status.md`: 公開 URL `https://scrum-board-jkcejsb6ka-an.a.run.app`、Basic ユーザー `kanban`。

## 設計

### 1. ログイン試行リミッタ（アプリ）

新規ファイル: `backend/internal/kanban/login_rate_limit.go`

```text
type LoginAttemptLimiter interface {
  Allow(loginKey, ip string, now time.Time) bool  // false = ロック中
  RecordFailure(loginKey, ip string, now time.Time)
  RecordSuccess(loginKey, ip string)
}
```

- キー: `login:` + normalizedLogin（trim+ToLower）、`ip:` + ip
- 各キー: `{ failures int, lockedUntil time.Time }`
- `Allow`: どちらかの `lockedUntil > now` なら false
- `RecordFailure`: 失敗数+1。≥5 なら `lockedUntil = now + 15m` かつ `failures = 0`
- `RecordSuccess`: 両キーをマップから削除
- 排他: `sync.Mutex`
- メモリ肥大防止: 操作時に期限切れロックかつ failures=0 のエントリを削除する簡単な掃除を入れてよい

`handler` に `loginAttempts LoginAttemptLimiter` を持たせる。`NewHandler` でデフォルト実装をセット（テストでは差し替え可能なら Option、またはパッケージ内デフォルトで単体テストはリミッタ自体を直接検証）。

クライアント IP 取得（`clientIP(r *http.Request) string`）:

1. `X-Real-IP`（nginx が `$remote_addr` から付与。クライアント改ざんの XFF より優先）
2. なければ `X-Forwarded-For` の先頭要素（カンマ区切りの最初、trim）
3. なければ `RemoteAddr` の host 部分（`net.SplitHostPort`、失敗時はそのまま）

Cloud Run / コンテナ内 nginx 背後を想定。信頼できるプロキシ前提（既存デプロイと同じ）。

### 2. Login フロー（変更後）

1. body パース（不正なら従来どおり 400）
2. `loginName = strings.TrimSpace(in.LoginName)`。`loginName == "" \|\| in.Password == ""` → **401** `msgLoginFailed`（カウント・bcrypt なし）
3. `loginKey = strings.ToLower(loginName)`、`ip = clientIP(r)`
4. `Allow` が false → **429** `{"message": msgLoginRateLimited}`（bcrypt なし）
5. `user, err := GetUserByLoginName(ctx, loginName)`（trim 済み・大小文字そのまま）
6. 比較対象ハッシュ:
   - `err == nil && !user.Disabled`: `user.PasswordHash`
   - それ以外（不在・無効）: パッケージ初期化済み `loginDummyHash`
7. `bcrypt.CompareHashAndPassword`（または同等）を **必ず** 実行
8. 不一致、または不在／無効 → `RecordFailure` → **401** `msgLoginFailed`（無効も同一メッセージ。現行 `msgLoginFailed` のまま変更しない）
9. 一致かつ有効 → `RecordSuccess` → `CreateSession` → Cookie（現行どおり）

### 3. 最低パスワード長

- 定数 `MinPasswordLength = 8`（`user.go`）
- 共有 `validatePasswordLength` を `validateUserCreate`、MySQL `UpdateUser`、テスト用 `memoryRepo.UpdateUser` のすべてから呼ぶ（handler テストは memory 経路）
- ログイン時の長さチェックはしない
- シード（`SeedAdminFromEnv`）も `validatePasswordLength` を適用（短すぎる `ADMIN_INITIAL_PASSWORD` は `ErrAuthSeed`）

### 4. nginx `limit_req`（コンテナ）

`deploy/nginx.conf` は `conf.d` 経由で `http` コンテキストに載る（既存の `map` と同様）。同一ファイルに:

```nginx
limit_req_zone $binary_remote_addr zone=api_general:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=api_login:10m rate=1r/s;
limit_req_status 429;
```

- `location = /api/auth/login` を `/api/` より **前** に定義し `limit_req zone=api_login burst=5 nodelay;`＋既存と同様の `proxy_pass` / header
- `location /api/` に `limit_req zone=api_general burst=20 nodelay;`
- Dockerfile / entrypoint のコピー経路は変更不要（template が更新されればよい）

アプリ側ロックと nginx は独立。nginx は接続単位の粗い盾、アプリはユーザー／IP の連続失敗ロック。

### 5. ドキュメント清掃（カード要件）

`docs/production-deploy-status.md`:

- 公開 URL → `https://<your-cloud-run-url>` 等
- Basic ユーザー名 → `<basic-user>` 等
- 「実 URL・認証情報はリポジトリ外（Cloud Run 環境変数等）で管理する」旨を短く追記
- 手順の意味は残す

### 6. OpenAPI（L-974）

`docs/openapi.yaml`:

- `/api/auth/login`: `429` レスポンスを追加し、既存 `Error` スキーマ（必須 `message`）を参照。説明に「連続失敗による一時ロック」を一文
- `POST /api/users` / `PATCH /api/users/{id}`: パスワードが 8 文字未満のとき 400 になる旨を説明または schema に追記（実装と同じ変更セットで更新）

### 7. テスト

新規:

- リミッタ単体: 5 失敗で Allow=false、15 分経過で復帰（再ロックは再び 5 回）、Success でクリア、login/IP 独立キー
- Login ハンドラ: 存在しないユーザーでもダミーハッシュ経路；ロック中 429；無効ユーザーは正しいパスワードでも 401 かつ `msgLoginFailed`（L-085: 列挙手がかりを増やさない）
- パスワード 7 文字の Create / Patch が 400、8 文字は成功

既存の更新・回帰:

- `TestUsersAPIListCreatePatch`: 重複作成ケースの `password:"x"` は **検証が先に走り 400 になる**ため、409 を期待する重複ケースは **8 文字以上のパスワード**に差し替える。短いパスワードの 400 は別アサーションで固定
- `TestAuthLoginLogoutMe` および同ファイルの Basic / me / セッション系既存テストを通す
- 正しいログイン 200・失敗 401・無効ユーザー 401 の既存期待を維持（429 追加は新規ケース）

## リスクと制約

- プロセス再起動でロック状態は消える（許容）
- 複数レプリカだと制限が緩む（現状単一想定・既知）
- ダミーハッシュ比較は常にコストが発生する（意図どおり。DoS は nginx＋ロックで緩和）
- X-Forwarded-For 偽装: 信頼プロキシ前提。直接公開時は RemoteAddr のみになるよう運用で担保

## 実装タスク概要（プランへ引き継ぎ）

1. `login_rate_limit.go` ＋テスト
2. `handler.login` 改修＋ダミーハッシュ＋`clientIP`＋テスト
3. `MinPasswordLength` を `validateUserCreate` / `UpdateUser`＋テスト
4. `deploy/nginx.conf` に zone / limit_req / 429
5. `production-deploy-status.md` スクラブ
6. `openapi.yaml`: login 429 ＋ users パスワード長の 400 説明
7. 既存 users テストの重複ケースを 8 文字以上に更新し、`go test ./internal/kanban/...` 等で検証（コミットは feature ではしない）
