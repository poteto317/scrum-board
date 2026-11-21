# 説明画像→コメント DnD（ITEM-085）

## 背景

カード要件: 説明のところにある画像をコメントにドラッグ&ドロップできる。Notion ではできないので、できると良い。

現状（ITEM-084 実装済み）:

- 説明・ソリューション・コメントは同一アイテム内の添付を `![alt](/api/items/by-number/{n}/attachments/{id}/content)` で参照する。
- 説明エディタ下のプレビュー（`DescriptionRichText`）で画像を表示する。コメント下書きはファイル DnD／「画像」で新規アップロードできる。
- 添付 DELETE は description／solution／全コメントから当該マークアップを除去する（参照が複数あっても 1 行＝1 blob）。

## 決めたこと

| 事項 | 採用 | 根拠 |
|------|------|------|
| ドロップの意味 | **参照コピー**（同じ `attachmentId` のマークアップを挿入。再アップロードなし） | 1A。枚数枠を増やさず、既存 DELETE 契約と整合 |
| ドラッグ元 | **説明の表示プレビュー画像のみ**（ソリューションは対象外） | 2A。カード文言どおり |
| ドロップ先 | **新規コメント下書き＋既存コメント編集** | 3A。既存ファイル DnD と同範囲 |
| DnD データ | カスタム MIME **`application/x-scrum-attachment`** に JSON `{ itemNumber, attachmentId, alt }` | 4A。ファイル DnD と分離（L-044）。`itemNumber` で所属をドロップ側検証 |
| 同一アイテム | ペイロードの `itemNumber` が現在のカード番号と一致し、かつ `attachmentId` が正の整数のときだけ挿入 | 不一致・欠落は**挿入せずエラー表示**（黙って無視しない） |
| API／DB | **変更なし** | 既存 content GET・マークアップで足りる |
| 権限 | コメント編集不可（`readOnly`）なら **drop／dragover で preventDefault せず受け付けない**（エラー UI なし）。挿入はクライアントのみ（POST しない） | 既存コメント画像と同型。受け入れの「失敗時エラー」は readOnly 以外 |

ユーザー回答: 推奨（1A／2A／3A／4A）で確定。

## 目的と受け入れ条件

1. 説明プレビュー上の自アイテム添付画像をドラッグし、コメント下書きまたは編集中本文へドロップすると、成功時のみ同じ `attachmentId` の画像マークアップが挿入される（L-001）。
2. 失敗時（文字数超過・不正／欠落ペイロード・`itemNumber` 不一致）は本文を変えず、**エラーを表示**する（黙って無視しない。L-044）。`readOnly` はドロップを受け付けないだけで、この「エラー表示」対象外。
3. ファイルの DnD と内部参照 DnD が**下書き form で**同居する。`dataTransfer.types` にカスタム MIME が含まれる場合は参照コピー経路のみ（`getData` が空・壊れていても `files` へフォールバックしない。エラー表示）。カスタム MIME が types に**無い**ときだけ既存どおり `files[0]` アップロード経路。
4. 説明側の画像に `draggable` を付け、ドラッグ開始でカスタム MIME（`itemNumber` 含む）をセットする。削除ボタン操作・通常クリックは壊さない。
5. ソリューションのリッチテキスト画像はドラッグ元にしない（初版）。
6. BE／スキーマ／GCS は触らない。新規アップロードは発生しないため枚数上限・MIME 検証は増えない。
7. 既存の添付 DELETE で、説明とコメントの両方から同じ id のマークアップが消える挙動は維持する。
8. キーリピート／ダブルクリックで確認ダイアログを飛ばす既存経路は変えない（L-408）。挿入ガードは同期フラグで連打を抑える（L-653）。

## 振る舞い詳細

### ドラッグ（説明プレビュー）

