# ボード設定 PATCH 応答の ACL フィルタ（#87）— 設計

- カード: [#87 セキュリティ[高] ボード設定の変更の応答で、閲覧制限つきアイテムの内容が全員に返る](https://scrum-board-jkcejsb6ka-an.a.run.app/items/87?project=1)
- 日付: 2026-11-22

## 背景

- `GET /api/board` と backlog 系は応答前に `filterBoardItems` を通し、閲覧不可アイテムを除外する。
- `PATCH /api/board/settings` の `updateBoardSettings` は `PatchBoardSettings` が返す `items`（free→pack 遷移時のみ非 nil）を **フィルタ無し** で返す。
- member が free→pack を切り替えると、閲覧制限つきアイテムの題名・説明などが応答に載る（ACL 迂回）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 直し方 | 応答に `items` を載せる直前に、`GET /api/board` と同じ `filterBoardItems(ctx, items, requestUserPtr(r))` を通す |
| items が nil のとき | キーごと載せない現状を維持（activeProjectId / mobile のみの PATCH など） |
| items を外す案 | 不採用（FE が free→pack 後に items を使う前提を壊す） |
| OpenAPI | 契約形は変えない。`/api/board/settings` PATCH の 200 description に「`items` がある場合は閲覧可能なもののみ」を **必須で** 追記する（実装と同じ変更セット） |
| テスト配置 | `board_settings_handler_test.go` に member + restricted の free→pack ケースを追加（ACL fixture は既存 acl テストと同型） |
| L-901 の扱い | 本カードの実装で settings 経路を直す。汎用知見への追記は `/review-digest` で行い、本カードの実装スコープ外 |

### 検討したが採らなかった案

- **B: items キーを応答から削除**: FE の再取得前提に変える範囲が広い。
- **リポジトリ層でフィルタ**: 認可はハンドラ責務。既存 board/backlog と揃える。

## 目的と受け入れ条件

1. member が `cardLayout: free` → `pack` を PATCH しても、閲覧できない restricted アイテムが応答 `items` に含まれない（自動テストで固定）。
2. 閲覧可能なアイテムは応答に残る。
3. `filterBoardItems` 失敗時は既存と同様 `fail` で、未フィルタの items を返さない。
4. FE・DB スキーマ変更なし。ルート追加なし。OpenAPI は description のみ更新。

## 非目標

- ACL モデル自体の変更
- free→pack 以外の設定 PATCH の意味変更
- 他エンドポイントの追加洗い出し（本カードは当該応答経路の修正）

## 実装概要

1. `handler.updateBoardSettings`: `items != nil` のとき `filterBoardItems` → 成功時だけ `out["items"] = filtered`。失敗時は `fail`（`out` を返さない）。
2. `board_settings_handler_test.go`: (a) member セッション + restricted（閲覧不可）+ open で free→pack。restricted 不在・open 存在・秘密 description 非含有。(b) filter 失敗時は **応答に載る items に restricted を含む** 状況で ACL 一覧エラー → **500** かつ `"items"` キー無し（L-002）。
3. `docs/openapi.yaml`: PATCH `/api/board/settings` 200 description を更新。

## 関連知見

| ID | 扱い |
| --- | --- |
| L-901 | **守る**: 主 GET に付けた ACL フィルタを、items を返す副経路（settings PATCH）でも同じヘルパで通す |
| L-002 | **守る**: フィルタ失敗を空配列成功に倒さず fail する |
