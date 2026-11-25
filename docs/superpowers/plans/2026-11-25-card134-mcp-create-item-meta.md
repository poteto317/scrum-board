# カード134 Implementation Plan

> **For agentic workers:** 順に実装・検証する（`/feature` 手順 11、完了後 `/refactor-srp` 以降へ自動連結）。

**Goal:** `mcp` の `create_item` がボード全件（`GET /api/board`）を取得せず、`GET /api/board/meta` から列 ID を解決するようにする。
**Architecture:** バックエンド既存の `GET /api/board/meta`（`{ columns, settings }`、`items` なし）を `create_item` から直接呼び出し、`resolveColumnIdFromBoardMeta` と `findColumnId` の正整数 ID 検証を通して `POST /api/items` を呼ぶ。キャッシュ・フォールバックは置かない。
**Tech Stack:** TypeScript, Node.js 18+, Vitest, Zod, `@modelcontextprotocol/sdk`
**Spec:** `docs/superpowers/specs/2026-11-25-card134-mcp-create-item-meta-design.md`

## Global Constraints
- チケット #134 の完了条件「`create_item` が、ボード全件を取得しない」を満たし、バックエンド・フロントエンド・`update_item`・`get_board` は変更しない。
- プロセス内列キャッシュや 404 時 `GET /api/board` フォールバックは入れない（L-542, L-060）。
- 反映知見: L-001（失敗・未存在時に後続 `POST /api/items` を呼ばない）、L-047（`findColumnId` の正整数検証）、L-060（旧 API 拒否・実クライアント境界テスト・変異テスト確認）、L-064（clean ビルドで古い `dist/` 成果物除去）、L-542（ステートレス維持）。

## Task 1: クリーンビルド設定と列 ID 検証の厳格化
**Files:**
- Modify: `mcp/package.json`
- Modify: `mcp/src/item-helpers.ts`
- Modify: `mcp/src/item-helpers.test.ts`

- [x] `mcp/package.json` に `clean` スクリプト（`node --input-type=module -e "import fs from 'node:fs'; fs.rmSync('dist', { recursive: true, force: true });"`）を追加し、`build` を `"npm run clean && tsc -p tsconfig.json"` に変更する（L-064）。
- [x] `mcp/src/item-helpers.ts` の `findColumnId(columns: unknown, columnName: string): number | null` で、`c.id` の検証を `typeof c.id === 'number' && Number.isInteger(c.id) && c.id > 0` に厳格化する（L-047）。
- [x] `mcp/src/item-helpers.test.ts` で、`findColumnId` に `0`・`-1`・`1.5`・`NaN`・`Infinity` の ID を無視する境界値テストを追加する（`cd mcp && npm test && npm run build` が Task 1 末尾で通ること）。

## Task 2: `create_item` の `/api/board/meta` 切替・ヘルパー改名・テスト強化・ドキュメント更新
**Files:**
- Modify: `mcp/src/item-helpers.ts`
- Modify: `mcp/src/item-helpers.test.ts`
- Modify: `mcp/src/tools.ts`
- Modify: `mcp/src/tools.test.ts`
- Modify: `mcp/README.md`

