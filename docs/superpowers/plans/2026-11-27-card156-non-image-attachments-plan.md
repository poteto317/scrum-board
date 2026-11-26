# カード #156 非画像（PDF）添付 実装プラン

- 設計書: `docs/superpowers/specs/2026-11-27-card156-non-image-attachments-design.md`
- 目的: PDF を画像と同じ添付 API で上げ、本文にダウンロード用の `[label](path)` を入れ、content GET で `Content-Disposition: attachment` を付ける。
- 気をつける知見: L-001, L-018, L-022, L-023, L-044, L-1009, L-1035
- 検証コマンド:
  - BE: `cd backend && go test ./internal/kanban/ -count=1 -run 'Attachment|ValidateAttachment|StripAttachment|ContentDisposition|MIME'`
  - 広げるとき: `cd backend && go test ./internal/kanban/ -count=1`
  - FE: `cd frontend && npx ng test --watch=false --include='**/attachment-image.spec.ts' --include='**/description-link.spec.ts' --include='**/description-rich-text.spec.ts' --include='**/description-view.spec.ts' --include='**/description-blocks-editor.spec.ts' --include='**/item-comments.spec.ts'`
  - 最後: `cd frontend && npm test -- --watch=false` と `python3 scripts/check-openapi-routes.py`（リポジトリに存在する場合）
- 進め方: TDD。コミットはしない（後の `/commit-ja`）。

## 責務の分割（後のコミット用）

1. BE: MIME / マジック / Content-Disposition / strip の両記法
2. FE: 許可リスト・マークアップ・パーサ・表示
3. FE: エディタ／コメントの挿入分岐と文言
4. docs: OpenAPI

---

## タスク 1: サーバー — PDF MIME とマジック

ファイル: `backend/internal/kanban/attachment.go`、`attachment_markup_test.go`、必要なら `attachment_handler_test.go`

1. `TestValidateAttachmentMIME` に次を足す（先に失敗を確認）:
   - `application/pdf` + 先頭 `%PDF-1.4` を含むバイト → err == nil
   - `application/pdf` + PNG マジック → err != nil
   - `image/png` + `%PDF` → err != nil
   - `text/html` + `%PDF` → err != nil（許可外）
2. サイズ超過: ハンドラまたは `CreateAttachment` 経路で、宣言 `application/pdf`・本体が `attachmentMaxBytes+1` のとき **400**（既存の画像サイズ超過テストと同型があればそれを PDF で 1 本追加。無ければ新規）。
3. 空・未検出マジック（L-022）: `application/pdf` + 空バイト、または `%PDF` でない短い先頭 → err != nil。
4. 実装:
   - **画像許可集合**（Disposition・インライン判定用）を現在の jpeg/png/gif/webp のまま残す（例: `imageAttachmentMIME`、または既存 map を画像専用に改名）。
   - **アップロード許可集合**は画像集合＋`application/pdf`（例: `allowedAttachmentMIME` = 画像 ∪ PDF）。Disposition は画像集合のみ参照する（PDF をアップロード許可に入れただけで Disposition が消えないようにする）。
   - `detectImageMIME` に PDF 分岐を追加（または `detectAttachmentMIME` に改名）。先頭 4 バイトが `%PDF` なら `application/pdf`。画像判定は既存のまま。
   - `validateAttachmentMIME` は検出結果を使う。
   - **枠は緩めない（L-1035）**: `attachmentMaxBytes` / `attachmentMaxCount` / `attachmentMaxConcurrent` / `attachmentMaxProjectBytes` の定数値は変更しない。PDF 経路でも枚数・プロジェクト枠超過は既存と同型の 400/エラーになることを、既存テスト参照または PDF 1 本で確認する。
5. テストを通す。

## タスク 2: サーバー — Content-Disposition と削除掃除

ファイル: `attachment.go`（`stripAttachmentMarkup` / マークアップ生成）、`attachment_handler.go`（`serveAttachmentContent`）、対応テスト

