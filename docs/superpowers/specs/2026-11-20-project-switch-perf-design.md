# プロジェクト切替の表示遅れを改善する（#76）

## 背景

カード: プロジェクト切替の際、アイテムの表示が遅れることがあるのでパフォーマンスを改善したい。

関連（役割が違う）:

- #71 / `itemsForActiveProject`: 切替中に旧プロジェクトのカードを出さない（正しさ）。副作用として、再取得完了まで一覧が空に見えやすい。
- #73: リロード時のセレクトと active の表示整合。GET 本数の統合は非対象だった。
- L-040 / L-842 / L-844: 世代無視・busy 順序・切替中操作拒否。本修正でも維持する。

## 調査結果（遅れの要因）

1. `switchTo` は `PATCH /api/board/settings` のあと、Board / Backlog が `GET /api/board`（Backlog は `forkJoin(backlog, board)`）する。**最低 2 RTT**。
2. 切替開始で `activeId` が先に新プロジェクトになり、`itemsForActiveProject` が旧 items を落とす → **GET 完了まで空表示**。
3. `GET /api/board` は常に **解決後アクティブ** の items だけを返す。切替前に別プロジェクトのボードを先読みする口が無い。
4. ネイティブ `<select>` では option ホバーは取れないが、**フォーカス／ポインタダウン（展開直前）** で先読みは可能。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 主目標 | 切替後、新プロジェクトのカードをできるだけ早く見せる（空待ちを短くする） |
| 手段 | **FE キャッシュ**（プロジェクトごとの最終成功スナップショット）＋ **先読み API** |
| 古さ | キャッシュを即表示 → 裏で再取得して差し替え。再取得失敗時はキャッシュのまま＋既存エラー表示 |
| 画面 | **Board と Backlog**（お気に入り一覧は対象外） |
| プリフェッチ | **する**。ヘッダーのプロジェクト `<select>` の focus／pointerdown で、active 以外を先読み |
| PATCH 同梱 board | **しない**（今回はキャッシュ＋ `?projectId=` GET。RTT 削減の同梱は非目標） |
| BE クエリ単体最適化 | 必須にしない（既存 index／読取 tx のまま。ボトルネックなら後続） |

### 検討したが採らなかった案

- **PATCH 成功応答に board 同梱のみ**: 初回切替の 1 RTT 化には効くが、再訪の即時表示とプリフェッチが弱い。キャッシュ＋先読みで足りる。
- **カスタムドロップダウン化**: ホバー単位の先読みはしやすいが UI 刷新が本カードの範囲を超える。
- **切替時に data を破壊的クリアしないまま旧カードを出す**: #71 の退行。禁止。

## 目的と受け入れ条件

1. キャッシュがあるプロジェクトへの切替では、**settings PATCH 成功後〜再 GET 完了前**（現行の `onSwitched` 発火以降）に、そのプロジェクトのカードが一覧に出る。optimistic `activeId` 直後かつ PATCH 成功前には、キャッシュを画面へ載せない（PATCH 失敗で active が巻き戻る経路と矛盾させない）。所属は常に `activeId` 一致のみ（#71 維持）。
2. ヘッダーのプロジェクト select を focus または pointerdown したあと、未キャッシュの他プロジェクトについて board（表示中が backlog なら backlog も）の先読みが走る。先読みは **キャッシュ更新のみ**（表示中の `data`／`items` は触らない）。先読み成功後にそのプロジェクトへ切り替えると、再 GET 待ちなし（またはごく短い）でカードが見える。
3. 先読み・切替後の再取得が失敗しても、旧プロジェクトのカードは出ない。キャッシュが無ければ空＋既存エラーでよい。
4. 先読み用 GET は **active を変更しない**（DB の `active_project_id` を書き換えない。FE の `activeId` も先読み応答では変えない）。
5. 古い先読み／再取得応答が、より新しい切替後の表示を上書きしない（L-040・世代）。
6. `switching` / L-842 / L-844 の busy・操作拒否は維持する。キャッシュ表示中も切替完了までは作成・DnD 等を拒否してよい（現状どおり `switching`）。
7. Go／FE のユニットまたはハンドラテストで、(a) `?projectId=` が active を変えず指定プロジェクトの items を返すこと、(b) キャッシュ適用で active 不一致カードが出ないこと、(c) 世代で古い応答を捨てること、を固定する。
8. `docs/api.md` に `projectId` クエリを追記する。

## 非目標

- お気に入り画面のキャッシュ／先読み
- プロジェクト select のカスタム UI 化
- PATCH settings への board／backlog 同梱
- 起動時の多重 GET 統合（#73 非対象の継続）
- item-detail からの所属移動フロー変更
- ACL・認可モデルの変更（既存の board／backlog と同じ認証）

## API

### `GET /api/board?projectId=<正の整数>`（任意）

