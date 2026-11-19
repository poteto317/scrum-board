# プロジェクト追加をモーダル化する（アイテム #66）

## 背景

カード要件:

- プロジェクトの追加画面を、綺麗な UI のダイアログなどにしてほしい。

現状:

- ヘッダー「追加」→ `window.prompt('プロジェクト名')` → `ProjectSession.create(name)` → `POST /api/projects`。
- カード／列追加は既に `appModal` の `<dialog>` があるが、プロジェクト追加だけ native prompt。
- 成功時は一覧に追加するだけで、**現行はアクティブプロジェクトへ自動切替しない**（`activeId` は据え置き）。
- 現行 `create` は空名のみ FE 拒否。80 文字超過は POST し、BE が拒否する。

## 決めたこと

| 事項 | 採用 |
|------|------|
| UI | **1A** 既存 `appModal` と同型のモーダル |
| 入力 | **2A** プロジェクト名のみ（API は `POST {name}` のまま） |
| 成功後 | **3A** 作成したプロジェクトへ切替（`switchTo`）。現行の「切替しない」から変更する |
| 見た目 | **4A** 既存モーダル（余白・見出し・フォーム・Esc）に揃える。ウィザード／イラストはしない |
| rename／delete | **5B** 初版対象外（prompt／confirm のまま） |

ユーザーは推奨を一括採用。

## 目的と受け入れ条件

1. 「追加」クリックでモーダルが開き、プロジェクト名を入力して作成できる。`window.prompt` は使わない。
2. 名前は trim 後必須。上限は **80 Unicode code points**（BE `normalizeProjectName` と一致）。空・超過は送信せず、フォーム内エラー。FE では入力に `textLimit(80, true)`（または同等）を掛け、`create` 側でも `[...trimmed].length > 80` なら `PROJECT_NAME_REQUIRED` を出して POST しない。
3. 作成中は送信ボタンと × を disabled、二重送信しない（`mutating`）。**作成中は Esc／× で閉じない**（既存列・カード追加の `saving()` 中と同じ）。
4. 成功時: 一覧に現れ、**そのプロジェクトへ切替**し、モーダルを閉じる。入力はクリア。
5. 失敗時（POST 失敗）: モーダルは開いたまま。エラーは**モーダル内のみ**（`formError`）。ヘッダーの `projectSession.error` は開いている間は使わない／クリアする（二重表示しない）。名前は残す。
6. 閉じ方は既存ボード追加モーダルと同型: **× と Esc のみ**。backdrop クリックでは閉じない。未送信の入力を捨てる。切替・作成は起こさない。キャンセル専用ボタンは置かない（4A に揃える）。
7. `switching`／`mutating` 中は「追加」が押せない（現行 disabled を維持）。
8. rename・delete の UX は変えない。
9. API／DB スキーマは変えない。
10. 切替後のボード／バックログ／アイテム詳細の追従は既存 `switchTo`／`onSwitched` に任せる（本変更で追加ロジックは作らない）。

## UI 詳細

- 配置: `app` シェル（ヘッダーのプロジェクトスイッチャー付近）。`Modal` ディレクティブ＋既存 `.modal` / `.modal-backdrop`。
- 見出し: 「プロジェクトを追加」。
- フィールド: 名前（必須ラベル）、field-note「80文字以内」。
- アクション: 作成（primary）のみ。× で閉じる。作成中は「作成中…」。
- フォーカス: 開いたとき名前 input に autofocus。閉じたあと「追加」ボタンへ戻すのは native `<dialog>` の focus restoration に任せる。
- バリデーション文言は既存 `PROJECT_NAME_REQUIRED` に揃える。

## `create` の契約変更

現行 `create(name): void` は App が成功を観測できない。次に変更する:

