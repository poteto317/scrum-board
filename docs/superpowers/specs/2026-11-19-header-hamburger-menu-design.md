# ヘッダー右端ハンバーガーメニュー（アイテム #69）

## 背景

カード要件:

- ヘッダーの一番右にハンバーガーメニューを作成する。
- たまに使うページや機能をメニューへ移し、普段見る情報量を減らす。
- ページ（の種類）ごとに、メニューに出す項目を設定できるようにする。
  - 例: 詳細には更新履歴が必要だが、ボード／バックログには不要。

現状:

- ヘッダー右端は `Personal workspace` + avatar（装飾）のみ。
- プロジェクトの「追加／名称変更／削除」はヘッダーのプロジェクトスイッチャー横に常時表示。
- ボード／バックログのナビとお気に入り一覧はサイドバー。
- アイテム詳細にはお気に入りトグル・リンクコピー・コマンド・ソリューションリンク・更新履歴（`app-item-history`）などがページ内にある。
- ワークスペース prefs の先例: `GET`/`PUT /api/list-filter`（シングルトン行・Basic Auth 共有）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| スコープ | **1C** メニュー UI ＋ 設定 UI ＋ サーバ永続まで一式 |
| ページ種別 | **2A** `board` / `backlog` / `itemDetail`（`/items/:n/solution` も `itemDetail` と同じメニュー） |
| 初回カタログ | **推奨** 詳細: 更新履歴・ソリューション・お気に入り。ボード／バックログ: プロジェクト追加・名称変更・削除をヘッダーからメニューへ移す |
| 保存先 | **4B** prefs API を新設してサーバ永続（list-filter と同型のワークスペース共有） |
| UI | **5A** ヘッダー右端のハンバーガー（3 本線）＋ popover。`Personal workspace` / avatar はその左に残す |
| 並び替え | **初版対象外**。設定は表示 ON/OFF のみ。順序はカタログ既定順 |
| リンクコピー | **初版対象外**（詳細ページ内の既存 UI のまま） |

ユーザー回答: `1C 4B`。未回答は推奨（2A・カタログ・5A）。

## 目的と受け入れ条件

1. ヘッダー右端にハンバーガーボタンがあり、クリックで popover メニューが開く。Esc・外側クリック・項目実行後に閉じる。開いているときのボタン再クリックはトグルで閉じる（L-879）。
2. 実行時メニューに出す項目は **現在の `pageKind` のカタログに属し、かつ `hiddenIds` に含まれないものだけ**（カタログ既定順）。他 pageKind 用 ID はメニューに出さない。
3. ボード／バックログでは、ヘッダーから「追加／名称変更／削除」ボタンを取り除き、メニュー項目から同じ操作を起動する（追加は既存モーダル、rename/delete は現行の prompt/confirm 経路のまま）。
4. アイテム詳細（およびソリューション頁）では、メニューから次を起動できる:
   - **更新履歴**: 詳細頁の履歴セクションへスクロール（ソリューション頁にいる場合は詳細へ遷移してからスクロール）。
   - **ソリューション**: `/items/:number/solution` へ遷移（既にいる場合は no-op でメニューを閉じる）。
   - **お気に入り**: 詳細の既存トグルと同じ API／状態を使う。ソリューション頁でも対象アイテムのお気に入りを切り替えられる。
5. メニュー内に「メニュー設定」があり、**3 種別すべて**をセレクト（またはタブ）で切り替えて編集できる。セレクトで選んだ pageKind のカタログだけをチェックリスト表示し、ON/OFF を変える。保存は常に `board` / `backlog` / `itemDetail` の 3 キー全体を PUT する（L-015）。変更はサーバへ保存され、再読込後も残る。
6. 設定の読み込み完了前、および **GET 通信失敗中（未 hydrate）** は PUT を送らない（L-669）。GET 失敗は空の成功と同一視せず、エラー表示と再試行を出す。保存失敗時は画面に短く示し、直前の confirmed 値へ戻せる／再試行できる。
7. PUT: 未知のページキー・必須キー欠落・未知の項目 ID・不正な型は **400**。GET: 壊れた／欠落した保存値は下記「GET 正規化」に従い修復して返し、**DB は書き換えない**（書き込みは厳格・読み込みは修復、L-044）。
8. prefs の GET/PUT は `loadGeneration` / `saveGeneration` で世代ガードし、古い応答で draft/confirmed を上書きしない（L-037 / L-040）。`load` 開始時に `saveGeneration++` して in-flight PUT を無効化。GET 成功時、dirty な pageKind は draft を優先マージし、必要なら 1 回 `scheduleSave`（list-filter-session と同型）。
9. Basic Auth 共有のワークスペース 1 設定（ユーザー別ではない）。プロジェクト単位でもない。
10. キーボード／a11y（初版で固定）:
   - トリガー: `aria-haspopup="menu"` / `aria-expanded` / `aria-controls`。
   - メイン一覧ビュー: `role="menu"`、各アクションは `role="menuitem"`。
   - 「メニュー設定」で **同じ popover 内の別ビュー**へ切替。設定ビューは `role="group"` + `aria-label="メニュー設定"`。各表示トグルはネイティブ `<input type="checkbox">`＋ラベル（`menuitemcheckbox` は使わない）。
   - 開いたらフォーカスを popover 先頭へ。Esc はどちらのビューでも popover 全体を閉じ、フォーカスをトリガーへ戻す。「戻る」でメイン一覧ビューへ。
