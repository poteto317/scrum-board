# 実装プラン: ログアウト時ボードキャッシュクリア（#100）

## タスク

- [x] `ProjectBoardCache.clear()` + epoch ガード（enqueue / refresh の next）
- [x] `ProjectSession.clearSubjectState()`
- [x] `AuthSession.clearSubject()` から上記を呼ぶ
- [x] `project-board-cache.spec.ts`: clear と in-flight 無効化
- [x] `project-session.spec.ts`: clearSubjectState
- [x] `auth-session` 統合テスト（TestBed）: clearSubject が cache/session を空にする
- [x] `npm test`（frontend・変更 spec 3 ファイル）

## レビュー

- 第1周: 受入2・3をテストタスクに含む。BE なし。
- 第2周: auth 循環依存なし（同一 root injectable）。L-037 を epoch で反映。