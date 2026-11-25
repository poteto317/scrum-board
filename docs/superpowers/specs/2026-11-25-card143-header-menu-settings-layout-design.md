# メニュー設定のレイアウト崩れ（#143）設計

## 背景

チケット「メニュー設定のレイアウトが崩れている」: チェックボックスの領域が広くテキスト幅が少ない／読み難い。項目ごとに位置が微妙にずれる。

調査（コード）:

- 設定ビューは `header-menu.component.html` の `.header-menu-settings-list label` 内に `input[type=checkbox]` + テキストラベル。
- コンポーネント CSS（`header-menu.component.css`）は label に `display:flex; align-items:center; gap:8px` のみ。
- グローバル `styles.css` が次を全 `label` / `input` に適用:
  - `label { margin: 23px 0 10px; … }` → 行ごとの縦余白が不揃いに見え、リストの `gap` と二重に効く。
  - `input, select { width: 100%; padding: 12px; … }` → チェックボックスが行幅いっぱい＋大きな padding になり、テキストが押し潰される／ずれて見える。
- 症状はチケットと一致。HTML 構造の変更は不要。スコープ付き上書きで足りる。

## 目的と完了条件（チケット）

1. メニュー設定の各行で、チェックボックスは自然な小ささ（コンテンツ幅）で左に並び、ラベル文字が十分な幅で読める。
2. 各行のチェックボックスとテキストの縦位置・左端が揃う（項目間で微妙なずれが無い）。
3. ページ種別セレクト・「戻る」・メインメニュー項目の見た目は壊さない。
4. 回帰テストで、設定リスト向けコンポーネント CSS に下記の打ち消しが含まれることを **ソース契約**（スタイルシート文字列の `toContain` / `toMatch`）で固定する。computed style や `getBoundingClientRect` は正本にしない（jsdom がグローバル＋コンポーネント CSSOM を十分に合成しないため）。

## 決めたこと

### 1. コンポーネント CSS で上書き（必須）

`header-menu.component.css` に次を **すべて** 足す（セレクタは設定リストに限定。グローバル `styles.css` は触らない）。下記プロパティ集合＝ソース契約の対象と同一:

```css
.header-menu-settings-list label {
  margin: 0;
  /* display/align/gap は既存どおり */
}

.header-menu-settings-list input[type='checkbox'] {
  width: auto;
  height: auto;
  padding: 0;
  margin: 0;
  flex-shrink: 0;
  border: none;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
}

/* border/box-shadow 打ち消しで global input:focus リングが消えるため復帰 */
.header-menu-settings-list input[type='checkbox']:focus-visible {
  outline: 2px solid #7e9b72;
  outline-offset: 2px;
}
```

### 2. HTML は据え置き

- `label` > `checkbox` + テキストの構造は維持。クラス追加・構造変更はしない。

### 3. 回帰テスト（正本: コンポーネント CSS ソース契約）

- `header-menu.component.spec.ts` に 1 `it`:
  1. 既存経路で設定ビューを開く（「メニュー設定」クリック。`pageKind.set` 禁止）。
  2. `document.styleSheets` から CSS テキストを結合し、次をすべて断言:
     - `.header-menu-settings-list label` 近傍に `margin: 0`（空白差は正規化して可）
     - `.header-menu-settings-list input[type='checkbox']`（または同等セレクタ）近傍に:
       `width: auto` / `height: auto` / `padding: 0` / `margin: 0` / `flex-shrink: 0` /
       `border: none` / `background: transparent` / `box-shadow: none` / `border-radius: 0`
  3. 先頭設定行 label の `textContent` がカタログラベル（例: 「プロジェクト」）を含むこと（可視テキスト固定。aria-label 依存にしない）。
- **左右ずれの getBoundingClientRect 比較はスキップ**（jsdom 非対応）。揃えは flex + 上記打ち消しのソース契約で担保する。

### 4. 変異テスト（L-175）

代表 2 変異で検知力を固定する（全プロパティを個別変異はしない。契約 `it` が全キーを `toContain` するため、消えたキーは同テストで落ちる）:

1. 変異前 green。
2. **M01**: checkbox 規則から `width: auto;` を削除 → 契約テストが `width` 期待で落ちる。
3. **M02**: label 規則から `margin: 0;` を削除 → 契約テストが `margin` 期待で落ちる。
4. 各回 `--show-diff` で狙った箇所のみ変更を確認し、復元・`cmp -s`（`git checkout` / `git restore` 禁止）。

## 範囲外

- グローバル `styles.css` の form 規則の全面見直し。
- メニュー設定の並び替え・新カタログ ID。
- メインアクション一覧（`role=menuitem`）のレイアウト変更。
- ダークモード／テーマ追加。

## 気をつける知見

- **L-060**: グローバル打ち消しの CSS をソース契約で固定。設定 UI は既存 openSettings 経路。
- **L-175**: M01/M02 で width・margin 契約の検知力を確認。
- **L-515**: 設定行ラベルは `textContent` で可視テキストを見る（aria-label だけに頼らない）。
