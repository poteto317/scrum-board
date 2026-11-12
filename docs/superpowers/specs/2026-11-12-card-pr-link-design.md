# カードとGitHub PRの紐付け

## 目的と要件
PR紐付け機能として、カードから実装PRを辿れるようにする。詳細画面のプロパティ欄に任意のGitHub PR URL入力を追加し、既存の保存ボタンで保存する。保存済みURLは「GitHub PR ↗」のリンクとして、その下にURLを表示し、別タブに開く。空欄の保存で解除する。1カードにつき1 URLを持つ。

## 決めたこと・方式
実装者の判断として、既存CardのprUrl文字列プロパティと部分更新APIを拡張する。説明にURLを埋め込む方式より専用欄の方が編集と参照が明確であり、複数PR管理は今回の小さな要件を超えるため採用しない。GitHub認証・PR情報取得・ステータス連動・自動保存・一覧でのリンク表示は含めない。

## 入力・API
Card JSONにprUrlを常に返す（未登録は空文字）。既存PATCH /api/cards/{id}へ任意prUrlを追加し、省略・nullは従来のポインタ形式に合わせ変更しない。空文字は解除。作成APIでも任意に受け付け、未指定は空欄。前後の空白を取り除き、https://github.com/{owner}/{repo}/pull/{positive integer} だけを受け付ける（所有者・リポジトリは英数字、_、-、.）。owner/repoの`.`・`..`単独セグメントはブラウザーで別パスへ正規化されるため拒否する。長さは2048 ASCII文字まで。末尾スラッシュ、query、fragment、credentials、port、他ホスト、制御文字、バックスラッシュは拒否する。ホストは小文字のgithub.comを使う。PR実在確認やネットワークアクセスはしない。画面でも同じ規則で検証し、入力エラーを表示。リンクは保存済みcard.prUrlだけを使用し、target=_blank、rel=noopener noreferrerを設定する。

## 永続化と移行
既存cards表を変更せずcard_pr_links(card_id PK FK cards ON DELETE CASCADE, pr_url VARCHAR(2048))補助表をAPI起動時にCREATE TABLE IF NOT EXISTSで準備する。読み取りはLEFT JOINとCOALESCEで未登録を空文字にする。作成・更新の既存トランザクション内でURLを保存し、失敗時は全体rollbackする。prUrl省略時は既存値を保持する。更新はcards本体の行だけをFOR UPDATEでロックし、その後にLEFT JOINで読み取る（欠損リンクのgap lockによる別カード同士のdeadlockを避ける）。番号・内部ID・本文・列・作成日時を移行で書き換えない。採番初期化とは独立し、両方が成功してからHTTP公開する。利用中DBはバックアップ取得後に新APIへ切り替える。

## Done済みカードの反映
既存のDoneカードへ、PR本文に根拠があるURLを新APIから部分更新して確認する。適用直前に再取得しタイトル・番号・Doneを確認、すでに別URLがある場合は上書きせず確認する。他フィールドが保持されたことを更新後に比較する。PR作成後、当該機能カードにも今回のPR URLを紐付ける（ステータスは変えない）。これら固有のデータをスキーマや初期データへハードコードしない。

## 検証・知見
L-018 URLの検証値をそのまま保存・使用。L-454/L-456省略プロパティと既存データを保持。L-035内部IDと公開番号を混同しない。L-037/L-040既存のルート切替取消と失敗時入力保持を維持。L-059専用MySQLで既存DB移行・再起動・部分更新・rollback・削除cascadeと実HTTPを確認。Angularでロード・保存・解除・不正URL・失敗時保持・保存済みリンクを検証する。通常DBで検証カードを作らず、使い捨てComposeでsmokeを実施する。