11. モバイルでもハンバーガーが見え、popover が画面内に収まる。DOM: `Personal workspace` / avatar だけを `.header-end` に残し、**ハンバーガーは `app-header` 直下の兄弟**（`.header-end` の外）。既存の `max-width: 680px` で `.header-end { display: none }` でもボタンは残る。
12. 追加モーダル open 中は `project_add` を disabled（現行ヘッダー追加ボタンと同じガード。L-879）。プロジェクト系アクションは subscribe 起点で busy を立て、cold Observable の二重購読で副作用が二重に走らない（L-880）。
13. お気に入りは詳細の既存トグルと同じ busy／世代ガードを共有し、メニューのラベルも同一 state に追随する（L-037）。

## ページ種別の判定

| ルート | `pageKind` |
|--------|------------|
| `''`（ボード） | `board` |
| `backlog` | `backlog` |
| `items/:number` | `itemDetail` |
| `items/:number/solution` | `itemDetail` |
| 上記以外（`**` リダイレクト待ちなど） | `null` |

- `pageKind === null` のとき: アクション項目は空。ボタンと「メニュー設定」は出す。設定セレクトの初期値は `board`。PUT は常にメモリ上の 3 キー全体（confirmed/draft）を送り、null だからといってキーを落とさない。

## カタログ（固定 ID・既定で全部 ON）

| ID | ラベル | 属する pageKind | 動作 |
|----|--------|-----------------|------|
| `project_add` | プロジェクトを追加 | board, backlog | 既存 `addProject()`（モーダル） |
| `project_rename` | 名称変更 | board, backlog | 既存 `renameProject()` |
| `project_delete` | 削除 | board, backlog | 既存 `deleteProject()` |
| `item_history` | 更新履歴 | itemDetail | 詳細の履歴へスクロール（必要なら詳細へ遷移） |
| `item_solution` | ソリューション | itemDetail | ソリューション頁へ |
| `item_favorite` | お気に入りに追加 / 外す | itemDetail | お気に入りトグル（ラベルは現在状態で切替） |

- 実行時メニュー・設定チェックリストとも、**その pageKind のカタログ ID だけ**を扱う。他種別 ID は表示も保存もしない。
- `project_*` の disabled 条件は現行ヘッダーと同じ（`switching` / `mutating` / `canRename` / `canDelete` / モーダル open など）。
- アイテム系は `ItemMenuActions` 未登録時 disabled。

## API

`GET` / `PUT /api/header-menu`

応答・本文:

```json
{
  "board": { "hiddenIds": [] },
  "backlog": { "hiddenIds": ["project_delete"] },
  "itemDetail": { "hiddenIds": [] }
}
```

### PUT バリデーション（いずれも 400）

- トップレベルに `board` / `backlog` / `itemDetail` 以外のキーがある
- いずれかの必須キーが欠落
- 各値の型がオブジェクトでない、または `hiddenIds` が配列でない
- `hiddenIds` の要素が string でない
- `hiddenIds` に当該 pageKind カタログ外の ID（未知・他種別）がある

重複 ID は除去して受理してよい（400 にしない）。

### GET 正規化（DB は触らない）

1. 行無し／JSON パース不可 → 3 キーすべて `{ "hiddenIds": [] }`
2. 余分なトップレベルキー → 応答から無視（落とす）
3. 必須キー欠落 → そのキーを `{ "hiddenIds": [] }` で補完
4. あるキーの値が不正型 → そのキーだけ `{ "hiddenIds": [] }`
5. `hiddenIds` 内の未知・他種別・非 string → その要素だけ除去。残りをユニーク化

