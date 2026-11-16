# カード自由配置（高さを保つ横移動）設計書

**カード:** https://scrum-board-jkcejsb6ka-an.a.run.app/items/4
**タイトル:** かんばんで移動させる際、高さを変えずに横移動したい

## 背景

現行のボードは列内を flex で上詰めし、CDK の drop index で `position` 順を更新する。列間移動すると視覚的な高さが変わりやすい。利用者は「上に詰める」現行をデフォルトのまま、設定で「空きを許す自由配置」に切り替え、横移動時に高さを保ちたい。

## 決めたこと

| 事項 | 採用 | 根拠 |
| --- | --- | --- |
| レイアウト意味 | **C: 列内に空きを許す自由配置**（`offsetY`） | ユーザー選択（1C） |
| 設定の保存 | **B: サーバー API**（ボード全体の設定） | ユーザー選択（2B）。Basic Auth 共有のみで利用者アカウントが無いため、**端末別ではなくボード共通** |
| 設定 UI | **A: ボードツールバーのトグル** | 未回答のため推奨。ラベル例:「自由配置」 |
| 適用範囲 | 自由配置 ON のとき **列内・列間とも** `offsetY` で描画。OFF は現行の上詰め | 1C に合わせる。未回答の「列間のみ」は自由配置と両立しないため不採用 |
| 既定値 | `pack`（上詰め＝現行） | カード本文どおり |
| `offsetY` 単位 | 列のカードリスト上端からの **CSS px（整数 ≥ 0）** | 実装単純。ズームはブラウザ任せ |
| 重なり | **許可**（衝突回避なし） | YAGNI |
| キーボード矢印 | **`pack` のときだけ**列内 `position` 並べ替え。`free` では無効（詳細のステータス変更は残す） | L-094・L-472 |
| 詳細のステータス変更 | 移動先列の末尾相当: `pack` は現行どおり末尾。`free` はサーバーが DOM 高を知らないため **`offsetY = COALESCE(MAX(offset_y), -160) + 160`**（空列 0、非空は最大 offsetY+160 の近似）。ボード上の DnD は実測のカード上端 Y を使う | 既存経路を壊さない |

## 要件

1. ボード設定 `cardLayout` が `pack`（既定）または `free`。サーバーに永続化し、全クライアントで同じ値になる。
2. `pack`: 現行どおり flex 上詰め + `position` 順。DnD / キーボードは現状のまま。`offsetY` は保持するが描画に使わない。
3. `free`: 各カードを列内で `top: offsetY` の絶対配置。列の高さは「各カードの下端の最大」と空列用 `min-height` の大きい方。横へ別列へ落としたとき **`offsetY` は変えない**（高さを保つ）。同じ列内では、ドラッグ開始時のポインタとカード上端の差分（掴みオフセット）を保った **カード上端の Y**（列上端・スクロール込み、整数 px、`< 0` は 0 にクランプ）で `offsetY` を更新する。
4. ツールバーにトグル。**切替ロック**は下表の直積に従う（L-094）。ロック中は ON/OFF 双方向とも不可（理由を `aria` / 短文で示す）。失敗時はトグルを戻し、ボードを壊さないバナーで知らせる（L-001）。**ボード読込失敗中は設定を保存しない**（L-669）。

   | boardLoad | settingsSave | itemReorder | layoutSwitchSeq | itemDragging | 切替 |
   | --- | --- | --- | --- | --- | --- |
   | loading / failed | * | * | * | * | 不可 |
   | ready | saving | * | * | * | 不可 |
   | ready | idle | saving | * | * | 不可 |
   | ready | idle | idle | in progress | * | 不可 |
   | ready | idle | idle | idle | dragging | 不可 |
   | ready | idle | idle | idle | idle | 可 |
5. `pack` ↔ `free` 切替時:
   - `pack` → `free`: 画面上の上詰め結果から各カードの `offsetY` を測って一括保存してから `free` にする（見た目が跳ばない）。
   - `free` → `pack`: `offsetY` 昇順（同値は `position`, `id`）で `position` を振り直し、レイアウトを `pack` にする。`offsetY` 値は残す（再切替の種）。
6. ライブ更新中も設定と `offsetY` を落とさない。未知の設定キーは読み書きで捨てない（L-459）。
7. バックログ画面は対象外。
8. 文書追従（L-203）: `README.md`（ボード操作・設定）、`docs/api.md`（`settings`・`offsetY`・`PATCH /api/board/settings`・`offsetYs`）、`docs/verification.md` に本機能の確認項目を追加する。

## 非要件

- 利用者ごとの個人設定（アカウント基盤が無い）
- カード同士の自動衝突回避・グリッドスナップ
- `offsetY` の % や rem 保存
- 列ヘッダー sticky の変更
- 自由配置中のキーボードでの Y 微調整

## アーキテクチャ

### データ

