# カード #155 説明欄のブロック記法 実装プラン

- 設計書: `docs/superpowers/specs/2026-11-26-card155-description-block-syntax-design.md`
- 目的: 説明欄の表示で、見出し・箇条書き・番号付きリスト・チェックボックス・引用・コードブロック・区切り線を描く。
- 気をつける知見: L-018（URL の解釈は `parseDescriptionLinks` のみ）、L-044（当たらない行は段落として残す）、L-858（保存の形・上限を変えない）
- 検証コマンド: `cd frontend && npx ng test --watch=false` と `npx ng build`（`npm test` は `scripts/check-dialog-modal-open-css.mjs` も流すので、最後に `npm test -- --watch=false` も通す）
- 進め方: TDD（テストを先に書き、失敗を確かめてから実装）。コミットはしない（後の `/commit-ja` で行う）。

## タスク 1: 純粋な解析関数 `parseDescriptionMarkdown` / `hasDescriptionBlockSyntax`

ファイル: 新規 `frontend/src/app/description-markdown.ts`、新規 `frontend/src/app/description-markdown.spec.ts`

1. spec を書く（vitest、`describe('parseDescriptionMarkdown')`）。`toEqual` で次を固定する。
   - `''` → `[]`
   - `'# a'` / `'## a'` / `'### a'` → `heading` level 1/2/3、text `'a'`。`'#### a'`、`'#a'`、`'# '`、`'#   '` → 段落
   - `'# a '` → text `'a '`（trim しない）
   - `'- a\n- b'` → `bullet-list` items `['a','b']`。`'- '` → items `['']`。`'-a'` → 段落
   - `'3. a\n1. b'` → `ordered-list` start 3、items `['a','b']`。`'1. '` → items `['']`。`'1.foo'`、`'1234567890. a'`（10 桁）→ 段落
   - `'- [ ] a\n- [x] b\n- [X] c'` → `task-list` `[{checked:false,text:'a'},{checked:true,text:'b'},{checked:true,text:'c'}]`。`'- [x]'` → `[{checked:true,text:''}]`。`'- [ ]foo'` → `bullet-list` items `['[ ]foo']`
   - `'> a\n>\n> b'` → `quote` text `'a\n\nb'`。`'>a'` → 段落
   - `` '```ts\n# x\n[l](https://e.com)\n```' `` → `code` text `` '# x\n[l](https://e.com)' ``。閉じが行末空白付き `` '``` ' `` でも閉じる。閉じが無い `` '```\na\nb' `` → code `'a\nb'`。閉じが無く本文が改行で終わる `` '```\na\n\n' `` → code `'a'`（閉じが無いときは末尾の空行を除く）。境界: `` 'a\n```\nx\n```\nb' `` → 段落 `a`・code `x`・段落 `b`、`` '- a\n```\nx\n```' `` → bullet・code。`` '```a```' `` と `` '````' `` → 段落。`` '```\n```' `` → code `''`
   - `'---'`、`'--- '` → `rule`。`'----'`、`'--- x'` → 段落
   - 段落: `'a\n\nb'` → 1 段落 `'a\n\nb'`。`'\n\na\n\n# H\n\n'` → `[段落 'a', 見出し 'H']`（前後の空行は除き、空の段落は出さない）。`'- a\n\n- b'` → 2 つの `bullet-list`
   - リストの種類の切り替わり: `'- a\n1. b\n- [ ] c'` → bullet / ordered / task の 3 ブロック
   - 行頭の空白: `'  - a'`、`' # a'` → 段落
   - `\r\n`: `'# a\r\n- b\r\nc\r\n'` → 見出し `'a'`、箇条書き `['b']`、段落 `'c'`
   - `hasDescriptionBlockSyntax`: `'a\nb'` → false、`''` → false、`'a\n---'` → true