- `DescriptionRichText` に任意入力 `draggableImages`（既定 false）。説明エディタ（`attachmentField="description"`）のプレビューだけ true。ソリューション側は渡さない。
- `draggableImages` かつ image セグメントのとき、`<img draggable="true">`。`dragstart` で:
  - `dataTransfer.setData('application/x-scrum-attachment', JSON.stringify({ itemNumber, attachmentId, alt }))`（`itemNumber` はコンポーネントの `itemNumber` 入力）
  - `effectAllowed = 'copy'`
  - 可能なら小さな drag image（任意・見た目のみ）
- 削除ボタンは `draggable=false` のまま。画像ドラッグが削除クリックと衝突しないこと。

### ドロップ（コメント）

- 下書き form と編集中ブロックに `dragover`／`drop` を付ける（編集モードにも同等ハンドラ。現状は下書きのみなので編集側を追加）。
- `dragover`／`drop`: `readOnly` なら何もしない（preventDefault しない・エラー UI なし）。
- `drop`（編集可のとき）:
  1. `preventDefault`
  2. `dataTransfer.types` にカスタム MIME が**含まれる**場合（`getData` の空／非空は問わない）:
     - `getData` → JSON パース。失敗、空、または `itemNumber`／`attachmentId` が正の整数でない、または `itemNumber !==` 現在のカード番号 → エラー表示して終了（`files` は見ない）。
     - `buildAttachmentMarkup(number, attachmentId, alt)` でマークアップ生成。
     - 下書きは末尾挿入（現行 upload 成功時と同型）。編集中はキャレット位置があればそこ、無ければ末尾。
     - `insertMarkupAt(..., COMMENT_BODY_MAX)`。失敗なら文字数エラー。
  3. カスタム MIME が types に**無く**、かつ対象が**下書き form**のときだけ、`files[0]` があれば既存 `uploadDraftImage`。
  4. **編集中コメント**へのドロップは参照コピーのみ（ファイル upload DnD は新設しない。types にカスタム MIME が無く files だけのときは no-op または短いエラーでよいが、upload は呼ばない）。
- 同期 `insertGuard`（または uploadGuard と同型）で二重挿入を防ぐ。

### 共有ヘルパ（推奨）

- MIME 定数・JSON の encode／decode・`payload.itemNumber === currentItemNumber && attachmentId > 0` の純粋関数を FE の小さなモジュール（例: `attachment-dnd.ts`）に置き、リッチテキストとコメントの両方から使う。テストで不正 JSON・欠けた id・itemNumber 不一致を固定する。

## 非目標

- ソリューション→コメント、コメント→説明、カード間 DnD。
- 参照の「移動」（説明から自動削除）。
- blob 複製・新 attachment 行の作成。
- 外部画像 URL の DnD。
- BE API 追加。

## 知見（手順 4）

| ID | この機能での扱い |
|----|------------------|
| L-001 | 挿入成功時のみ本文更新 |
| L-044 | 不正カスタム MIME／欠落・不一致 `itemNumber`／欠落 id はエラー。`types` にカスタム MIME があるが `getData` が空・壊れているときはファイルへフォールバックしない |
| L-408 | 削除確認は既存どおり。本機能は確認ダイアログを増やさない |
| L-653 | ドロップ挿入に同期ガード |
| L-830 | 本機能はサーバー本文書き換えを伴わない（参照コピーのみ） |

## テスト方針

- 純粋関数: encode／decode、壊れた JSON、attachmentId 非正、itemNumber 不一致。
- `DescriptionRichText`: `draggableImages` 時に dragstart が `itemNumber` 付きカスタム MIME を書く（DataTransfer モック）。
- `ItemComments`: カスタム MIME ドロップで本文にマークアップが増え upload API が呼ばれない。文字数超過で不変。壊れた MIME／他 itemNumber でエラーかつ upload なし。ファイルのみのドロップは従来どおり upload（回帰）。
- 編集中コメントへのドロップも同様に 1 本以上。

## サブエージェントレビュー

- 第 1 周（記述の確かさ）: 他アイテムの無視 vs エラー、itemNumber 検証手段、readOnly の無効 vs エラー表示を指摘 → 反映済み。
- 第 2 周（範囲と知見）: L-044 の分岐を `types` 基準に、編集中のファイル upload DnD 新設を削る → 反映済み。