- `items.offset_y INT NOT NULL DEFAULT 0`（起動時冪等マイグレーション。既存は 0）。
- `board_settings` テーブル（**key/value**）:
  - `setting_key VARCHAR(64) PRIMARY KEY`, `setting_value VARCHAR(255) NOT NULL`
  - 初期行: `card_layout` = `pack`（無ければ起動時に挿入）
- JSON:
  - `Item.offsetY`（number・整数）
  - ボード応答に `settings: { cardLayout: "pack" | "free" }` を含める（追加フィールド。既存 FE は無視できる）。未知の DB キーは応答に載せず保持する（L-459）。

### API

1. **`GET /api/board`** — 上記 `settings` と各 item の `offsetY` を返す。
2. **`PATCH /api/board/settings`** — body `{ "cardLayout": "pack" | "free" }` のみ（未知フィールド拒否）。
   - **採用:** `free`→`pack` の `position` 再割当は **設定 PATCH と同じトランザクション**（サーバーが `offset_y, position, id` でソート）。成功応答は `{ "settings": ..., "items": [ /* Board と同じ全アイテム */ ] }`（FE が再 GET なしで置換）。`pack`→`free` は settings のみ更新し応答は `{ "settings": ... }`（`items` 省略可）。`pack`→`free` の `offsetY` 初期化は **FE 計測 → `PUT /api/items/order`（offsetY 付き）→ 成功後に settings PATCH**。途中失敗で設定だけ `free` にしない（L-038, L-001）。
3. **`PUT /api/items/order`** — 既存の `columns[].itemIds` に加え、任意で同長の `offsetYs: number[]`。`free` レイアウト保存時は必須扱いに FE がする。サーバーは各値が **整数かつ `>= 0`**（小数・負は **400**）。`offsetYs` 省略時は既存 `offset_y` を維持し `position` だけ更新（`pack` の現行 DnD 互換）。列・カード集合の 409 規則は現行どおり（L-038）。

### フロント

- `board-toolbar` にトグル（チェックボックスまたは switch）。状態は `data().settings.cardLayout`。
- `pack`: 現行 CDK 並べ替え（sorting 有効）。
- `free`:
  - `.card-list` を `position: relative`。カードは `position: absolute; top: offsetY; left/right: 0`（幅は列に合わせる）。
  - CDK は **sorting 無効**（`cdkDropListSortingDisabled`）。列間は `connectedTo` 維持。
  - drop 時: **カード上端 Y**（掴みオフセット込み・上記要件 3）で `offsetY` を求める。列間では **移動前の `offsetY` を維持**（ポインタ Y で上書きしない）。同一列ではその新しい上端 Y。`position` は安定のため `offsetY` 順で振り直してから PUT。
  - プレビューと確定で同じ関数から Y を求める（L-612）。
  - 絶対配置で文書が伸び続ける循環を避ける: ドラッグ中プレビューはリストの layout 高さ計算から外す／既存のページ縦 auto-scroll の「端静止で scrollHeight 不変」を維持（L-680）。
- 設定トグルのロックは要件 4 の直積表を純粋関数化し、該当する理由文を返す（テストで表を固定）。

### テスト

- BE: マイグレーション冪等、`offsetY` の round-trip、settings PATCH 検証、`free`→`pack` で position が offsetY 順、order の `offsetYs` 長不一致 400、省略時に offset 維持。
- FE: `pack` 既定回帰、`free` で横移動時 offsetY 不変、同列ドロップで Y 更新、トグル失敗で UI 復帰、読込前にトグルできない、切替シーケンス（pack→free は order 成功後に settings）。

## 知見（手順 4）

- L-001 成否を呼び出し元へ / 失敗時に成功扱いしない
- L-038 列＋ offset 更新をトランザクション／順序付きで中途半端にしない
- L-094 レイアウト方式切替のロック表
- L-203 設計・README・verification を実装に追従
- L-459 設定の未知キーを捨てない（settings オブジェクトの拡張に備える）
- L-472 表示モードと DnD インデックスの乖離（`free` では index 並べ替えに頼らない）
- L-612 ドラッグプレビューと確定の入力を一致
- L-669 設定読込完了前に保存しない
- L-680 自由配置 DnD 中の scrollHeight 暴走防止

## 受け入れ条件

- [ ] 初回（未設定）は上詰め（現行と同じ見た目・操作）
- [ ] トグルで自由配置にすると、カードを横の列へ移しても高さが変わらない
- [ ] 自由配置で同列内ドラッグすると縦位置が変わり、空きが残る
- [ ] トグルを戻すと上詰めに戻り、順序はおおむね上から `offsetY` 順
- [ ] 別ブラウザ／再読込後も設定と位置がサーバーから復元される
- [ ] 設定・並び保存失敗時にデータが壊れず、エラーが分かる

## リスクと制約

- カード高さは内容依存のため、`pack`→`free` の初期 `offsetY` は **DOM 計測**が必要（jsdom ではモック）。
- 共有 Basic Auth のため設定は全員共通。個人別が必要なら別途アカウントが前提。
- 縮小表示やフォント変更で「見た目の高さ」と保存 px がずれることは許容する。
