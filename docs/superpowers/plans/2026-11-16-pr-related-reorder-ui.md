# PR / 関連の並び替え UI 実装プラン（カード #37）

> **For agentic workers:** **Spec:** `docs/superpowers/specs/2026-11-16-pr-related-reorder-ui-design.md`  
> **コミットしない**（`/feature`）。知見: L-001, L-015, L-035, L-037, L-038, L-039, L-040, L-453, L-460  
> BE 変更なし。詳細の PR・関連一覧に CDK DnD＋上下ボタン。即時 PATCH 全置換。

**Goal:** カード詳細で `prUrls` と `relatedItems` を DnD／上下ボタンで並べ替えでき、再読込後も順序が保たれる。

**Architecture:** 既存 `CardPrLinks` / `CardRelatedItems` の `save(全配列)` に `reorder`／`move` を足す。楽観的にローカル配列を更新し、失敗時は直前配列へ戻す。UI は詳細の各一覧に独立した `cdkDropList`＋ハンドル＋上下ボタン。専用 reorder API は作らない。

**Tech Stack:** Angular 21 + CDK DragDrop / 既存 Go API（変更なし）

## Global Constraints

- BE・スキーマ・履歴フィールド名・専用 API は触らない。
- PR と関連は別リスト（接続しない）。ボード面は対象外。
- 件数 ≤1 ではハンドル・上下を **出さない**。
- エラーは既存 `error` バナー（`onError`）。カード切替キャンセル後は `apply` しない。
- L-015: 並び替え PATCH は当該 side 配列だけ送り、title/description/他方 side を消さない。
- L-038: 部分配列を送らず全件置換に任せる（BE 既存 TX）。
- L-460: 詳細は全件表示のまま並べ替え、フィルタ部分配列で保存しない。
- `/feature` 中はコミットしない（各 Task 末の Commit ステップはスキップ）。

## ファイルマップ

| パス | 責務 |
|------|------|
| `frontend/src/app/list-reorder.ts` | 純関数 `moveIndex(items, from, to)`（範囲外・同位置は同一参照または no-op） |
| `frontend/src/app/list-reorder.spec.ts` | 上記の単体テスト |
| `frontend/src/app/card-pr-links.ts` | `reorder` / `move`、楽観更新＋失敗ロールバック、`markPrSideDirty` |
| `frontend/src/app/card-related-items.ts` | 同様の `reorder` / `move` |
| `frontend/src/app/card-autosave.ts` | `markPrSideDirty`（related と同型）。必要なら PR save 開始時シールド |
| `frontend/src/app/card-detail.ts` | bind に markPr、ドロップ／上下ハンドラ、DragDrop インポート |
| `frontend/src/app/card-detail.html` | PR・関連リストの DnD／上下 UI、track を安定キーに |
| `frontend/src/app/card-detail.scss`（または既存 styles） | ハンドル・上下の最小スタイル |
| `frontend/src/app/card-detail.spec.ts` 等 | 並び替え・失敗ロールバック・端・≤1 非表示 |
| `docs/api.md` / `README.md` | 「並べ替え UI は別機能」→ 詳細で可能、と短く更新（あれば） |

---

### Task 1: 純関数 `moveIndex` + PR 並び替えセッション

**Produces:** `moveIndex<T>(items: readonly T[], from: number, to: number): T[]`  
`CardPrLinks.reorder(from, to)` / `move(index, delta)`  
`CardAutosave.markPrSideDirty()`  
楽観: 控える → ローカル適用 → PATCH → 成功は応答で apply、失敗は控えへ戻して `onError`

1. [x] `list-reorder.spec.ts`: from/to が同じ・範囲外 → 元と同じ内容、2↔0 で順が入れ替わる、元配列を破壊しない。
2. [x] `list-reorder.ts` を実装（コピーして splice。CDK `moveItemInArray` を使ってもよいが **引数配列を mutate しない**）。
3. [x] `markPrSideDirty` を `markRelatedSideDirty` と同型で追加。`CardPrLinks.bind` に渡し、**すべての** `save` 開始時（add/remove/reorder）で呼ぶ（L-453）。
4. [x] `CardPrLinks`:
   - `reorder(from, to)`: no-op なら return。`previous = [...prUrls]`、`next = moveIndex(...)`、楽観 `apply({ prUrls: next, updatedAt })`、`save(next, undefined, previous)`。
   - `move(index, delta)`: `reorder(index, index+delta)`。
   - `save` を拡張: 失敗時に `previous` があれば `apply({ prUrls: previous, updatedAt: card.updatedAt })`（L-001）。成功時は応答で上書き（L-039）。`cancel$` で next を走らせない（L-037）。