- [x] `mcp/src/item-helpers.ts` の `resolveColumnIdFromBoard` を `resolveColumnIdFromBoardMeta(metaData: unknown, columnName: string): number | null` に改名し、JSDoc を `/** Resolve column id from a GET /api/board/meta JSON body. */` に更新する。同時に `mcp/src/item-helpers.test.ts` の import と `describe` ブロックも `resolveColumnIdFromBoardMeta` に更新する。
- [x] `mcp/src/tools.ts` で `resolveColumnIdFromBoardMeta` を import し、`create_item` の `GET /api/board` を `GET /api/board/meta` に変更する（変数名 `meta`、失敗時は `errText(meta.reason)`、列未存在時は `errText('column_not_found')` で早期 return し `POST /api/items` へ進まない、L-001）。
- [x] `mcp/src/tools.test.ts` の `create_item` 既存 5 テスト（`create_item resolves column name and POSTs item`, `create_item maps board GET failure` → `create_item maps board meta GET failure` に改名, `create_item maps POST failure`, `create_item treats null board data as column_not_found` → `create_item treats null board meta data as column_not_found` に改名, `create_item returns column_not_found when name missing`）のモックにおいて、`'GET', '/api/board'` が呼ばれたら `throw new Error('unexpected GET /api/board')` を投げるようにし、`'GET', '/api/board/meta'` が呼ばれたことを断言する（L-060）。
- [x] `mcp/src/tools.test.ts` の GET 失敗・`null` 応答・列未存在の各テストに `expect(client.request).toHaveBeenCalledTimes(1)` を追加し、`POST /api/items` が呼ばれないことを断言する（L-001）。
- [x] `mcp/src/tools.test.ts` に `createHttpClient` と `vi.stubGlobal('fetch', ...)`（`afterEach(() => vi.unstubAllGlobals())` でクリーンアップ）を用いた境界テストを追加し、`create_item` が `${baseUrl}/api/board/meta` → `${baseUrl}/api/items` を呼び、`/api/board` へアクセスしないことを検証する（L-060）。
- [x] `mcp/README.md` の 63 行目 `create_item` 用途欄を `作成（列名を GET /api/board/meta から id 解決）` に更新する。

## Task 3: テスト・ビルド・変異テスト・ゲート検証
- [x] `cd mcp && npm test && npm run build` を実行し、全テスト通過（既存 53 件 + 新規追加分）および TypeScript ビルド成功を確認する。
- [x] `ls -la mcp/dist` で、対応ソースのない `item-identity.js` / `item-identity.d.ts` が削除され、`mcp/src/*.ts`（テスト除く）に対応する `.js` / `.d.ts` のみが存在することを確認する（L-064）。
- [x] `~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh` の存在と `--help` を確認したうえで、以下を実行し `mcp/src/tools.ts` の `'/api/board/meta'` を `'/api/board'` に変える変異に対して `KILLED` になることを確認する（L-060）。環境上同スクリプトを参照・実行できない場合は、`cp -p mcp/src/tools.ts <一時ファイル>` で退避したうえで `mcp/src/tools.ts` の該当文字列を一時編集し `cd mcp && npx vitest run` が失敗することを確認したら、`git checkout` / `git restore` は使わず退避ファイルから書き戻して `cmp -s` で完全一致を確認し、再度 `cd mcp && npx vitest run` が全件通過することを確かめる（L-175・L-200）。
  ```sh
  cd mcp && ~/Desktop/dev-flow-kit/scripts/git/mutation-test.sh --baseline --show-diff M01 src/tools.ts "s#'/api/board/meta'#'/api/board'#" -- npx vitest run
  ```
- [x] `~/Desktop/dev-flow-kit/scripts/dev-flow/require-feature-reviews.sh` を実行し exit 0 を確認する。

## 検証結果（2026-11-25）
- `cd mcp && npm test`: 4 ファイル 56 テスト通過（`item-helpers.test.ts` 14 件、`config.test.ts` 8 件、`http.test.ts` 6 件、`tools.test.ts` 28 件。SRP リファクタリングでの `isPositiveIntId` 抽出・`resolvedItemId` 境界値テスト追加を含む）。
- `cd mcp && npm run build`: clean ビルド成功、`mcp/dist/` に残存していた `item-identity.js` / `item-identity.d.ts` が除去され、ソース対応分（`config`, `http`, `index`, `item-helpers`, `tools`）のみ生成。
- `mutation-test.sh --baseline --show-diff M01 src/tools.ts "s#'/api/board/meta'#'/api/board'#" -- npx vitest run`: `[M01] KILLED (exit 1)`（`create_item` 関連 6 テストすべて失敗）。
- `git diff --check` および `require-feature-reviews.sh`: 成功（`ok: feature reviews gate passed`）。
