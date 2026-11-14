# カードへの複数 GitHub PR 紐付け

## 目的と要件

1カードに複数の GitHub PR URL を紐付け、詳細画面から追加・削除・開封できるようにする。1つの実装が複数 PR に分かれるケースに対応する。並び替え UI は今回やらない（別カード #37）。

## 決めたこと

| 項目 | 決定 |
|------|------|
| API 形 | `prUrl` を廃止し `prUrls: string[]` に置き換え（未登録は `[]`）。互換の `prUrl` は残さない |
| 上限 | 件数上限なし（各 URL は従来どおり ASCII 2048 文字以内） |
| 並び | 登録順を `position`（0 始まり連番）で保持。API は配列順＝表示順。並べ替え UI は #37 |
| 詳細 UI | URL 入力＋追加ボタン、一覧にリンクと削除。既存の URL 検証規則を維持 |
| 重複 | 同一カード内の同一 URL は拒否（400） |
| 置換意味 | PATCH で `prUrls` を送ったら配列全体を置き換え。省略・`null` は変更しない。`[]` で全解除 |
| 履歴 | 変更フィールド名は `prUrls`。before/after は JSON 配列文字列（例: `[]` / `["https://..."]`） |
| 旧履歴 | 既存の `prUrl` 履歴イベントはそのまま表示できる（フロントのラベル互換）。新規記録は `prUrls` のみ |
| 自動保存 | `prUrls` は autosave の対象外。追加・削除の操作ごとに即 PATCH |
| 対象外 | GitHub 認証、PR 情報取得、ステータス連動、ボード一覧での複数リンク表示、並び替え UI |

## 入力・API

- Card / Board / Backlog の JSON: 常に `prUrls`（配列）。`prUrl` キーは返さない・受け付けない（未知扱いで 400 になりうる既存経路に従う）。
- `POST /api/cards`: 任意 `prUrls`。未指定・省略は `[]`。各要素を trim したうえで **非空の** GitHub PR URL として検証（下記）。空文字要素は捨てず 400。不正・重複は 400、カードは作らない。
- `PATCH /api/cards/{id}`: 任意 `prUrls`。省略・`null` は保持。配列なら trim・検証・重複検査のうえ全体置換。空配列 `[]` で全削除（単一 URL 時代の `prUrl:""` に相当）。他フィールドとの同時更新は従来どおり同一トランザクション。
- `POST /api/cards/refined`: 引き続き PR は付けない（応答の `prUrls` は `[]`）。
- 単一 URL の検証: 現行と同じパターン（`https://github.com/{owner}/{repo}/pull/{正の整数}`、owner/repo は英数字 `_-.`、単独 `.`/`..` 拒否、末尾スラッシュ・query・fragment・credentials・port・他ホスト拒否、ホストは小文字 `github.com`、ASCII 2048 まで）。実在確認なし。
- **配列要素では空文字を許可しない。** 現行 `validPRURL("")==true`（単一欄の解除用）は流用せず、要素は「trim 後非空かつ従来パターンに合致」のみ通す。空白のみも trim 後空になり 400。全解除は `[]` のみ。
- 重複判定は trim 後の文字列の完全一致（大文字小文字を折らない）。DB の UNIQUE `(card_id, pr_url)` も同様。
- 件数上限は設けない。極端に長い配列はリクエストサイズや DB 負荷の実限界に任せる（別途ハード上限は置かない）。

## 永続化と移行

既存の `card_pr_links`（`card_id` PK + `pr_url`）を、1カード複数行へ移行する。

新スキーマ（起動時 `InitializePRLinks` で冪等に用意）:

- `card_id BIGINT NOT NULL`（FK → cards ON DELETE CASCADE）
- `position INT NOT NULL`（カード内 0 始まり、隙間なし）
- `pr_url VARCHAR(2048) CHARACTER SET ascii COLLATE ascii_bin NOT NULL`（GitHub PR URL は ASCII。utf8mb4 のままだと UNIQUE が MySQL のキー長上限 3072 バイトを超える）
- PRIMARY KEY `(card_id, position)`
- UNIQUE `(card_id, pr_url)`（同一カード内重複防止）

移行手順（起動時、トランザクション内）:

