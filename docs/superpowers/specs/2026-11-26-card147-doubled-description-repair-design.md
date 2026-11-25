# カード147: 説明・ソリューション二重本文の修復 設計書

## Goal

#112（IME×Backspace）修正前に DB へ残った「説明／ソリューション本文が同一文字列の連結で二重になっている」データを、管理者が一度だけ安全に修復できるようにする。新規の二重化を防ぐ UI 変更は #112 済みで、本機能は残存データの掃除だけを扱う。

## 背景

カード #147 の本文は、過去に二重化された説明が手作業では直しにくい、という報告である。#112 の設計では「すでに保存済みの重複本文を推測で自動修復する処理」をスコープ外としていた。フロントの IME ガードは新規発生を止めるが、既存行の `items.description` / `items.solution` はそのまま残る。

二重化の典型は、確定済み本文 `A` が `A+A` として保存された形である。曖昧な類似や部分重複まで直すと誤修復のリスクが高い。

## 要件

1. 管理者だけが実行できる HTTP API で、生存中アイテム（`deleted_at` / `archived_at` が NULL）の `description` と `solution` を走査する。
2. 各フィールド独立に、「文字列全体がちょうど同じ前半と後半の連結」（`text == half + half` かつ `half` が空でない）のときだけ、値を `half` に置き換える。Unicode は rune 列で半分を取る（バイト境界で割らない）。
3. 一度の実行で、半分にしてもなお `half+half` なら上限回数まで畳む（例: `A`→`AA`→`AAAA` が残っている場合）。上限を超えたらそのフィールドは打ち切り、`warnings` 配列に理由を1件ずつ載せ、件数は `warnings` の要素数とする（専用カウントフィールドは設けない）。
4. 実際の書き込みはリクエストで明示する。プレビュー（dry-run）では DB を変えず、対象件数と、アイテム ID＋フィールド名の一覧（`repairs`）を返す。
5. 書き込み時は既存の `UpdateItem` 経路を使い、アイテム ID・作成日時・履歴以外のフィールドをいじらない。変更したフィールドだけ履歴に残る。
6. 成否・件数を JSON で返す。一覧取得など走査開始前の致命的失敗だけ 5xx。アイテム単位の `UpdateItem` 失敗はロールバックせず継続し、最終的に 200 と `failedItemIds` で部分成功を明示する（L-001）。
7. OpenAPI に endpoint を追加する。

## スコープ外

- 起動時マイグレーションでの自動修復。
- 画面上の「重複を直す」ボタンや一般ユーザー向け UI。
- ブロック単位・あいまい類似・部分文字列の重複検出。
- ゴミ箱・アーカイブ済みアイテムの修復。
- #112 以外のエディタ挙動の再修正。
- タイトル・コメント・履歴スナップショット自体の書き換え。

## 決めたこと

- 修復手段: **管理者向けワンショット API**（推奨採用）。起動時 migrate や UI ボタンは採用しない。
- 判定: **厳密な half+half** のみ。誤検知を避ける。
- 対象フィールド: **description と solution の両方**（同じエディタ由来）。
- 認可: 既存の `requireAdmin`（セッション／Basic で admin）。スケジューラトークン専用にはしない。
- プレビュー: ボディ `{"dryRun": true}` で必須確認できるようにする。`dryRun` 省略または `false` で適用。
- 知見反映: L-001（成否を返す）、L-002（空と失敗を混同しない）、L-003（dry-run で先に検証可能）、L-456（ID / createdAt を新規生成しない）、L-018（判定と書き込みで同じ half 関数を使う）。

## API 設計

`POST /api/admin/repair-doubled-text`

- Auth: `requireAdmin`。非 admin は 403、未ログインは 401。
- Content-Type: `application/json`。
- Body:

```json
{ "dryRun": true }
```

- `dryRun` は省略可。省略時は `false`（適用）。
- 成功 200 例（適用）:

