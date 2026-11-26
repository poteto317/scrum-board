# カード #155 説明欄で見出し・リスト・チェックボックス・引用・コード・区切り線を使えるようにする 設計書

- カード: https://scrum-board-jkcejsb6ka-an.a.run.app/items/155?project=1
- 関連: カード #145（画像・リンクの貼り付けと複数画像）

## 目的

アイテムの説明欄（`description`）に、Markdown の小さな部分集合（見出し・箇条書き・番号付きリスト・チェックボックス・引用・コードブロック・区切り線）を書くと、説明のプレビュー（表示）に反映されるようにする。入力欄（行ごとの textarea）の挙動と、保存の形（文字列）は変えない。

## 現状

- 説明欄は `DescriptionBlocksEditor`（`frontend/src/app/description-blocks-editor.ts`）で編集する。本文を `\n` で分けた行ごとに textarea を出す。
- 表示は `DescriptionRichText`（`description-rich-text.ts`）。本文全体を `parseDescriptionLinks`（`description-link.ts`）でテキスト・リンク・画像のセグメントに分け、`white-space: pre-wrap` の 1 つの `div` に描く。
- エディタの下のプレビュー（`.blocks-preview`）は、`showRichPreview` が真のとき、つまり本文にリンクか画像があるときだけ出る。項目の詳細には説明の読み取り専用の表示が別に無く、このプレビューが「表示」にあたる。
- 同じ部品の利用箇所:
  - 説明: `item-detail.html` の `<app-description-blocks-editor attachmentField="description">`
  - ソリューション: `item-solution.html` の `<app-description-blocks-editor attachmentField="solution">`
  - コメント: `item-comments.html` の `<app-description-rich-text>`（エディタを通さず直接）

## 決めたこと

1. **対象は説明欄だけ。** ソリューションとコメントは同じ部品を使うが、表示は変えない。`DescriptionRichText` に入力 `blockSyntax`（既定 `false`）を足し、`DescriptionBlocksEditor` が `attachmentField() === 'description'` のときだけ `true` を渡す。コメントは `blockSyntax` を渡さないので、これまでどおり。
2. **記法（行の先頭で判定。行頭の空白があれば記法にしない）**
   - 各記法の項目・見出しの文字列は、記号（`# `・`- `・`1. `・`- [ ] ` など）の直後から行末までをそのまま使う（trim しない）。
   - 見出し: `# ` / `## ` / `### ` に続く文字列。`#` の後に半角空白が必要。`####` 以上や、空白の無い `#見出し`、`# ` の後が空（空白だけを含む）の行は段落として扱う。
   - 箇条書き: `- ` で始まる行（チェックボックスの形を除く）。`- ` の後が空でも 1 つの項目にする。
   - 番号付きリスト: `1. ` のように、1〜9 桁の数字・`.`・半角空白で始まる行（`1. ` の後が空でも 1 つの項目にする。`1.` の後に空白が無い行は段落）。連続する行を 1 つのリストにし、先頭の番号を開始番号（`ol` の `start`）にする。2 行目以降の番号は使わない（Markdown と同じく、ブラウザが連番を振る）。
   - チェックボックス: `- [ ] ` / `- [x] ` / `- [X] ` で始まる行。`]` の後に半角空白が必要。行全体が `- [ ]` / `- [x]` / `- [X]` だけの行は空の項目にする。`- [ ]foo` のように `]` の後に空白が無い行は、文字列 `[ ]foo` の箇条書きの項目にする。
   - 引用: `> ` で始まる行、または `>` だけの行。連続する行を 1 つの引用にし、各行の `> ` / `>` を除いて `\n` でつなぐ。
   - コードブロック: 開始は、```` ``` ```` で始まり、その後ろにバッククォートを含まない行（```` ```ts ```` は開始、```` ```` ```` や ```` ```a``` ```` は段落）。閉じは、行末の空白を除いて ```` ``` ```` だけの行。開始行の ```` ``` ```` の後の文字（言語名など）は捨てる。閉じが無ければ本文の最後までをコードにする（末尾の空行は除く。CommonMark と同じ。入力の途中で ```` ``` ```` だけを打つと、閉じるまで後ろがコードとして表示されるが、保存の内容は変わらないので許容する）。中の行は記法・リンク・画像を一切解釈しない。
   - 区切り線: `---` だけの行（行末の空白は無視）。
   - それ以外の行は段落。連続する段落の行（空行を含む）は 1 つの段落にまとめ、`\n` でつなぐ。段落の中の空行は残す（`pre-wrap` の見た目を保つ）が、段落の先頭と末尾の空行（空白だけの行を含む）は取り除き、空になった段落は出さない（見出し・リストの余白と空行が二重にならないように）。例: `a⏎⏎# H` は段落 `a` と見出し `H`、`- a⏎⏎- b` は 2 つの箇条書き（空行がリストを区切る）。
   - 行末の `\r` は、記法の判定とテキストの両方で取り除く。
   - 異なる種類のリスト（箇条書き・番号付き・チェックボックス）が隣り合ったら、別々のリストにする。
