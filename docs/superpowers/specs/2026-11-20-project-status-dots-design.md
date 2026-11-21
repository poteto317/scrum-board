# プロジェクト選択に状態ドットを付ける（#81）

## 背景

カード: https://scrum-board-jkcejsb6ka-an.a.run.app/items/81?project=1

ヘッダーのプロジェクト listbox を開いたとき、各プロジェクトが **Doing / Review を抱えているか** が一目で分からない。かんばん列の status-dot と同じ見た目の丸い色アイコンで、選択前に忙しさを把握したい。

関連:

- `docs/superpowers/specs/2026-11-20-project-select-ui-design.md` — カスタム listbox（本機能の土台）
- `docs/superpowers/specs/2026-11-20-project-switch-perf-design.md` — `ProjectBoardCache` と focus／pointerdown 先読み
- `board.html` / `board.css` — 列見出しの `.status-dot`（`.doing` / `.done` のみ色上書き。Review は現状デフォルト）

## 決めたこと

| 事項 | 採用 |
|------|------|
| 表示場所 | listbox の **各 option 行**（プロジェクト名の左）。トリガーボタンには付けない |
| 判定対象の列名 | 完全一致 `"Doing"` / `"Review"` / `"Todo"`（カスタム列名・Close・Done は無視） |
| 表示ルール | **Doing に1件以上** → Doing ドット。**Review に1件以上** → Review ドット。両方あれば **両方**（Doing→Review の順）。どちらも0件で **Todo に1件以上** → Todo ドットのみ。それ以外 → アイコンなし |
| 件数 | 件数数字は出さない（ドットの有無だけ） |
| 色 | **現行かんばんの status-dot と同じ**。Doing = `.doing .status-dot`（金）。Review / Todo = デフォルト `.status-dot`（灰リング）。ボードに Review 専用色は **足さない**（カード外の見た目変更を避ける）。Doing+Review 同時は金＋灰で区別。Review のみと Todo のみは同色（ボード現状どおり。既知の制約） |
| セレクタ形 | Doing ドットは祖先 `.doing` + 子 `.status-dot`。Review ドットは識別用に祖先 `.review` を付けてよいが **色ルールはデフォルトのまま**（`.review .status-dot` の色上書きは書かない）。Todo は修飾なし `.status-dot`。子へ `.status-dot.doing` 直付与はしない |
| データ源 | 既存の `GET /api/board?projectId=` 応答。**新規 API は作らない** |
| キャッシュ | board スナップショットは **`{ items, columns }` 一体のみ**。items だけの put 経路は廃止。warm 判定は「columns が1列以上ある一体エントリがある」こと。先読みは既存どおり `putBoardIfAbsent`（または同等）で、**後から届いた古い prefetch が fresher な `putBoard` を上書きしない**（L-040） |
| 未キャッシュ | ドットなし（開くのを待たない・エラー表示もしない）。先読み完了後にメニューが開いたままでも **再描画でドットが現れる** |
| 算出の単一源 | **常に `ProjectBoardCache` の board スナップショットだけ**から `projectStatusDots` する。Board コンポーネントのライブ `data()` は直接読まない。アクティブも他プロジェクトも、`putBoard` / prefetch 成功でキャッシュが埋まったあとだけドットが出る（一瞬のズレは既存の先読み契約と同じく許容） |
| a11y | ドットは `aria-hidden="true"`。状態は option の可視テキストに足さない。option には **必ず** 短い `aria-label` を付ける（ドットなし: プロジェクト名のみ。あり: `名前, Doing` / `名前, Review` / `名前, Doing と Review` / `名前, Todo`） |
| 対象外 | Done / Close のドット、トリガー上の集約ドット、バックエンド集計エンドポイント |

### 検討したが採らなかった案

- **優先度1つだけ（Doing > Review > Todo）**: 「DoingやReview」の両方が分かる要望に弱い。両方表示を採用。
- **専用 summary API**: 先読み board で足りる。BE 変更は非目標。
- **列 ID を全プロジェクト共通とみなす**: プロジェクトごとに列が別行。禁止（L-035）。
- **未キャッシュ中にスピナー**: メニューを重くするだけ。ドットなしでよい。
- **ボードへ Review 専用色を新設**: セレクトのためだけにかんばん見た目を変えるのは範囲外。現行デフォルト色に合わせる。
- **`.todo` 修飾クラス**: ボードの Todo 列はデフォルトのまま。セレクトも修飾なし。
- **ライブ Board `data()` を優先参照**: キャッシュと二重源になり優先順位が曖昧。キャッシュ単一源に固定。
- **items のみ旧 put を残す二系統**: プラン肥大と warm 判定の穴。一体 put の1経路だけ。

## 目的と受け入れ条件

1. listbox を開くと、各 option の左に状態ドットが出る（ルールは上表）。
2. Doing ドットの色はボードの Doing 列 status-dot と一致する。Review / Todo ドットはボードのデフォルト status-dot と一致する。
3. Done / Close だけあるプロジェクト、または該当3列がすべて空のプロジェクトはドットなし。
4. 先読み前はドットなし。focus／pointerdown 先読み後（または切替後の `putBoard`）にデータが揃えば、開いたままでもドットが付く。
5. 列名・切替・先読み・L-842 busy 契約は既存のまま。本機能は表示専用で `switchTo` を変えない。
6. FE テストで少なくとも次を固定する: (a) 純関数で Doing+Review / Todo フォールバック / なし、(b) columns 欠落や未キャッシュでドットなし（空と失敗を「全部 Todo」扱いにしない。L-002）、(c) **`app.spec`（App 組み立て経由）** で option 内ドットの有無と `aria-label` が配線されること（ヘルパ単体だけでは L-060 不足）、(d) 遅延 prefetch が fresher `putBoard` を踏まないこと（既存 cache テストの延長）。

