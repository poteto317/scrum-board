# #138 アイテム追加レイアウト／スタイル未適用 — 設計

## 背景

かんばんカード [#138](https://scrum-board-jkcejsb6ka-an.a.run.app/items/138?project=1):

- タイトル: アイテム追加画面レイアウトが崩れている
- 説明: かんばんボードで追加ボタンとコマンドボタンが重なっている
- 追加指示: 全体的にスタイルが適用されていないところが見られる

チケット文言の「追加ボタン」は、列フッター「アイテムを追加」とカード上のコマンド／リンク群のどちらかが曖昧なため、**調査結果に基づき次を両方の受け入れ対象とする**: (1) 追加ダイアログの崩れ、(2) ボード上カードのクイックアクション（コマンド＋リンク）の重なり。列ヘッダー「＋」とコマンドの重なりは DOM 上別領域のため **未再現なら対象外**（再現報告時のみ同 PR または追従で扱う）。バックログカード QA は本カード必須ではない（モーダル共通修正の副作用確認のみ）。

## 決めたこと

| 項目 | 決定 |
| --- | --- |
| 主因（追加ダイアログ／全体の「スタイル無し」感） | Native `<dialog open>` の UA `display: block` が `.modal-backdrop { display: flex }` より勝ち、中央寄せフレックスが効かない。対象は **`dialog.modal-backdrop` 全般**（`appModal` の有無を問わない） |
| 主因（カード上の重なり） | グローバル `.task-card .copy-card-link { position: absolute }` と、ボードの `.task-card .card-quick-actions`（flex＋リンク `static`）の分断。バックログは別クラス `.backlog-quick-actions`（`backlog.css`）。「効かない」は主に **board.css 未適用／回帰**を指し、現行 DOM では詳細度でボード側が勝つ想定 |
| 削除確認ダイアログ | HTML が `modal-actions` / `danger` を使うが CSS 未定義。**HTML を既存ユーティリティ `form-actions` / `danger-button` にリネーム**する（CSS に別名を足さない） |
| カード重なりの完了経路 | **第一選択**: `board.css` の quick-actions 契約を維持し、回帰テストでセレクタ適用を固定。**足りない場合のみ** `.board-page .task-card …` を `styles.css` に祖先付きで補強（L-792）。**無修飾の `.task-card …` をグローバルへ丸ごと移すことは禁止**（item-detail 等を壊す）。プラン先頭で採用経路を固定する |
| スコープ外 | デザイン刷新、テーマ変更、各ページの `.page-heading` 統合、Done ドットのグローバル化のみのリファクタ |
| 知見 | L-792（グローバル移動時は祖先セレクター） |

## 現状の構造

1. **追加 UI**は専用ルートではなく、ボード／バックログの `dialog.modal-backdrop` → `section.modal`。見た目は `styles.css` の `.modal*`。多くは `appModal`、削除確認は `open` 属性のみ。
2. **`dialog.modal-backdrop`** はサイズ・背景をリセットし、`::backdrop` でオーバーレイを出すが、**開いたときの `display: flex` を再宣言していない**。
3. **ボード**のカードクイックアクションは `board.css`。**バックログ**は `.backlog-quick-actions`（`backlog.css`）。グローバルはリンク単独の absolute 配置のまま。
4. **コメント／説明ブロック削除**は `modal-actions` + `danger` のまま未定義クラス。

## アプローチ（採用）

**CSS／マークアップの穴埋め（最小差分）**

1. `styles.css` に次を追加する（セレクタはこの形に固定）:

   ```css
   dialog.modal-backdrop[open] {
     display: flex;
     align-items: center;
     justify-content: center;
     padding: 24px;
   }
   ```

   UA の `dialog[open]` より詳細度で勝ち、中央寄せを復元する。

2. 削除確認ダイアログの HTML（明示ファイル）: `item-comments.html`・`description-blocks-editor.html` で `modal-actions` → `form-actions`、`danger` → `danger-button`。

3. カード重なり: 上記「完了経路」どおり（ボード必須）。バックログは必須スコープ外。

## 受け入れ条件

1. ボード／バックログの「アイテムを追加」ダイアログが中央にパネルとして表示され、ヘッダー・フォーム・アクションが既存 `.modal` スタイルどおり並ぶ
2. ボード上のカードでコマンドアイコンとリンクコピーが重ならない（`.card-quick-actions` の横並び）。列「＋」とコマンドの重なりが再現される場合も解消する
3. `dialog.modal-backdrop` を使う他ダイアログ（`appModal` 有無を問わず。例: プロジェクト作成、コメント削除）も中央寄せが回復する
4. コメント／説明ブロック削除確認でボタン行が右寄せフレックス、危険ボタンが赤スタイルになる
5. 自動テスト（1プランに全ルート E2E は載せない）:
   - 既存の board（および必要なら backlog）スペックで、開いた `dialog.modal-backdrop` の computed `display` が `flex`、`align-items` / `justify-content` が中央寄せであること
   - ボード: `.task-card .card-quick-actions .copy-card-link` が `position: static` を固定
   - 他画面の `dialog.modal-backdrop` は手動スモーク（プロジェクト作成など 1〜2 画面）で足りる

## 非目標

- README / OpenAPI 変更（UI のみ）
- モバイル専用レイアウトの作り直し（既存モバイル規則は壊さない）