1. 失敗するテストを書く:
   - `stripAttachmentMarkup`: `"before [doc](/api/items/by-number/7/attachments/3/content) after"` → `"before  after"`。画像記法も従来どおり消える。片方だけ path が違う id なら残る。
   - `BuildFileAttachmentMarkup(itemNumber, id, name)`（新関数。FE の `buildFileAttachmentMarkup` と同語順）: `]` と改行を除き、空なら `file`。戻り値は `[label](path)`（`!` 無し）。
   - content GET: 小さな PDF をアップロード後、`Content-Disposition` が `attachment` を含み `filename=` / `filename*=` がある。PNG アップロード後は `Content-Disposition` ヘッダが無い（または空）。判定は **画像許可集合**（タスク1）のみ。アップロード許可集合に PDF が入っていても PDF には Disposition が付く。
   - filename 安全性: `originalName` に CR/LF/`"`/`\` と非 ASCII（例: `報告.pdf`）を含む PDF を上げ、`filename=` にそれらの危険文字が無く ASCII フォールバック、`filename*=UTF-8''` に percent-encode された UTF-8 があることを固定する。
   - L-1009: 既存の multipart 残骸テストが PDF マジック不一致（宣言 `application/pdf`・本文は >maxMemory のゴミ）でも残骸ゼロであることを確認。無ければ同等ケースを 1 本足す。
2. 実装:
   - `stripAttachmentMarkup`: 既存の `![` 探索に加え、同じ needle `](path)` に対して直前の `[`（直前が `!` でない）も除去。
   - `sanitizeAttachmentName(name, fallback string)` に共通化。画像は fallback `"image"`、非画像は `"file"`。`CreateAttachment` は保存 MIME が画像集合なら `image`、そうでなければ `file` を渡す。`BuildAttachmentMarkup` / `BuildFileAttachmentMarkup` も同じ関数を使う。
   - `serveAttachmentContent`: `contentType` が **画像許可集合**に無いときだけ Disposition をセット。filename は上記規則で符号化。
3. テストを通す。ハンドラ結合は既存 `attachment_handler_test.go` の upload→content パターンに PDF ケースを足す。

## タスク 3: フロント — 許可リストとマークアップ／パーサ

ファイル: `frontend/src/app/attachment-image.ts`（＋ `.spec.ts`）、`description-link.ts`（＋ `.spec.ts`）、`description-view.ts`（`taskLabel` 等で `file` を扱う箇所）

1. `attachment-image.spec.ts`:
   - `application/pdf`・サイズ内 → 許可。`text/html`・サイズ超過 → 拒否。
   - accept 文字列に `application/pdf` が含まれる。
   - ヒント文言・`ATTACHMENT_IMAGE_BUSY_HINT`（および batch/失敗文言があれば）に PDF／添付として矛盾しない文言（「画像の処理中」→「添付の処理中」など）を固定する。
2. `description-link.spec.ts`:
   - `buildFileAttachmentMarkup(2, 9, 'a]b\nc')` → `[abc](/api/items/by-number/2/attachments/9/content)`（BE の `BuildFileAttachmentMarkup` と同語順）
   - 空名 → `[file](…)`（`sanitizeAttachmentAlt` の空→`image` は画像記法専用。ファイル記法は fallback `file`）
   - `parseDescriptionLinks` で同一アイテムの `[file](path)` → `{kind:'file', label, src, attachmentId}`。`![…](path)` は従来どおり `image`。他アイテム path・外部 https は従来どおり。
3. `description-view.spec.ts`（または view 内ヘルパ）: `file` セグメントのラベルが `taskLabel` 等で壊れない（`file.label` を使う。`image.alt` 前提の分岐を直す）。
4. 実装:
   - 許可 Set に `application/pdf`。ヒント／busy／batch 文言を添付向けに更新。関数名 `isAllowedImageFile` / `planImageUpload` は残して中身を PDF 込みにする（呼び出し多数のため。コメントで「添付ファイル」と明記）。
   - `DescriptionSegment` に `| { kind: 'file'; label: string; src: string; attachmentId: number }`
   - `buildFileAttachmentMarkup` 追加（内部で `sanitizeAttachmentName(name, 'file')` 相当）。`parseDescriptionLinks` の `[` 分岐で、`normalizeDescriptionLinkUrl` の前に `isAttachmentContentPath` を見て file セグメントにする（同一アイテムのみ。L-018）。
   - `description-view` のラベル取得を `image` / `file` 両対応にする（必須）。
5. テストを通す。

## タスク 4: フロント — リッチ表示

ファイル: `description-rich-text.ts`、`description-rich-text.spec.ts`

1. spec: 本文に `buildFileAttachmentMarkup(7, 3, 'doc.pdf')` を入れたとき、`a[href*="/attachments/3/content"]` がありラベル `doc.pdf` が出る（`download` 属性は付けない。保存名は Content-Disposition）。`canDelete=true` なら削除ボタン。画像ケースは回帰で `img` のまま。
2. テンプレートに `@else if (seg.kind === 'file')` を追加。`<a [href]="seg.src">{{ seg.label }}</a>`。削除は画像と同様 `onDelete`。
3. テストを通す。

## タスク 5: フロント — エディタ／コメントの挿入分岐

ファイル: `description-blocks-editor.ts` / `.html` / `.spec.ts`、`item-comments.ts` / `.html` / `.spec.ts`

1. 失敗するテスト:
   - PDF `File` をアップロード成功スタブ（`contentType: 'application/pdf'`）→ 本文に `buildFileAttachmentMarkup(...)` が入る（`!` 無し）。PNG は `buildAttachmentMarkup`。
   - **貼り付け**: クリップボードに PDF だけがある場合、アップロード成功後にファイル記法が入る。既存の「PDF 拒否」テストは許可後の成功に書き換える（説明エディタ・コメントの両方で該当するものを直す）。
   - 許可外（例: `application/msword`）・サイズ超過では本文が増えない（L-001）。
   - **アップロード失敗**: 許可 MIME の PDF でも `uploadAttachment` がエラーを返したら本文が増えない。
   - ボタン／ヒント／busy が「添付」寄り（ラベルまたは HINT／BUSY に PDF・添付）。
2. 実装:
   - 成功コールバックで `att.contentType` が画像許可なら画像記法、`application/pdf` ならファイル記法。
   - `accept` は更新後の `ATTACHMENT_IMAGE_ACCEPT`（PDF 込み）を使う。
   - UI 文言: 「画像」→「添付」など設計どおり最小変更。busy も共有 HINT を使う。
3. テストを通す。

## タスク 6: OpenAPI

ファイル: `docs/openapi.yaml`（`update-api-doc` スキルに従う）

1. 添付 POST / content GET の description に次を追記する:
   - 許可 MIME に `application/pdf`、1 件 5MiB
   - 非画像（画像許可集合外）の `Content-Disposition: attachment`
   - **本文記法**: 画像 `![label](path)`、非画像 `[label](path)`（path は `/api/items/by-number/{n}/attachments/{id}/content`）
   - **エラー例**: 許可外 MIME・マジック不一致・サイズ超過の 400（既存の書き方に合わせて例を足す）
2. `scripts/check-openapi-routes.py` はルート不変のため触らない（認証区分も不変）。
3. ルート検査があれば実行して通す。

## 完了条件

- 設計書の受け入れ 1〜8 を上記タスクが覆う。
- BE/FE の指定テストが通る。
- コミットはしない。
