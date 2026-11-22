# API Basic 認証（セッションと併用）

## 背景

本番は nginx Basic（`AUTH_USER` / `AUTH_PASSWORD`）のあと、Go の `withSessionAuth` が Cookie `sb_session` を要求する。`curl -u` / `--netrc` だけでは `/api/board` 等が `401`（`ログインが必要です。`）になる。エージェント・スクリプトが login→Cookie を毎回踏むのは摩擦が大きい。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 方針 | Go ミドルウェアが `Authorization: Basic` を受け、`users` の login/password でそのリクエストを認証する |
| ブラウザ | `Sec-Fetch-Site` があるリクエストでは Basic を無視し Cookie セッションのみ（nginx が送り続ける Basic と衝突しない） |
| Cookie | 既存のセッションログインは維持。有効 Cookie があれば Basic は見ない |
| セッション発行 | Basic 成功時に Cookie / `sessions` 行は **作らない**（リクエスト単位の認証） |
| クライアント | MCP・スキルの自動 login は本変更の対象外 |
| nginx | 本番エッジの Basic ゲートは変更しない |

## 目的と受け入れ条件

1. 有効な `users` の login_name / password を `Authorization: Basic` で送ったリクエストは、**`Sec-Fetch-Site` ヘッダが無い**（非ブラウザ: curl・エージェント等）場合に限り、Cookie 無しでも `CurrentUser` 付きでセッション必須の `/api/*` を処理できる（例: `GET /api/board` → 200）。`Sec-Fetch-Site` があるブラウザリクエストでは Basic を無視する。
2. 検証はログインと同じ: `GetUserByLoginName` → `Disabled` なら拒否 → `CheckPassword`。必須経路で Cookie も有効 Basic も無い／Basic が不正なときは既存どおり **401** と `msgLoginRequired`（平文パスワード・`err.Error()` を出さない。login の `msgLoginFailed` には寄せない）。
3. 有効な `sb_session` Cookie がある場合は従来どおり Cookie のみで認証し、Basic ヘッダの有無・正誤は問わない。
4. Basic 成功時に `CreateSession` / `Set-Cookie` を行わない。
5. `sessionExempt` / `sessionOptional` の経路は従来どおり。Optional で Cookie も Basic も無い／無効なら匿名続行。Optional で **有効な Basic** があれば `CurrentUser` を載せる。
6. ブラウザの `/login` Cookie フロー、nginx Basic、Scheduler のセッション免除パスは壊さない。
7. 単体テストで少なくとも次を固定する: Basic のみで board 相当が通る／誤 Basic は 401／有効 Cookie 優先／Basic 成功後に Set-Cookie が無い。
8. OpenAPI（および必要なら README の認証注記）を実装に合わせて更新する。

## 認証モデル（更新後）

```
[Client] --(nginx Basic: AUTH_*)--> [nginx] --proxy--> [Go withSessionAuth]
                                                      |
                                                      +-- Cookie sb_session 有効 → CurrentUser
                                                      +-- Cookie 無し + Sec-Fetch-Site 無 + Basic 有効 → users 照合 → CurrentUser（セッション無し）
                                                      +-- Sec-Fetch-Site あり → Basic 無視（Cookie のみ）
                                                      +-- どちらも無し（必須経路）→ 401

[Browser] は従来どおり POST /api/auth/login → Cookie
```

本番では nginx Basic のユーザー／パスワードと、シード admin（`AUTH_USER` / `AUTH_PASSWORD`）が一致している前提で、同じ資格情報がエッジと Go の両方を通る。アプリ内でユーザーパスワードだけ変えた場合、nginx と Go が食い違う既存リスクは本変更では扱わない。

## 実装メモ

- 変更の中心: `backend/internal/kanban/auth_middleware.go` の `withSessionAuth`。
- 再利用: `GetUserByLoginName`、`CheckPassword`（`auth_handler.go` の login と同型）。
- Basic パースは標準ライブラリ（`net/http` の `BasicAuth`）を使う。
- 失敗メッセージ: 必須経路で認証できないときは常に `msgLoginRequired`（ユーザー列挙を増やさない）。

## 非対象

- nginx htpasswd の廃止や IAM 化
- Bearer / API キー
- Basic 成功時のセッション永続化
- クライアント（MCP・curl ラッパ）の自動 login 実装
- パスワードローテーション運用の自動化

## テスト計画

- ミドルウェア／ハンドラテスト: Basic 成功・失敗・Cookie 優先・Set-Cookie 非発行・Optional 経路。
- 手動: 本番相当 URL で `curl --netrc`（または `-u`）のみの `GET /api/board` が 200。
