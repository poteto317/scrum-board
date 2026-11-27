# 説明欄画像の拡大表示と表示サイズ（#158）設計

## 背景

カード #158「説明欄の画像をクリックで拡大し、表示の大きさを変えられるようにする」:

> 説明欄・ソリューション・コメントの画像を、クリックで拡大表示できるようにする。あわせて、本文中の表示の大きさ（小・中・大など）を選べるようにする。  
> （カード #145 から分けた項目。）

#145 で同一アイテム添付の `![alt](…/attachments/{id}/content)` を `DescriptionRichText` が `<img class="rich-image">` で表示する。クリック拡大は無し。インライン幅は固定 `max-width: min(100%, 28rem)`。

## 決めたこと

### 範囲

- **対象:** 説明・ソリューション・コメントの **同一アイテム添付画像**（既存の image セグメント）。
- **含める:** (1) クリックで拡大（lightbox）(2) 本文中の表示サイズ 小・中・大の選択と永続化。
- **変えない:** アップロード・MIME・DnD・PDF ファイルリンク・ブックマーク・外部 `https://` 画像（引き続きプレーンテキスト）。API / バックエンドなし。
- **範囲外:** ピンチズーム、ギャラリー左右送り、回転、ダウンロード専用 UI、編集モード専用の別プレビュー。

### 表示サイズ（本文に永続化）

| キー | 意味 | インライン `max-width`（推奨） |
|--|--|--|
| `sm` | 小 | `min(100%, 12rem)` |
| `md` | 中（既定） | `min(100%, 28rem)`（現状と同じ） |
| `lg` | 大 | `min(100%, 48rem)` |

- **記法:** CommonMark の title。`![alt](path "sm")` / `"md"` / `"lg"`。path と `"…"` の間は **空白必須**、title は二重引用のみ。title 無し・未知値は **`md`**。
- パーサ（`parseDescriptionLinks`）は `](` … `)` 内を path と任意の `"title"` に分ける。path はいまどおり `isAttachmentContentPath`。正規化は `normalizeImageDisplaySize`（許可 3 値以外 → `md`）を parse と build で共有（L-018）。
- `DescriptionSegment` の image に `displaySize: 'sm' | 'md' | 'lg'` を足す。CSS は `.rich-image--sm` / `--md` / `--lg`。
- `buildAttachmentMarkup` は既定 `md` のとき title を省略（既存本文と互換）。`sm`/`lg` のときだけ `"…"` を付ける。
- **UI:** 各画像の下（削除ボタン横）に「小／中／大」の segmented control（`role="group"` + `aria-label="画像の表示サイズ"`）。
- **誰が変えられるか（真偽表）:** `canChangeImageSize` 入力。説明・ソリューションは **既存の画像削除と同じ条件**（`imagesEnabled()` = 添付フィールドありかつ `!disabled()`。親の `editLocked` は `disabled` に畳まれて渡る）。コメントは **`canModifyComment(c)`**（`canDelete` が `!readOnly` と粗い場合でも、サイズ変更は作者／権限チェック付き）。閲覧不可・権限なしはサイズ UI なし（lightbox のみ可）。
- **コメントの保存:** 閲覧表示中にサイズを変えたら、そのコメント本文を rewrite して **既存のコメント更新 API で即保存**。編集モード（textarea）中はサイズ UI が無いので変更しない（markdown を手で直すか、保存後に閲覧表示で選ぶ）。
- **書き換え範囲:** `imageDisplaySize` は `{ attachmentId, size }`。親はそのフィールド本文内で、当該 `attachmentId` の **すべての** `![…](…/attachments/{id}/content…)` 出現を同じ size に書き換える（同一添付は同じ表示サイズ）。出現 index は持たない。
- サイズ変更は画像クリック（拡大）と衝突しないよう、コントロールの click で `stopPropagation`。

### クリック拡大（lightbox）

- `DescriptionRichText` 内に **1 つの** `<dialog class="modal-backdrop">`（既存の dialog 契約に合わせる。`dialog.modal-backdrop[open]` の flex 中央寄せはグローバル CSS を流用）。
- `<img>` クリックで `showModal()`。拡大画像は同じ `src`（サーバが返す実寸。クライアントで再デコード爆弾を増やさない。アップロード上限は既存 5MiB）。
- 閉じる: Escape（dialog の cancel）、× ボタン、backdrop クリックは **既存ボードの add dialog 方針に合わせる** → **backdrop では閉じない**、× と Escape で閉じる（誤タップで閉じない。L-473 系の意図と揃える）。
- フォーカス: 開いたら × へ。閉じたら元の画像（またはサイズ操作）へ戻す。
- 削除ボタン・サイズ操作の click は拡大しない。
- `draggable` の dragstart とは独立（ドラッグ中に click が発火しない前提。必要なら pointer 判定は最小限）。
- lightbox 内にサイズ変更は置かない（本文のコントロールのみ）。

### 配線

| 場所 | 変更 |
|--|--|
| `description-link.ts` | parse / build に size title |
| `description-rich-text.ts` | サイズ class、コントロール、dialog、click |
| `description-blocks-editor` / `item-comments` | size 変更で本文書き換え |
| テスト | parse/build、rich-text 開閉・サイズ class、親の書き換え |

### 受け入れ条件

1. 説明・ソリューション・コメントの添付画像をクリックすると拡大 dialog が開き、× / Escape で閉じる。
2. 小・中・大を選ぶとインライン幅が変わり、保存後も markdown title で残る。未指定は中。
3. 既存の title 無し `![…](…)` は中サイズのまま表示され、壊さない。
4. 削除・DnD・ファイル添付・ブックマークは従来どおり。

## アプローチ比較

| | A title `"sm"|"md"|"lg"`（採用） | B alt に `|sm` | C 別メタ API |
|--|--|--|--|
| 互換 | title 無し = md | alt 表示が汚れる | BE 必要 |
| 標準 | CommonMark title | 独自 | — |

## 知見

- **L-060** サイズ変更・lightbox を親／rich-text テストで配線固定。
- **L-018** size の正規化（許可 3 値以外 → md）を parse と build で同じ関数に。
- dialog `[open]` flex（既存 styles 契約）。
- キーリピート / Escape は dialog に任せ、独自 blur 確定と混ぜない。
