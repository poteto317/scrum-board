# MCP 平文 HTTP + Basic 拒否（#107）

## 背景

`mcp/src/config.ts` の `loadConfig` は `http:` / `https:` を許可し、ユーザー・パスワードが揃えば常に `Authorization: Basic` を付与する。`SCRUM_BOARD_BASE_URL` を誤って `http://` の外部ホストにすると資格情報が平文で流れる。

## 受け入れ条件

- `SCRUM_BOARD_AUTH_USER` と `SCRUM_BOARD_AUTH_PASSWORD` が両方非空のとき、`SCRUM_BOARD_BASE_URL` が **`http:` かつループバック以外** なら `loadConfig` は **Basic ヘッダーを組み立てる前に** `insecure_auth_transport` で終了する（評価順: URL 妥当性 → 平文 Basic 拒否 → auth 組み立て）。
- **許可する `http:` ホスト**: `localhost`、`127.0.0.1`、`::1`（URL 上は `[::1]` 含む）。既定 `http://127.0.0.1:4200` は変更しない。
- **`https:`** はホスト問わず Basic 可（TLS 上）。
- **資格情報なし** の `http:` 外部 URL は従来どおり許可（公開 API 取得のみ想定。MCP はセッション未対応のまま）。
- 単体テストで「`http://evil.example` + Basic → 拒否」「`http://127.0.0.1` + Basic → 許可」「`https://evil.example` + Basic → 許可」を固定する。

## 決めたこと

| 事項 | 選択 |
|------|------|
| 拒否位置 | `loadConfig`（`http.ts` は変更しない） |
| エラー | `throw new Error('insecure_auth_transport')` |
| ループバック判定 | `URL.hostname` を小文字化し `localhost` / `127.0.0.1` / `::1` / `[::1]` |
| ドキュメント | `mcp/README.md` に制約を追記 |

## 非目標

- MCP へのログインセッション対応、資格情報の Secret Manager 化。
- バックエンド API の TLS 強制。

## 知見（手順 4）

- L-029: 秘密を平文チャネルで送らない
- L-1001: Basic 資格情報と admin 初期値の共有（誤設定時の影響）

## 検証

- `cd mcp && npm test`