- `create(name: string): Observable<Project>`
  - 空／超過: `PROJECT_NAME_REQUIRED` を `error` にセットし **`throwError`**（POST しない）。App の `error` ハンドラが拾う。
  - busy（`switching`／`mutating`）: **`EMPTY`**（complete・next なし）。App は no-op。
  - 成功: 一覧に追加 → `of(project)` を流す。**`mutating` はまだ true のまま**（呼び出し側が `switchTo` を始めた直後に下ろす）。`switchTo` は呼ばない。
  - POST 失敗: `error` をセットし `mutating=false`。Observable は error。

App（モーダル送信）の流れ:

1. ローカル `saving=true`（追加ボタン／×／Esc を抑止。`mutating=false`〜`switchTo` の隙間も塞ぐ）。
2. `create(name).subscribe({ next, error, complete })`
3. `error`: `formError` に文言を写し、`projectSession.error` をクリア（ヘッダー二重表示防止）。`saving=false`。モーダルは開いたまま。
4. `next`: モーダルを閉じる → すぐ `switchTo(project.id)` を subscribe → **その直後に** `projectSession` 側の `mutating=false`（`create` が返す前に下ろさない／または App が `create` 成功直後に下ろしてから `switchTo`。いずれにせよ `switchTo` 開始前に追加ボタンが有効にならないよう `saving` でガード）。
5. `switchTo` の `error`: 一覧は残す。ヘッダー `projectSession.error`。作成は取り消さない（L-001）。`saving=false`。
6. `switchTo` が `EMPTY`（切替中など）: `saving=false`。必要ならヘッダーに短いエラー（「切替できませんでした」）。サイレント成功扱いにしない。

実装の推奨形: `create` 成功時は **`mutating` を維持したまま `of(project)`**。App が `switchTo` を呼んだ直後（または `finalize`）で `mutating=false`。テストでは「成功 emit 時点ではまだ mutating」を固定してもよい。

`create` 内部で `switchTo` を呼ばない（責務分離）。

## エラー表示ルール

| 状態 | 表示先 |
|------|--------|
| モーダル開・バリデーション／POST 失敗 | モーダル内 `formError` のみ。開くときと error ハンドラで `projectSession.error` をクリア |
| モーダル閉・切替失敗／EMPTY 時 | 既存ヘッダー `projectSession.error` |

## 非対象

- 説明フィールドや他メタデータの追加、色・アイコン。
- rename／delete のダイアログ化。
- 新規ルートページ。
- backdrop クリック閉じ・キャンセルボタン（既存追加モーダルと揃えるため）。

## 関連知見

- **L-001**: 作成成功後の切替失敗を作成失敗と混同しない。一覧は戻さない。
- **L-775 / L-037**: `mutating`／`switching` 中の追加ボタン disabled を維持。
- **L-158 / 既存 Modal**: backdrop では閉じない。Esc／× のみ。作成中は閉じない。
- **L-835**: ダイアログ内のインタラクティブ要素の入れ子に注意。
- **L-842**: `switchTo` は optimistic `activeId` の前に `switching=true`。

## テスト方針

- App: 「追加」でダイアログ、prompt 非呼び出し。空名／81 文字で POST なし。成功で閉じる＋ create のあと `switchTo`。Esc／× で閉じる。backdrop では閉じない。作成中は ×／Esc 無効。
- ProjectSession:
  - create 成功: 一覧に追加、Observable が project を流す。`activeId` はまだ変わらない（呼び出し側が switch）。
  - create 失敗: 一覧不変、Observable error。
  - App 結合またはセッション手順: create 成功後の switchTo 失敗で一覧は残り、`activeId` は復元、error あり。
- 回帰: rename／delete の prompt／confirm 経路。

## 手動チェックリスト

1. ボード／バックログ／アイテム詳細それぞれで追加 → 作成 → セレクトが新プロジェクトになり、開いているビューが既存 `switchTo` どおり追従する。
2. 空名／81 文字以上でエラー、POST されない。
3. Esc／× で閉じ、プロジェクトが増えない。backdrop クリックでは閉じない。
4. 作成 API 失敗時、ダイアログが残りモーダル内エラーが見える。ヘッダーと二重表示しない。
5. 名称変更・削除が従来どおり。
