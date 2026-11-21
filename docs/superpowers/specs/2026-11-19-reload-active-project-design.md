# リロード後のアクティブプロジェクト不整合を直す（アイテム #73）

## 背景

カード要件:

- リロードするとプロジェクト表示が先頭（1つ目）になるが、かんばん等のアイテムはリロード前のプロジェクトのまま見え、不整合になる。
- リロードしてもプロジェクトを変えないでほしい。

仕様上の前提（既存・変更しない）:

- アクティブは `board_settings.active_project_id`（JSON `activeProjectId`）に永続。localStorage は使わない。
- 無効・欠落 ID は GET 応答で position→id 先頭へ解決する。読取では DB を直さない。

## 調査結果（原因）

1. 起動時 `ProjectSession.load`（projects + board）と Board/Backlog 初回 `GET /api/board` が並行する（L-040）。
2. `load` は **先に `projects.set`、続けて `syncActiveFromBoard(..., clearIfMissing=true)`**。
3. ヘッダー select は `projects` があり `activeId` がまだ null のとき `value=""` → ブラウザが**先頭 option を表示**する。
4. その後 `activeId` が永続値（正の id）に戻っても、ネイティブ select の**表示だけ先頭のまま**残ることがある。Board は `itemsForActiveProject(..., activeId)` で永続側のカードを出す（#71）。  
   → 見た目: セレクト＝先頭、ボード＝直前プロジェクト。  
   （`activeId` が null の間はフィルタでボードは空。本バグの主症状は「activeId は正しいが select 表示がずれている」側。）
5. Board の sync は `clearIfMissing=false`。その後 Session.load が settings 欠落で `clearIfMissing=true` だと、一度付いた正しい `activeId` を null に戻しうる。

`parseActiveProjectId` が null になる条件: 値が「正の整数 number」でない（欠落・`0`・非数・非 integer）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 直し方 | **1A** FE 起動を直す。DB 永続維持。localStorage なし。GET 統合はしない |
| 無効 ID | **2A** BE 解決（先頭フォールバック）をそのまま表示 |
| コード変更の範囲 | **Session.load 順・sync 契約・ヘッダー select**。Board/Backlog/お気に入りは `activeId` 追従のみ（本 PR で触らない） |
| clearIfMissing | 正の `activeId` があるとき欠落ではクリアしない（二重 GET 対策） |

## 目的と受け入れ条件

1. プロジェクト B 選択中にフルリロード → セレクトもボード／バックログも B（アイテムも B）。
2. 起動中、セレクトが先頭プロジェクト名を選んだように見えない。`bootstrapped` 前は option を出さず disabled。bootstrap 後は `@if` で select をマウントし、初期 `[value]` が永続 id と一致する（**マウントし直し必須**）。
3. 無効・欠落の永続 ID では解決後先頭でセレクトとボードが一致する。
4. API／DB 変更なし。読取で DB 治癒しない。GET 本数の統合・削減はしない。
5. `switchTo`・作成後切替・#71 フィルタは壊さない。
6. ボードが一瞬空になるフラッシュは許容（AC 外）。

## 修正方針

### ProjectSession.load

1. 成功時: **`syncActiveFromBoard` → `projects.set` → `bootstrapped.set(true)`**。
2. `bootstrapped`: 初回成功 load のあと true。失敗では立てない。プロジェクト 0 件でも成功なら true（select は projects 空で disabled）。
3. `syncActiveFromBoard(id, clearIfMissing)`:  
   - 正の id → set。  
   - null かつ `clearIfMissing` かつ **現在の `activeId` が正でない**ときだけ null。  
   - 既に正の `activeId` があるときの欠落は no-op。

### ヘッダーセレクト

- `@if (projectSession.bootstrapped() && projectSession.projects().length > 0 && projectSession.activeId() != null)` のときだけ `<select>` をマウント。
- それ以外は同じ場所に disabled のプレースホルダ（または空の disabled select）で幅を保ってもよい。
- 有効時 `[value]="'' + activeId()"` に加え、option に `[selected]="project.id === activeId()"`（jsdom／ネイティブの初期 value ずれ対策）。

### Board / Backlog / お気に入り

- コード変更なし。既存 sync・`itemsForActiveProject`・favorites の active 購読に任せる。

## 非対象

- localStorage／URL 永続。
- 読取時 DB 治癒。
- 起動 GET の統合（Session board + Board + Favorites の多重 GET 削減）。
- rename／delete／作成モーダル。

## 関連知見

- **L-040**: 起動の二重／多重 GET。本修正は表示の単一の正しさ。GET 統合は非対象。
- **#71 / itemsForActiveProject**: ボードは activeId に従う。
- **L-001**: 失敗 load で一覧を空にしない。
- **L-842 / L-844**: 切替シーケンスは触らない（境界の確認のみ）。

## テスト方針

- ProjectSession: load 後 `activeId` が settings どおり、`bootstrapped` true。projects 設定時点で activeId が既に非 null（永続が有効なとき）。
- ProjectSession: 正の activeId があるとき欠落 sync(clearIfMissing) で消えない。
- App: bootstrap 前に先頭プロジェクト名が出ない。load 後、永続 id の option が selected。
- 回帰: switchTo、#71 フィルタ、作成後切替。

## 手動チェックリスト

1. 2 番目以降のプロジェクトへ切替 → リロード → セレクトもボードも同じ。
2. リロード直後にセレクトが一瞬先頭に飛ばない。
3. バックログでも同様。
4. プロジェクト切替・追加が従来どおり。
