# 関連アイテムの ACL（#88）— 設計

- カード: [#88 セキュリティ[中] 関連アイテムの追加で、閲覧できないアイテムの題名が漏れ、相手側が書き換わる](https://scrum-board-jkcejsb6ka-an.a.run.app/items/88?project=1)
- 日付: 2026-11-22

## 背景

- 詳細 GET は `enrichItemForReply` → `filterRelatedItemsForViewer` で関連先の題名を閲覧フィルタする。
- ボード／バックログ／並べ替え／設定 PATCH／ステータス／担当の応答は、所有者アイテムが可視でも **関連先タイトルをフィルタしない**。
- 関連付け PATCH は相手の閲覧・編集 ACL を見ず、逆リンクで相手の `updated_at`・履歴が変わる。

## 決めたこと

| 事項 | 採用（推奨） |
|------|------|
| 書き込み認可 | item 種別の関連を **追加**する相手には `CanEdit` を要求（逆リンク書き込みがあるため。`CanEdit` は `CanView` を含む）。**削除**で逆リンクを外す相手にも `CanEdit`（票は「追加」中心だが、逆リンク書き込みは削除も同リスクのため本カードで揃える）。複数 peer のうち 1 件でも不可なら **要求全体を 403**（部分許可なし）。**URL 種別**は peer アイテムが無いため ACL 検査対象外（従来どおり URL のみ追加可）。peer 解決: `GetItemByNumber` が **NotFound** → ACL スキップ（既存 400 バリデーションに任せる）。**NotFound 以外の DB 失敗** → **`fail`（500）**（403 にしない） |
| 拒否時 | 400（既存の関連バリデーションと同系）ではなく **403**。編集副経路なので `requireEdit` と同じ **`msgEditForbidden`** 固定（view 禁止の `msgViewForbidden` とは別） |
| 一覧系の読み | `filterBoardItems` 成功後、残った各アイテムに related ピアをフィルタ。対象経路: **board / backlog / reorder / settings PATCH の items**（受け入れ #2 の board・backlog に加え、同じ `filterBoardItems` 経路の漏洩を塞ぐ） |
| related フィルタの err | 既存 `filterRelatedItemsForViewer` を再利用する。分岐を固定: (1) peer `GetItemByNumber` が NotFound 等 → **omit**（欠落ピアの id/題名を漏らさない既存方針。L-002 の「空成功」ではない）(2) `loadItemACLState` 等の **DB/ACL 読み失敗** → **error を返し 500**。未フィルタの `relatedItems` を返さない（L-002・#87 AC#3 と同型） |
| 単体応答 | `changeStatusByNumber` / `changeAssigneeByNumber` は `enrichItemForReply` を通してから reply（詳細 **GET** および本文 PATCH `PATCH /api/items/{id}` の enrich と同型） |
| Create | `CreateItem` の relatedItems も同じ peer ACL 検査。不可 peer なら **Create 全体が 403**（アイテム未作成） |
| 一括フィルタ | `filterRelatedItemsForViewer` をアイテムごとに呼ぶか、専用一括版を足すかは実装裁量。どちらの場合も **ACL/DB 失敗の部分成功禁止**: いずれか失敗なら呼び出し全体失敗 |
| OpenAPI | 関連を含む Create / Update の **403** 説明を **必須**で同一変更セットに追記（#87 と同型）。ルート追加なし |

### 検討したが採らなかった案

- **CanView のみでリンク許可**: 逆リンクで相手が書き換わるため不十分。
- **逆リンクをやめる**: 既存仕様変更が大きく本カード外。
- **一覧から relatedItems を落とす**: FE がドット等で使う可能性があり、ピア単位フィルタの方が最小。

## 目的と受け入れ条件

1. member が閲覧不可（および編集不可）のアイテム番号を関連に **追加**しようとすると **403**（`msgEditForbidden`）で失敗し、逆リンクも履歴も付かない。Create / Update とも同様。
2. 編集不可 peer への関連 **削除**も **403**（逆リンク書き込みを防ぐ）。
3. 既に管理者等が付けた関連があっても、member の **board／backlog／status／assignee** 応答の `relatedItems` に相手の題名が出ない（reorder／settings の items も同フィルタ）。
4. 閲覧・編集可能な相手への関連付けは従来どおり成功する。
5. FE・DB スキーマ変更なし。
6. related フィルタで ACL/DB 読み失敗時は 500 とし、未フィルタ related を返さない（欠落ピアの omit は従来どおり可）。

## 非目標

- 関連 UI の変更
- 逆リンク仕様の廃止
- ゴミ箱専用 API の追加監査（一覧に載る trash は既存 trash 経路。本カードは票記載の経路）
- **履歴 GET** の changes JSON 内に残る過去の related 題名の再フィルタ（埋め込みスナップショット。別カード候補。本カードはライブ応答の relatedItems）

## 実装概要

1. ハンドラ: relatedItems を含む Create/Update の直前に peer ACL 検査ヘルパ（新規 peer / 削除 peer に CanEdit。1 件不可で全体 403）。
2. `filterBoardItems` 後に各 item へ related ピアフィルタ（単体関数のループまたは一括版。ACL/DB 失敗は全体 fail。欠落ピアは omit）。
3. status / assignee 応答に `enrichItemForReply`。
4. OpenAPI: Create/Update の 403 説明を更新。
5. テスト: (a) Update 追加 403 (b) Create 追加 403 (c) Update 削除 403 (d) board 題名非漏洩 (e) backlog または reorder/settings の items 非漏洩 (f) status/assignee 非漏洩 (g) 許可ユーザは成功 (h) ACL/DB 失敗時 500。

## 関連知見

| ID | 扱い |
| --- | --- |
| L-901 | **守る**: 関連の埋め込み題名・書き込み副経路にも ACL（履歴 JSON は非目標に分離） |
| L-002 | **守る**: ACL/DB フィルタ失敗は fail。空成功に倒さない。欠落ピア omit は漏洩防止であり例外 |

## 第 2 周レビューで直せない／範囲外として記録したもの

- 履歴 GET の related 題名スナップショット: 非目標へ移し、別カード候補とする（本プランに含めない）。
