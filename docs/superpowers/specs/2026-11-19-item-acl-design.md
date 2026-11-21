# アイテム権限（閲覧／編集 ACL）（アイテム #61）

## 背景

カード要件:

- 各ページ（アイテム）を見れる人の範囲を制限できるようにする。
- 制限なしの全公開もできるようにする。

前提（#75 済み）:

- セッションログイン・`users`（admin/member）がある。
- 一般 API はログイン必須。nginx Basic は当面維持。
- アイテムに `created_by` は無い。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 単位 | **1A** アイテム単位 |
| 可視／編集モード | **2A** 閲覧は `public` / `open` / `restricted`。編集は `open` / `restricted`（匿名編集なし） |
| 制限の効く操作 | **3C** 閲覧 ACL と編集 ACL を分離 |
| ACL 変更者 | **4A** admin 全員 ＋ 作成者（`created_by_user_id`）。既存で作成者 NULL のカードは admin のみ |
| 既存の既定 | **5A** 既存は閲覧 `open`・編集 `open`（挙動変化なし） |
| UI | **6A** 詳細に閲覧／編集ポリシー＋ restricted 時のユーザー複数選択。ボードは鍵アイコン程度 |

ユーザー指定は **3C**。他は推奨を採用。

## 目的と受け入れ条件

1. 各アイテムに **閲覧ポリシー** `viewAccess` と **編集ポリシー** `editAccess` がある。
   - `viewAccess`: `public` | `open` | `restricted`
   - `editAccess`: `open` | `restricted`（`public` は禁止）
2. `restricted` のとき、許可ユーザーはテーブル `item_acl_entries`（`item_id`, `user_id`, `capability`=`view`|`edit`）で持つ。disabled ユーザーは許可に含めても実効アクセス不可。
3. **編集権限があれば閲覧も許可**（edit エントリは view を包含）。view のみのユーザーは読めない操作で 403。
4. **判定**
   - 閲覧可: `viewAccess=public`（誰でも）／`open`（ログイン済み）／`restricted`（セッションユーザーが view または edit エントリ、または **admin**、または **作成者**）
   - 編集可: ログイン必須かつ（`editAccess=open` かつ閲覧可）／（`restricted` で edit エントリ、または admin、または作成者）
   - **ACL 変更（manage）**: admin または作成者のみ（編集可だけでは ACL を変えられない）
5. 既存行: migrate で `view_access='open'`, `edit_access='open'`, `created_by_user_id=NULL`。新規作成時は `created_by_user_id=現在ユーザー`。
6. **一覧**（ボード／バックログ／関連表示など）: 閲覧不可のアイテムは **含めない**（タイトル漏洩防止）。件数・並びは「見える集合」基準。
7. **詳細 GET**: 閲覧不可は **403**（ログイン済）または **401**（未ログインかつ public でない）。存在の有無を 404 で隠さない（番号推測は既存どおり）。拒否ボディは **固定文のみ**（例: 「閲覧権限がありません」／未ログインは既存の未認証メッセージ）。内部 id・他ユーザー名・ポリシー名を返さない（L-017）。
8. **書き込み**（PATCH／DELETE／移動／コメント等のアイテム変更）: 編集不可は **403**＋固定文（例: 「編集権限がありません」）。
9. **public 閲覧**: `viewAccess=public` のとき、次の **読取 GET のみ**セッション不要（ハンドラ内で当該アイテムの `viewAccess=public` を確認してから通す。パス一括免除はしない）:
   - `GET /api/items/{id}`
   - `GET /api/items/by-number/{number}`（projectId 付き）
   - 上記レスポンスに既に埋め込まれる関連（`relatedItems`・`prUrls` 等）。**別エンドポイント**の comments / history / command-templates / 添付は **ログイン必須のまま**（今回 public 免除しない）。
   ボード一覧・作成・他アイテム・書き込みは従来どおりログイン必須。nginx Basic は維持。
