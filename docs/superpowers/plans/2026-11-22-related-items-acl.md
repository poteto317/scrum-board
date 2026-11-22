# 関連アイテム ACL（#88）Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [x]`) syntax. Commit は `/feature` 中はしない。

**Goal:** 関連の追加・削除で編集不可 peer を 403 にし、board／backlog／reorder／settings／status／assignee 応答の related 題名漏洩を止める。

**Architecture:** Create/Update 直前に追加・削除 peer へ `loadItemACLState` + `CanEdit`。拒否は常に **`msgEditForbidden`**（`requireEdit` は使わない — view 不可時に `msgViewForbidden` になるため）。一覧は `filterBoardItems` 成功後に各 item へ `filterRelatedItemsForViewer`（NotFound=omit、他 Get 失敗=err）。status/assignee は `enrichItemForReply`。

**Tech Stack:** Go、既存 memoryRepo / httptest

**Design:** `docs/superpowers/specs/2026-11-22-related-items-acl-design.md`

**知見:** L-901, L-002（ACL/DB 失敗は 500。欠落ピア omit は既存どおり）

**Commits:** `/feature` 中はコミットしない。

**検証コマンド:** `cd backend && go test ./internal/kanban/ -count=1`

---

## File map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/item_acl_handler.go` | `requireEditOnRelatedPeerDiff`、`filterBoardItems` 後 related フィルタ |
| `backend/internal/kanban/handler.go` | create/update で peer ACL |
| `backend/internal/kanban/status_handler.go` | `enrichItemForReply` |
| `backend/internal/kanban/assignee_handler.go` | `enrichItemForReply` |
| `backend/internal/kanban/item_acl_handler_test.go`（または専用 `related_acl_handler_test.go`） | 403・非漏洩・500 テスト |
| `docs/openapi.yaml` | Create/Update 403 説明 |

---

### Task 1: peer 書き込み ACL ヘルパ + 失敗テスト

**Produces:** `requireEditOnRelatedPeerDiff(w, r, before, after []RelatedItem) bool`

- [x] **Step 1:** ヘルパ仕様を実装前にテストで固定する。`before`/`after` の item 種別のうち、追加または削除された `(projectId, number)` だけを検査。各 peer を `GetItemByNumber` → 見つかれば `loadItemACLState` + `CanEdit(st, requestUserPtr(r))`。不可なら **`reply(w, 403, {message: msgEditForbidden})`**（`requireEdit` 禁止 — view 不可で msgViewForbidden になる経路を避ける）。`ErrNotFound` はスキップ（既存の 400 バリデーションに任せる）。**NotFound 以外の Get / loadItemACLState エラーは `fail`（500）して false**。1 件でも不可なら全体 false（部分許可なし）。URL 種別は無視。

```go
// requireEditOnRelatedPeerDiff returns false after writing 403/5xx when any
// added or removed item-kind peer is not editable by the requester.
// Reject message is always msgEditForbidden.
func (h handler) requireEditOnRelatedPeerDiff(w http.ResponseWriter, r *http.Request, before, after []RelatedItem) bool
```

- [x] **Step 2:** `TestRelatedPeerAddForbidden`（member セッション）: open カードを member が編集可、restricted peer（View/Edit restricted、admin のみ）。`PATCH /api/items/{openID}` で `relatedItems:[{kind:item,number:secret.Number,projectId:1}]` → **403** かつ body に `msgEditForbidden`。peer 側 `RelatedItems` に open が付かない（逆リンク無し）。open の履歴件数・peer の `updated_at` が PATCH 前後で不変。

- [x] **Step 3:** `TestRelatedPeerCreateForbidden`: member が `POST /api/items` で related に restricted を含める → **403**、アイテム未作成（board 件数が増えない）。

- [x] **Step 4:** `TestRelatedPeerRemoveForbidden`: admin が open↔secret を関連付け済み。member が open を編集し `relatedItems:[]` で secret を外そうとする → **403**、関連が残る。

- [x] **Step 5:** `TestRelatedPeerPartialReject`: after に許可 peer + restricted peer を混在 → Update も Create も **全体 403**、許可 peer 側にも逆リンクが付かない。