## 非目標

- バックエンド API・DB・集計テーブル
- トリガーボタン上のドット
- Done / Close / カスタム列のインジケータ
- 件数バッジ・ツールチップ必須化
- お気に入り一覧や item-detail のプロジェクト UI
- **ボード列の Review（や Todo）専用色の新設・変更**

## 表示ルール（純関数）

入力: そのプロジェクトの `columns: {id,name}[]` と `items: {columnId}[]`（living のみ。キャッシュ／board 応答と同義）。

```ts
type StatusKind = 'doing' | 'review' | 'todo';

function projectStatusDots(
  columns: { id: number; name: string }[],
  items: { columnId: number }[],
): StatusKind[] {
  const idByName = new Map(columns.map((c) => [c.name, c.id]));
  const count = (name: string) => {
    const id = idByName.get(name);
    if (id == null) return 0;
    return items.reduce((n, it) => n + (it.columnId === id ? 1 : 0), 0);
  };
  const doing = count('Doing');
  const review = count('Review');
  const todo = count('Todo');
  if (doing > 0 || review > 0) {
    const out: StatusKind[] = [];
    if (doing > 0) out.push('doing');
    if (review > 0) out.push('review');
    return out;
  }
  if (todo > 0) return ['todo'];
  return [];
}
```

- `columns` が空／未取得 → `[]`（「Todo がある」とみなさない。L-002）。
- 名前の揺れ（全角・小文字）は対象外。既存ボードと同じ英語名前提。

## データ／キャッシュ

- `ProjectBoardCache` の board スナップショットを `{ items: Item[]; columns: Column[] }` の **一体形だけ**に拡張する（items 単体 put は削除）。
- warm = その projectId に一体エントリがあること。prefetch 成功は `putBoardIfAbsent`（エントリが既にあれば無視）。`putBoard`（切替後の本取得など）は上書き可。遅延した古い prefetch が fresher な `putBoard` を踏まないことをテストで固定（L-040）。
- `getBoard(projectId)` は従来どおり **items 配列**（または clone）を返す薄い互換。columns 付きが要る呼び出しは `getBoardSnapshot(projectId)`。
- backlog キャッシュは本機能では使わない。
- listbox のドットは **キャッシュの signal／再計算のみ**（Board の `data()` を注入しない）。

## UI 構造

```
li[role=option][aria-label="…"]
  span.project-status-dots[aria-hidden]
    // Doing: <span class="doing"><span class="status-dot"></span></span>
    // Review: <span class="review"><span class="status-dot"></span></span>  // 色上書きなし
    // Todo のみ: <span class="status-dot"></span>
  span.project-option-name
    {{ project.name }}
```

- Doing 色は既存 `.doing .status-dot` を流用。セレクト用に色を新規定義しない。グローバルへ移す場合は `.kanban-column` / `.project-select-list` で祖先限定（L-792）。
- ボードの `board.html` / Review 列クラスは **変更しない**（非目標）。

## 知見（手順 4）

- **L-002**: columns／キャッシュ未取得を「空ボード＝ドットなし」とし、「全部 Todo」やデフォルト列 ID 推測に倒さない。
- **L-035**: 状態判定は **そのプロジェクトの columnId**（名前→id マップ）。表示 index や他プロジェクトの列 ID を使わない。
- **L-040 / L-842**: 先読みはキャッシュ更新のみ。表示中 board の data を先読みで上書きしない。warm 定義変更後も **遅延 prefetch が fresher `putBoard` を上書きしない**（`putBoardIfAbsent`）。ドットはキャッシュ購読／再計算のみ。
- **L-037**: 先読み応答を projectId キーに結び付ける（既存 enqueue と同じ）。
- **L-792**: status-dot 共有をグローバルへ出すなら祖先セレクター必須。
- **L-408**: listbox の開閉・キー契約は #80 のまま。ドット追加でキー処理を変えない。
- **L-060**: option ドットと `aria-label` の配線は **`app.spec`（App 経由）で必須固定**。ヘルパ単体だけでは不足。

## テスト方針

- `project-status-dots`（仮）純関数の単体: Doing のみ / Review のみ / 両方 / Todo フォールバック / なし / columns 空 / 名前不一致列のみ。
- キャッシュ: 一体 put で columns 保持、未 warm で再 prefetch 可、遅延 prefetch が fresher put を踏まない。
- `app.spec`（必須）: キャッシュを埋めたうえで option 内 Doing／Review ドットと aria-label。未キャッシュでドットなし。

## リスク

- Review のみと Todo のみが同色（ボード現状の制約。受け入れ済み）。
- 先読み未完了の短い間はドットなし → 後から付く（許容）。
- 列を改名したプロジェクトではドットが付かない（完全一致仕様。既知の制約）。
