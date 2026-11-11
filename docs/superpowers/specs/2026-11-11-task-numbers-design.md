# タスク番号と詳細URLの連番化

## 要件と原因
元の参照 http://127.0.0.1:4200/cards/18 の要望は「1は最初にあるので、2からスタートするようにしてほしい。今あるものは、適切な番号に変えて」。加えてユーザーは詳細URLの番号も画面のTASK番号へ揃えるよう指定した。修正後、このカードはTASK-003、URLは/cards/3となる。

現状の内部IDが1,17,18…と飛んでいたのは、MySQLのAUTO_INCREMENTを画面に表示し、削除済みテストカードや失敗INSERTがIDを消費したため。

## 採用方針と代替案
画面とURLに使う不変なタスク番号numberを内部IDから分離する。本文・状態・id・日時は保持する（L-455/L-456）。主キーの直接振り直しは将来の参照を壊すため採用しない。表示index+1は削除や移動で番号が変わるため採用しない。

既存カードは初回移行で作成日時→id順に1..Nを付与する。サンプルだけのDBではサンプル1、次の新規カード2。以後の番号は変更せず、削除後も再利用・隙間詰めをしない。失敗作成は番号を消費しない。3桁ゼロ埋め表示を維持する。

## 永続化
cards本体を変更せず、card_numbers(card_id PK/FK→cards.id ON DELETE CASCADE, task_number BIGINT UNIQUE NOT NULL)とcard_number_sequence(singleton PK,next_number BIGINT)を追加する。

API公開前に補助表をCREATE TABLE IF NOT EXISTSで用意する。バックフィルはトランザクションでカウンター行をSELECT FOR UPDATEし、max(next_number,MAX(task_number)+1)から未採番カードを作成順に採番しカウンターを進める。新規作成も同じ行をロックし、カードINSERT・番号INSERT・カウンター更新を1トランザクションで確定する。失敗はロールバックし、再起動・並行初期化・並行作成にも対応する。

## URLとAPI
- 画面ルートは/cards/:number。ボードもnumberでリンクし、TASK-003のURLは/cards/3。
- GET /api/cards/by-number/{number}を追加し、Repository.GetCardByNumber(ctx,number)が一意なtask_numberからカードを取得する。不正番号は400、未存在は404。
- 既存GET/PATCH/DELETE /api/cards/{id}は内部IDのAPIとして維持する。画面はnumberで取得したCard.idを保存・削除に使用する。
- 全Card JSONはnumberを返す。書込payloadにnumberは追加しない。
- 旧画面URLのID解釈は維持しない。同じ数字が別カードのnumber/idに存在しうるため、番号未存在時にIDを推測するフォールバックは行わない。

## 対象外・反映
他カードにある機能、番号編集、削除後の再採番、旧URL推測リダイレクトは含めない。利用中DBを初期化せずバックアップしてからAPIを置換する。初回移行では旧APIを停止し、新APIの採番完了後に公開する。URL統一の追加対応ではDBの追加移行は不要。旧コードへのロールバックでは画面のURL/表示が旧ID方式へ戻る。

## 検証
実MySQLの専用DBで初期next2・既存id1/17/18→number1/2/3・本文/日時保持・失敗作成・並行採番・再初期化・削除非再利用を確認。APIはid18/number3とid3/number18の交差例で番号取得とID取得を区別し、番号404/400を確認。Angularはリンク/cards/2、URL3→TASK-003、更新/削除id18、番号変更時の再取得と古い応答取消しを確認する。利用中環境は読取だけでDBとブラウザーを確認し、テスト用の作成・削除は専用環境に限定する。

## フロー
featureの設計・計画レビュー、実装、SRP、独立レビューを経て、日本語コミットでPR #2へ反映する。ユーザー指定によりPR作成・更新で終了し、マージしない。