1. 現行表に `position` 列が無い（旧 PK のみ）なら、一時表へ `card_id, 0, pr_url` をコピー（`pr_url=''` や空白のみの行はコピーしない）、旧表 DROP、新表を正規名で作成／リネーム。
2. 既に新スキーマなら CREATE IF NOT EXISTS / 列確認のみで何もしない。
3. カード本体・番号・履歴行は書き換えない。既存1 URL は `position=0` の1行になる。

読み取り: カードごとに `ORDER BY position` で URL を集め `[]string` にする（JOIN 1行前提をやめる）。Board / Backlog / Get 系すべてで同じ配列を返す。

書き込み: **cards 本体の行だけ**を `FOR UPDATE` でロックし（欠損リンク行の gap lock で別カード同士が deadlock しないよう、2026-11-12 設計と同じ）、同一トランザクション内で対象 `card_id` のリンク行を DELETE し、配列順に `position=0..n-1` で INSERT。失敗時は全体 rollback（L-038）。`prUrls` 省略時はリンク表に触らない（L-454）。

## 画面

詳細のプロパティ欄:

- ラベル「GitHub PR（任意）」
- 入力（type=url）＋「追加」ボタン。検証エラー時は既存と同趣旨の文言。成功したら入力を空にし、一覧を更新。
- 一覧: 登録順。各行に `GitHub PR ↗` + URL 表示、別タブ（`target=_blank` `rel=noopener noreferrer`）、削除ボタン。
- 削除・追加は即 `PATCH { prUrls: 次の配列 }`。失敗時はエラー表示し、操作前の一覧表示を維持する（L-001 / L-037）。成功時だけカードの `prUrls` を応答で更新する。
- ルート変更・別カード読込時は、進行中の PR 用 PATCH を `takeUntil(changed$)`（既存の詳細画面パターン）で打ち切り、古い応答を新しいカードに載せない（L-040）。
- title / description / status の autosave から `prUrl` を外す。

## 履歴・インポート

- ライブ履歴の比較キーを `prUrl` → `prUrls` に変更。値は `encoding/json` のデフォルト（空白なしコンパクト、要素は正規化済み URL 文字列）で揃える。同一内容なら履歴行を増やさない既存方針を維持。
- 履歴インポート検証: 許可フィールドを `title` / `description` / `status` / `prUrls` とする（新規インポートで `prUrl` は拒否）。`prUrls` の before/after は次をすべて満たすこと: (1) JSON テキスト全体が 65536 ASCII バイト以内、(2) JSON 配列にパースできる、(3) 配列は空でもよい、(4) 各要素は文字列かつ「非空の GitHub PR URL」検証に合格。オブジェクト・ネスト配列・null 要素は拒否。
- フロント履歴表示: `prUrls` を「GitHub PR」ラベルで表示。値が URL らしい単一文字列の旧 `prUrl` も従来どおりリンク化。`prUrls` の JSON 配列は要素ごとにリンク表示する。

## ドキュメント

`docs/api.md` と `README.md` の「1カード1 URL」「`prUrl`」記述を `prUrls` 配列仕様に更新する。curl 例も配列に合わせる。

## 検証・知見

関係する知見: L-018（検証値をそのまま保存）、L-454 / L-002（省略と空配列の区別）、L-038（途中失敗で中途半端なリンク行を残さない）、L-035（公開番号と内部 ID）、L-037 / L-040（追加削除の競合と古い応答）、L-015（削除が他フィールドを消さない）、L-540（position の連番を配列順で再採番し衝突させない）、L-456（移行で card id / 作成日時を作り直さない）。

テスト観点:

- Go: 0/1/複数 URL の作成・置換・全解除、重複 400、空文字要素 400、不正 URL 400、省略で保持、`PATCH { prUrls: [] }` だけでも title/description/status が変わらない（L-015）、他フィールド同時更新、起動時旧→新スキーマ移行の冪等・tx rollback、削除 cascade、履歴が `prUrls` コンパクト JSON になること。
- Angular: 追加・削除・不正入力・失敗時保持・保存済みリンク複数表示、autosave が PR 一覧を潰さないこと、遷移中の PR PATCH 応答が別カードに載らないこと。
- 通常の開発 DB に検証専用カードを増やしすぎない。使い捨て Compose / 既存統合テストパターンを使う。

## スコープ外（明示）

- PR 並び替え UI → カード #37
- `prUrl` 互換フィールドの併存
- 件数のハード上限
- ボードカード面への複数 PR 表示
