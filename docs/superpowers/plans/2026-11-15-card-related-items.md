# カード関連アイテム実装プラン（カード #28）

> **For agentic workers:** **Spec:** `docs/superpowers/specs/2026-11-15-card-related-items-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-002, L-035, L-037, L-453, L-454, L-688  
> 双方向カード関連＋URL 片方向。`relatedItems` PATCH 全置換。

**Goal:** カード詳細から他カード／http(s) URL を関連付けでき、カード↔カードは双方向に見え、履歴に残る。

**Architecture:** 補助表 `card_related_items`（両方向行＋URL 行）。`attach`／`replace` を `prUrls` と同型に組み込み。PATCH は同一 TX で A 置換・相手同期・履歴。FE は `CardRelatedItems` セッション＋詳細 UI。

**Tech Stack:** Go / MySQL / Angular standalone

## Global Constraints

- 件数上限なし。`prUrls` と統合しない。履歴インポートは v1 対象外。
- URL は trim のみ（スラッシュ／大小は正規化しない）。ラベル任意・最大 120。
- `relatedItems` キー省略＝変更なし。クリアは `[]`。`null` は `prUrls` と同じ扱い。

## ファイルマップ

| パス | 責務 |
|------|------|
| `backend/internal/kanban/related_item.go` | DDL・型・検証・JSON・replace／attach |
| `backend/internal/kanban/related_item_migrate.go` | 起動時 CREATE IF NOT EXISTS |
| `backend/internal/kanban/model.go` | `RelatedItem` / Card・Patch フィールド |
| `backend/internal/kanban/repository.go` | UpdateCard／Create／load で attach・replace・相手ロック |
| `backend/internal/kanban/history.go` | `relatedItems` 差分 |
| `backend/internal/kanban/handler.go` | PATCH に `relatedItems` デコード・400・「変更あり」判定 |
| `backend/internal/kanban/*_test.go` | 双方向・検証・履歴・省略 |
| `backend/cmd/server` | マイグレーション呼び出し（既存配線に合わせる） |
| `frontend/src/app/models.ts` | `RelatedItem` / `Card.relatedItems` |
| `frontend/src/app/card-related-items.ts` | 追加・削除・即 PATCH |
| `frontend/src/app/related-item.ts` | 入力判定・表示ラベル・URL 検証 |
| `frontend/src/app/card-detail.*` | UI・bind・savingBusy |
| `frontend/src/app/card-history.*` | フィールド名「関連」 |
| `frontend/src/app/card-autosave.ts` | relatedItems を対象外のまま |
| `frontend/src/app/*spec.ts` | FE テスト |

---

### Task 1: BE — 型・DDL・検証・attach／replace

**Produces:** `RelatedItem` `{Kind, Number?, Title?, URL?, Label}`、`normalizeRelatedItems`、`replaceRelatedItems`、`attachRelatedItems`、`InitializeRelatedItems`

1. [x] テスト: 自己参照／重複 number／不正 URL／ラベル超過 → エラー。trim 後 URL の重複検出。正規化後 JSON は title なし。
2. [x] `kind` は `"card"` / `"url"`。カードは number→id 解決が replace 側で必要（リポジトリから番号解決関数を渡すか replace 内で query）。
3. [x] `replaceRelatedItems(ctx, tx, cardID, items, resolveNumber)`:
   - 触る peer ID を集め、`id` 昇順で `SELECT id FROM cards WHERE id IN (...) FOR UPDATE`
   - A の旧 card 関連 ID 集合を読む → A の行 DELETE → 新行 INSERT
   - 追加 peer: B→A が無ければ B の max(position)+1 に空ラベル挿入、B の `updated_at` 更新
   - 削除 peer: B→A DELETE → B の position 詰め、`updated_at` 更新
   - **維持 peer（新旧両方にある）は B 側ラベル・順序に触れない**
   - 戻り値: 同期で変わった peer の before/after（履歴用）
4. `attachRelatedItems`: board／単体ロード後に number・title を付与。欠けは `[]`。
5. 起動時マイグレーションを既存 PR リンク初期化の隣で呼ぶ。

**Done when:** 単体テスト（DB 不要の検証＋可能なら integration）が緑。

---

### Task 2: BE — UpdateCard／履歴／handler 配線

**Consumes:** Task 1 の replace／attach

1. `Card` / `CardInput` / `CardPatch` に `RelatedItems`（Patch は `*[]RelatedItem`）。
2. `UpdateCard`: `p.RelatedItems != nil` のとき PR と同様に必要なら列ロック（gap lock 回避）＋ replace。**同一 TX** で A の履歴に加え、peer の before を replace 前に load し peer 履歴も `appendHistory`。
3. `historyValues` に `relatedItems`（正規化 JSON）。フィールド順に追加。
4. Create／Get／Board の attach 経路を更新。memoryRepo／handler_test スタブも追従。
5. テスト: A に B を追加 → B の GET に A。A から削除 → B からも消える。PATCH で relatedItems 省略時は既存維持。履歴に A/B 両方。

**Done when:** `go test ./internal/kanban/...` 緑。

---

### Task 3: FE — モデル・検証・CardRelatedItems

1. `RelatedItem` 型と `Card.relatedItems: RelatedItem[]`（欠落時 `?? []`）。
2. `related-item.ts`: `parseRelatedDraft(text)` → card number | url | invalid。`displayLabel(item)`（label → カード title → URL ホスト → URL 全文）。`httpUrlValidator`（trim、http/https）。
3. `CardRelatedItems`: `CardPrLinks` と同型。`add()` は draft＋optional label。重複は number/url で判定（L-035）。`save(relatedItems)` は `updateCard(id, { relatedItems })`。`cancel$` で切替時キャンセル（L-037）。
4. 単体テスト: parse／display／add／remove／エラー。

**Done when:** 関連 FE 単体テスト緑。

---

### Task 4: FE — 詳細 UI・履歴ラベル

1. `card-detail` に providers／bind／`savingBusy` に related saving を含める。
2. PR ブロック下に「関連」: 入力・ラベル任意・一覧・RouterLink／外部リンク・削除。
3. `card-history` の field ラベルに `relatedItems` → `関連`。
4. autosave ペイロードに relatedItems を入れない（L-453/454）。

**Done when:** card-detail / history 関連 spec 緑。

---

### Task 5: 検証

```sh
cd backend && go test ./internal/kanban/...
cd frontend && npm test -- --watch=false
```

**Done when:** 両方緑。

## サブエージェントレビュー済み

- Approved。維持 peer 非変更・handler 配線・displayLabel フォールバックを本文へ反映。
