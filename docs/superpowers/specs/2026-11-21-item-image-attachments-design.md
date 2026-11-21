# 画像添付（ITEM-084）

## 背景

カード要件: 画像を添付できるようにする。主に詳細画面の説明。ドラッグ&ドロップでもできるようにする。

現状:

- 説明はプレーン＋`[表示名](https://…)` のみ（`2026-11-17-description-text-links-design.md`）。画像 Markdown は解釈しない。
- アップロード／multipart／GCS メディアの先例なし。Cloud Run は単一コンテナ＋nginx 静的 SPA。
- ソリューションは専用ページ、コメントは詳細下部の別 UI。いずれもテキスト中心。

## 決めたこと

| 事項 | 採用 | 根拠 |
|------|------|------|
| 保存先 | **GCS**＋DB メタ（`item_attachments`） | 1A。Cloud Run ディスク非永続・BLOB はバックアップ過大 |
| 本文への載せ方 | アップロード成功後、カーソル位置に **`![alt](…/attachments/{id}/content)`** を挿入 | 2A。既存リンク構文の拡張 |
| 操作 UI | 対象テキストエリアへの **DnD** ＋ ツールバー「画像」 | 3A（カード要件） |
| 対象フィールド | **説明・ソリューション・コメント** | 4B ＋ユーザー追記 |
| 形式・上限 | `image/jpeg\|png\|gif\|webp`、**1 枚 ≤ 5 MiB**、**1 アイテムあたり ≤ 20 枚** | 5A |
| 配信・権限 | **アプリ経由**のみ（GCS 署名なし直リンク禁止）。content GET の認証は **既存 item GET と同じ**（`viewAccess=open` なら匿名可、制限時はセッション＋ACL） | 6A |
| 削除 | 添付削除 API ＋ **当該アイテムの description／solution／全 comment body** から該当マークアップ除去 | 7B |
| コメント紐付け | 投稿前アップロード可。`comment_id` は **NULL 可**（item 紐付けのみ）。投稿後のバックフィルはしない | UI とモデルを一致 |
| `field` 列 | 挿入先意図（description/solution/comment）の記録・一覧表示用。枚数は item 合算のまま | フィルタ／デバッグ |
| 枚数 | アイテム配下の添付行が **20 未満**のときだけ POST 可（未紐付け・全 field 合算） | 孤児も枠を消費 |
| MIME | **許可リスト厳格照合**（宣言 Content-Type ∈ 許可集合）。マジックバイト不一致も 400。sniff フォールバック無し | L-044 |
| 採番順序 | DB 行を先に INSERT（object_key は id 確定後に更新可）→ GCS Put → 失敗なら行削除（補償） | 片方だけ残さない |
| 依存 | FE に重い画像エディタは入れない。BE は `cloud.google.com/go/storage`（または GCS JSON API） | YAGNI |

## 目的と受け入れ条件

1. 詳細の説明・ソリューション編集・コメント入力で、DnD またはファイル選択により画像をアップロードできる。
2. 成功時のみ本文に画像 Markdown を挿入する（L-001）。失敗時は本文を変えずエラー表示。
3. 描画ビューで許可済み画像参照がインライン表示される（説明／ソリューション／コメント表示）。任意の外部 `https://` 画像 URL は**初版では挿入・描画しない**（自前配信のみ。XSS／トラッキング回避）。
4. `POST` アップロードはセッション必須。アイテム編集不可なら 403（L-901。コメント投稿権限は既存コメント API と同型）。
5. `GET …/content` は **既存のアイテム閲覧規則と同じ**（公開なら匿名可）。閲覧不可・他アイテムの id は **404**（存在漏れ防止）。GCS への直接公開はしない。
6. 不正 MIME（許可リスト外・マジックバイト不一致）・サイズ超過・枚数超過（当該 item の添付行 ≥20）・**`file` 欠落**・**許可外 `field`**・未知 multipart フィールドの黙認フォールバックはせず **400**（L-044）。
7. `DELETE` 添付で GCS 削除＋DB 行削除。続けて **description・solution・全コメント body** から当該 id の画像マークアップを除去して保存（7B）。POST は本文をサーバ側で書き換えない（挿入はクライアント）。
8. アイテム hard delete／purge、コメント DELETE（`comment_id` 付き行の CASCADE）時は DB は CASCADE。GCS はベストエフォート掃除（失敗はログ。孤児は初版許容）。
9. 起動時マイグレーションで表作成、`001_schema.sql` 同期。既存 item／comment の id・createdAt は触らない（L-456）。
10. デプロイに GCS バケット名等の環境変数と SA 権限が必要。ローカルは fake storage でテスト可能にする。

## データモデル

### `item_attachments`

