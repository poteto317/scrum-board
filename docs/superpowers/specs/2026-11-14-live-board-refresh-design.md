# ページリロードなしの画面反映（ライブ再取得）

## 目的

外部（API・別タブ・エージェントの status 更新など）でカードの列や内容が変わっても、利用者がブラウザのフルリロードをしなくても、開いているかんばん／バックログ／カード詳細に自動で反映される。

カード #34: 「ページリロードをしないと、ステータスの変更などが画面に反映されない。自動的にされてほしい。」

## 受け入れ条件

- ボード画面を開いたまま、別経路でカードの `columnId`（ステータス）やタイトル等が変わると、フルリロードなしでボード上の位置・表示が更新される
- バックログ画面でも同様に、一覧の内容が自動更新される
- カード詳細を開いたまま、別経路で同じカードの列や本文が変わると、フルリロードなしで詳細に反映される（ただし利用者の未保存編集は上書きしない）
- 初回ロードや手動「再試行」以外の背景再取得では、画面全体をローディング表示にしない
- 背景再取得の一時的な失敗で、既存の成功データをエラーバナーで塗りつぶさない
- 並び替え・作成モーダル・保存中など、ローカル操作の最中に背景再取得が楽観的 UI を壊さない

## 決めたこと

| 事項 | 採用 | 理由 |
| --- | --- | --- |
| 同期方式 | フロントの短い間隔ポーリング（既存 `GET /api/board` / `GET /api/backlog` / `GET /api/cards/by-number/:n`） | SSE / WebSocket は未導入。README も「リアルタイム共同編集」は対象外。現状の HTTP だけで足りる |
| 間隔 | 5 秒（定数。設定 UI なし） | エージェントの Todo→Doing などが体感で追いつく。負荷も小さい単一利用者向け |
| 可視性 | `document.visibilityState === 'visible'` のときだけ tick。hidden ではタイマーを止め、visible 復帰時に即 1 回再取得 | 裏タブの無駄リクエストを避ける（L-108 と合わせて破棄・停止を明確に） |
| 対象画面 | ボード・バックログ・カード詳細 | カード文面の主画面。対象外はヘッダ等のみの画面が無いため実質全一覧系 |
| バックエンド | 変更なし（新規エンドポイント・ETag・SSE なし） | YAGNI。既存 Cache-Control: no-store の GET を再利用 |
| ローディング UI | 背景ポーリングでは `loading` を true にしない | 点滅を防ぐ |
| エラー UI | 背景ポーリング失敗は黙ってスキップ（前回成功データを維持）。初回／手動 `load()` のエラー表示は現状どおり | 一時的ネット断で赤いバナーを出さない |
| 適用ガード（ボード／バックログ） | `reordering()`・作成モーダル表示中・`saving()` 中は適用しない（リクエスト自体もスキップ可）。ボードは、列のドラッグ中（`draggingColumnId`）とカードのドラッグ中（`draggingCardId`。`cdkDragStarted` から `cdkDragEnded` まで）も同様 | ドラッグ中の楽観更新や作成フォームを上書きしない。カードの `previousIndex` / `currentIndex` はドラッグ開始時のリストに対する値なので、ドラッグ中にデータが差し替わるとドロップで別のカードが動く（`2026-11-14-card-drag-drop-design.md` §4.4 の 9） |
| 古い応答（ボード） | ボードは、取得を始めたときの `data` のままのときだけ応答を適用する（`pollBoard`） | 取得中に並び替えの保存・作成・再読込が `data` を書き換えると、その応答は書き換えより古く、適用すると画面が巻き戻る。`enabled` の再確認だけでは、保存が応答より先に終わっていると防げない |
| 適用ガード（詳細） | `autosave.hasChanges()`・`autosave.saving()`・`prLinks.saving()`・`confirmDelete`・`deleting()` のいずれかならポーリング結果を**丸ごと捨てる**。ガード外では列は常に更新し、カード本文は `hasChanges()` が無いときだけ載せ替える | 未保存編集の消失を防ぐ（L-008 の逆・L-040）。削除中のちらつきも避ける |
| 世代 | リクエスト発行時に世代カウンタを進め、subscribe 時に世代が一致しなければ捨てる | 遅い応答が新しい状態を上書きしない（L-040） |
| 差分適用 | 取得ペイロードを `JSON.stringify` で前回適用分と比較し、同一なら `set` しない（画面 state の形に合わせたオブジェクトを比較） | 不要な再描画・フォーカス喪失を減らす |
| 共有実装 | `frontend/src/app/live-refresh.ts` に小さなヘルパー（interval + visibility + 世代）。各画面が `fetch` コールバックを渡す | 3 画面でタイマー処理を複製しない。`providedIn: 'root'` のグローバル単一ポーラーにはしない（画面ごとのガードが違う） |
| 対象外 | 真の共同編集・カーソル共有・CRDT、SSE/WebSocket、間隔のユーザー設定、他オリジンへの push | カード範囲外 |