- **省略時**: 現行どおり。解決後アクティブの items。
- **指定時**:
  - `projectId` が存在しない／0 以下 → **400**。
  - items は **その projectId** に属する living のみ（active 解決結果ではない）。
  - `settings.activeProjectId` は **従来どおり解決後アクティブ**（先読みでセレクトを動かさないための真実）。応答の items の `projectId` はクエリのプロジェクト。
  - DB の active は変更しない。
- columns / settings のその他フィールドは現行 GET と同じ。

### `GET /api/backlog?projectId=<正の整数>`（任意）

- board と同じ規則。items は指定プロジェクトの backlog 順。

実装メモ: `Board` / backlog 読取で `resolveActiveProjectID` のあと、クエリがあればその id の存在確認してから items の WHERE に使う。settings の active フィールドは常に解決後アクティブ。

## FE 設計

### キャッシュ

- キー: `projectId`。メモリのみ（リロードで消える）。
- **Board 用値**: そのプロジェクトの `Item[]` のみ（columns／settings はキャッシュしない）。
- **Backlog 用値**: そのプロジェクトの `Item[]` のみ（board settings 断片は持たない。Backlog の切替即時表示は items 差し替えだけ）。
- 成功した GET（通常・先読み・切替後再取得）で、応答 items をキー `projectId`（クエリ指定または各 item の所属／active）へ保存する。
- 画面へ載せるときは必ず `itemsForActiveProject`（または同等）を通す。

### プリフェッチ

- ヘッダー project `<select>` の `focus` と `pointerdown`（片方だけにしない。キーボード／マウス両対応）。
- active 以外・未キャッシュかつ in-flight でないプロジェクトへ `board(?projectId=)`。現在ルートが backlog のときは `backlog(?projectId=)` も。
- **先読み成功時はキャッシュ Map のみ更新する。表示中の Board `data`／Backlog `items` は更新しない。**
- **完了時の書き込み**: その `projectId` のキャッシュが **既にあれば先読み結果で上書きしない**（切替後 GET など後から入った新しいスナップショットを、開始が早い先読みが踏み潰さない）。未キャッシュのときだけ入れる。
- 同時実行数を抑える（例: 2）。`switching` 中は新規先読みを始めない。
- 失敗は黙ってよい（エラーバナー必須にしない）。再試行は次の focus／切替時。

### 切替時

1. `switchTo` 開始（既存: busy → optimistic activeId → PATCH）。
2. Board／Backlog の `reloadAfterProjectSwitch`（`onSwitched` 経由、PATCH 成功後）の処理順を次で固定する:
   1. `++boardLoadGeneration`（Backlog は `backlogLoadGeneration`）で進行中の通常 load／poll 応答を無効化する。
   2. **その直後・GET 購読開始前**に、新 `activeId` のキャッシュ `Item[]` があれば **items だけ**同期適用する（Board は `data.items` のみ。`columns` / `settings` は再 GET まで現状維持。Backlog は `items` シグナルのみ）。
   3. **この即時表示では `syncActiveFromBoard` / `applyBoardDataWithActiveSync` を呼ばない。**
   4. 続けて `GET`（`projectId` 省略の現行 GET。PATCH 後はサーバ active が新プロジェクト）を購読し、成功時は通常どおり active sync して全体差し替え。失敗時はキャッシュ表示（あれば）を残し既存エラー表示。
3. `endSwitch` は再取得の settle 時（現行）。キャッシュ即時表示があっても busy は再取得まで維持。

### 世代（L-040）

- **画面用**: 通常 load／poll／切替再取得だけが `boardLoadGeneration` / `backlogLoadGeneration` を進める・照合する。
- **先読み**: これらの世代カウンタを **進めない・表示採用に使わない**。App（または root 提供のキャッシュサービス）が **projectId 単位の in-flight フラグ**だけを持ち、重複リクエストと「既キャッシュなら完了時スキップ」を管理する。
- 先読み応答では `syncActiveFromBoard` しない。切替時のキャッシュ即時表示でもしない。再 GET 成功時のみ既存の board 適用経路を使う。

## 関連知見

- **L-040**: 古い非同期の上書き防止（先読み・切替・poll）。
- **L-037**: 対象／世代の結び付け。
- **L-842 / L-844**: busy 順序と切替中操作拒否。
- **L-001**: 失敗を成功扱いしない（キャッシュ表示は「暫定」であり PATCH 失敗時は既存どおり active 巻き戻し）。
- **#71**: 所属フィルタ必須。

## テスト方針

- BE: `projectId` あり／なし／不正、active が別プロジェクトのとき items がクエリ側であること、settings.active が変わらないこと。
- FE: キャッシュヒットで切替直後に新 projectId のカードが見える；ミスヒットは空のまま；古い先読みが新 active を汚さない；select focus で prefetch API が呼ばれる。

## セルフチェック

- TBD / TODO なし
- #71 と矛盾しない（旧カード露出なし）
- 先読みが active を書き換えない
- 非目標にカスタム select／PATCH 同梱を入れて範囲を閉じた
