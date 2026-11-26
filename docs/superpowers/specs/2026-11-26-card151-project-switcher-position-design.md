# プロジェクトのセレクトボックスの位置を変える（#151）設計

## 背景

カード #151「プロジェクトのセレクトボックスの位置を変える」:

> ヘッダーにあると、詳細などを開いた場合にも選択できるが、選択をしても特に何もないのでノイズ。
>
> かんばんボードとバックログのページの右上に表示させる

現状:

- プロジェクトの切り替え（`#project-select-trigger` のボタンと `#project-select-list` の listbox）は、シェルの `app.html` のヘッダーに直書きされている。開閉・キー操作・状態の点（L-060）・他プロジェクトの先読み・切り替え後の `?project=` の同期は、すべて `App`（`app.ts`）が持つ。
- 選択中のプロジェクトの状態は `ProjectSession`（root）が持ち、ボード・バックログ・スプリントなどはそれを読むだけ。
- `?project=` のディープリンクの適用（`applyProjectDeepLink`）も `App` にある。

## 決めたこと

- **部品を切り出す。** ヘッダーの切り替えの UI とその処理を、新しい standalone の部品 `ProjectSwitcher`（`project-switcher.ts` / `.html` / `.css`、selector `app-project-switcher`）へそのまま移す。DOM の id（`project-select-trigger`、`project-select-list`、`project-option-<id>`）・クラス名・キー操作・ARIA・先読み・状態の点・エラー表示（`projectSession.error()`）は変えない。開閉の状態（`projectMenuOpen` など）は部品のローカルな signal に置く（ページを離れると破棄される。L-542）。listbox を閉じる処理（`document:keydown.escape` と `document:mousedown` の `@HostListener`、外側の判定に使う `#projectSwitcher` の ref）も部品へ移す。ボードとバックログは同時に出ないので、リスナーは二重にならない。
- **置き場所。** かんばんボード（`board.html`）とバックログ（`backlog.html`）の先頭のパンくずの行を、`.page-topbar`（`display:flex; justify-content:space-between; flex-wrap:wrap`）で包み、右端に `<app-project-switcher />` を置く。これを「ページの右上」とする。見出しの右の操作ボタン（「アイテムを追加」など）とは縦に重ならない。`.page-topbar` はグローバルの `styles.css` に 1 つだけ定義する。
- **ヘッダーから外す。** `app.html` から `.project-switcher` と、その前の `.header-divider` を消す。`app.ts` から切り替えの処理を消す。ディープリンクの適用（`applyProjectDeepLink` と、その effect）と `projectSession.load()` は `App` に残す（ボード `/` に着いたときだけ一度適用する、いまの動きを保つ。L-1038 の「ディープリンクで共有の設定を PATCH しない」も変えない）。`<app-header-menu [projectSwitching]>` はそのまま。
- **URL の同期。** 切り替え成功後の `?project=` の書き換えは、部品の中で `router.parseUrl(router.url)` に `withProjectQueryParam` を当てて `navigateByUrl(tree, { replaceUrl: true })` する。いまの `App` は `NavigationEnd` で覚えた `routeUrl()` を使っているが、部品はルートの中で作られるので、表示中は `router.url` が `urlAfterRedirects` と同じ値になる。マージの方法（`navigateByUrl` と純関数）は変えない。ただし部品はページと一緒に破棄されるので、切り替えの完了を待つ間に別のページへ移ると、完了時の `router.url` は移動先を指す。そこで、選んだ時点のパス（クエリを除く）を覚え、完了時のパスが同じときだけ同期する（違えば同期しない）。`switchTo` の購読は解除しない（解除しても `ProjectSession` 側の切り替えは止まらず、HTTP だけ取り消されて状態が半端になるため）。
- **CSS。** `app.css` の `.project-switcher`・`.project-select-trigger`・`.project-select-list` 系・`.project-switcher .secondary`・`.project-error` は、部品の `project-switcher.css` へ移し、`app.css` からは消す（`:host` を `display:block` 相当にする）。`.header-divider` は `app.html` から外すので、その定義と `@media (max-width:680px)` の中の `.header-divider` と `.project-switcher .project-error` の指定も消す（`.header-end` の指定は残す）。状態の点の色（`styles.css` の `.project-select-list .status-dot` など）はグローバルのまま残す。
- **ラベル。** 部品は `<label class="sr-only" for="project-select-trigger">プロジェクト</label>` を持ち続ける（見えるラベルは付けない。いまと同じ見た目）。トリガーに `aria-label` は足さない（ボタンの文言＝プロジェクト名が名前になり、`label` で補う、いまの形を保つ）。
- **モバイル。** `.page-topbar` は折り返す。トリガーの `max-width: 180px`・省略表示と、listbox の `max-width: min(280px, 80vw)` はそのまま。右端に置くので、listbox は `right: 0; left: auto` で右揃えに開く（左に開くと画面外へはみ出すため）。エラーの文言は、ヘッダーでは狭い画面で隠していたが、ページ内では隠さず、折り返して出す。
- **ほかのページ（判断 3）。** プロジェクト単位のデータを出すページ（スプリント一覧・スプリント詳細・アーカイブ・ゴミ箱・繰り返し）は、ヘッダーから名前が消えると、どのプロジェクトかが分からなくなる。そこで、文字だけの部品 `ActiveProjectName`（`active-project-name.ts`、selector `app-active-project-name`、`<p class="active-project-name">プロジェクト: <strong>名前</strong></p>`）を作り、各ページのパンくずの直後（スプリント詳細も同じ位置）に置く。切り替えはできない。名前が分からない間（読み込み前など）は何も出さない。
  - アイテム詳細は、自分のプロジェクトを「プロジェクト」の選択欄で出しているので足さない。AI チャットのページ（`/ai-chat`）は `?project=` があればそれを、無ければ選択中のプロジェクトを対象にする（`projectId()`）。そこで `ActiveProjectName` は任意の入力 `projectId`（`number | null | undefined`）を持ち、`undefined`（渡されない）のときだけ `ProjectSession.activeId()` の名前を出す。`null`（`?project=` が不正、または未選択）のときは何も出さない（不正な ID の画面に別のプロジェクトの名前を出さない）。AI チャットのページでは `[projectId]="projectId()"` を渡し、`<header>` の中の `h1` の直後に置く。プロジェクト管理・ユーザー・設定は、ワークスペース全体のページなので足さない。