3. **解析は純粋な関数にする。** 新しいファイル `frontend/src/app/description-markdown.ts` に次を置く。
   ```ts
   export type DescriptionMarkdownBlock =
     | { kind: 'paragraph'; text: string }
     | { kind: 'heading'; level: 1 | 2 | 3; text: string }
     | { kind: 'bullet-list'; items: string[] }
     | { kind: 'ordered-list'; start: number; items: string[] }
     | { kind: 'task-list'; items: { checked: boolean; text: string }[] }
     | { kind: 'quote'; text: string }
     | { kind: 'code'; text: string }
     | { kind: 'rule' };

   export function parseDescriptionMarkdown(text: string): DescriptionMarkdownBlock[];
   export function hasDescriptionBlockSyntax(text: string): boolean; // 段落以外のブロックが 1 つでもあれば true
   ```
   - 空文字は `[]` を返す。
4. **インラインの記法（リンク・画像）は今の関数をそのまま使う。** 段落・見出し・リストの項目・チェックボックスの項目・引用の文字列を、それぞれ `parseDescriptionLinks(text, itemNumber)` でセグメントにする。コードブロックは文字列のまま（リンク・画像の記法を解釈しない）。
   - 表示用の形を作る純粋な関数 `buildDescriptionView(text, itemNumber, blockSyntax)` を `description-view.ts` に置き（記法の解析と、表示用の形の組み立ては変更理由が違うので、ファイルを分ける）、ブロックごとのセグメントを持たせる。`blockSyntax` が `false` のときは、本文全体を 1 つの段落（今と同じセグメント）にする。コンポーネントは `computed` でこれを呼び、描くだけにする。
5. **描画（`DescriptionRichText`）**
   - 外枠の `div.rich-text` は残し、その中にブロックを並べる。
   - 段落: `div.rich-paragraph`（`white-space: pre-wrap`）にセグメントを描く。`blockSyntax` が `false` のときは本文全体（前後の空行も含め、加工しない）が 1 つの段落になり、見た目は今と同じ。
   - 見出し: `#` → `h2`、`##` → `h3`、`###` → `h4`。ページの `h1`（アイテムの詳細）の下に入るため。
   - 箇条書き: `ul > li`、番号付き: `ol[start] > li`。
   - チェックボックス: `ul.rich-task-list > li` に、`<input type="checkbox" disabled>`（`checked` を状態に合わせる）と本文。表示だけで押せない。読み上げはネイティブのチェックボックスの状態（チェック済み・未チェック）で伝わる。各チェックボックスに項目の文字列を `aria-label` で付ける（記法の文字を読ませないよう、セグメントの文字・リンクの表示名・画像の代替テキストをつないだもの。空なら「チェック項目」）。項目の本文はリンクや画像の削除ボタンを含みうるので `label` 要素で包めず、名前の無いチェックボックスにしないために `aria-label` を使う。
   - 引用: `blockquote`（`pre-wrap`）。
   - コード: `pre > code`。`white-space: pre`、`overflow: auto`、`max-height: 24rem` で、横に長い行と縦に長いコードはブロックの中でスクロールする（カードの「長いコードブロックで画面が崩れない」に合わせ、縦も上限を付ける）。
   - 区切り線: `hr`。
   - インラインのセグメント（テキスト・リンク・画像）の描き方は今のまま（`ng-template` を使って、ブロックの種類をまたいで同じ描き方を共有する）。画像の削除ボタンとドラッグも今のまま。
   - `innerHTML` は使わない。すべて Angular の補間・プロパティのバインドで描く。`<` `>` などは文字のまま出る。
