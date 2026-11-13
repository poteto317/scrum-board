# カードの変更履歴

## 要件と決めたこと
変更履歴機能として、詳細画面へ変更履歴を追加する。今後の新規作成とタイトル・説明・ステータス・PR URLの実際の変更を保存する。自動保存/API双方を既存Repositoryの同じ入口で記録し、カード更新と履歴を同一txで確定する。値が変わらないPATCHは履歴を増やさない。履歴から戻す操作、認証/操作者の推測、削除カードの閲覧は含めない。削除時はカードの履歴もcascade削除する。

既存行にupdatedAtしかないため、そこから全変更を推測する方式は採らない。追記専用の補助表card_historyを使い、イベントにkind(created/updated/baseline/restored)、occurredAt、recordedAt、changes配列(field,before,after文字列)、note、evidenceUrlを保存する。カードID FK、イベントキー（任意、カード内一意）、日時/ID索引を持つ。画面では作成・変更・導入時の状態・復元記録を区別し、復元の出典と注記を表示する。baseline/createdはafterだけを表示する。status差分は当時の列名を保存する。

## 初期化・保存・取得
HTTP公開前に冪等DDLと既存カードのbaselineを作る。baselineは履歴が1件もない既存カードのみを対象とし、作成履歴がある導入後カードへ次回起動時に追加しない。baselineは導入時刻の観測状態であり、作成時の内容とは扱わない。カード単位でcards本体を先にロックし、既存の番号/本文/列/作成・更新日時を変更せず一意キーbaseline-v1で一度だけ保存する。
新規作成/更新のtx内でイベントをINSERTし、INSERT失敗時はカードと番号発行もrollback。カード本体のみの行ロックを維持し、LEFT JOIN欠損キーのgap lockを再導入しない。
GET /api/cards/by-number/{number}/history?before={eventId} は公開番号で解決し、occurredAt降順/id降順で50件とnextBefore（続きなし0）を返す。カーソルは同じカードのイベントだけを許可し、不正値400、カード/カーソル未存在404。新規復元が古い日時でも日時順に表示できるよう、cursorの日時とIDを比較する。

## UI
詳細の編集欄の下に独立コンポーネントを追加する。履歴の読込失敗で編集を止めない。保存成功のupdatedAt変化で先頭から再取得し、別カードへ移る時は古い取得と追加読込を取消す。50件ずつ「さらに表示」。before/afterの長文・改行・空値を読めるよう折返し表示し、Angularのテキスト補間を使う。evidenceUrlはhttps://github.com/.../pull/正整数形式を既存検証で制限し、別タブにはnoopener noreferrer。保存したPR URLと出典リンクを混同しない。

## 過去分の復元
専用CLI import-historyで、レビュー可能なJSON記録をまとめて追加する。各記録はnumberと期待内部ID、キー、occurredAt、changes、note、evidenceUrlを持ち、kindはrestored固定。未知のカードやID不一致、不正な日時/field/URLは拒否、全体をtxで確定する。一意キーで再実行しても増えず、既存カードの値/日時を変更しない。公開の履歴追加HTTP APIは設けない。
今回の復元元は既存createdAt、当時のSQL/JSONバックアップ、PR#2〜6の本文とmergedAt、今回の着手前後のAPI取得。内部IDと作成日時で対象を照合する。バックアップ間の差分は観測間の変化として表示し、イベント時刻には後の観測時刻を用いる旨を注記する（正確な変更時刻と偽らない）。作成時刻だけ分かる場合は初期本文を捏造しない。PRマージを根拠にステータス変更の正確な時刻を推測しない。根拠データとmanifestはignored領域へ保管し、固有カードやPRの対応を起動処理へハードコードしない。

## 検証と知見
L-035/455/456番号・IDと既存データ保持、L-038/454更新と履歴のtx/省略保持、L-037/040 UI取得取消、L-059実MySQLで冪等移行・更新/履歴rollback・並行更新・pagination・import再実行/失敗rollbackを確認。Angularで読込/追加/失敗/ルート切替/保存後再読込、専用ComposeでHTTP受け入れとブラウザー表示を確認する。通常DBはAPI停止・ダンプ後に反映し、復元前後の全カードを照合する。削除済みカードや根拠のない操作は復元しない。