- **テスト。** `app.spec.ts` の「App project switcher」のうち、切り替えの UI のテストは `project-switcher.spec.ts` へ移す（`App` ではなく部品を作って確かめる）。`app.spec.ts` には「ヘッダーに `#project-select-trigger` が無い」テストを足し、ディープリンク・サイドバー・お気に入りなどのテストは残す。部品のテストには、Escape・外側クリックで閉じることと、切り替えの完了前に別のパスへ移ったら `?project=` を書き換えないことを含める。ボードとバックログのテストに「`app-project-switcher` が右上（`.page-topbar` の中）にある」ことを足す（L-060: 組み立ての配線漏れを検出する）。`ActiveProjectName` の単体テスト（`projectId` が `undefined` / 数値 / `null` の 3 通り）と、各ページで出ることのテストを足す。
- **範囲外。** プロジェクト管理の画面、選択中のプロジェクトの保存方法、`ProjectSession` の API、バックエンド。

## 変えないこと（確認）

- 切り替え時のボードの読み直し・バックログの切り替え・AI チャットの対象の切り替えは、すべて `ProjectSession.activeId()` を見ているので、UI の置き場所を変えても動きは変わらない。
- アイテム詳細から別プロジェクトへ移した後の整合も `ProjectSession` 側の処理で、ヘッダーに依存しない。
- `header-menu` は `projectSwitching` だけを受け取り、セレクトボックスの DOM には依存しない。

## 知見

- L-060（配線漏れ）: ボード・バックログに部品があることをページのテストで確かめる。
- L-542（ページ固有の UI 状態）: 開閉の状態は部品のローカルに置く。
- L-1038（ディープリンクで PATCH しない）: ディープリンクの処理は動かさない。
- L-408（キーリピート）: いまの `event.repeat` の扱いをそのまま移す。