10. FE: 詳細に閲覧／編集セレクト。restricted 時はユーザー複数選択（users 一覧）。**`/me` と詳細（必要なら acl）の権限が確定するまで**編集コントロール・ACL 操作は無効（L-463）。編集不可ならフォーム disabled。manage 不可なら ACL UI 非表示または読取専用。ボード／バックログの閲覧不可カードは出さない。restricted または public は鍵／地球などの小さな表示（過剰なカード UI にしない）。
11. **失敗 ≠ 空**（L-002）: ボード／バックログ取得失敗は空成功にしない。ACL 用 users 一覧や詳細の acl 読込失敗時はチェックリストを空の成功許可にせず、**保存ボタンを無効**＋エラー表示（空 allowlist での上書き保存を防ぐ）。
12. **世代**（L-037）: ACL 保存・詳細 live refresh・カード切替で、古い `/acl` や詳細応答が新しい対象を上書きしない（generation または同等）。
13. プロジェクト単位 ACL・ロールだけの ACL・OAuth・共有リンクトークンは非対象。

## 権限モデル（確定）

```
viewAccess:
  public      → セッション無しでも当該アイテムの読取 GET 可
  open        → ログイン済みなら閲覧可
  restricted  → allowlist(view|edit) ∪ admin ∪ 作成者

editAccess:
  open        → ログイン済みかつ閲覧可なら編集可
  restricted  → allowlist(edit) ∪ admin ∪ 作成者
  （public 不可）

manageACL: admin ∪ 作成者（created_by_user_id）
edit ⇒ view（包含）
```

不変条件:

- `editAccess=restricted` かつ edit エントリが空でも、admin／作成者は編集可（閉じ込め防止）。
- `viewAccess=restricted` かつエントリ空でも、admin／作成者は閲覧可。
- `editAccess=open` でも閲覧不可（例: view=restricted で自分不在）なら編集不可。
- ACL PATCH で自分（作成者）や最後の admin をロックアウトする組み合わせは、**作成者／admin の暗黙権限が残る**ため「誰も触れない」状態にはしない。一般ユーザーだけを空にすることは許す。

## データ

- `items.view_access` VARCHAR NOT NULL DEFAULT `'open'`
- `items.edit_access` VARCHAR NOT NULL DEFAULT `'open'`
- `items.created_by_user_id` BIGINT NULL（FK users.id、ON DELETE SET NULL）
- `item_acl_entries`:
  - `item_id`, `user_id`, `capability` (`view`|`edit`)
  - PRIMARY KEY (`item_id`, `user_id`, `capability`)
  - FK CASCADE on item / user delete
- `database/init/001_schema.sql` と migrate を同期。
- アイテム JSON:
  - 一覧・詳細とも: `viewAccess`, `editAccess`, `createdByUserId`（鍵／地球表示用）
  - 詳細／作成／更新／ACL PATCH 応答: `canEdit` / `canManage`（当該セッション向け。allowlist を漏らさず FE の disabled 判定に使う）
  - **`acl`（`viewUserIds` / `editUserIds`）は manage 権限がある応答にだけ含める**（ACL PATCH 成功応答、および manage 可能なユーザーの詳細 GET）。一般閲覧者・未ログインの public GET・ボード一覧には **載せない**（L-017）。

## API（概要）

| 操作 | 認可 |
|------|------|
| ボード／バックログ一覧 | ログイン必須。結果は閲覧可のみ |
| GET item（id / by-number） | 閲覧可。`viewAccess=public` ならセッション任意。`acl` 配列は manage のみ |
| 一般 PATCH/DELETE／列移動／コメント書込等 | 編集可。**ボディに `viewAccess` / `editAccess` / `viewUserIds` / `editUserIds` / `acl` が在れば 400**（ACL は専用 API のみ） |
| `PUT` または `PATCH /api/items/{id}/acl` | manage（admin\|作成者）。ポリシー＋エントリの置換 |
| 新規 CreateItem | ログイン必須。`created_by_user_id` 設定。**初期 ACL は常に open/open**（作成リクエストでの ACL 指定は受け付けない。作成直後に作成者が `/acl` で変更する） |

ACL 更新ボディ例:

