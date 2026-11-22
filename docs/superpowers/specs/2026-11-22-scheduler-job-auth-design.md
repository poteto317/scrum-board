# 設計: 定期ジョブ API の専用認証と CSRF 対策（#97）

## 決めたこと

| 事項 | 採用 |
|------|------|
| ジョブ API | `POST /api/trash/purge`, `POST /api/recurring/run` |
| 認証 | `X-Scheduler-Token` ヘッダとサーバ環境変数 `SCHEDULER_JOB_TOKEN` の一致（定数時間比較）。または **ログイン済み admin**（UI の手動 purge 用） |
| Basic のみ | ジョブ API では不可（セッション免除は維持し、ハンドラで上記を要求） |
| Content-Type | 上記 2 API と `POST /api/auth/login` は `application/json` 必須（415） |
| Origin | `Origin` ヘッダがあるときは `PUBLIC_ORIGIN`（未設定時はリクエストの scheme+host）と一致必須。無いときは許可（Scheduler/curl） |
| Scheduler スクリプト | `PUBLIC_ORIGIN` は `https://` 必須。`AUTH_*` 廃止、`SCHEDULER_JOB_TOKEN` をヘッダにのみ載せる |
| 秘密の保管 | 本番は Secret Manager に `scrum-board-scheduler-job-token`（デプロイ脚本で追加予定、README 記載） |

## 受け入れ条件

1. トークンも admin セッションも無しでは purge/run が 401/403。
2. Scheduler 定義に admin Basic が残らない。
3. ログインが `text/plain` 等の Content-Type を拒否する。

## 知見

- L-085, L-1001, L-974, L-1032