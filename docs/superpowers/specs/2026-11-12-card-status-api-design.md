# 生成AI向けステータス変更API

## 要件と現状
目的は、生成AIが画面のタスク番号と列名だけでステータスを変えられるようにすること。既存PATCH /api/cards/{id}は列ID指定で更新可能だが、生成AIが画面のタスク番号・ステータス名から扱うにはIDの解決が必要。

## アプローチと決定
既存APIの意味は変更せず、ステータス専用のPATCH /api/cards/by-number/{number}/statusを追加する。bodyは{"status":"Doing"}、応答は既存Card JSONと同じ200。Todo/Doing/Doneだけに限定せず、追加した任意の列名を指定可能とする。名前は前後空白を除去し1〜60 Unicode文字。名前の照合は列作成の一意制約と同じMySQLの照合順序に従う。

既存の内部ID APIだけを説明する案はタスク番号と列名の解決が残るため採用しない。既存PATCHへnumber/idの推測を加える案は誤更新を起こすため採用しない（L-035/L-455）。既存ステータス変更を再利用し、UI・新規DBスキーマ・認証・MCPは追加しない。

## 処理と責務
HTTP層はnumberの正値・JSON形・status文字列を検証し、Repository.GetCardByNumberで対象を取得、Repository.GetColumnByNameで列名から列を解決、既存Repository.UpdateCardへColumnIDだけのpatchを渡す。number→idの対応は不変で、列の改名/削除は未実装のため、読取後の既存更新トランザクションで安全に更新できる。途中でカードが削除されれば更新も404。既存の最終保存優先ポリシーを維持する。

新しいGetColumnByName(ctx,name)(Column,error)は列だけを取得し、ボード全カードを読む処理は避ける（L-315）。既存UpdateCardが行ロック・部分更新・応答取得を担い、タイトルや説明を空値へ置き換えない（L-454/L-456）。JSONの未知フィールドや複数JSONは既存decodeで拒否する。

## エラーと境界
不正number/空白status/過長status/不正JSON/未知プロパティは400。未存在タスクは404、存在しないステータスは400。DB失敗は既存の500応答で内部詳細を漏らさない（L-017）。入力が不正なら一切保存しない。ステータスだけのJSONで本文を消さない。同じステータスへの再送も成功し、カードの重複作成や番号消費は起きない。JSONのstatusはnullや非文字列を認めない。

## 検証と使用例
HTTPテストで公開番号7/内部ID22と番号22/内部ID7の交差例を用意し、番号7だけの更新、本文・番号・作成日時保持、任意の列、再送、404/400/500・失敗時に非更新を検証する。実MySQLの隔離環境で列名取得とステータス変更をAPI/Web経由で確認し、既存のGo race/vetとAngularテスト・buildを実行する（L-059）。利用中のカードを検証のために移動しない。

READMEとAPI使用ガイドへ、curl --fail-with-bodyでPATCH /api/cards/by-number/7/statusに{"status":"Doing"}を送る例、応答columnIdで結果を確認する方法、列一覧とエラーを説明する。ローカルAPIのまま利用し、認証なしの公開運用は追加しない。

## ブランチと完了条件
公開番号は先行PR#2に依存するため、作成時はPR#2のブランチ（fix/card-task-numbers）を基準にfeat/card-status-apiから別PRを作った。PR#2のマージ後にブランチを最新のmainへrebaseし、PRのbaseをmainへ変更した。PR本文は今回のAPI変更に絞る。PR作成後のレビュー・マージ・知見の反映は別フローで実施する。
