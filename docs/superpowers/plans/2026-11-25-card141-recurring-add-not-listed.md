# カード141 Implementation Plan

> **For agentic workers:** 順に実装・検証する（`/feature` 手順 11、完了後 `/refactor-srp` 以降へ自動連結）。

**Goal:** 繰り返しルールの POST 成功後、一覧に必ず行が現れるようにする（`rules===null` 時は再 GET）。空一覧からの追加表示をテストで固定する。
**Architecture:** `RecurringSession.create` の tap だけを直し、UI の save 成功クローズは維持。再 GET は既存 `fetchList`（`loadGeneration`）を再利用。
**Tech Stack:** Angular, TypeScript, Vitest, HttpClientTesting
**Spec:** `docs/superpowers/specs/2026-11-25-card141-recurring-add-not-listed-design.md`

## Global Constraints

- patch/delete・ephemeral 永続化・`?projectId=` API は触らない（範囲外）。
- 反映知見: L-001, L-060, L-175, L-040, L-643。

## Task 1: RED — session / 画面の回帰テスト

**Files:**
- Modify: `frontend/src/app/recurring-session.spec.ts`
- Modify: `frontend/src/app/recurring.spec.ts`

- [x] `recurring-session.spec.ts` に次を追加（`afterEach` で `http.verify()`。`create().subscribe()` は変数に控え `unsubscribe` を `try/finally` または `afterEach` で行う、L-643）:
  - `rules` を `null` のまま create → POST flush → **続けて** `GET /api/recurring-rules` を expect → `{ rules: [created] }` を flush → `session.rules()` が作成ルールを含む。
  - 同様に create → POST flush → GET を 500 で flush → `session.rules()` が null のまま、`loadError` が非空（設計: 再 GET 失敗）。
  - 変更前コードでは成功系の再 GET が出ず失敗（RED）することを確認する。
- [x] `recurring.spec.ts` に次を追加（**空配列 `[]` の merge 経路**の画面固定。`rules===null` では追加ボタンが disabled のため null→`fetchList` は session テストが正本、L-060）:
  - `listRecurringRules` が `{ rules: [] }`、`createRecurringRule` が `of(rule({ id: 99, name: '追加ルール', title: '追加タイトル' }))`。
  - 「ルールを追加」→ form 入力 → `save()` → detectChanges。
  - テキストに「繰り返しルールはまだありません」が無く、`追加ルール` / `追加タイトル` が含まれること。`editorOpen()` が false。
- [x] `cd frontend && npx ng test --watch=false --include src/app/recurring-session.spec.ts` で null→再 GET の新規が **実装前 RED** であることを確認する（UI 空配列テストは実装前後どちらでも merge が既にあれば GREEN になりうる）。

## Task 2: GREEN — create の null→fetchList

**Files:**
- Modify: `frontend/src/app/recurring-session.ts`

- [x] `create` の tap を次の契約にする（**flat if/else**。変異用に `fetchList` が `}` 入れ子の外に来る形）:
  ```ts
  tap((created) => {
    if (generation !== this.mutateGeneration) return;
    const cur = this.rules();
    if (cur) this.rules.set(withCreatedRule(cur, created));
    else this.fetchList();
  }),
  ```
- [x] Task 1 の session / UI テストが GREEN になることを確認。
- [x] 既存の `drops stale create updates after reloadForProjectSwitch` が引き続き通ること。

## Task 3: 変異テストと全体検証

- [x] `~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --help` を確認したうえで、`cd frontend` で:
  ```sh
  ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --baseline --show-diff M01 \
    src/app/recurring-session.ts \
    's/else this\.fetchList\(\);/else { \/* mutated *\/ }/' \
    -- npx ng test --watch=false --include src/app/recurring-session.spec.ts
  ```
  （`--show-diff` で create の `else this.fetchList();` だけが変わったことを確認。違う場所ならやり直し。）
  KILLED であること。失敗ログに再 GET（`expectOne('/api/recurring-rules')` や rules 内容）由来のアサーションが含まれることを確認（L-175）。復元はスクリプト任せ。
  実行不可時: `cp -p` 退避 → **変異前に同 ng test が green** → 手編集で `fetchList` 削除 → テスト失敗（狙い分岐）確認 → 書き戻し → `cmp -s`（`git checkout` / `git restore` 禁止）→ 再度 green。
- [x] `cd frontend && npm test -- --watch=false && npm run build`
- [x] リポジトリルートで `git diff --check` および `~/Desktop/dev-flow-kit/scripts/dev-flow/require-feature-reviews.sh`

## 検証結果（2026-11-25）

- RED: recurring-session 新規 2 件が変更前で失敗（再 GET 無し）。
- GREEN: recurring-session + recurring.spec 31 passed。全体 113 files / 1126 tests。build 成功。
- 変異 M01: `else this.fetchList();` → KILLED（null 再取得テスト）。