### 永続化

- 表示集合 = その pageKind のカタログ順から `hiddenIds` を除いたもの。
- DB: `workspace_header_menu` シングルトン（`id = 1`）。ペイロード全体を **JSON 列 1 本**（`payload`）に保存。マイグレーションは list-filter と同様に起動時 `GET_LOCK`。
- PUT はワークスペース全体置換。

`docs/api.md` に節を追加する。

## FE 構成

- `HeaderMenuSession`（`providedIn: 'root'`）: GET で hydrate、設定変更で debounce PUT、`hydrated` 前は PUT しない（list-filter-session と同型。L-669 / L-040 generation）。
- `header-menu.ts`: カタログ定義・pageKind 判定・visible 計算の純関数。
- `HeaderMenu` コンポーネント: ボタン＋ popover（一覧／設定の2ビュー）。配置は `app-header` 直下、`.header-end` の右隣（兄弟）。`.header-end` には workspace/avatar のみ。
- アクション配線:
  - プロジェクト系: App の既存メソッドを呼ぶ（または小さな facade）。
  - アイテム系: `ItemMenuActions` サービス。`ItemDetail` / `ItemSolution` が activate 時にハンドラ登録、destroy で解除。未登録時は項目 disabled。
- 設定ビュー: 「メニュー設定」で切替。pageKind セレクト（初期は現在ルートの pageKind、null なら `board`）＋そのカタログのチェックリスト。変更は即 draft → debounce 保存。

## タスク分割（実装プラン用）

1. BE: マイグレーション＋ `GET`/`PUT /api/header-menu`＋テスト＋ `docs/api.md`
2. FE: `header-menu.ts` 純関数＋ `HeaderMenuSession`＋ Api クライアント
3. FE: `HeaderMenu` UI（開閉・一覧・設定・a11y・モバイル DOM）
4. FE: プロジェクト系をメニューへ移し、ヘッダーボタン撤去
5. FE: `ItemMenuActions`＋詳細／ソリューション登録（履歴・ソリューション・お気に入り）

## 非対象

- 項目のドラッグ並び替え。
- ユーザー／プロジェクト別 prefs。
- カードリンクコピー・コマンド管理のメニュー化。
- サイドバーのボード／バックログ／お気に入り一覧の移動。
- `Personal workspace` / avatar の削除やメニュー内への移動。
- rename/delete のモーダル化（#66 で追加のみモーダル化済みの方針を維持）。

## 知見（手順 4）

実装・レビューで特に見る:

- **L-669** hydrate 前 PUT 禁止・失敗後も既定で上書きしない
- **L-040 / L-037** 保存・読込の generation
- **L-044** PUT の未知 ID／キーは 400。壊れた GET は空 hidden へ正規化
- **L-015** 設定 UI から外した pageKind のキーを PUT で消さない（常に 3 キー全体を送る／読む）
- **L-879** メニュー open 中にトリガー再クリックで状態が壊れない（トグルで閉じる）
- **L-880** cold Observable の busy を subscribe 前に置かない（プロジェクト操作流用時）

## テスト方針

- BE: normalize / 未知 ID 400 / 必須キー欠落 400 / GET 既定 / PUT 永続の handler・repo テスト。
- FE session: hydrate 前 PUT 抑止、GET 失敗後 PUT 抑止、GET 成功時 dirty マージ＋1 回 save、遅延 PUT が新しい draft を潰さない、load 直後の古い PUT 無効化。
- FE UI: pageKind 判定、visible 計算、メニュー開閉 a11y の要点、モバイルでハンバーガー残存、プロジェクトボタンがヘッダーから消えメニューから同じ disabled 規則（モーダル open 中の `project_add` 含む）、ItemMenuActions 未登録時 disabled、お気に入りをメニュー経由でも既存 L-037 ガードで回帰。

## サブエージェントによる設計書レビュー

### 第1周（記述の確かさ）

対応した指摘: モバイル DOM（ハンバーガーを `.header-end` 外へ）、設定 UI は3種別すべて編集、実行時メニューは pageKind∩表示ON のみ、`pageKind=null` の扱い、GET 正規化の逐次ルール、PUT バリデーション表、a11y を group+checkbox に固定。

### 第2周（範囲と知見）

対応した指摘: GET 失敗と hydrate、generation／dirty マージ、L-879 の project_add、L-880、お気に入りの同一ガード、実装プラン用タスク分割。L-044 / L-015 / ハンバーガートグルは既反映のため追加対応なし。
