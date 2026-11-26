# 説明欄への非画像ファイル添付（#156）設計

## 背景

カード #156: 今の添付は JPEG / PNG / GIF / WebP（5MiB まで）だけ。PDF などのファイルも添付でき、本文からダウンロードのリンクとして開けるようにする。許可する種類・サイズ・配信時の安全性（Content-Disposition など）は設計で決める。

（#145 から分けた項目。#145 では画像・リンクの貼り付けと複数画像に対応した。画像添付の土台は `2026-11-21-item-image-attachments-design.md`。）

現状:

- アップロード API・GCS・枚数/プロジェクト容量・同時実行上限は画像専用の許可リストで動いている。
- 本文への挿入は常に `![alt](…/attachments/{id}/content)`。表示は `<img>`。
- `GET …/content` は `Content-Type` / ETag / Cache-Control のみ。`Content-Disposition` は無し。
- 削除時の本文掃除 `stripAttachmentMarkup` は `![…](path)` だけを除去する。

## 決めたこと

| 事項 | 採用 | 根拠 |
|------|------|------|
| 許可 MIME（非画像） | **`application/pdf` のみ**を追加。画像 4 種は維持 | カードの主対象が PDF。「など」は将来拡張の余地だが、ZIP/Office/HTML はマジック判定や XSS 面で別設計が要る（YAGNI） |
| 1 件サイズ | **全種類 5 MiB のまま**（`attachmentMaxBytes` 共通） | 既存のリクエスト上限・GCS チャンク・プロジェクト 100 MiB 枠（L-1035）を崩さない |
| 枚数・同時実行・プロジェクト枠 | **変更しない**（20 / 4 / 100 MiB） | 非画像も同じ行・同じスロットを使う |
| MIME 検証 | **サーバー**: 宣言 Content-Type ∈ 許可集合かつマジックバイト一致。不一致・空・読めない先頭は拒否（L-022 / L-023 / L-044）。**フロント**: 許可 MIME 集合とサイズだけ（`file.type`）。マジックはサーバーのみ | FE/BE で揃えるのは許可 MIME 集合。画像と同じ二層はサーバー側。PDF マジックは先頭 `%PDF` |
| 本文マークアップ | 画像は従来どおり `![name](path)`。**非画像は `[name](path)`**（`!` 無し） | 表示をリンクにするため。path は既存の同一アイテム content URL |
| 表示 | 同一アイテムの非画像 path を **ファイルリンク**として描画（新しい segment `file`）。`<a href=path download>` 相当。外部 `https:` リンクとは別扱い | ダウンロード意図を明示。他アイテム path はこれまでどおりプレーンテキスト |
| Content-Disposition | **画像許可 MIME（jpeg/png/gif/webp）: 付けない**。**それ以外（本設計では `application/pdf`）: `attachment`** + `filename` / `filename*` | 付与条件は「保存 MIME が画像許可集合の外」で統一（PDF 専用分岐を増やさない）。ブラウザが PDF をインライン実行せず保存寄りにする。ファイル名は DB の `originalName` をヘッダ安全に符号化 |
| ファイル名サニタイズ | 既存 `sanitizeAttachmentAlt` をリンクラベルにも流用。空なら画像は `image`、非画像は **`file`** | `]` / 改行除去は共通（L-018） |
| 削除時の本文掃除 | `stripAttachmentMarkup` が **`![…](path)` と `[…](path)` の両方**を除去 | 非画像リンクが本文に残らないようにする |
| 対象フィールド | **説明・ソリューション・コメント**（画像と同じ入口） | カード文言は説明だが、既存添付 API の field と UI を揃える |
| UI | 既存の「画像」操作を **「添付」** に広げ、`accept` / ヒント / busy 文言を画像+PDF 対応に更新。ボタンは 1 つ | 入口を増やさない |
| 貼り付け・ドロップ・複数 | 既存の順次アップロードを流用。許可 MIME に PDF を含め、画像と PDF を同じバッチで扱える | #145 の流れを壊さない |
| 挿入関数 | `buildAttachmentMarkup` を **contentType で分岐**（または画像用 / ファイル用を分ける）。検証した path・名前だけを挿入（L-018） | FE/BE の削除掃除と契約を一致させる |
| OpenAPI | 許可 MIME・Content-Disposition・本文記法を更新 | `update-api-doc` スキルに従う |

## 目的と受け入れ条件

