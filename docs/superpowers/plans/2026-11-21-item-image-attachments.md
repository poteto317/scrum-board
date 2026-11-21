# 画像添付 Implementation Plan

> **本フローではコミットしない**（`/feature`）。

**Goal:** アイテムの説明・ソリューション・コメントに画像をアップロードし、本文へ Markdown で埋め込んで表示・削除できる。

**Architecture:** GCS にバイト列、`item_attachments` にメタ。アプリ経由で content GET（item 閲覧規則と同型）。DELETE 時のみサーバが本文からマークアップ除去。FE は DnD＋ツールバーで upload→挿入。orphan GCS は best-effort 掃除。

**Spec:** `docs/superpowers/specs/2026-11-21-item-image-attachments-design.md`

**Tech Stack:** Go/MySQL、GCS（`cloud.google.com/go/storage`）、Angular/Vitest、multipart

## Global Constraints

- MIME: jpeg/png/gif/webp のみ。宣言 Content-Type ∈ 許可＋マジックバイト一致。それ以外・`file` 欠落・不正 `field`・未知 multipart フィールド黙認なし → **400**（L-044）
- 1 枚 ≤ **5 MiB**（超過 400）。1 item の添付行（全 field・未紐付け含む）≤ **20**
- マークアップ: `![alt](/api/items/by-number/{n}/attachments/{id}/content)`。alt から `]`／改行を除去。外部 https 画像は挿入・描画しない
- POST は本文を書き換えない。DELETE は description／solution／**全** comment body から当該 id マークアップ除去
- content GET: item 閲覧規則と同じ（`viewAccess=open` なら匿名可）。他 item の id → **404**。GCS 直リンクなし。`Content-Type` は保存 MIME。キャッシュは短め or private
- `comment_id` NULL 可。枚数は未紐付け含む
- hard delete／purge／comment DELETE: **先に object_key 収集**→ DB CASCADE → GCS best-effort（失敗はログ。孤児初版許容）
- 説明・solution 10000／comment 既存上限に Markdown 文字数も含まれる
- nginx `client_max_body_size` ≥ **6m**（5 MiB＋multipart 余裕）。未設定だと 413
- L-001 / L-044 / L-408 / L-456 / L-653 / L-879 / L-901 / L-926
- `/feature` のためコミットしない。**3 面すべてが初版必須**（縮小禁止）
- env: **`ATTACHMENT_GCS_BUCKET`**（未設定時 upload 503。ローカル／テストは MemoryBlobStorage）
- `object_key` 命名: INSERT 直後 `pending/{uuid}` → id 確定後 `items/{itemID}/attachments/{id}` に更新してから Put

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `attachment_migrate.go` (+test) | DDL |
| `001_schema.sql` / `main.go` / `mysql_test.go` | 同期・連鎖 |
| `attachment_storage.go` | BlobStorage＋GCS／Memory |
| `attachment.go` | 型・Repo CRUD・strip／sanitize／ListObjectKeys |
| `attachment_handler.go` | multipart API |
| `handler.go` / `NewHandler` / `main.go` | ルート・BlobStorage 注入 |
| hard-delete／`DeleteComment`／`purgeTrash` 経路 | キー収集→削除→purgeAttachmentBlobs |
| `description-link.ts`（既存 `parseDescriptionLinks` 拡張） | `![alt]` を `[` より先に認識 |
| 説明／solution／comment **表示コンポーネント** | textarea/`<pre>` 生表示からセグメント描画へ切替 |
| `item-detail*` / `description-blocks-editor*` | DnD・ツールバー・添付一覧・img DELETE |
| `item-solution*` / `item-comments*` | 同型 |
| `api.ts` | クライアント |
| `deploy/nginx.conf` / `frontend/nginx.conf` | `client_max_body_size 6m` |
| `docs/api.md` / README / deploy コメント | env・API |
| `go.mod` | storage 依存 |

---

### Task 1: BE — schema・Storage・キー収集 API

**Files:** migrate, schema, main, mysql_test, attachment_storage.go, attachment.go（キー一覧）, tests

**Interfaces:**
- `(MySQLRepository) InitializeItemAttachments(ctx) error`
- `type BlobStorage interface { Put(...); Get(...); Delete(...) error }`
- `MemoryBlobStorage`
- `ListAttachmentObjectKeysByItemID(ctx, itemID) ([]string, error)`
- `ListAttachmentObjectKeysByCommentID(ctx, commentID) ([]string, error)`
- `purgeAttachmentBlobs(ctx, store BlobStorage, keys []string)` — best-effort・失敗ログ

- [ ] **Step 1: 失敗するテスト** — migrate 冪等・既存 id 不変（L-456）。Memory Put/Get/Delete。未設定 GCS Put 明確エラー。List*Keys が行と一致
- [ ] **Step 2: 実装** — DDL、Memory＋GCS（`ATTACHMENT_GCS_BUCKET`）、List*Keys、purge ヘルパ。Handler／main に BlobStorage フィールド配線の骨格
- [ ] **Step 3: `go test` PASS** / **Step 4: コミットしない**

---

### Task 2: BE — attachments API＋本文除去＋CASCADE 前掃除

