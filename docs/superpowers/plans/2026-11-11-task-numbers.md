# タスク番号の連番化 Implementation Plan

**Goal:** 内部IDを維持して既存カードを1..Nへ採番し、新規カードは正常作成時だけ連番を進める。
**Architecture:** Card.numberと採番表・カウンターを追加。初回移行と作成は同じカウンター行ロックで直列化し、APIの全取得経路と両画面へ番号を渡す。
**Tech Stack:** Go/database/sql、MySQL8.4、Angular21、既存mysqlドライバーのみ。
**Spec:** docs/superpowers/specs/2026-11-11-task-numbers-design.md（独立設計レビュー済み・指摘なし）

## Global Constraints
既存id/本文/日時を保持。画面URLはnumberへ統一する。初回のみ作成日時→id順で1..N。以後の番号は不変、削除番号は再利用しない。失敗作成で番号を消費しない。初回サンプル1件から次は2。numberはAPI出力専用。利用中DBへのテスト書込禁止。PR作成で終了・マージしない。実装完了まで中間コミットしない。

## Review Focus
- 既存データ移行でid/日時/本文が維持され、リンクはnumberへ統一される（L455/456/035）。
- 失敗INSERTで内部AUTO_INCREMENTだけ進んでも表示番号は進まない。
- 並行作成/並行初期化で番号が重複しない（L037）。
- 再起動と削除で既存番号を変更・再利用しない。
- フロントの表示とルートはnumber、更新・削除には返されたidを使う（L059実DB検証）。

### Task 1: 永続的な採番
**Files:** backend/internal/kanban/{model,repository,numbering,numbering_integration_test}.go, backend/cmd/server/main.go, backend/internal/kanban/handler_test.go
**Interfaces:** Card.Number int64(json:number)。MySQLRepository.InitializeNumbers(context.Context) error。CreateCardはCardを返しNumberが付与される。
- [x] 専用DB scrumboard_numbering_test にだけ接続する実DBテストを先に追加。KANBAN_TEST_DSN未設定時skip、他DB名は拒否。既存の初期SQLでセットアップした隔離DBを利用する。
- [x] テストは既存id1/17/18→number1/2/3・本文/日時不変、再初期化、失敗作成→次番号4、並行作成の連続一意性、削除後の非再利用、更新後番号保持、並行初期化を検証。別の専用DBでサンプル1件→number2も確認する。
- [x] `go test ./...`で未実装のNumber/InitializeNumbersによるREDを確認。
- [x] numbering.goで補助2表の冪等DDLとカウンター行ロックの移行を実装。repository.goでJOIN取得・scanにnumberを追加し、作成を同一トランザクションの採番へ変更。更新・削除はidのまま維持。
- [x] main.goのDB接続成功後、HTTP公開前に初期化。移行失敗は起動失敗として返す。
- [x] Go race/vetと専用MySQLテストを成功させる。DDL/バックフィル/作成の原子性とロールバックを読む。

### Task 2: 番号表示とAPI契約
**Files:** frontend/src/app/{models.ts,board.html,board.spec.ts,card-detail.html,card-detail.spec.ts}, scripts/smoke.py, README.md
**Interfaces:** Card.number:numberは応答必須。書込payloadはtitle/description/columnIdのまま。routeは/cards/:number。
- [x] id18/number3の詳細がTASK-003を表示し、更新対象は18であるテストを追加。id17/number2のボード表示とhref=/cards/2もテストする。
- [x] `npm test -- --watch=false`で表示テストのREDを確認。
- [x] 型と両画面をnumber表示へ変更し、fixtureをnumber付きへ更新。既存の操作・レイアウトを維持。
- [x] smokeにnumberが取得/作成/更新で保持される検証を追加。READMEでidとnumberの違い、既存DBの自動移行、削除後の欠番、ロールバックとバックアップ手順を説明。
- [x] Angularテスト・production build・Go race/vet・独立Composeのsmokeを成功させる。

### Task 3: ローカル反映とPRまで
**Files:** docs/verification.md, .claude/dev-flow/state.json/review-log.md（管理外）
- [x] ローカルDBのdumpとAPI読取snapshotを管理外backupへ保存。APIを停止し、更新したDocker API/Webへ置換する。専用テスト用DB・volumeは利用中と区別して削除する。
- [x] snapshotをidで照合し本文・status・日時・全カードが保持され、numberだけ作成順1..Nになったことを確認。ブラウザーでボードと新URL /cards/3 のTASK表示を確認する。
- [x] feature完了後、refactor-srpを観点を変えて対応0件3周連続、review-loopを毎回新規担当者で0件3周連続まで進める。修正があればRED→GREENと全検証。
- [x] 対象ファイルを明示して日本語コミットし、pushして要件・ファイル一覧・検証結果と実装判断を含む日本語PRを作成する。
- [x] PRのURLとローカル反映状態を報告して終了。PRレビュー・マージ・知見pushへ連結しない（ユーザー指定）。

### 追加対応: 詳細URLと表示番号の統一
上記のルートにidを使う制約はユーザー追加要件により置換する。保存/削除APIのidは維持する。
- [x] Go: Repository.GetCardByNumber(context.Context,int64)(Card,error)、GET /api/cards/by-number/{number}を追加。番号とidが交差した2カードの取得、404/400を先にテストしRED→GREEN。
- [x] Angular: /cards/:number、Api.cardByNumber(number)、ボードのnumberリンクへ変更。詳細はnumberで取得し、返されたidで保存・削除。URL3→id18、リンク2、削除18、ルート再利用と旧応答取消しをテストする。
- [x] README/仕様/PR本文の最終方針をURL=numberへ統一。旧URLのID推測はしない。Go race/vet、Angularテスト・build、実DBの読取とブラウザー確認を行う。
- [ ] 独立レビュー後、同じブランチへ日本語コミット/pushしPR #2を更新。マージしない。
