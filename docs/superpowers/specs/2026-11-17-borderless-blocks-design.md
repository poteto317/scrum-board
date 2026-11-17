# 入力の枠をなくす（アイテム #21）

## 背景

カード要件: Notion のように詳細画面をもっと自由に入力できるようにする。大きな枠付きの説明欄は不要。**詳細画面のみ**が対象で、ボード／バックログの「アイテムを追加」は従来どおり textarea のままでよい。説明以外（タイトルやプロパティ周り）も、Notion のようにページ上の部品として扱い、説明本文は段落ごとの**ブロック**にする。

現状の詳細は `detail-card` の枠＋タイトル `input`＋説明の閲覧／編集トグル（枠付き `description-view` / `textarea`）であり、フォーム感が強い。

## 決めたこと（推奨案を採用）

設計の確認事項は推奨案つきでまとめて問う想定だが、本フローでは未回答を承認とせず推奨を採用して確定する（feature.md）。

| 事項 | 採用 |
|------|------|
| 対象範囲 | **詳細画面のみ**。作成モーダル（board / backlog）の説明 textarea は変更しない |
| データ | `description` は従来どおり **単一 string**（上限 10000）。API／DB スキーマ変更なし |
| ブロックの意味 | 説明本文を **段落ブロックの列**として編集する。モデルは **`string[]`**（各要素が1ブロックのテキスト）。1 ブロック = 改行 `\n` で区切った 1 行（空行も `''` ブロックとして保持） |
| シリアライズ | `serialize(blocks) = blocks.join('\n')`。`parse(text) = text === '' ? [''] : text.split('\n')`。既存の単一行・複数行・`[label](https://…)` リンク記法はそのまま通る |
| ブロック内改行 | textarea への **貼付や Shift+Enter でブロック文字列に `\n` が入ったら、その入力の処理の直後に `parse(serialize(blocks))` で正規化し、必ず「1 要素 = `\n` を含まない」状態にする**（次の load まで遅延しない） |
| 入力手段 | **枠なし・自動伸縮の textarea** をブロックごとに使う（contenteditable は使わない）。カードの「テキストエリアにする必要はない」は **1 枚の大きな枠付き説明欄**を指すと解釈する |
| 常時編集 | 閲覧／編集トグルと「編集」ボタンは廃止。フォーカスで書き、blur／debounce で既存 autosave へ流す |
| タイトル | ページ見出し風の **枠なし大入力**（ブロック列には入れない。必須 1〜200 は維持） |
| 「説明以外もブロック」 | ステータス・担当・期限・プロジェクト等の **ドメイン属性は free-text ブロック化しない**（壊れる）。代わりにプロパティを Notion 風の **枠の薄い行リスト**にし、本文エリアのカード枠を外してページ感を出す |
| ブロック操作（MVP） | Enter で次ブロック分割、先頭での Backspace で前ブロックへ結合。**DnD 並べ替え・ネスト・見出し／リスト／ToDo／コードブロック・スラッシュコマンドは対象外**（L-457 回避） |
| リンク | 既存の `[label](https://…)` 挿入ダイアログを維持。対象はフォーカス中ブロックの selection。全体結合後の文字数で 10000 を判定（L-836） |
| ライブラリ | TipTap / ProseMirror 等は入れない（依存追加なし） |
| 見出し UI | 「アイテムの詳細」など案内コピーは残してよいが、本文カードの section-label「タスクの内容」は外してページ感を優先 |

## 目的と受け入れ条件

1. 詳細画面のタイトルと説明に、従来のような目立つ入力枠（`border` 付きの大きな説明欄）が無い。作成モーダルの説明は従来どおり枠付き textarea。
2. 説明は 1 つ以上の段落ブロックとして編集でき、Enter でブロックが分かれ、先頭 Backspace で前と結合する。空の説明は空ブロック 1 個から始められる。
3. 保存形式は従来の `description` string。リロード後も同じ文字列（改行位置含む）に戻り、既存リンク記法が表示・挿入できる。
4. 自動保存（debounce / blur / 組成中ガード）は既存 `ItemAutosave` 経路を使い、ブロック編集は **`form.controls.description` だけ**を更新する（フォーム欄であり side フィールドではない）。dueAt 等の sideDirty マージ規則は既存のまま触らない（L-790 の対象外として維持）。世代ずれ防止は L-037。成否は呼び出し元へ伝える（L-001）。
5. プロパティ（プロジェクト・ステータス・担当など）は構造化 UI のまま操作でき、見た目は枠を抑えた行リストである。
6. 説明 10000・タイトル 200 の上限は、結合後／正規化後の値で拒否され、上限超えで文書全体が読めなくなる経路を作らない（L-836）。
7. 日本語 IME 変換中の Enter でブロック分割しない。判定は `event.isComposing || event.keyCode === 229` の両方（L-474）。blur と明示操作の二重確定で内容を消さない（L-473）。
8. Enter／Backspace でブロック DOM（textarea）を差し替えるとき、外れた要素の blur に保存を依存しない。差替の**直前**に serialize → `setValue`（必要なら flush）する（L-397）。

## 非目標（本イテレーション）