1. 説明・ソリューション・コメントで、PDF（≤5 MiB）をファイル選択・ドロップ・貼り付けからアップロードできる。
2. 成功時のみ本文に `[サニタイズ後ラベル](/api/items/by-number/{n}/attachments/{id}/content)` が入る（空なら `file`。L-001 / L-018）。失敗時は本文を変えず案内を出す。生の `originalName` / `file.name` をそのままラベルにしない。
3. 描画ビューで同一アイテムのファイルリンクがクリック可能なダウンロードリンクとして出る。画像 Markdown はこれまでどおりインライン画像。
4. `POST` の許可外 MIME・マジック不一致・サイズ超過は **400**。枚数・プロジェクト枠超過は既存どおり。
5. `GET …/content` で、保存 MIME が画像許可集合の外（本設計では PDF）のとき `Content-Disposition: attachment`（と安全な filename）が付き、画像許可 MIME の応答には付けない。`X-Content-Type-Options: nosniff` は既存グローバルのまま。
6. `DELETE` で本文から画像記法・ファイル記法の両方が消える。
7. JPEG/PNG/GIF/WebP の既存挙動（挿入・表示・削除・キャッシュ）は壊さない。
8. フロントとサーバーの**許可 MIME 集合**が一致する。マジック一致はサーバーのみ（L-018 / L-023）。

## データモデル

変更なし。`item_attachments.content_type` に `application/pdf` が入るだけ。マイグレーション不要。

## API

既存エンドポイントのまま。差分のみ:

| 箇所 | 変更 |
|------|------|
| POST 許可 | `application/pdf` を追加。マジック `%PDF` |
| GET content | 保存 MIME が画像許可集合の外なら `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…`（本設計では PDF のみ該当） |
| OpenAPI | 上記とエラー例を追記 |

`filename`（ASCII フォールバック）は非 ASCII を `_` 等に置換した短縮名。`filename*` は RFC 5987 の UTF-8 percent-encoding。元名の CR/LF/`"`/`\` は入れない。

## UI / フロント

- `attachment-image.ts` を拡張（または `attachment-file.ts` に改名・再エクスポート）し、許可集合・accept・ヒント・`isAllowed*File` / `plan*Upload` を PDF 対応にする。画像専用の関数名が残る場合は互換ラッパを置くか、呼び出し側を一括更新する。
- `description-link.ts`: `buildFileAttachmentMarkup`（または分岐）、`parseDescriptionLinks` で同一アイテム path の `[label](path)` を `file` セグメントに。外部 https リンクの規則は変えない。`![…](path)` が画像、`[…](path)` がファイル。同じ path でも `!` の有無で種別が決まる。
- `description-rich-text` / `description-view`: `file` セグメントを `<a [href]="seg.src" [attr.download]="seg.label">` などで描画。削除ボタンは画像と同様に出せる（任意で「ファイルを削除」aria）。
- エディタ / コメント: アップロード成功後、`contentType` が画像なら画像記法、PDF ならファイル記法を挿入。

## セキュリティ

- HTML / SVG / JS / 実行ファイルは許可しない。
- PDF は `attachment` で配信し、インライン埋め込み表示はしない（別タブプレビュー UI も作らない）。
- マジック未検出は許可しない（L-022）。宣言だけ PDF で中身が画像、などの食い違いは拒否（L-023）。
- クライアント宣言のサイズは信じず、既存どおり読み取り上限で切る。
- Content-Disposition のファイル名はヘッダインジェクション防止のためサニタイズする。

## 気をつける知見

- L-001 成功/失敗を本文挿入に反映
- L-018 検証した URL・ラベルだけを挿入・href に使う
- L-022 / L-023 MIME とマジック
- L-1035 枠・同時実行を緩めない
- L-1009 multipart 後始末（`ParseMultipartForm` 直後の `RemoveAll` defer は動かさない。PDF 追加後も成功・マジック不一致などの新規 400 で >maxMemory part の残骸テストを維持する）
- L-044 許可リスト厳格

## 範囲外

- Office（docx/xlsx/pptx）、ZIP、テキスト、動画、音声
- PDF のインラインプレビュー・ページサムネ
- 1 件サイズやプロジェクト枠の引き上げ
- 外部 URL のファイルホットリンク
- 添付一覧専用 UI の新設（既存の本文・削除ダイアログで足りる）

## テスト方針

- BE: PDF マジック一致で 201、偽 PDF / サイズ超過 / 画像との取り違えで 400。content の Disposition 有無を画像と PDF で分岐固定。削除後に `[…](path)` が本文から消える。multipart は既存の `RemoveAll` defer を維持し、PDF マジック不一致など新規 400 でも >maxMemory part の残骸が残らないことを既存または同等テストで固定する（L-1009）。
- FE: accept・plan 関数が PDF を通し HTML 等を落とす。挿入記法の分岐。リッチ表示でファイルリンクが出る。既存画像テストが通る。許可外・サイズ超過・アップロード失敗では本文マークアップを増やさない（成功時挿入と対。L-001）。
