# ユーザー機能の土台（アイテム #75）

## 背景

カード要件:

- ユーザー機能を作り、後々に権限などの機能を付与できるようにする。

現状:

- 本番の入り口は **nginx Basic 認証**（`AUTH_USER` / `AUTH_PASSWORD`）。Go API 自体に認証ミドルウェアは無い。
- 担当（`assignee`）は自由文字列＋プリセット（Cursor 等）。ユーザーマスタは無い。
- Cookie / セッションログインは未実装。CORS 不要（same-origin proxy）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| スコープ | **1A** ユーザー CRUD ＋ `role`（admin/member）土台。細かい権限マトリクスは作らない |
| 認証 | **2A** アプリのセッションログインを本線の「誰か」。nginx Basic は機械アクセス／既存ゲートとして残す |
| 項目 | **3A** `login_name`（一意）・表示名・password_hash・role・有効/無効 |
| 担当 | **4A** ユーザー一覧から選択可。既存の自由入力＋プリセットは残す |
| 管理 UI | **5A** `/users` ＋ヘッダー「ユーザー」。編集は admin のみ |

ユーザーは推奨を一括採用。

## 目的と受け入れ条件

1. `users` テーブルがあり、起動 migrate で作成される。フィールド: id, login_name（UNIQUE）, display_name, password_hash, role (`admin`|`member`), disabled（bool）, created_at, updated_at。
2. ユーザーが 0 件のとき、起動時に `AUTH_USER` / `AUTH_PASSWORD` から **admin を 1 人シード**する（login_name=AUTH_USER, display_name=AUTH_USER）。**users=0 かつ AUTH_USER または AUTH_PASSWORD 欠如 → プロセス起動失敗**（L-462）。シード後も既存 nginx Basic ゲートは維持。再起動で二重シードしない。
3. セッションログイン: `POST /api/auth/login`（login_name + password）→ HttpOnly Cookie。`POST /api/auth/logout`。`GET /api/auth/me` で現在ユーザー（未ログインは 401）。
4. パスワードは **bcrypt**（コスト定数 **10**）。平文をログ・レスポンス・**例外メッセージ**に出さない（L-017 / L-029）。ログイン失敗・シード失敗・bcrypt 失敗の HTTP／ログ文言は **固定文**のみ（`err.Error()` をクライアントへ返さない）。
5. FE: `/login`。`/me` が **401 のときだけ**ログインへ誘導。5xx・ネットワーク失敗はログイン扱いせずエラー表示（L-002）。ログイン済みで `/login` を開いたらボード（または returnUrl）へリダイレクト。**ログアウトまたは別ユーザーで再ログインしたら**、メモリ上の `/me`・users 一覧・admin UI 状態を破棄してから取り直す（主体切替）。
6. `GET /api/users`: ログイン必須。担当ピッカー用に id / display_name / login_name / role / disabled を返す（password 無し）。disabled は一覧に含めるが担当選択 UI では選べない（非活性表示）。**一覧 GET 失敗 ≠ 空成功**（loading / error / empty を区別。L-002）。
7. ユーザー管理（作成・更新・無効化・パスワード変更）は **role=admin** のみ。member は管理系 API で 403。拒否: 自己の無効化、**最後の有効 admin の無効化、最後の有効 admin の role を member へ降格**。
8. `/users` ページ＋ヘッダー catalog `open_users`（表示名「ユーザー」、board/backlog/itemDetail）。**member もページ閲覧可（一覧 GET 共用）。管理コントロール（追加・編集・無効化・パスワード）は admin のみ表示。** 管理系 API は member に 403。
9. 担当 UI: 有効ユーザーをチップ／候補として追加。既存 `ASSIGNEE_PRESETS` と自由入力は残す。保存は従来どおり **表示用文字列**（選んだユーザーは `display_name`）。`user_id` 列への移行は非対象。
10. nginx Basic・Scheduler の Basic 呼び出しは壊さない。Go のセッション必須から除外する経路は次のみ: `POST /api/auth/login`、`POST /api/auth/logout`、`POST /api/trash/purge`、`GET /api/public-config`（entrypoint 起動プローブ）、`GET /api/health`。MCP・手動 curl・smoke の **一般 API** はログイン（Cookie）が追加で必要（README／デプロイに明記）。
11. 細かいリソース権限・OAuth・招待メールは非対象。

## 認証モデル（確定）

```
[Browser] --(nginx Basic)--> [nginx] --proxy--> [Go]
                                |
                                +-- /health: Basic 免除（現状維持）
[Scheduler] --(Basic)--> nginx --> POST /api/trash/purge（Go セッション不要）
[entrypoint] --> GET /api/public-config（ループバック・セッション不要）

Go セッション不要:
- POST /api/auth/login
- POST /api/auth/logout
- POST /api/trash/purge
- GET /api/public-config
- GET /api/health

Go セッション必須: GET /api/auth/me、/api/users*、ボード／アイテム等の上記以外すべて
```