5. [x] `card-pr-links` 向けテスト（または list-reorder + サービス単体）: reorder が `updateCard(id,{prUrls:新順})` を呼ぶ／失敗で旧順に戻る。UI 断言は Task 3。

**Done when:** `cd frontend && npx vitest run src/app/list-reorder.spec.ts` および PR セッションの新規テスト緑。

---

### Task 2: 関連の並び替えセッション

**Consumes:** Task 1 の `moveIndex`

1. [x] `CardRelatedItems.reorder(from, to)` / `move(index, delta)`: no-op なら return。`previous` 控え → 楽観 `apply({ relatedItems: next, updatedAt })` → `save(next, undefined, previous)`。ペイロード形は既存 add/remove と同じ。
2. [x] `save` 失敗時は `previous` へ戻す。`markRelatedSideDirty` は既存どおり save 開始時。
3. [x] テスト: 混在（card + url）2件以上の順入れ替え、失敗ロールバック。メンバーシップ不変（同じ要素集合）。カード切替で in-flight の next が apply されないこと（既存 cancel$ パターンを流用）。

**Done when:** 関連並び替えの単体／詳細テスト緑。

---

### Task 3: 詳細 UI（DnD + 上下）

**Consumes:** Task 1–2 の API

1. [x] `card-detail` に `DragDropModule`（または `CdkDropList` / `CdkDrag` / `CdkDragHandle` standalone import）。ボードのカード DnD の複雑さ（connected lists / live scroll）は **持ち込まない**（単一リスト内のみ）。
2. [x] PR `<ul>`: `cdkDropList`、`(cdkDropListDropped)` → `prLinks.reorder(prev, curr)`（index 不変なら no-op）。各 `<li cdkDrag>`、`cdkDragHandle`、上／下ボタン。`@for` track を **URL** に変更。
3. [x] 関連 `<ul>`: 同様。track は既存の安定キーのまま。`relatedItems.reorder`。
4. [x] **当該一覧の** `prLinks.saving()` / `relatedItems.saving()` 中だけ、その一覧の DnD・上下・追加・削除を disabled（他方は操作可）。件数 ≤1 ではハンドル・上下を出さない。
5. [x] 端の上下は disabled。`aria-label` を仕様どおり。フィールド注記を「並べ替え可」に短く更新。
6. [x] スタイル: ハンドルがリンククリックを奪わない最小限（ボードの `.card-drag-handle` を参考にクラスを流用または詳細用に薄く）。
7. [x] テスト: 上下クリックで PATCH 順、≤1 でボタン無し、当該 saving 中 disabled。可能なら CDK drop をスタブ。autosave 並走は `markPrSideDirty` と既存 sideDirty 系で確認。

**Done when:** 詳細の並び替え UI テスト緑＋ `ng test` / プロジェクトの通常 FE 検証コマンド緑。

---

### Task 4: ドキュメント微修正 + 全体検証

1. [x] `docs/api.md` / `README.md` で「並べ替え UI は別機能」と書いてある箇所を、詳細で DnD／上下により可能、と現状に合わせる（API 契約は変えず）。
2. [x] `#28` / `#36` 設計の「対象外」は歴史文書のまま残してよい。本仕様・プランが正。
3. [x] FE 全テスト、必要なら `go test ./internal/kanban/...`（変更無ければスキップ可）。

**Done when:** 検証緑。受け入れ条件 1–8 をチェックリストで自己確認。

---

## 実装メモ

- 楽観更新の `updatedAt` はローカル仮更新時は既存値のままでよい。成功応答の `updatedAt` で揃える。
- PR の add は今どおり成功後に一覧が増える（楽観必須は並び替えのみ）。ただし `markPrSideDirty` は add/remove にも付ける。
- 関連並び替えで peer 順序が変わらないことは BE 既存挙動に依存。FE から peer を送らない。