```json
{
  "dryRun": false,
  "scanned": 120,
  "descriptionRepaired": 4,
  "solutionRepaired": 1,
  "itemIds": [12, 45, 90, 101],
  "repairs": [
    { "itemId": 12, "field": "description" },
    { "itemId": 45, "field": "description" },
    { "itemId": 45, "field": "solution" },
    { "itemId": 90, "field": "description" },
    { "itemId": 101, "field": "description" }
  ],
  "warnings": [],
  "failedItemIds": []
}
```

- dry-run の 200 も同じ形。`descriptionRepaired` / `solutionRepaired` / `repairs` / `itemIds` は「予定」の意味（DB は未変更）。
- `itemIds`: 少なくとも1フィールドを修復（または dry-run で修復予定）したアイテム ID（昇順・重複なし）。
- `repairs`: 修復対象の `{ itemId, field }`。`field` は `"description"` または `"solution"`。
- `warnings`: 例 `"item 45 description: fold limit reached"`。警告件数 = `len(warnings)`。
- 失敗の扱い: 一覧取得失敗 → 既存 `fail`（5xx）。ループ中の個別 `UpdateItem` 失敗 → その ID を `failedItemIds` に入れて継続し、最後に 200。部分成功を隠さない（L-001）。

## 判定ロジック

純関数 `collapseExactDoubledText(s string, maxFolds int) (out string, folds int, hitLimit bool)`:

1. `s` が空ならそのまま。
2. rune スライス `r` について、長さが偶数かつ ≥2、かつ前半 rune 列と後半が等しいときだけ前半に置き換え、`folds++`。
3. `folds == maxFolds`（既定 8）に達してもまだ二重なら `hitLimit=true` で終了。
4. 判定と永続化は同一関数の結果だけを使う（L-018）。

偶発的に「同じ短い文の繰り返し」を意図した本文も修復されうる。厳密一致かつ管理者の dry-run 確認を前提に許容する。

## 実装配置

- 判定: `backend/internal/kanban/doubled_text.go`（テスト容易な純関数）。
- ハンドラ: 同パッケージの handler メソッド。ルート登録は `handler.go` の admin 系の近く。
- 一覧: 既存の生存アイテム一覧（`ListLivingItems` 相当）。無ければ同等のクエリを repository に追加。
- 更新: 既存 `UpdateItem` + `ItemPatch` で description / solution のポインタのみセット。
- FE 変更なし。運用は curl / HTTP クライアント。
- `docs/openapi.yaml` を更新（`update-api-doc` スキルに従う）。

## テスト設計

- 純関数: 空、奇数長、非二重、単純二重、多重畳み、rune 境界（例: `あいうあいう`）、上限到達。
- ハンドラ: 非 admin 403、dry-run で DB 不変かつ件数が正しい、apply で値が半分になり履歴が1件増える、description のみ二重・solution のみ二重・両方、失敗時に `failedItemIds` が埋まる（スタブ）。修復対象 0 件でも 200（`scanned` は正、`repairs` 空）— 空を失敗にしない（L-002）。
- 回帰: 通常の PATCH description / solution と #112 系 FE テストは触らない（変更なしのため）。
- 運用: 本番適用前に必ず `dryRun: true` を先に叩く（受け入れ条件 1 / L-003）。

## エラー処理

- 不正 JSON: 既存 `decode`。
- 権限不足: 401/403。
- 一覧取得失敗（走査開始前）: 5xx。これ以外でリクエスト全体を abort しない。
- 個別 Update 失敗: その ID を `failedItemIds` に入れ継続し、最終 200。呼び出し元は件数と failed を見て再実行・個別確認する。

## 受け入れ条件

1. admin が `dryRun: true` で対象 ID を事前確認できる。
2. `dryRun: false` 後、対象アイテムの説明／ソリューションが half に戻り、画面再読込で二重表示が消える。
3. 非二重の本文は変化しない。
4. 非 admin では実行できない。
5. OpenAPI に契約がある。
