# MCP の起票で、列名を調べるためにボード全件を取得しない（#134）設計

## 背景

`mcp/src/tools.ts` の `create_item` は、指定された列名（`args.column`）から `columnId` を調べるためだけに、ボード全件（`GET /api/board`）を取得してから `POST /api/items` を呼び出している。

`create_item` が必要としているのは列の一覧（`columns[].id` と `columns[].name`）のみであり、アイテム本体（`items`）は不要である。それにもかかわらず起票のたびにボード全件を取得しているため、アイテム数が増えるほど転送量とサーバー負荷が不要に増大する。

バックエンドには既に、列と設定だけを返す軽量エンドポイント `GET /api/board/meta`（`backend/internal/kanban/handler.go` の `boardMeta`）が存在し、`{ "columns": Column[], "settings": BoardSettings }`（`items` なし、`withSessionAuth` 認証済み、`projectId` 非依存）を返す。

## 目的と完了条件（チケットから）

- `create_item` が、ボード全件（`GET /api/board`）を取得しない。

## 決めたこと

### 1. `create_item` の取得先を `GET /api/board/meta` に切り替える

- `mcp/src/tools.ts` の `create_item` で呼び出すエンドポイントを `GET /api/board` から `GET /api/board/meta` に変更する。
- `GET /api/board/meta` が失敗（`!meta.ok`）した場合は `errText(meta.reason)` を返して処理を終了し、後続の `POST /api/items` を実行しない（L-001）。
- 列名に一致する列が見つからない場合（`columnId === null`）は `errText('column_not_found')` を返して終了する。

### 2. プロセス内キャッシュとフォールバックは入れない

- **プロセス内キャッシュを入れない理由**: `GET /api/board/meta` 自体がアイテムを含まない軽量 API であり、キャッシュを持たないことで列の追加・改名・削除を即座に反映できる。また、`scrum-board-mcp` のステートレスな薄い HTTP ラッパとしての性質を保ち、状態残留・テスト間汚染リスク（L-542 相当）を回避できる。
- **404 時の `GET /api/board` フォールバックを入れない理由**: 同一リポジトリ内のバックエンドで `GET /api/board/meta` が既に提供されており、フォールバックは配線漏れや API の退行を隠す原因（L-060）となるため。

### 3. ヘルパー関数の改名と ID 検証の厳格化

- `mcp/src/item-helpers.ts` の `resolveColumnIdFromBoard` は `mcp/src/` 内からのみ参照されているため、`resolveColumnIdFromBoardMeta` に改名し、JSDoc を `/** Resolve column id from a GET /api/board/meta JSON body. */` に更新する。
- `findColumnId` の ID 検証を `resolvedItemId` と揃えて正の整数（`typeof c.id === 'number' && Number.isInteger(c.id) && c.id > 0`）に厳格化し、`0`・負数・小数・`NaN`・`Infinity` を拒否する（L-047）。

### 4. テスト・ドキュメント・ビルドの更新

- `mcp/package.json` に `clean` スクリプト（`node --input-type=module -e "import fs from 'node:fs'; fs.rmSync('dist', { recursive: true, force: true });"`）を追加し、`"build": "npm run clean && tsc -p tsconfig.json"` に変更する。これによりビルドごとに `mcp/dist/` が初期化され、過去に削除・改名されたモジュール（現状残存している `item-identity.js` / `item-identity.d.ts` など）が残らない（L-064）。
- `mcp/src/tools.test.ts` で、`create_item` の全テストケース（成功・GET 失敗・POST 失敗・`null` 応答・列未存在）のモックにおいて `'GET', '/api/board'` が呼ばれたら即座に例外（`throw new Error('unexpected GET /api/board')`）を投げるようにし、`'GET', '/api/board/meta'` の呼び出しを断言する（L-060）。
- `mcp/src/tools.test.ts` で、GET 失敗時・`null` 応答時・列未存在時のすべてにおいて `POST /api/items` が呼ばれないこと（`toHaveBeenCalledTimes(1)`）を断言する（L-001）。
- `mcp/src/tools.test.ts` に `createHttpClient` と `fetch` モックを使った境界テストを追加し、`create_item` 実行時に実 URL `${baseUrl}/api/board/meta` → `${baseUrl}/api/items` へリクエストが飛び、`/api/board` へは飛ばないことを検証する（L-060）。
- 検証時に `mutation-test.sh` で `mcp/src/tools.ts` の `/api/board/meta` を `/api/board` に戻す変異が `KILLED` になることを確かめる。
- `mcp/src/item-helpers.test.ts` を `resolveColumnIdFromBoardMeta` へ追従させ、`findColumnId` に `0`・`-1`・`1.5`・`NaN`・`Infinity` を無視する境界値テストを追加する。
- `mcp/README.md` の `create_item` 用途欄を「作成（列名を GET /api/board/meta から id 解決）」に更新する。
- `cd mcp && npm test && npm run build` を実行し、全テスト通過および `mcp/dist/` に `mcp/src/` 対応分以外の古い成果物が残っていないことを確認する（L-064）。

## 範囲外

- `update_item` の 2 段階通信（`GET /api/items/by-number/:number` → `PATCH /api/items/:id`）: 単一アイテムの取得でありボード全件を取得しないため、本チケットの対象外とする。
- `get_board` ツール: ボード全体の取得が目的であるため変更しない。
- バックエンド `GET /api/board/meta` の実装変更: 既に `{ columns: Column[], settings: BoardSettings }` を返しており変更不要。
- MCP プロセス内の列キャッシュ導入: 上記判断により採用しない。

## 気をつける知見

- **L-001**: `GET /api/board/meta` 失敗時や列未存在時に `POST /api/items` へ進まず確実にエラーを返し、テストでも `toHaveBeenCalledTimes(1)` で後続未実行を検証する。
- **L-047**: `findColumnId` の ID 検証で `Number.isInteger(c.id) && c.id > 0` を使い、`Infinity`・`NaN`・`0`・負数・小数を弾く。
- **L-060**: 旧 API へのフォールバックを置かず、`tools.test.ts` の全 `create_item` テストで `/api/board` 呼び出しを拒否し `/api/board/meta` 呼び出しを断言する。さらに `createHttpClient` + `fetch` 境界テストと `mutation-test.sh` で配線漏れを検出できるようにする。
- **L-064**: `mcp/package.json` の `build` を `npm run clean && tsc -p tsconfig.json` にし、ソース変更後のビルドで `mcp/dist/` に古いビルド成果物を残さない。
- **L-542**: 列キャッシュを持たず、MCP サーバーをステートレスに保つ。