**Files:** attachment_handler.go, attachment.go, model Store, memoryRepo, ACL, HardDelete／DeleteComment／purgeTrash, docs/api.md, tests

**Interfaces:**
- `CreateAttachment(...)` / `ListAttachments` / `OpenAttachmentContent` / `DeleteAttachment`
- `stripAttachmentMarkup(text, itemNumber, attachmentID) string`
- `sanitizeAttachmentAlt(name) string`

**DELETE 添付の順序（明示）:**
1. 閲覧／編集 ACL・他 item id → 404
2. GCS Delete（失敗しても続行・ログ）
3. DB 行 DELETE
4. description／solution／全 comment body から markup 除去して保存（既存 update 経路）
5. いずれか致命失敗時は 5xx。部分失敗（GCS のみ）は 200＋ログ可

**CASCADE 順序（明示）:**
1. `ListAttachmentObjectKeysByItemID` または `…ByCommentID`
2. item／comment の DB 削除（CASCADE で添付行消滅）
3. `purgeAttachmentBlobs(keys)`

- [ ] **Step 1: 失敗するテスト**
  - POST 201・枚数 20→400・**5 MiB 超過 400**・不正 MIME／**マジック不一致 400**／field／file 欠落／**未知 multipart 400**
  - GET 一覧・content（**open 匿名可**）・他 item id **404**
  - DELETE 後 content 404・本文3面から消失・他 item **404**・編集不可 403・未ログイン POST 401
  - Put 失敗で DB 行なし
  - alt サニタイズ
  - hard delete／comment DELETE／purge で **List→delete→storage.Delete 呼び出し**（失敗でも API 成功）
- [ ] **Step 2: 実装**
- [ ] **Step 3: `go test` PASS** / **Step 4: コミットしない**

---

### Task 3: FE — パーサ拡張＋3面の描画配線

**Files:** `description-link.ts`（`parseDescriptionLinks`）, 新規描画コンポーネントまたは既存テンプレ拡張, item-detail／item-solution／item-comments 表示部, specs

**Interfaces:**
- `parseDescriptionLinks` を拡張: **`![alt](path)` を通常 `[label](url)` より先にマッチ**。自 item の attachment content path のみ `kind: 'image'`、それ以外の `![…](…)` と外部 URL は text
- `buildAttachmentMarkup(itemNumber, id, alt)` / `sanitizeAttachmentAlt` / `isAttachmentContentPath(path, itemNumber)`
- 表示: 説明・solution・comment の閲覧モードでセグメント描画（textarea/`<pre>` 生のままにしない）。`itemNumber` をパーサ／img に渡す

- [ ] **Step 1: 失敗するテスト** — 合法 img、`![` がリンク誤認しない、外部 URL／他 item path は text、XSS、alt サニタイズ。**説明／solution／comment 表示テンプレで img が出る**結合テスト（各1）
- [ ] **Step 2: 実装** — パーサ＋3面配線
- [ ] **Step 3: テスト PASS** / **Step 4: コミットしない**

---

### Task 4: FE — 説明 UI（一覧・img DELETE）

**Files:** api.ts, description-blocks-editor*, item-detail*, specs

- [ ] **Step 1: 失敗するテスト** — ツールバー／DnD・成功挿入・失敗非挿入（L-001）・busy（L-653）・確認（L-408）・モーダル再入場（L-879）・**添付一覧 DELETE**・**描画 img からの DELETE**（確認後 API）
- [ ] **Step 2: 実装**
- [ ] **Step 3: PASS** / **Step 4: コミットしない**

---

### Task 5: FE — ソリューション UI

**Files:** item-solution*, specs

- [ ] **Step 1: 失敗するテスト** — Task 4 同型（field=solution）。表示で attachment img／外部は text
- [ ] **Step 2–4:** 実装・検証・コミットしない

---

### Task 6: FE — コメント UI

**Files:** item-comments*, specs

- [ ] **Step 1: 失敗するテスト** — draft upload→挿入→POST。表示 img。DELETE 後消失。L-653／L-408／L-879
- [ ] **Step 2–4:** 実装・検証・コミットしない

---

### Task 7: nginx＋運用ドキュメント

**Files:** `deploy/nginx.conf`, `frontend/nginx.conf`, README, docs/api.md, deploy-gcp.sh コメント

- [ ] **Step 1:** `client_max_body_size 6m;` を両 nginx に追加。`ATTACHMENT_GCS_BUCKET`・未設定 503・SA・MemoryBlobStorage を文書化
- [ ] **Step 2: コミットしない**

---

## プランレビュー

### Round 1（要件対応）

Important 8／Nice 3 → プラン反映（CASCADE・一覧 UI・5MiB／マジック／List／匿名／L-879／alt／env／文字数／Task5）

### Round 2（実装可能性）

- Critical: 描画経路明示・CASCADE 前キー収集・nginx 6m → 反映済み
- Important: `parseDescriptionLinks` 名・`![` 先行・purge／Handler 注入・DELETE 順序・img DELETE テスト → 反映済み
- Nice: object_key 規則・Content-Type → 反映。`attachment_run` 表記削除

**プラン承認:** Critical 解消後自動承認（`/feature`）。実装開始可。