6. **プレビューを出す条件。** `DescriptionBlocksEditor.showRichPreview` は、`itemNumber() <= 0` と空文字で `false` を返す前置きを従来どおり残し、今の条件（リンクか画像がある）に加え、`attachmentField() === 'description'` で `hasDescriptionBlockSyntax(value())` が真のときも出す。ソリューションは今の条件のまま。
7. **入力の挙動は変えない。** `description-blocks.ts` と `description-blocks-editor.ts` の入力（Enter・Backspace・貼り付け）は触らない。記法の文字はそのまま打てる。コードブロックの中身も、今と同じく 1 行 1 つの textarea で編集する。
8. **案内の文言。** `item-detail.html` の説明欄の注記（`field-note`）に、使える記法を 1 行で足す（ツールバーが無いので、記法を知る手がかりとして最小限の 1 行だけ）。
9. **バックエンドは触らない。** 保存の形は今のまま文字列（10000 文字まで）。解析は 1 行ずつの線形の処理なので、上限の長さでも重くない。

## 範囲外

- 太字・斜体・表・ネストしたリスト（行頭の空白で入れ子にする書き方）・`* ` や `+ ` の箇条書き・`)` の番号付きリスト・インラインコード
- ソリューション・コメントへの適用
- チェックボックスを表示上で切り替える動き
- ツールバー（書式ボタン）・入力欄での見た目の変換・Markdown の貼り付け変換

## テスト

- `description-markdown.spec.ts` と `description-view.spec.ts`（純粋な関数）
  - 各記法の判定（見出し 3 段階、`####` と `#見出し` と `# ` は段落、箇条書き、番号付きの開始番号、チェックボックスの `[ ]` `[x]` `[X]`、引用の `> ` と `>`、コード（言語名を捨てる・閉じが無い・中の記法をそのまま）、区切り線と `----` `--- x` は段落）
  - 連続する行のまとまり（段落の中の空行は残る、段落の前後の空行は除く、空行でリストが分かれる、リストの種類の切り替わり、行頭の空白は段落）
  - 空の項目（`- `、`1. `、`- [x]`）、`- [ ]foo` は箇条書き、`1.foo` は段落、```` ```` ```` と ```` ```a``` ```` は段落
  - `\r\n` の本文
  - `hasDescriptionBlockSyntax`
  - `buildDescriptionView`: `blockSyntax=false` は全体が 1 段落で今のセグメントと同じ、コードブロックの中の画像・リンクの記法は文字列のまま、見出し・リストの項目のリンクと画像はセグメントになる
- `description-rich-text.spec.ts`（表示）
  - `blockSyntax=true` で `h2` `h3` `h4` `ul` `ol[start]` `input[type=checkbox][disabled]`（checked の状態と aria-label）、`blockquote`、`pre > code`、`hr` が出る
  - `blockSyntax=false`（既定）では記法の文字がそのまま文字として出る（コメント・ソリューションの表示が変わらない）
  - `<b>x</b>` のような文字列が、段落とコードのどちらでも要素にならず文字のまま出る
  - コードブロックの中の画像の記法で `img` が出ない、リストの項目の画像は `img` が出て削除ボタンも出る
- 既存の `item-comments.spec.ts`・`item-solution` 関連のテストが変更なしで通ること（`blockSyntax=false` の表示が変わらないことの確認）
- `description-blocks-editor.spec.ts`
  - 説明欄で記法だけを含む本文のとき、プレビューが出て、`blockSyntax` が効いている（`h2` が出る）
  - ソリューション（`attachmentField="solution"`）では、記法だけの本文でプレビューが出ない

## 気をつける知見

- L-018（検証と実行の解釈を揃える）: リンクの URL は今の `parseDescriptionLinks` の正規化をそのまま使い、新たな URL の解釈を足さない。
- L-044（認識できない入力を黙って別の解釈に流さない）: 記法に当たらない行は、文字のまま段落として出す（消さない・変えない）。
- L-858（文字数の上限）: 保存の形も上限も変えない。