```json
{
  "viewAccess": "restricted",
  "editAccess": "restricted",
  "viewUserIds": [2, 3],
  "editUserIds": [2]
}
```

検証: 未知の access 値は 400。`editAccess=public` は 400。存在しない user id は 400。edit にいる id は view リストへ自動包含して保存してよい（またはレスポンスで正規化して返す）。

セッション免除の追加（#75 からの差分）:

- AC9 で列挙した 2 経路のみ。ミドルウェアのパス一括免除はしない。ハンドラ（または item 読取専用ラッパ）が行を読んだあと `viewAccess=public` なら匿名許可、否则は通常のセッション必須（L-462）。

## UI

- 詳細: 「閲覧」セレクト（全公開 / ログイン全員 / 指定ユーザー）、「編集」（ログイン全員 / 指定ユーザー）。指定時はユーザーチェックリスト。
- 編集不可: 既存の保存 UI を disabled＋理由。
- manage 不可: ACL ブロック非表示または disabled。
- 一覧: 非表示フィルタは API 側。FE は返ってきたものだけ描画。
- a11y: ラベル、`role="alert"` で 403 メッセージ。

## 実装方針（分割）

1. **BE データ:** 列＋`item_acl_entries` migrate、Item 型拡張、作成者記録。
2. **BE 認可:** view/edit/manage 判定ヘルパ。一覧フィルタ。GET/書込ガード。public 読取のセッション任意。
3. **BE ACL API:** ポリシー＋エントリの置換（トランザクション）。
4. **FE:** 詳細 ACL UI、編集不可時の disabled、一覧は API 結果に追従、鍵アイコン。
5. **検証:** 行列テスト（public/open/restricted × 匿名/member/allowlisted/admin/作成者）。

## 非対象

- プロジェクト／列単位の ACL
- 共有リンク・期限付きトークン
- nginx Basic 撤去・完全インターネット公開
- コメント単位の権限
- 「閲覧のみ一覧にタイトルを出す」モード（3B）

## 知見（手順 4）

- **L-002:** 一覧フィルタ失敗を空ボード成功としない。ACL GET/PATCH 失敗 ≠ 空許可。
- **L-017:** 拒否理由に内部 id や他ユーザー名を不用意に出さない（固定文「閲覧権限がありません」等）。
- **L-018:** 一覧用の「見える」判定と詳細 GET／PATCH の判定を同じ関数に集約する。
- **L-462 / L-894:** public 読取免除をポリシー確認後の狭路に限定。`/me` 成功キャッシュで権限 UI が腐らないよう既存 AuthSession 方針を維持。
- **L-037:** ACL 保存と詳細再取得の世代。
- **L-463:** 編集不可なのに保存ボタンが押せる隙間を作らない（権限確定前は操作無効）。

## テスト方針

- migrate 後既存カードは open/open で従来どおり全ログインユーザーが読編集可。
- restricted view: 非許可 member は一覧に出ず詳細 403（固定文）。許可・admin・作成者は可。
- restricted edit: view のみユーザーは GET 可・PATCH 403（固定文）。
- public: 未ログインで詳細 GET 200（`acl` 無し）。未ログインで PATCH 401。未ログインで board 401。comments GET は未ログイン 401。
- manage: member 非作成者は ACL PATCH 403。作成者・admin は可。一般 PATCH に viewAccess を載せると 400。
- edit エントリのみで view エントリ無し → 閲覧可。
- Create は常に open/open（ボディの ACL フィールドは無視または 400）。
- FE: 権限未確定中は操作不可。編集不可で disabled。users/acl 読込失敗時は保存不可（空上書きしない）。遅延 ACL 応答が切替後カードを汚さない。

## サブエージェントによる設計書レビュー

### 第1周（記述の確かさ）

対応: public 免除 GET を 2 経路に列挙（comments 等は対象外）。`acl` は manage のみ。一般 PATCH の ACL フィールドは 400。Create は常に open/open。

### 第2周（範囲と知見）

対応: 403/401 固定文（L-017）。失敗≠空・ACL 保存不可（L-002）。世代（L-037）。権限確定まで操作無効（L-463）。範囲肥大なし。
