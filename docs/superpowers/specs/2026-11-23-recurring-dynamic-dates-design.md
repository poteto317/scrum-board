# 繰り返し起票タイトル／説明の動的日付（#136）

## 背景

繰り返しルールの `title` / `description` は起票時にそのままコピーされる。週次などで「その週の開始日」をタイトルに含めたいが、静的文字列ではできない。カード要件: 週は**日曜日スタート**。カード本文の「タイトルなど」を、起票説明（`description`）にも同じ展開を当てる範囲と解釈する。`{{date}}`（発火日）は週次以外でも使える最小セットとして v1 に含める（カード必須は `weekStart`、`date` は同実装コストの付随トークン）。

## 要件

1. ルールに保存する起票タイトル・説明に、日付プレースホルダを書ける。
2. `POST /api/recurring/run`（および同等の RunRecurring）でアイテムを作るとき、ルールの **timezone** と下記「展開基準時刻」でプレースホルダを展開してから `createItemInTx` する。
3. 週の開始は **日曜 0:00（ルール TZ）**。その週に属する発火日を含む週の日曜を `weekStart` とする。
4. API の CRUD スキーマは変えない（保存値はテンプレートのまま。展開は run 時のみ）。
5. フロントはプレースホルダの説明（例とトークン一覧）をルール編集 UI に出す。**保存時のサーバ検証は増やさない**（未知 `{{...}}` も保存可）。run 時も未知は残す（L-044: 黙って別トークンへマップしない）。
6. README の繰り返し／認証周辺に触れず、**OpenAPI（rule の title/description）と UI ヒント**を実装に合わせる（L-203）。

## 決めたこと

| 事項 | 決定 |
| --- | --- |
| 対象フィールド | `title` と `description` |
| 構文 | `{{token}}` のみ（v1。書式サフィックスは入れない） |
| トークン照合 | **完全一致**の `{{weekStart}}` と `{{date}}` のみ置換。空白入り（`{{ weekStart }}`）、別ケース（`{{WeekStart}}`）、未閉じはすべて「未知」として残す |
| トークン意味 | `weekStart`＝その週の日曜（TZ ローカル日付）、`date`＝展開基準時刻の TZ ローカル日付 |
| 出力形式 | どちらも `YYYY-MM-DD`（例: `2026-11-23`） |
| 未知の `{{...}}` | 置換せず原文のまま残す（起票は成功） |
| **展開基準時刻** | `runOneRecurringRule` に渡る **`now`（UTC）**。`shouldFire` が true になったあと同じ瞬間。cron の理論上の `next` は使わない（既存が `last_fired_at` に `now` を書くのと揃える。遅延 run・初回 `lastFiredAt==nil` も同じ） |
| `fireAt` の受け渡し | `shouldFire(..., now)` 成功後、同じ `now` と `time.LoadLocation(rule.Timezone)` を `expandRecurringText` に渡す（`nextFireAfter` を展開用に再計算しない） |
| 展開後の title 長 | 既存 `validTitle` / `createItemInTx` の制限に従う。超過なら起票失敗 → 当該ルールは `failed++`（他ルールは継続） |
| 不正 TZ | 既存どおり `shouldFire` が error → `failed++`。展開に到達しない |
| 週境界 | 日曜 0:00 含む〜翌日曜直前。展開基準時刻のローカル日付が属する週の日曜 |
| セッション／Basic | 変更なし |
| OpenAPI（L-203） | **正**: recurring rule の `title` / `description` スキーマ説明に、(1) `{{weekStart}}` / `{{date}}` の意味、(2) **run 時のみ**展開、(3) 未知 `{{...}}` はそのまま起票、を書く。`/api/recurring/run` への追記は任意。README 更新は v1 非必須 |
| カード範囲 | 必須: `weekStart`＋日曜週＋title。説明展開と `{{date}}` はカード「など」＋同関数で実装する付随（プランで Nice 扱いしない＝必須成果物） |

### 例

- テンプレ: `週次レビュー {{weekStart}}`
- タイムゾーン `Asia/Tokyo`、発火が 2026-11-24（火）09:00 → 週開始 2026-11-22（日）→ タイトル `週次レビュー 2026-11-22`

## 非目標（v1）

- 任意 strftime / Go layout 文字列
- `weekEnd`・相対日（`date+1`）・ロケール依存表記（`11月23日`）
- プレースホルダの保存時バリデーション必須化
- 手動「今すぐ起票」UI（既存に無ければ追加しない）

## 設計

### バックエンド

- 新規純関数（例: `expandRecurringText(template string, at time.Time, loc *time.Location) string`）:
  - `at`（= run の `now`）を `loc` に変換しローカル日付を得る
  - `weekStart`: ローカル曜日から日曜まで戻す（`time.Weekday` で Sunday=0）
  - 文字列置換は `{{weekStart}}` / `{{date}}` の完全一致のみ。他の `{{...}}` や空白付きは維持
- `runOneRecurringRule`: `shouldFire` 成功後、同じ `now` と location で title/description を展開してから `createItemInTx`
- 単体テスト: 火曜の now→日曜、土曜の now→同じ日曜、TZ 跨ぎ、未知トークン残存、description も展開、展開後長超過で failed
- 既存 run テストが静的 title 前提なら、展開後一致に合わせる

### フロント

- `recurring.html` の起票タイトル／説明の近くに短いヒント（トークンと例）
- 挙動変更の必須ロジックは無し（保存はテンプレのまま）

### 知見

- L-044: 未知プレースホルダを別トークンに黙ってマップしない。保存時検証も増やさない
- L-203: OpenAPI（title/description 説明）と UI ヒントを実装に合わせる。README は v1 非必須
- 日付計算はサーバの run 時（L-538 の FE「今日固定」問題は対象外）

## 受け入れ

1. ルール title に `{{weekStart}}` を含め、該当 cron で run すると起票タイトルにその週の日曜（YYYY-MM-DD）が入る
2. `{{date}}` は展開基準時刻（run の `now`）のローカル日付。description 内も同様に展開される
3. プレースホルダ無しの既存ルールは従来どおり
4. UI に使い方のヒントがある
5. OpenAPI の recurring rule title/description 説明に、トークン・run 時展開・未知残存が書かれている
