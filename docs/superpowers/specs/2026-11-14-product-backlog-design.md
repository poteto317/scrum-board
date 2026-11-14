# プロダクトバックログ 設計書

- 対象機能: プロダクトバックログを作る（カード #6）
- 概要: かんばんと同一のカードを、別ページで縦一列の優先順位リストとして表示・並び替え・新規追加できるようにする。

## 決めたこと

| 項目 | 選択 | 根拠 |
| --- | --- | --- |
| データ | **A: 既存 `cards` に `backlog_position` を追加** | 未回答のため推奨。「かんばんと共通」を同一レコードで実現 |
| 掲載範囲 | **B: 全ステータス（Done 含む）** | ユーザー選択 |
| 並び替え UI | **A: HTML5 DnD ＋ 上下キー** | 未回答のため推奨。列並び替えと同型。カード DnD（PR #5 / CDK）への依存なし |
| ルート・ナビ | **A: `/backlog` ＋ ヘッダーでボード／バックログ切替** | 未回答のため推奨 |
| 作成 | **B: バックログページからも新規追加可** | ユーザー選択。既存 `POST /api/cards` を再利用。モーダルで初期ステータス（列）を選び、バックログ末尾へ追加 |
| 順序 API | **A: `PUT /api/backlog/order` に全カード ID の完全順** | 未回答のため推奨。`PUT /api/columns/order` と同型 |

**PR #5 との関係:** カード列内 `position` / CDK には依存しない。#5 マージ後も `backlog_position` は独立フィールドとして共存する。スキーマ衝突時は両カラムを並記する。

## 1. 現状と課題

1. カードはかんばん列にのみ表示され、プロダクト全体の優先順位ビューが無い。
2. カード #6 は「別ページ・縦並び・並び替え・かんばんと共通アイテム」を要求している。
3. 新規作成はボードのモーダルのみ。

## 2. 設計方針

- バックログは **優先順位の一覧ビュー**。ステータス変更の主経路は従来どおりボード／詳細。
- ライブラリを増やさず HTML5 DnD（列並び替えパターン: 楽観更新・409・非破壊バナー・aria-live・`aria-disabled`）。
- タッチ DnD は非対応でよい（列 DnD と同じ既知制約）。
- YAGNI: フィルタ、検索、スプリント割当、バックログ専用の詳細編集フォームは作らない（詳細は既存 `/cards/:number`）。

## 3. バックエンド

### 3.1 スキーマ

`cards` に `backlog_position INT NOT NULL DEFAULT 0` を追加。インデックス `INDEX cards_backlog_position (backlog_position, id)`。

- **新規 DB:** `001_schema.sql` に含める。
- **既存 DB:** 起動時 `InitializeBacklogPositions`（冪等）:
  1. 列が無ければ `ALTER TABLE` で追加。
  2. **列ごとではなく全カード単位**で、`COUNT(*) >= 2` かつ `COUNT(DISTINCT backlog_position) = 1` のときだけ `ORDER BY created_at, id` で `0..n-1` をバックフィル（再起動で DnD 順を消さない）。
  3. インデックスが無ければ追加。

### 3.2 モデル

- `Card` に `BacklogPosition int \`json:"backlogPosition"\``。
- `scanCard` / `cardFields` に含める。
- エラー: `ErrBacklogOrder`（400）、`ErrBacklogMismatch`（409）。

### 3.3 `GET /api/backlog`

```json
{ "cards": [ /* backlog_position, id 昇順の全カード（Board と同じ Card 形） */ ] }
```

列情報は返さない（画面は必要なら `GET /api/board` の columns を併用、または作成モーダル用に board を別取得）。

### 3.4 `PUT /api/backlog/order`

```json
{ "cardIds": [3, 1, 7, 2] }
```

- バリデーション（400）: 欠落・null・空、`<=0`、重複、未知フィールド。
- 整合性（409）: DB の全カード ID 集合と `cardIds` が一致しない。
- 成功（200）: `{ "cards": [ /* 全カード、新しい backlog_position 付き */ ] }`。
- トランザクション: 全カードを `ORDER BY id FOR UPDATE` → 集合一致 → 各 ID に position 付与 → 再取得。
- **履歴:** バックログ順だけの変更は履歴に載せない（ステータス・本文変更ではない）。

