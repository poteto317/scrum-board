# 説明ブロック末尾削除と IME 競合の修正 設計書

## Goal

説明・ソリューションのブロックエディタで、末尾の空ブロックを行頭 Backspace で削除したときに、直前の本文を複製したり、IME の未確定値でブロックを復元したりしない。

## 背景

カード #112 では、アイテム詳細の説明欄で末尾ブロックを消そうとすると、直前の内容が重複して保存されることが報告された。編集対象は共通の `DescriptionBlocksEditor` であり、説明ページとソリューションページの両方で使われる。

ブロックの本文は `blocks` signal を正とするが、IME 中は `input` の途中値を signal に反映せず DOM の textarea 値を compositionend 時に採用する。一方、Backspace の構造変更は現在 IME 判定をせず、signal の古い内容で前ブロックとの結合を行う。このため、signal の縮小後に compositionend が古い textarea 群を読み直すと、結合前の内容を本文へ戻しうる。

## 要件

1. 日本語 IME の変換中に Enter と Backspace はブロック構造を変更しない。
2. compositionend では、その時点の各 textarea の値を一度だけ `blocks` と保存値へ反映する。
3. IME 確定後、空の末尾ブロックの行頭で Backspace を押すと、そのブロックだけを削除し、直前の本文を変更しない。
4. 連続した Backspace で複数の空ブロックを順に削除できる。
5. 保存して再読み込みしても重複や末尾改行の復活がなく、削除後・保存直前の本文と再読み込み後の本文が一致する。
6. 説明ブロックとソリューションブロックに同じ挙動を適用する。
7. 文字数制限、既存の前ブロックとの結合、入力の拒否時の復元、リンク・画像操作は変更しない。

## スコープ外

- 別のエディタ方式や WYSIWYG 化。
- 空ブロックの自動圧縮。
- Backspace 以外のショートカットやキーマップ追加。
- サーバー API、DB スキーマ、同期方式の変更。
- すでに保存済みの重複本文を推測で自動修復する処理。

## 設計

`onKeydown` は現在 Enter 分岐だけに IME 判定がある。Backspace 分岐にも同じ判定を適用する。各構造変更分岐へ入る前、`event.isComposing` または `event.keyCode === 229` またはエディタ内部の `composing` が有効なら、`preventDefault` せず処理を終了する。ブラウザーが IME 自身の削除・確定を完了できるようにし、compositionend の同期を唯一の確定経路にする。

compositionend では、既存どおり DOM の textarea 値を取得して正規化し、長さ検証後に `blocks` と本文を更新する。構造変更を別のイベントで先に行わないため、textarea 群の再取得対象と signal の構造が食い違わない。

通常の Backspace は既存の `mergeDescriptionBlockWithPrevious` を使い続ける。空の末尾ブロックを結合すると直前ブロックの文字列はそのままで、末尾の改行だけが削除される。連続削除は各 keydown で再描画後の現在位置と `blocks` を使用する。

## テスト設計

`description-blocks-editor.spec.ts` に次を追加する。

- IME 中の Backspace では `preventDefault` されず、`blocks` と保存イベントが変わらない。
- `compositionstart` 後にイベントの `isComposing` や 229 が付かない Enter / Backspace でも、内部の `composing` で構造変更を抑止する。
- その後の compositionend で空になった末尾 textarea が `末尾改行ありの本文` として採用される。
- compositionend の後に確定用 `input` が届くイベント順でも、最終本文が古い signal 値へ戻らない。
- compositionend 後の通常 Backspace で末尾ブロックが消え、保存値が直前の本文と完全一致する。
- 同じ保存値から再マウントしてもブロック数と本文が一致する。
- 連続する空ブロックを通常 Backspace で順に消せる。

ItemDetail の既存 IME 応答テストを拡張し、`DescriptionBlocksEditor` から autosave の PATCH まで通す。IME 中は PATCH が発生せず、compositionend 後に確定本文だけが保存されること、末尾空ブロックの削除後は改行を含まない本文が送信されることを必須とする。

`item-solution.spec.ts` でも共通エディタの IME 編集と末尾ブロック削除を画面経由で行い、独自の debounce 保存が `{ solution: <削除後の本文> }` を送ることを確認する。

## エラー処理

IME 確定後の値が文字数上限を超えた場合は既存の length error を維持し、DOM を signal の確定値へ戻す。正常な構造削除は既存どおり同期的に本文を emit し、自動保存の成功・失敗は既存の `ItemAutosave` / ソリューション保存経路が通知する。

## 決めたこと

- `event.keyCode === 229` を `isComposing` と併用し、IME 実装差を吸収する。
- コンポーネント内部の `composing` も確認し、IME イベント順序で `isComposing` が付かない環境も保護する。
- IME 中の Backspace はブロック削除を遅延せず、IME が処理する入力とし、その後の明示的な通常 Backspace に任せる。
- 既存データの重複除去は行わない。

## 確認した知見

- L-001: 構造変更と保存値の emit を失敗や未実行と誤認させない。
- L-038: IME 処理とブロック削除という途中状態を同時に確定しない。
- L-039: structural update 後の DOM と signal を食い違わせない。
- L-060: エディタ単体だけでなく、親の保存配線を通す回帰テストを用意する。
