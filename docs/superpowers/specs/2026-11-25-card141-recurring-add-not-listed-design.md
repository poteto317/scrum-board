# 繰り返しルール追加が一覧に出ない（#141）設計

## 背景

チケット「繰り返しの追加ができない」: 繰り返し画面で追加しても一覧に表示されず、追加が成功したかも分からない。

調査（コード＋本番 API）:

- BE の `POST/GET /api/recurring-rules` は **アクティブプロジェクト**（`ActiveProjectID`）スコープ。本番で create→list は同一セッションなら一貫して見える。
- FE `RecurringSession.create` は成功時にローカル merge するだけ（再 GET なし）。`rules()` が truthy のときだけ `withCreatedRule` する（`recurring-session.ts`）。
- `rules === null`（読込失敗・切替中など）のときは merge をスキップし、`Recurring.save` は editor を閉じるだけ → **POST 成功なのに一覧が更新されない**（L-001）。
- 追加ボタンは `rules === null` で disabled だが、開いたあとに並行 GET 失敗などで `rules` が null になると（GET 失敗は `mutateGeneration` を進めない）世代一致のまま merge が空振りしうる。
- コンポーネントテストに「空一覧から create 成功 → 行が表示される」固定が無い（L-060 / L-175）。
- 補足（本カードでは直さない）: `viewFromDeepLink` の ephemeral 表示と共有 `activeProjectId` がずれると、ヘッダー表示と CRUD 対象が食い違うことがある。別カード候補。

## 目的と完了条件（チケット）

1. 繰り返しルールを **追加（POST）** したら、成功時に一覧へ行が現れる。判定時点:
   - ローカル merge できた場合: editor 閉鎖直後に一覧へ `created` が含まれる。
   - merge できず再 GET する場合: 再 GET 成功後に一覧へ含まれる。再 GET 失敗時は一覧領域の `loadError`（既存）を出し、**editor は閉じたまま**（POST 自体は成功済み）。
2. POST 失敗時は editor を開いたまま `actionError` を出す（現行維持）。
3. 調査結果に基づく修正であること（推測だけで範囲を広げない）。

## 決めたこと

### 1. create のローカル反映を「merge または再取得」にする（必須）

- `RecurringSession.create` の `tap` で:
  - `generation !== mutateGeneration` → 現行どおり破棄（プロジェクト切替の stale create。L-040 系）。
  - `rules()` が配列 → `withCreatedRule`。
  - `rules()` が `null` → **黙ってスキップせず** `fetchList()` を呼ぶ（L-001）。
- 再 GET の破棄軸は既存どおり **`loadGeneration`**（`fetchList` 内）。create 起点の再 GET も通常の `fetchList` と同じ。
- **patch / delete** の同型フォールバックは範囲外。

### 2. 回帰テスト

- `recurring-session.spec.ts`: `rules` が `null` のとき create 成功 → `GET /api/recurring-rules` が発行され、flush 後に rules が作成結果を含む。HTTP 期待・subscribe は `afterEach` または `try/finally` で verify / 解除（L-643 / L-175）。
- `recurring.spec.ts`: 空一覧から追加成功 → 「まだありません」が消え、作成名／タイトルが一覧に出る（L-060 / L-001）。

### 3. 変異テスト（検知力・L-175）

1. 変異前に対象テストが green であることを確認する。
2. create の null 分岐から `fetchList` 呼び出しを消す（または no-op にする）変異を当て、`--show-diff` または差分で狙った箇所だけ変わったことを確認する。
3. 上記 session テストが **その分岐の期待（再 GET）で** 落ちる（KILLED）ことを失敗ログで確認する。
4. ファイルを控えから復元し `cmp -s` で一致を確認する（`git checkout` / `git restore` は使わない）。

## 範囲外

- ephemeral 深リンクと共有 `activeProjectId` の永続化／寄せ（別カード）。
- recurring run（自動起票）の不具合。
- `GET /api/recurring-rules?projectId=` の先読み API 拡張。
- patch/delete の null→再取得。
- cron バリデーション文言の改訂。

## 気をつける知見

- **L-001**: POST 成功なのに一覧が変わらない状態を残さない（null 時は再 GET）。
- **L-060 / L-175**: 空一覧→追加表示と null→再取得をテストで固定し、変異前 green・差分・狙い失敗・復元まで確認する。
- **L-040**: 切替で `mutateGeneration` が進んだ create 応答は破棄。再 GET は `loadGeneration`。
- **L-643**: 新規 HTTP テストは `afterEach` / `try/finally` で verify・unsubscribe する。