2. テストが落ちることを確かめる。
3. 実装する。
   - 型 `DescriptionMarkdownBlock` は設計書の決めたこと 3 のとおり。
   - 本文を `\n` で分け、各行の末尾の `\r` を取り除く。
   - 行の判定は正規表現: 見出し `/^(#{1,3}) (.*)$/` で、`m[2].trim() === ''` なら段落。チェックボックス `/^- \[([ xX])\](?: (.*))?$/`（`(.*)` が undefined なら `''`）。箇条書き `/^- (.*)$/`。番号付き `/^(\d{1,9})\. (.*)$/`。引用 `/^>(?: (.*))?$/`（`>` だけは `''`）。コードの開始 `/^```[^`]*$/`。閉じ `line.trimEnd() === '```'`。区切り線 `line.trimEnd() === '---'`。
   - コードの開始行は、直前の段落・リスト・引用を確定させてから、閉じまでの行を集める。閉じが無ければ末尾の空行を除いた残りをコードにする。
   - 判定の順: コードの開始 → 区切り線 → 見出し → チェックボックス → 箇条書き → 番号付き → 引用 → 段落。
   - 同じ種類（bullet / ordered / task / quote / paragraph）が続く間は直前のブロックに足す。段落の行の後に別の種類が来たら段落を確定する。段落の確定時に先頭と末尾の空行（`''`）を取り除き、残りが無ければ出さない。リスト・引用は空行（段落の行）で途切れる。
   - `hasDescriptionBlockSyntax(text)` = `parseDescriptionMarkdown(text).some(b => b.kind !== 'paragraph')`。
4. テストが通ることを確かめる。

## タスク 2: 表示用の形 `buildDescriptionView`

ファイル: `description-markdown.ts`、`description-markdown.spec.ts`

1. 型を足す。
   ```ts
   export type DescriptionViewBlock =
     | { kind: 'paragraph'; segments: DescriptionSegment[] }
     | { kind: 'heading'; level: 1 | 2 | 3; segments: DescriptionSegment[] }
     | { kind: 'bullet-list'; items: DescriptionSegment[][] }
     | { kind: 'ordered-list'; start: number; items: DescriptionSegment[][] }
     | { kind: 'task-list'; items: { checked: boolean; label: string; segments: DescriptionSegment[] }[] }
     | { kind: 'quote'; segments: DescriptionSegment[] }
     | { kind: 'code'; text: string }
     | { kind: 'rule' };
   export function buildDescriptionView(text: string, itemNumber: number, blockSyntax: boolean): DescriptionViewBlock[];
   ```
   - `label` はチェックボックスの `aria-label`（項目の文字列。空なら `'チェック項目'`）。
2. spec（`describe('buildDescriptionView')`）:
   - `blockSyntax=false` → `[{kind:'paragraph', segments: parseDescriptionLinks(text, n)}]`（`'# a\n\n'` のような本文も加工せず 1 段落）。空文字でも 1 段落（今の `parseDescriptionLinks('')` の結果 `[{kind:'text',text:''}]`）
   - `blockSyntax=true` で、見出し・箇条書きの項目・チェックの項目・引用・段落のリンクと画像（`buildAttachmentMarkup(7,3,'pic')`）がセグメントになる
   - コードの中の画像・リンクの記法は `code` の `text` に文字列のまま残る
   - チェックの `label`: `'- [x] 買う'` → `'買う'`、`'- [ ]'` → `'チェック項目'`
3. 落ちることを確かめてから実装し、通す。各文字列は `parseDescriptionLinks(s, itemNumber)` に渡す。

## タスク 3: `DescriptionRichText` で描く

ファイル: `description-rich-text.ts`、`description-rich-text.spec.ts`

1. spec を足す（既存の `mount` に `blockSyntax?: boolean` を足す）。
   - `blockSyntax=true`、本文 `'# A\n## B\n### C\n- x\n2. y\n- [x] done\n- [ ] todo\n> q\n---\n```\n<b>z</b>\n```'` で、`h2`/`h3`/`h4` の文字、`ul li`、`ol[start="2"] li`、`input[type=checkbox]` 2 つ（両方 `disabled`、1 つ目 `checked`・2 つ目は未チェック、`aria-label` が `done`/`todo`）、`blockquote`、`hr`、`pre > code` の `textContent` が `<b>z</b>` で、`b` 要素が無い
   - 段落の `<b>x</b>` が文字のまま（`querySelector('b')` が null、`textContent` に含む）
   - `blockSyntax` 既定（false）で `'# A\n- x'` は `h2`・`ul` が無く、文字のまま出る
   - コードブロックの中の `buildAttachmentMarkup(7,3,'pic')` で `img` が出ない。箇条書きの項目の画像は `img` と削除ボタン（`canDelete=true`）が出る
   - 既存の「`segments()` を再利用する／再計算する」テストは `blocks()` に読み替える（テストの意図は同じ）
2. 落ちることを確かめる。
3. 実装する。
   - `readonly blockSyntax = input(false);`
   - `readonly blocks = computed(() => buildDescriptionView(this.text(), this.itemNumber(), this.blockSyntax()));`（`segments` は削除）
   - テンプレート: 外枠 `div.rich-text` の中で `@for (block of blocks(); track $index)` と `@switch (block.kind)`。インラインは `<ng-template #inline let-segments>` に今のセグメントの描き方（text / link / image と削除ボタン）を移し、`ngTemplateOutlet` で使う（`NgTemplateOutlet` を imports に足す）。
   - 見出しは `@switch (block.level)` で `h2`/`h3`/`h4`。番号付きは `<ol [attr.start]="block.start">`。チェックは `<ul class="rich-task-list"><li><input type="checkbox" disabled [checked]="item.checked" [attr.aria-label]="item.label" /> …</li></ul>`。コードは `<pre class="rich-code"><code>{{ block.text }}</code></pre>`。区切り線は `<hr />`。
   - スタイル: `.rich-text` から `white-space: pre-wrap` を `.rich-paragraph, .rich-text li, .rich-text blockquote, .rich-text h2/h3/h4` に移す（`word-break` と `line-height` は外枠に残す）。`.rich-code { white-space: pre; overflow: auto; max-height: 24rem; }`、`.rich-task-list { list-style: none; padding-left: 0 }`、`blockquote` に左の線、見出しの余白を小さめにする。
4. テストを通す。

## タスク 4: エディタのプレビュー条件と受け渡し

ファイル: `description-blocks-editor.ts`、`description-blocks-editor.html`、`description-blocks-editor.spec.ts`

1. spec を足す。
   - `attachmentField='description'`、`itemNumber=7`、`value='# 見出し'` → `.blocks-preview` があり、その中に `h2` が出る
   - `attachmentField='solution'`、同じ本文 → `.blocks-preview` が無い
   - `itemNumber=0` で `'# 見出し'` → `.blocks-preview` が無い
2. 落ちることを確かめる。
3. 実装する。
   - `showRichPreview`: 前置き（`number <= 0` と空文字で false）を残し、`(this.attachmentField() === 'description' && hasDescriptionBlockSyntax(text)) || 今のリンク・画像の判定` にする。
   - `readonly blockSyntax = computed(() => this.attachmentField() === 'description');` を足し、テンプレートの `<app-description-rich-text>` に `[blockSyntax]="blockSyntax()"` を渡す。
4. テストを通す。

## タスク 5: 案内の文言

ファイル: `item-detail.html`

- 説明欄の `field-note` の後に 1 行足す: `<p class="field-note">見出し（# / ## / ###）・箇条書き（- ）・番号付き（1. ）・チェック（- [ ] / - [x] ）・引用（> ）・コード（```）・区切り線（---）が使えます。</p>`
  - ```` ``` ```` は Angular のテンプレートでそのまま書ける（`{` `}` `@` を含まない）。

## タスク 6: 全体の検証

- `cd frontend && npx ng test --watch=false`（既存の `item-comments.spec.ts` などが変更なしで通ること）
- `npm test -- --watch=false`
- `npx ng build`
- `grep -n innerHTML frontend/src/app/description-rich-text.ts` が 0 件