Cookie: 名前 `sb_session`。属性 `HttpOnly; SameSite=Lax; Path=/`。`Secure` は **HTTPS リクエスト時のみ**付与（ローカル HTTP では付けない）。  
ストア: **DB テーブル `sessions` のみ**。カラム: id（ランダム）, user_id, expires_at, created_at。  
有効期限: **14 日**（定数）。ログアウト・ユーザー無効化で当該セッション行を削除。

二重ゲート: ブラウザは当面 Basic＋ログイン。Basic 撤去は別カード。

機械アクセス: セッション不要は上表のみ。その他の自動化は Cookie ログインまたは後続トークン。

## データ

- `users` … AC1。password_hash は bcrypt。
- `sessions` … 上記。
- `database/init/001_schema.sql` と `InitializeUsers` / `InitializeSessions` を同期。
- assignee カラムは変更しない。

## API（概要）

| 方法 | 経路 | 認可 | 本文 |
|------|------|------|------|
| POST | `/api/auth/login` | 公開 | `{ "loginName", "password" }` |
| POST | `/api/auth/logout` | 任意 | なし |
| GET | `/api/auth/me` | ログイン | — |
| GET | `/api/users` | ログイン | — |
| POST | `/api/users` | admin | **必須:** loginName, password, displayName。**任意:** role（省略時 `member`） |
| PATCH | `/api/users/{id}` | admin | 任意フィールド: displayName, role, disabled, password（指定時のみ更新） |
| POST | `/api/trash/purge` | セッション不要 | — |
| その他既存 API | … | ログイン必須 | — |

ログイン失敗は 401（統一メッセージ。ユーザー有無を漏らさない）。disabled はログイン不可。

## UI

- `/login`: login_name + password。成功で returnUrl（安全な同一オリジン相対パス）またはボードへ。
- `/users`: 一覧は全ログインユーザー。追加・表示名編集・role・無効化・パスワード再設定は admin のみ。
- ヘッダー: `open_users`。詳細の担当欄に有効ユーザー候補を追加。
- a11y: フォームラベル、エラーは `role="alert"`。

## 実装方針（分割）

1. **BE データ:** users/sessions migrate、シード（AUTH 欠如は起動失敗）、リポジトリ。
2. **BE 認証:** ログイン／ログアウト／me、DB セッション Cookie、ミドルウェア（purge・login・logout 除外）。
3. **BE users API:** list/create/patch、admin ガード、最後の admin 保護（無効化＋降格）。
4. **FE:** login、`/me` 401 のみガード、/users、header、assignee 候補、`withCredentials`。
5. **検証・手順:** テスト。README／deploy にログイン必須と MCP/smoke の注意を一文。

## 非対象

- リソース単位の ACL / プロジェクト権限
- OAuth / SSO / 招待メール
- assignee の `user_id` カラム移行・プリセット廃止
- nginx Basic の撤去
- パスワードリセットメール
- MCP 専用トークン／サービスアカウント（後続可）

## 知見（手順 4）

- **L-017 / L-029:** パスワード・ハッシュをログ／エラー／JSON に出さない。シードでも平文をログしない。
- **L-462:** users=0 かつ AUTH 欠如は **起動失敗**（スキップや認証バイパスなし）。
- **L-002:** ログイン失敗と「ユーザー無し」を同じ 401。`/me` の 401 だけを未ログイン誘導に使い、通信失敗と混同しない。users 一覧・担当候補も GET 失敗と空を混同しない。
- **L-037 / L-040:** users 一覧 load／作成・更新の in-flight generation。加えて **ログアウト→再ログイン（主体切替）** で旧 `/me`・一覧・admin 状態を捨てる。
- **L-669:** header prefs を読込前に全 PUT しない（catalog に `open_users` 追加のみ）。
- **L-890:** Scheduler の Basic ヘッダは `KEY=VALUE`（既存スクリプト維持）。

## テスト方針

- シード: 空 DB＋AUTH で admin 1 人。再起動で増えない。AUTH 欠如は起動失敗。
- ログイン成功／失敗／disabled。ログアウト後 `/me` 401。失敗レスポンスに秘密が混ざらない。
- 未ログインで board API 401。purge は未ログインでも成功応答。
- admin のみ user 作成。member は管理 API 403。最後の admin 無効化・降格は 400。
- FE: `/me` 401 → ログイン。5xx ではログインに飛ばない。users GET 失敗 ≠ 空。遅延 load／作成応答が世代後に一覧を汚さない。ログアウト後の再ログインで旧 admin UI が残らない。担当にユーザー候補。自由入力が残る。

## サブエージェントによる設計書レビュー

### 第1周（記述の確かさ）

対応: purge のみセッション除外に固定、DB セッション＋14日固定、シード AUTH 欠如は起動失敗、最後の admin 降格も拒否、member UI を閲覧可・管理は admin のみに固定、POST /users 必須フィールド、`/me` 401 のみ誘導、ログイン済 `/login` はリダイレクト、health は Go 非変更、機械アクセス範囲と MCP 影響を明記、L-037/040 の適用先を users FE に限定。

### 第2周（範囲と知見）

対応: users GET 失敗≠空、主体切替クリア、L-017 の固定文言を AC 化、generation／空区別のテストを追加。