## 方式

### ヘルパー `live-refresh.ts`

- `startLiveRefresh(options): () => void`（または DestroyRef 連携）
  - `intervalMs`（既定 5000）
  - `enabled: () => boolean` — false なら tick で fetch しない（例: reordering）
  - `fetch: () => Observable<T>` — 実際の API
  - `apply: (data: T) => void` — 成功時。呼び出し側で差分比較・ガード済みなら no-op 可
  - `document` の `visibilitychange` を購読。hidden で interval clear、visible で即 fetch + interval 再開
  - 返却の stop、または `DestroyRef` で interval・listener を外す（L-108 / L-109 / L-217）
- tick 内で世代 `seq++`。`fetch` 完了時に `seq` が発行時と違えば `apply` しない（L-040）
- `fetch` エラーは `apply` せず握りつぶす（呼び出し側 error UI なし）。ログは任意

### ボード

- `ngOnInit` の初回 `load()` は現状どおり（loading 付き）
- `startLiveRefresh` は `ngOnInit` で開始する。開始時の即時 tick は行わず、最初の取得は `intervalMs` 後（または visible 復帰時）。`enabled` に `!loading()` を含め、手動 `load()` 中は tick をスキップする。タイマーは `NgZone.runOutsideAngular` 経由で張り、`whenStable` を塞がない
- `fetch` は `api.board()`、`apply` はガード通過かつ前回と異なれば `data.set`
- `enabled`: `!loading() && !reordering() && !saving() && modal() === null && draggingColumnId() === null && draggingCardId() === null`（列のドラッグ中・カードのドラッグ中を含む。カードのドラッグとの関係は `2026-11-14-card-drag-drop-design.md` §4.4 の 9）
- `fetch` は `pollBoard()`: `api.board()` の応答を、リクエスト時点の `data` と同じ参照のときだけ通す（取得中にローカルの更新があれば捨てる）
- `DestroyRef` で stop

### バックログ

- 同様。`fetch` は現状の `forkJoin({ cards: backlog(), columns: board() })` 相当を silent に再実行
- `enabled`: `!loading() && !reordering() && !saving()`（バックログに作成モーダルが無ければ `modal` は不要。あればボードと同じく閉じていること）

### カード詳細

- `startLiveRefresh` の `fetch` は `forkJoin({ board, card })`（現状 `load` と同形）
- `apply`: ガード中（`hasChanges` / `saving` / `prLinks.saving` / `confirmDelete` / `deleting`）は return。ガード外では `columns` を更新し、カードは未保存が無いときだけ `autosave.reset` 相当で載せ替え（履歴 `revision` も追随）
- `enabled`: `!loading()`（手動／ルート再取得中はスキップ）
- ルート `number` 変更時は世代を進め、古いカード番号の応答を捨てる（既存 `changed$` と同趣旨）

### 対象外の明示

- ポーリング中の操作ボタン無効化はしない
- サーバ側の変更通知ハブは作らない
- 「更新しました」トーストは出さない（静かに差し替える）

## エラーと権限

- 背景失敗: 無視（データ維持）
- 初回失敗: 既存のエラー UI
- 権限モデル変更なし（認証なしの既存 API）

## 検証方針

- ユニット: `live-refresh` — interval で fetch が呼ばれる / hidden で止まる / visible で即 fetch / stop 後に呼ばれない / 古い世代の応答が apply されない / fetch エラーで apply されない
- コンポーネント: ボードでポーリング応答が `data` に載る / `reordering` 中は apply されない / 背景中に loading が true にならない
- 詳細: `hasChanges` 中はカード上書きされない
- 既存の board / backlog / card-detail のテストが壊れないこと

## 知見の反映

- L-040: 世代トークンで遅いポーリング応答を捨てる
- L-108 / L-109 / L-217: タイマーと visibility listener を破棄時に解除し、ID をクリア
- L-008: 外部変更をメモリに載せる（本機能の本体）。未保存編集がある詳細では載せないことで「編集バッファを壊す」側を避ける
- L-001: 初回／手動 load の成否表示は維持。背景失敗は「成功扱いの副作用」を起こさない（apply しない）

## 設計時の推奨採用（質問省略）

ユーザー確認を待たず次を採用した（`/feature` の推奨案既定）:

1. 方式はポーリング（SSE ではない）
2. 間隔 5 秒 + Page Visibility
3. ボード・バックログ・詳細の 3 画面
4. バックエンド変更なし
5. 未保存・並び替え中は上書きしない
)