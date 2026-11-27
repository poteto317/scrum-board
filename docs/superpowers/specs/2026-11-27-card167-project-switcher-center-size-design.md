# プロジェクト変更の位置とサイズ（#167）設計

## 背景

カード #167「プロジェクト変更の位置」:

> 右上ではなく中央に変更する。  
> また、大きくする。  
> 幅と高さをそれぞれ2倍にする（もっと良いサイズに調整可）

#151 でヘッダーからボード／バックログの `.page-topbar` **右端**へ移した。トリガー `max-width: 180px`、`padding: 4px 8px`、`font-size: 14px`。listbox は右揃え（`right: 0`）。

## 決めたこと

### 範囲

- **対象:** `app-project-switcher` の配置と見た目サイズのみ（ボード・バックログ）。
- **変えない:** 開閉・ARIA・キー操作・先読み・`ProjectSession`・ディープリンク・`ActiveProjectName`・他ページ。API / バックエンドなし。

### 位置（中央）

- `.page-topbar` を **3 カラムの CSS grid** にする（`display: flex` / `flex-wrap` はやめる）。
  - 列は `grid-template-columns: 1fr auto 1fr`。
  - **DOM は子 2 つだけ**（パンくず + `<app-project-switcher />`）。右の対称用に空の第三要素は置かない。スイッチャーは `grid-column: 2`（中央トラック）に置き、左右の `1fr` が対称になる。
- グローバル `styles.css` の `.page-topbar > app-project-switcher { margin-left: auto }` は削除する（右寄せの原因）。
- 部品内 `.project-switcher` の `justify-content` は `center` にする。中央寄せはホスト内側の `margin-left: auto` に載せない（L-1096）。
- listbox はトリガー直下の中央に開く: `left: 50%; right: auto; transform: translateX(-50%)`（右寄せ `right: 0` をやめる）。`max-width: min(560px, 90vw)` で画面内に収める。
- エラー文言（`.project-error`）は `text-align: center`（部品内の `text-align: right` をやめる）。
- **狭い幅:** topbar は wrap しない。パンくずは左列で省略（`min-width: 0` + ellipsis）、スイッチャーは常に中央トラック。縦スタックはしない。
- 実装時に右寄せの取り残しを消す: `justify-content: flex-end`、`.project-error { text-align: right }`、listbox の `right: 0`。

### サイズ（約 2 倍・調整）

カードの「2 倍」を基準に、読みやすさで少し丸める。

| 項目 | 現状 | 採用 |
|--|--|--|
| トリガー `max-width` | 180px | **360px** |
| トリガー `padding` | 4px 8px | **8px 16px** |
| トリガー `font-size` | 14px | **16px**（厳密 2×=28px は大きすぎるため調整） |
| トリガー `border-radius` | 6px | **8px** |
| listbox `max-width` | min(280px, 80vw) | **min(560px, 90vw)** |
| listbox `max-height` | min(280px, 50vh) | **min(360px, 55vh)**（高さは縦メニューなので 2×=560 は過大） |
| option `padding` | 6px 10px | **12px 16px** |
| option `font-size` | 14px | **16px** |

高さは行の padding + font で約 2 倍になる。

### テスト

- ボード／バックログ: `app-project-switcher` が `.page-topbar` 内にあること、かつ **DOM 上は topbar の第 2 子**（パンくずの次）であることを固定（L-060）。中央ラッパーは使わない。
- スタイル: `.page-topbar` が grid で `grid-template-columns` が `1fr auto 1fr` であること、および `app-project-switcher` に `margin-left: auto` が付いていないことを固定（右寄せ回帰防止）。
- listbox の中央開き（`left: 50%` / `transform`）とサイズ表の主要値を、CSS 本文または computed で回帰固定してよい。
- 右寄せ前提のアサーション（`margin-left: auto` 依存）があれば直す。

## 受け入れ条件

1. ボードとバックログで、プロジェクト切替がページ上部の**水平中央**に見える（パンくずの右端ではない）。
2. トリガーと listbox／option が上記のサイズ表どおり大きくなる。
3. listbox はトリガーの下に中央揃えで開き、操作・キーボード・切替動作は #151 と同じ。
4. ヘッダーや他ページにセレクトが増えない。

## 範囲外

- プロジェクト管理画面、名前の付け方、永続化、バックエンド。
- モバイル専用の別レイアウト（縦スタックや別コンポーネント）。狭い幅は上記「狭い幅」どおり同一 grid。

## 知見

- **L-060** 配置変更はページテストで配線を固定する。
- **L-1096** 中央寄せはホスト／grid 列で行い、内側ラッパーの `margin-left: auto` に載せない。
- 見た目だけの変更でも、右寄せ用 CSS（`margin-left: auto` / `justify-content: flex-end` / `right: 0`）の取り残しで戻って見える。

## アプローチ比較（採用: A）

| | A（推奨）topbar 3 列 grid + 中央列 | B 絶対配置で画面中央 | C パンくず下の別行に中央置き |
|--|--|--|--|
| パンくずとの関係 | 同一行で左右対称 | パンくずと重なりうる | 縦に場所を取る |
| #151 構造 | 最小差分 | topbar 外へ出す | 行が増える |

**採用 A。**
