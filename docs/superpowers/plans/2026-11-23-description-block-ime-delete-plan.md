# 説明ブロック末尾削除と IME 競合の修正 Implementation Plan

## Goal

PBI #112 の受け入れ条件を満たし、説明・ソリューション共通のブロックエディタで、IME 編集後の末尾空ブロックを誤って旧内容で復元せず、Backspace で本文重複なく削除できるようにする。

## 設計書

- `docs/superpowers/specs/2026-11-23-description-block-ime-delete-design.md`

## 受け入れ条件

- 日本語 IME 中の Enter / Backspace はブロック構造を変更しない。
- compositionend 後の通常 Backspace で末尾ブロックを削除し、直前の本文を複製しない。
- 連続した削除ができる。
- 説明の `ItemAutosave` とソリューションの独自 debounce 保存が、削除後の確定本文を PATCH する。
- 保存後の再読み込みで同じ本文・ブロック構造になる。

## 確認した知見

- L-001: emit と保存結果を成功扱いする前提を明示する。
- L-038: IME と構造変更を中途半端に同時確定しない。
- L-039: DOM と signal の構造を同じ世代に保つ。
- L-060: エディタだけでなく親の保存配線をテストする。

## 変更対象

- `frontend/src/app/description-blocks-editor.ts`
- `frontend/src/app/description-blocks-editor.spec.ts`
- `frontend/src/app/item-detail.spec.ts`
- `frontend/src/app/item-solution.spec.ts`

サーバー・DB・外部 API は変更しない。

## Task 1: エディタの再現テストを追加する

- [x] `description-blocks-editor.spec.ts` に、`a\nb` の末尾ブロックを compositionstart し、DOM 値を空へ変えて input を送り、IME フラグなしの Backspace を dispatch するテストを追加する。
- [x] `compositionstart` 後に IME フラグなしの Enter を送り、`defaultPrevented`、`blocks()`、emit が変わらないことを確認する。
- [x] Backspace が `defaultPrevented` にならず、IME 中は `blocks()` と `host.texts` がまだ変わらないことを確認する。
- [x] compositionend、続く確定用 input、通常 Backspace の順に処理し、最後の emit が `a` になり `blocks()` が `['a']` になることを確認する。
- [x] 通常 Backspace で `a\n\n` の末尾空ブロックを連続して削除し、emit が `a\n`、`a` の順になることを確認する。
- [x] 削除後の `a` を新しい `DescriptionBlocksEditor` へ再入力し、ブロックが `['a']` であることを確認する。
- [x] `cd frontend && npx ng test --watch=false --include=src/app/description-blocks-editor.spec.ts` を実行し、新しい IME Backspace テストが現行実装で失敗することを確認する。

完了条件: 連続削除・再読込テストは通り、IME 中 Backspace テストだけが修正前の挙動差で失敗する。

## Task 2: IME 中の構造変更を抑止する

- [x] `DescriptionBlocksEditor.onKeydown` の Enter / Backspace 構造変更前に、`event.isComposing`、`event.keyCode === 229`、内部 `composing` のいずれかなら return する共通ガードを追加する。
- [x] IME 中の keydown を `preventDefault` しない。
- [x] 既存の Enter、通常 Backspace、最大長、リンク・画像、compositionend の処理はそのままにする。
- [x] Task 1 のコマンドを再実行し、全テストが通ることを確認する。

完了条件: 修正は `description-blocks-editor.ts` のキーボード境界に限定され、エディタ単体の全ケースが通る。

## Task 3: 説明の保存配線を回帰テストする

- [x] `item-detail.spec.ts` の IME response handling に、`a\nb` を表示している説明エディタの末尾 textarea に compositionstart、IME 中の Backspace、compositionend、通常 Backspace を適用する画面経由テストを追加する。
- [x] IME 中に autosave の `updateItem` が呼ばれず、compositionend で `a\n`、続く通常 Backspace で `a` が保存されることを待機／flush 制御で確認する。
- [x] 保存の応答を返し、説明エディタの最終値が `a`、重複がないことを確認する。
- [x] 保存直前の値で ItemDetail を再読み込みした場合の textarea が 1 個で `a` になることを確認する。
- [x] `cd frontend && npx ng test --watch=false --include=src/app/item-detail.spec.ts` を実行する。

完了条件: DOM 操作から `ItemAutosave` の PATCH まで、末尾削除後の確定値だけが説明として送られる。

## Task 4: ソリューションの保存配線を回帰テストする

- [x] `item-solution.spec.ts` に、画面の textarea から IME 編集後の末尾空ブロック削除を行うテストを追加する。
- [x] IME 中は `updateItem` が呼ばれず、debounce 後に `updateItem(18, { solution: 'a' })` だけが呼ばれることを確認する。
- [x] 保存応答後の control と textarea が `a` で一致し、重複がないことを確認する。
- [x] 保存結果を返すよう `itemByNumber` を設定して新しい `ItemSolution` を作り、textarea が 1 個・値が `a` になる再読込テストを追加する。
- [x] `cd frontend && npx ng test --watch=false --include=src/app/item-solution.spec.ts` を実行する。

完了条件: 説明と異なる独自 debounce 保存でも共通エディタの確定値が正しいフィールドへ送られる。

## Task 5: 変更全体を検証する

- [x] `cd frontend && npm test -- --watch=false` を実行する。
- [x] `npm run build` を実行する。
- [x] `git diff --check` と `git status --short` を確認する。
- [x] 設計書・プランのチェックボックスと、PBI #112 の各受け入れ条件のテスト対応表を確認する。

完了条件: フロントエンドの全テストとビルド、空白検査がすべて成功し、未処理の受け入れ条件がない。