### 3.5 `CreateCard` / `ReorderBacklog` のロック

- **Repository:** `Backlog(ctx) ([]Card, error)`、`ReorderBacklog(ctx, cardIDs []int64) ([]Card, error)`。
- **CreateCard:** 既存どおり指定 `columnId` へ INSERT。同一トランザクションで `SELECT id FROM cards ORDER BY id FOR UPDATE` により全カードを主キー順ロックし、`backlog_position = MAX+1`（0 件なら 0）を付与してから INSERT（`ReorderBacklog` と同じロック順でデッドロックを避ける）。なお、カードの列内並び替え（`cards.position`、`ReorderCards`）と統合した後は、全カード書き込み経路が `cards` に触れる前に `board_columns` の全列ロックを取る（`ReorderBacklog` も同様。詳細は card-drag-drop-design §3.4）。
- バックログ UI の作成モーダルは `columnId` を利用者が選択して `POST /api/cards` に渡す（既定候補は Todo だが固定ではない）。

### 3.6 ハンドラー

- `GET /api/backlog`、`PUT /api/backlog/order` を登録。
- `fail()`: `ErrBacklogOrder` → 400 `"バックログの並び順を確認してください。"` / `ErrBacklogMismatch` → 409 `"バックログの構成が変更されています。最新を読み込んでからやり直してください。"`。

## 4. フロントエンド

### 4.1 ルーティング・ナビ

- `routes`: `{ path: 'backlog', loadComponent: () => import('./backlog').then(m => m.Backlog) }`
- `app.html` ヘッダーに `routerLink="/"`「ボード」、`routerLink="/backlog")`「バックログ」（現在地が分かる `routerLinkActive`）。

### 4.2 API

- `backlog()`: `GET /api/backlog`
- `reorderBacklog(cardIds: number[])`: `PUT /api/backlog/order`

### 4.3 バックログページ (`backlog.ts` / `.html` / `.css`)

1. 縦リスト。各行: 優先度番号（1-based）、TASK-xxx、タイトル、現在のステータス名、詳細リンク。
2. ドラッグハンドル（列と同様 `⋮⋮`）＋ HTML5 DnD。コンテナ一元の `dragover`/`drop`、挿入スロット、同一位置 no-op、楽観更新＋ロールバック＋非破壊バナー（`L-001`, `L-038`, `L-541`, `L-680`, `L-681`）。
3. ハンドルで `ArrowUp` / `ArrowDown`、保存中は `aria-disabled`、フォーカス復元、`aria-live`。
4. 「アイテムを追加」でモーダル（タイトル・説明・初期ステータス select。列一覧は `board().columns`）。`POST /api/cards` 成功後、作成カードを一覧末尾に反映（または backlog 再取得）。
5. ステータス名表示: ページ初期化で `forkJoin({ backlog, board })` し `columnId → name` を解決。
6. `cards.length > 1` かつ非保存中のときだけ並び替え可（`canReorder`）。1 件以下は DnD／キーを無効化。

### 4.4 純粋ロジック

- `backlog-order.ts`: `computeDropSlot`（縦: clientY / 行中心）、`targetIndex`、`moveCard`、`computeAutoScrollDelta`（縦）— 列用と重複するなら共通化してよいが、縦用にファイルを分けてもよい（YAGNI なら backlog 専用で短く）。

## 5. ドキュメント

- `docs/api.md` に backlog エンドポイントを追記。
- `README.md`「できること」にプロダクトバックログを追加。
- `docs/verification.md` に確認項目。

## 6. テスト

1. Go: order 成功・400・409・Create が末尾 `backlog_position`、マイグレーション冪等、`ReorderBacklog`×`CreateCard` 並行で破壊なし。
2. Angular: API クライアント、DnD／キーボード、作成モーダル（列選択）、エラーロールバック、1 件時の並び替え不可。
3. 実ブラウザは独立環境で（利用中 DB を壊さない）。

## 7. 非目標

- スプリント、見積もり、フィルタ、バックログからステータス DnD、リアルタイム同期、認証。

## 8. 知見 ID

- `L-001`, `L-038`, `L-048`, `L-494`, `L-540`, `L-541`, `L-680`, `L-681`