| 列 | 型 | 備考 |
|----|-----|------|
| id | BIGINT PK AI | |
| item_id | BIGINT NOT NULL | FK items CASCADE |
| comment_id | BIGINT NULL | 任意。FK comments ON DELETE CASCADE。投稿前は NULL 可 |
| field | VARCHAR(16) NOT NULL | `description` \| `solution` \| `comment`（挿入先の意図。枚数は field 問わず item 合算） |
| object_key | VARCHAR(512) NOT NULL | GCS オブジェクト名。INSERT 直後は仮キー可→id 確定後に本キーへ更新 |
| content_type | VARCHAR(64) NOT NULL | 許可 MIME |
| byte_size | INT NOT NULL | |
| original_name | VARCHAR(200) NOT NULL | 表示用 alt 初期値 |
| created_by_user_id | BIGINT NULL | |
| created_at | DATETIME(3) NOT NULL | |

索引: `(item_id, id)`。ユニーク: `object_key`。

`field=comment` でも `comment_id` は必須にしない（投稿前 DnD 用）。

## API

| メソッド | パス | 認証 | 内容 |
|----------|------|------|------|
| POST | `/api/items/by-number/{n}/attachments` | セッション＋編集可（コメント意図でも item 編集可が必要。閲覧のみは 403） | multipart `file`＋`field`＋任意 `commentId`。**本文は変更しない**。201＋メタ |
| GET | `/api/items/by-number/{n}/attachments` | 閲覧可 | 当該アイテムの一覧 |
| GET | `/api/items/by-number/{n}/attachments/{id}/content` | 閲覧可 | バイナリ。`{id}` が `{n}` のアイテム以外なら **404** |
| DELETE | `/api/items/by-number/{n}/attachments/{id}` | セッション＋編集可 | GCS＋DB＋description/solution/全 comment からマークアップ除去。他アイテム id は **404** |

JSON は camelCase。**サーバが本文を書き換えるのは DELETE 時のみ**（既存 item/comment 更新経路を内部利用）。

### マークアップ

- 挿入形: `![originalName](/api/items/by-number/{number}/attachments/{id}/content)`
- alt に `]` と改行は不可（ファイル名をサニタイズ）。
- パーサは既存リンクパーサを拡張し、`![alt](path)` で path が上記パターンかつ id が自アイテムのときだけ `<img>`。

## UI

- 説明: 既存ブロックエディタ／ツールバーに「画像」。エリア DnD。
- ソリューションページ: 同様。
- コメント: 入力欄 DnD＋画像ボタン。投稿前に upload（`comment_id` NULL）→ draft に Markdown 挿入 → 通常どおりコメント POST。削除時はサーバが全 comment body を掃除。
- 投稿せず残った添付は枚数枠を消費する。ユーザーは添付一覧または本文から参照削除で DELETE 可能（自動 GC は対象外）。
- 添付 **DELETE は確認ダイアログあり**（Enter/Space の `event.repeat` 無視、`click.detail > 1` 無視。L-408）。
- busy／連打: upload・DELETE ハンドラ先頭に **同期再入場ガード**（L-653）。モーダル open 中の再トリガー無効（L-879）。
- 日本語 UI。CSS は既存トークン（L-926）。

## 対象外

- 動画・PDF・任意ファイル。
- 外部画像 URL のホットリンク挿入。
- 画像編集（トリミング・圧縮 UI）。クライアント自動リサイズは任意（初版必須にしない）。
- ボード／バックログカード上のサムネ一覧。
- 署名付き公開 URL。
- GCS ライフサイクル／CDN。

## 知見（実装時）

- L-001: アップロード成功確認後にだけ本文挿入。削除も成功後に UI 更新。
- L-044: 非画像・超過は 400。黙って捨てない。
- L-408: DELETE 確認のキーリピート／ダブルクリック抑止。
- L-456: 既存行の id／createdAt 非破壊。
- L-653: upload／DELETE の同期再入場ガード。
- L-879: モーダル再入場防止。
- L-901: attachments の GET/POST/DELETE すべてに item ACL。
- L-926: 独自デザイントークン禁止。

## 実装プラン分割（予告）

**1 本の実装プラン**で完了する（ユーザー指定で説明・ソリューション・コメントが初版必須）。共有核を先に置き、UI は面ごとに Task 分割:

(1) DB＋storage 抽象＋migrate (2) upload/list/content/delete API＋本文除去 (3) 画像 Markdown パーサ共通 (4) 説明 UI (5) ソリューション UI (6) コメント UI (7) デプロイ env／docs。

受け入れは 3 面すべて。途中で「説明のみ」に縮小しない。

## 直せない／残す制約

- GCS バケット未設定の環境ではアップロードは失敗する（明確な 503/設定エラー）。ローカルは fake で単体テスト。
- purge／hard delete と GCS の完全同期はベストエフォート。孤児オブジェクトが残る可能性は初版許容。
- 説明・ソリューションの文字数上限（各 10000）およびコメント body 上限（既存どおり、例: 4000）に Markdown も含まれる。先に当たる上限で拒否される。
