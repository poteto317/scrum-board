# MySQL InterpolateParams 有効化（#117）

## 背景

`go-sql-driver/mysql` の既定では、プレースホルダ付きクエリは Prepare → Execute → Close の 3 段階になり、往復が増える。API サーバは `mysqlconfig.ForServer`、一部 CLI（`rewrite-origins`）は `mysqlconfig.ForCLI` 経由。**`import-history` は `mysql.ParseDSN` 直叩きで mysqlconfig 外**（今回の入口統一対象外）。

`InterpolateParams = true` の先例は、履歴統合の **専用テスト**（`TestMySQLImportHistoryWithStandardDriverFlags`）が別接続で有効化している程度。大半の `mysqlTestDB` 経路は未設定。

## 決めたこと

| 事項 | 採用 |
|---|---|
| 設定箇所 | `ApplyStandardDriverFlags`（`ParseTime` / UTC / `InterpolateParams`）。`FromDBEnv` 経由で `ForServer` / `ForCLI` DB_* に波及 |
| Import DSN（ForCLI） | `ForCLI` の `KANBAN_IMPORT_DSN` 分岐でも Parse 後に `ApplyStandardDriverFlags`（`rewrite-origins` 等） |
| import-history | **非対象**（mysqlconfig 外のまま。カードの入口は `mysqlconfig/config.go`） |
| 文字コード | **DB_* / FromDBEnv**: 既存 `Params charset=utf8mb4` でカード記載どおり追加緩和なし。**DSN 直指定**（`KANBAN_TEST_DSN` / Import DSN）は呼び出し側の charset に依存し、今回 Params を強制しない |
| 統合テスト接続 | `mysqlTestDB` でも `InterpolateParams = true`。**「本番と同じは InterpolateParams のみ」**（`MultiStatements=true` はテスト用のまま） |
| 既存対比テスト | `TestMySQLImportHistoryWithStandardDriverFlags` は両方 true になっても残す（冗長なら後で整理可・必須ではない） |
| 非対象 | クエリ書き換え、接続プール、本番往復計測、`import-history` |
| API | HTTP / OpenAPI 変更なし |

## 目的と受け入れ条件

1. `FromDBEnv` / `ForCLI`（Import DSN 含む）で `InterpolateParams == true`（単体テストで固定）。
2. `KANBAN_TEST_DSN` 付き統合テストが通る（JSON 列などの型退行なし）。既知フレーク `TestMySQLActivateSprintConcurrent` は本変更と無関係のため skip 可。
3. 契約・権限・ロック順の変更は無い。

## 気をつける知見

- **L-1084 / L-777**: N/A（計測追加・ロック順変更なし）。
- ドライバ設定の単一入口は `mysqlconfig` に閉じ、`import-history` は別経路として残す。

## レビュー記録

- 第 1 周（記述の確かさ）: CLI 範囲・履歴テスト過大表現・mysqlTestDB 同一性・import-history 非対象を修正。
- 第 2 周（範囲と知見）: 1 プラン妥当。Import DSN 分岐の漏れ防止を受け入れに含む。charset は DB_* と DSN 直指定を区別。L-1084/L-777 N/A 維持。
