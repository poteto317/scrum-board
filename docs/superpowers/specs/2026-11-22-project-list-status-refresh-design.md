# プロジェクト一覧オープン時に最新ステータスを取る（#135）— 設計

- カード: [#135 プロジェクト一覧を開いた時に最新のステータスを取得する](https://scrum-board-jkcejsb6ka-an.a.run.app/items/135?project=1)
- 日付: 2026-11-22

## 背景

- ヘッダーのプロジェクト listbox の Doing/Review ドットは `ProjectBoardCache` の board スナップショットから算出する（#81）。
- 先読みは `prefetchOthers` → `enqueue` が **既に warm なら HTTP をスキップ**し、成功時も `putBoardIfAbsent` のため古いスナップショットが残る。
- 結果: 一度先読みした後に他プロジェクトで Doing→Review/Done しても、一覧を開き直すと **古い Doing ドットのまま**見える。

関連: `docs/superpowers/specs/2026-11-20-project-status-dots-design.md`（ドット規則・キャッシュ一体形は維持。本カードは「開くときの鮮度」だけを変える）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| トリガー | (1) `onProjectSelectWarmup`（trigger `focus` / `pointerdown`）(2) **`openProjectMenu` 成功時にも** 同じ `onProjectSelectWarmup` を呼ぶ。キーボード Enter で開く場合も最新化するため（focus 済みだと pointerdown/focus が再発火しない） |
| 重複抑制 | 同一 `board:{id}` は既存 `inFlight` で 1 本。飛行中の再トリガーは無視 |
| 動作 | **アクティブ以外**の各プロジェクトについて、warm でも board GET を取り直し、成功かつ世代一致ならスナップショットを上書き（内部 `writeBoardSnapshot`。`putBoard` は呼ばない＝ gen を二重に進めない） |
| 世代（L-040） | プロジェクトごとに `boardWriteGen`。force fetch **開始時**に gen+1。応答は開始時 gen と現在が一致するときだけ write。`putBoard`（表示中 board の本取得など）は write 前に gen+1 し、飛行中 refresh を無効化 |
| inFlight | キー `board:{id}` を soft prefetch と共有。飛行中は新規を足さない。listbox は refresh のみ呼ぶので通常は force が直接走る。soft が飛行中なら完了待ち、その後のトリガーで force |
| API | `ProjectBoardCache.refreshOthers(api, activeId, projectIds): void`（board のみ）。署名に backlog は含めない |
| backlog 配線 | `onProjectSelectWarmup` は (a) `refreshOthers(...)`（board force）(b) backlog ルートのときだけ、active 以外へ既存 `prefetchBacklog`（warm/ifAbsent のまま）をループ。`prefetchOthers` は listbox からは呼ばない |
| 既存 prefetch | 切替高速化用 `prefetchBoard` / `prefetchOthers`（warm スキップ + ifAbsent）は **残す**（他経路・回帰用） |
| アクティブ | refresh 対象外（表示中 board の `putBoard` / poll が正。L-860） |
| 失敗時 | エラー表示なし。キャッシュ非変更（古いドットのまま。空扱いにしない。L-002） |
| 取得中 | ドットを消さない。成功適用で `revision` 更新 → 開いたまま再描画 |
| ドット規則 | #81 のまま |
| BE | 変更なし |

### 検討したが採らなかった案

- **TTL のみ**: 開いた直後でも古い可能性が残る。
- **キャッシュ全クリア**: 一瞬ドット消失・失敗時に空（L-002）。
- **focus/pointerdown のみ**: Enter 開閉で再取得が走らない。
- **世代なしの putBoard 完了順**: switchTo 後の fresher `putBoard` を遅い refresh が潰す（L-040 違反）。
- **専用 summary API**: 範囲外。

## 目的と受け入れ条件

1. 他プロジェクトが Review/Done になったあと、listbox を **focus/pointerdown またはメニューオープン**すると、ドットが最新の列内容に合う（自動テスト: 古い warm → refresh 成功で更新）。
2. warm 済みでも refresh の HTTP が飛ぶ。
3. refresh 失敗時はドットが消えず、直前キャッシュが残る。
4. 飛行中に fresher `putBoard` が入ったあと遅延 refresh 応答が来ても、スナップショットを戻さない（世代不一致で破棄。L-040）。
5. 切替用 `prefetchOthers` の warm スキップ + ifAbsent 契約は回帰で残る。
6. BE / ドット算出 / listbox DOM 構造は変えない。App で「refresh 成功後に option ドットが更新される」ことを組み立てテストで固定する（#81 の L-060 配線に加え、本カードの鮮度シナリオ）。

## 非目標

- バックエンド集計 API
- backlog の force 再取得
- ポーリング常時同期
- ドット規則・色の変更
- アクティブプロジェクトの board 再取得

## 実装概要

1. `ProjectBoardCache`: `boardWriteGen` / `writeBoardSnapshot`、force enqueue（warm でも fetch、gen 一致時は write のみ）、`putBoard` は gen+1→write、`refreshOthers`。
2. `App.onProjectSelectWarmup`: switching/mutating early return 維持 → `refreshOthers` + backlog 時 `prefetchBacklog`。`openProjectMenu` 成功後も同じ warmup を呼ぶ。
3. テスト: プラン Task1/2 のとおり（focus と open の両方、取得中ドット維持、世代破棄、active 除外、switching ガード）。

## 知見（手順 4）

| ID | 扱い |
| --- | --- |
| L-040 | **守る**: force refresh の適用は `writeBoardSnapshot` のみ。fresher な `putBoard`（gen+1）後の遅延 refresh は世代不一致で破棄 |
| L-002 | **守る**: 失敗を空ドットに倒さない |
| L-860 | **守る**: active を refresh 対象外 |
| L-060 | **守る**: 既存の option ドット／aria-label 配線に加え、本カードは refresh→ドット更新の組み立てを固定 |

## レビュー記録

### 第 1 周（記述の確かさ）2026-11-22
対応: L-040 を世代無効化で明文化、Enter 開閉用に openProjectMenu トリガー、backlog 配線を一意化、L-060 と鮮度 AC を分離記述。

### 第 2 周（範囲と知見）2026-11-22
対応: switching/mutating ガード維持と refreshOthers の active 除外テストを実装概要へ追記。