- contenteditable / リッチテキスト（太字・色）
- ブロック種別の追加（H1、箇条書き、画像、埋め込み）
- ブロック DnD・インデント階層
- 説明の JSON カラム化・マイグレーション
- 作成フォームのブロック化
- ディープリンクやライブ更新の仕様変更

## UI

```
[← 戻る]
TASK-021                    [リンク] [コマンド…]
（ページタイトル入力・枠なし・大）
（段落ブロック… 枠なし・自動伸縮）
  [リンク]（フォーカス時ツールバー可）

｜ プロパティ（枠薄）
｜ プロジェクト / ステータス / …
```

- メインカラムから `detail-card` の強い枠・「タスクの内容」ラベルを外す（または紙面背景のみ）。
- サイドの properties は行区切り中心にし、select 自体の最低限の枠はアクセシビリティのため残してよい。
- グローバル `input, textarea { border: … }` があるため、詳細ページでは **修飾クラス**（例: `.page-title`, `.block-input`）で枠・背景を打ち消す。クラスをグローバルへ無修飾で移さない（L-792）。

## コンポーネント構成

| 単位 | 責務 |
|------|------|
| `description-blocks.ts`（純関数） | `parseDescriptionBlocks(text) → string[]` / `serializeDescriptionBlocks(blocks: string[]) → string` / `splitBlock` / `mergeWithPrevious` / 入力後の `normalizeBlocks`（要素内 `\n` を展開）。長さチェックは **serialize 後の文字数** |
| `DescriptionBlocksEditor`（コンポーネント） | ブロック配列の表示・Enter/Backspace・フォーカス管理・リンクツールバー呼び出し口。出力は `text` の Change と同等（親が FormControl へ書く） |
| `DescriptionEditor` | リンクダイアログ状態は維持。`editing` トグルは削除または常時 true 相当に簡略化 |
| `ItemDetail` | タイトルを page-title 化、本文を `DescriptionBlocksEditor` に置換、プロパティ枠のクラス調整。autosave.flush / composition をブロック経由で接続 |

ライブ再取得や project 切替で item が差し替わるときは、既存どおり form をリセットし、ブロックも `parse` し直す（古い世代を書き戻さない・L-037）。

## データ流

1. load → `description` string → `parseDescriptionBlocks` → エディタ表示
2. ユーザー入力 → ブロック配列更新 → `serialize` → `form.controls.description.setValue(..., { emitEvent: true })` → 既存 debounce autosave
3. リンク挿入 → フォーカスブロックの selection に markdown を挿入 → serialize → setValue + flush（現行と同様 L-001）

`setValue` 時は省略引数で他フィールドを `undefined` 上書きしない（L-454）。description だけを更新する。

## キーボード

| キー | 条件 | 動作 |
|------|------|------|
| Enter | `!(isComposing \|\| keyCode === 229)` | キャレット位置でブロックを分割し、後半を新ブロックへ。差替前に serialize/setValue。新ブロックへフォーカス |
| Enter | `isComposing` または `keyCode === 229` | 分割しない（IME 確定のみ） |
| Backspace | キャレット先頭かつ前ブロックあり | 前ブロック末尾へ結合し、空になったブロックを除去（唯一のブロックは空文字のまま残す） |
| Backspace | それ以外 | 通常削除 |

Escape でブロック破棄はしない（autosave 文書のため）。

## エラー・上限

- serialize 後が 10000 超: FormControl の既存 `textLimit(10000)` で invalid にし、画面に既存と同様のエラー文を出す。
- Enter 分割や貼付正規化の結果が 10000 超になる場合は **その操作を適用せず**（ブロック配列を操作前に戻す）、同じエラー文を出す。黙って切り捨てない（L-044）。
- リンク挿入失敗は現行どおりダイアログエラー（L-001）。

## テスト方針

- 純関数: parse/serialize 往復、空・末尾改行・既存リンクを含む文字列、要素内 `\n` の normalize。
- エディタ: Enter 分割、先頭 Backspace 結合、`isComposing` と `keyCode === 229` それぞれの Enter 非分割、10000 超の分割拒否、差替前 setValue（blur 非依存）。
- ItemDetail: 枠クラス／作成フォーム未変更の回帰（board の `#card-description` が残る）、autosave が serialize 結果を送る、カード切替でブロックが新しい description に同期。
- **閲覧用 `description-view`（リンクを `<a>` 化する描画）は廃止**する。既存の view クリック／セグメント試験はブロック編集＋リンク挿入試験へ移行する。ブロック内に `<a>` を入れ子にしない（L-835 の再導入禁止）。description-link のパース／挿入純関数テストは維持。

## 知見（手順 4）で特に見る ID

優先度 A: L-001, L-037, L-040, L-044, L-453, L-454, L-473, L-474, L-790, L-792, L-836  
優先度 B（UI・非同期）: L-397, L-399, L-408, L-835, L-842  
（DnD ネストは非目標のため L-457 は「やらない」ことで回避）

## 実装後に直さない既知の制約

- ブロック並べ替えや見出しブロックは無い。
- プロパティを本文ブロックへ混ぜることはしない。
- リンクは markdown 原文のままブロック内で編集する（装飾レンダリングの常時表示は次イテレーション可）。閲覧専用 view は戻さない。