- [x] **Step 6:** `go test ./internal/kanban/ -run 'TestRelatedPeer(Add|Create|Remove|Partial)' -count=1` が **赤**。

- [x] **Step 7:** `requireEditOnRelatedPeerDiff` を実装し、`createItem`（normalize 後・CreateItem 前、`before=nil`）と `updateItem`（`p.RelatedItems != nil` のとき `before=existing.RelatedItems`, `after=*p.RelatedItems`、UpdateItem 前）から呼ぶ。

- [x] **Step 8:** Step 6 のテストが **緑**。許可ユーザ（admin）での追加成功テスト `TestRelatedPeerAddAllowed` も追加して緑。

### Task 2: 一覧・単体応答の related フィルタ

- [x] **Step 1:** `filterRelatedItemsForViewer` の Get 分岐を設計どおりに直す: `errors.Is(err, ErrNotFound)` → omit、**それ以外の Get 失敗 → `return err`**（現行は全 err を omit しており L-002 に反する）。その後 `filterBoardItems` の末尾（`filterVisibleItems` の後）で各 item に `filterRelatedItemsForViewer`。いずれかが err ならその err を返す（部分成功禁止）。

```go
// in filterRelatedItemsForViewer:
peer, err := h.repo.GetItemByNumber(ctx, rel.Number, rel.ProjectID)
if err != nil {
	if errors.Is(err, ErrNotFound) {
		continue
	}
	return err
}
```

```go
visible := filterVisibleItems(items, user)
for i := range visible {
	if err := h.filterRelatedItemsForViewer(ctx, &visible[i], user); err != nil {
		return nil, err
	}
}
return visible, nil
```

- [x] **Step 2:** `TestBoardOmitsRestrictedRelatedTitle`: member、open に secret 関連（title に固有文字列 `secret-peer-title-xyz`）。`GET /api/board` → 200、open は載るが body 全体にその title 文字列が無い。同データで `GET /api/backlog`（または reorder/settings の items 応答）でも title 非漏洩を断言（AC#3・設計テスト (e)）。

- [x] **Step 3:** `TestStatusAssigneeOmitsRestrictedRelatedTitle`: 同上データで `PATCH .../status` と `PATCH .../assignee`（member が open を編集可）→ 各応答の related に secret title 無し。

- [x] **Step 4:** status/assignee: `reply` 前に `enrichItemForReply(r.Context(), &updated, requestUserPtr(r))`。err なら `fail`。

- [x] **Step 5:** `TestFilterBoardItemsRelatedACLFailureReturns500`: board 経路で related があり、`loadItemACLState` / ListACL が失敗するよう `aclListFail`（または同等）を仕掛け、open+secret related がある状態で GET board → **500**、未フィルタ related（secret title）が body に無い。200 空 related は不合格（L-002）。同 fail 仕込みで `PATCH .../status` と `PATCH .../assignee` も **500**・secret title 非漏洩（AC#6・設計 (h)）。※欠落ピア omit は既存 `TestItemACLFiltersRelatedPeers` のまま。

- [x] **Step 6:** `go test ./internal/kanban/ -run 'TestBoardOmits|TestStatusAssigneeOmits|TestFilterBoardItemsRelated' -count=1` 緑。

### Task 3: OpenAPI + 全体検証

- [x] **Step 1:** `docs/openapi.yaml` の `POST /api/items` と `PATCH /api/items/{id}`（または同等パス）の 403 説明に「関連先アイテムの編集権限が無い場合」を追記（#87 と同型の同一変更セット）。

- [x] **Step 2:** `cd backend && go test ./internal/kanban/ -count=1` 全通。

---

## レビュー記録

### 第 1 周（要件との対応）2026-11-22
対応: backlog 非漏洩、status/assignee 500、履歴/updated_at、PartialReject、Get 失敗 500。

### 第 2 周（タスク整合と知見）2026-11-22
対応: CanEdit+msgEditForbidden（requireEdit 不使用）、filterRelated の Get NotFound/他 fail 分岐ステップ。

