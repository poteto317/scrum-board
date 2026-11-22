# 実装プラン: #97 定期ジョブ API 専用認証

## タスク

- [x] `csrf_origin.go` / `scheduler_job_auth.go` 追加
- [x] `purgeTrash` / `runRecurring` / `login` にガード
- [x] `WithSchedulerJobToken` + wiring + deploy Secret Manager
- [x] Scheduler 脚本（トークン・https・JSON）
- [x] テスト + OpenAPI + `.env.example`

## 検証

`cd backend && go test ./internal/kanban/ -count=1`