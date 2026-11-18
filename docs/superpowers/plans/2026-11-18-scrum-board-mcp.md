# スクラムかんばん MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. **本フローではコミットしない**（`/feature`）。

**Goal:** 既存 HTTP API の薄いラッパとして、stdio MCP サーバーを `mcp/` に追加し、ローカルの Claude Code / Codex からボード操作できるようにする。

**Architecture:** Node.js + TypeScript の独立パッケージ。`@modelcontextprotocol/sdk` の `McpServer` + `StdioServerTransport`。HTTP クライアントは `fetch`（Node 18+）。ツールは設計書の 8 個のみ。API 追加なし。不足 API はカード #8 と README に追記。

**Tech Stack:** TypeScript、`@modelcontextprotocol/sdk`、`zod`、`vitest`、`tsx`（開発実行）

**Spec:** `docs/superpowers/specs/2026-11-18-scrum-board-mcp-design.md`

## Global Constraints

- 既存 HTTP API の追加・変更なし
- ツール入力に item 内部 `id` を取らない（公開 `number` / 列名）
- HTTP 非 2xx・ネットワーク失敗・JSON 不正 → `{ isError: true }`。失敗文は `HTTP <status>` または `network_error` / `invalid_json` / `identity_mismatch` / `column_not_found` / `no_patch_fields` 等の固定短文のみ。生ボディ・`error.message`・認証情報を出さない（L-001 / L-017 / L-031）
- `update_item` は get の `number`（と指定時 `projectId`）照合後にその `id` で PATCH（L-018）
- 受け入れは認証なしローカル。`SCRUM_BOARD_AUTH_*` は任意ヘッダのみ
- `/feature` のためコミットしない
- 関連知見: L-001, L-017, L-031, L-018, L-035

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `mcp/package.json` | パッケージ・scripts・依存 |
| `mcp/tsconfig.json` | strict TS |
| `mcp/src/config.ts` | BASE_URL / Auth 環境変数 |
| `mcp/src/http.ts` | fetch ラッパ・失敗→固定 reason |
| `mcp/src/tools.ts` | 8 ツールの登録とハンドラ |
| `mcp/src/index.ts` | McpServer + stdio 起動 |
| `mcp/src/config.test.ts` 等 | ユニット（HTTP mock） |
| `mcp/README.md` | 設定例・ツール・不足 API |
| カード #8 description | 不足 API 節追記（API PATCH、リポ外） |

---

### Task 1: パッケージ骨格と config

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/src/config.ts`
- Create: `mcp/src/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(): { baseUrl: string; authHeader: string | null }`
  - `SCRUM_BOARD_BASE_URL` 未設定 → `http://127.0.0.1:4200`
  - trailing slash 除去
  - user+password 両方あるときだけ `Basic …`、片方だけなら `authHeader: null`（警告ログは stderr 可、秘密は出さない）

- [x] **Step 1: `mcp/package.json` を作成**

```json
{
  "name": "scrum-board-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "scrum-board-mcp": "./dist/index.js" },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "engines": { "node": ">=18" },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [x] **Step 2: `mcp/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "esModuleInterop": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [x] **Step 3: 失敗するテストを書く**

```ts
// mcp/src/config.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const keys = ['SCRUM_BOARD_BASE_URL', 'SCRUM_BOARD_AUTH_USER', 'SCRUM_BOARD_AUTH_PASSWORD'] as const;

afterEach(() => {
  for (const k of keys) delete process.env[k];
});

describe('loadConfig', () => {
  it('defaults baseUrl and strips trailing slash', () => {
    process.env.SCRUM_BOARD_BASE_URL = 'http://example.test/board/';
    expect(loadConfig().baseUrl).toBe('http://example.test/board');
  });

  it('builds Basic auth only when both user and password are set', () => {
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    process.env.SCRUM_BOARD_AUTH_PASSWORD = 'p';
    const h = loadConfig().authHeader;
    expect(h).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });

  it('omits auth when only user is set', () => {
    process.env.SCRUM_BOARD_AUTH_USER = 'u';
    expect(loadConfig().authHeader).toBeNull();
  });
});
```

- [x] **Step 4: 実装 `mcp/src/config.ts`**

```ts
export type Config = { baseUrl: string; authHeader: string | null };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const raw = env.SCRUM_BOARD_BASE_URL?.trim() || 'http://127.0.0.1:4200';
  const baseUrl = raw.replace(/\/+$/, '');
  const user = env.SCRUM_BOARD_AUTH_USER;
  const pass = env.SCRUM_BOARD_AUTH_PASSWORD;
  const authHeader =
    user !== undefined && user !== '' && pass !== undefined && pass !== ''
      ? `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
      : null;
  return { baseUrl, authHeader };
}
```

- [x] **Step 5: `cd mcp && npm install && npm test` → PASS**

- [x] **Step 6: コミットしない**

---

### Task 2: HTTP クライアント

**Files:**
- Create: `mcp/src/http.ts`
- Create: `mcp/src/http.test.ts`

**Interfaces:**
- Produces:
  - `type ApiOk<T> = { ok: true; status: number; data: T }`
  - `type ApiErr = { ok: false; status: number | null; reason: string }`
  - `createHttpClient(config: Config): { request<T>(method, path, body?: unknown): Promise<ApiOk<T> | ApiErr> }`
  - path は `/api/...` から。query は呼び出し側で path に含める
  - 非 2xx → `{ ok: false, status, reason: \`HTTP ${status}\` }`（ボディ読まない／読んでも破棄）
  - fetch throw → `{ ok: false, status: null, reason: 'network_error' }`
  - JSON パース失敗 → `{ ok: false, status, reason: 'invalid_json' }`
  - Authorization ヘッダは config.authHeader があるときだけ

- [x] **Step 1: 失敗するテスト（mock fetch）**

```ts
// mcp/src/http.test.ts
import { describe, expect, it, vi, afterEach } from 'vitest';
import { createHttpClient } from './http.js';

afterEach(() => vi.unstubAllGlobals());

describe('createHttpClient', () => {
  it('returns data on 2xx JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } }),
    ));
    const client = createHttpClient({ baseUrl: 'http://x', authHeader: null });
    const res = await client.request<{ id: number }>('GET', '/api/projects');
    expect(res).toEqual({ ok: true, status: 200, data: { id: 1 } });
  });

  it('maps non-2xx to fixed reason without body text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('secret-token-in-body', { status: 401 }),
    ));
    const res = await createHttpClient({ baseUrl: 'http://x', authHeader: null })
      .request('GET', '/api/board');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('HTTP 401');
      expect(JSON.stringify(res)).not.toContain('secret');
    }
  });

  it('maps network failure to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED secret'); }));
    const res = await createHttpClient({ baseUrl: 'http://x', authHeader: null })
      .request('GET', '/api/board');
    expect(res).toEqual({ ok: false, status: null, reason: 'network_error' });
  });

  it('maps 2xx non-JSON to invalid_json', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('not-json', { status: 200, headers: { 'content-type': 'text/plain' } }),
    ));
    const res = await createHttpClient({ baseUrl: 'http://x', authHeader: null })
      .request('GET', '/api/board');
    expect(res).toEqual({ ok: false, status: 200, reason: 'invalid_json' });
  });

  it('sends Authorization when configured', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await createHttpClient({ baseUrl: 'http://x', authHeader: 'Basic abc' })
      .request('GET', '/api/board');
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Basic abc');
  });
});
```

- [x] **Step 2: `mcp/src/http.ts` を実装して `npm test` PASS**

- [x] **Step 3: コミットしない**

---

### Task 3: ツール登録（読み取り・プロジェクト・ステータス・担当）

**Files:**
- Create: `mcp/src/tools.ts`
- Create: `mcp/src/tools.test.ts`
- Create: `mcp/src/index.ts`（スタブでも可、Task 4 で完成）

**Interfaces:**
- Consumes: `createHttpClient`, `loadConfig`
- Produces:
  - `createToolHandlers(client): { list_projects, get_board, set_active_project, get_item, update_status, update_assignee, create_item, update_item }`（各 handler は Task4 で揃える。Task3 時点では create/update_item は未実装スタブでもよいが、export 名は固定）
  - `registerTools(server, client): void` — 内部で `createToolHandlers` を呼び `server.tool` / `registerTool` に載せる
- ツール結果ヘルパ:
  - `okText(data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] })`
  - `errText(reason) => ({ content: [{ type: 'text', text: reason }], isError: true })`
- 登録するツール（この Task）: `list_projects`, `get_board`, `set_active_project`, `get_item`, `update_status`, `update_assignee`
- Zod 入力は設計書どおり。`projectId` 任意のときは query `?projectId=` を付与
- `update_status` body: `{ status: string }`（API 準拠）
- `update_assignee` body: `{ assignee: string }`
- `set_active_project` body: `{ activeProjectId: number }`

- [x] **Step 1: tools.test.ts で list_projects / get_item / update_status の成功と HTTP 失敗→isError を書く**

`createToolHandlers(client)` が Record を返し、`registerTools` はそれを MCP に載せる（テストは handlers を直接呼ぶ）。

```ts
// 例: get_item 失敗
const client = { request: vi.fn(async () => ({ ok: false, status: 404, reason: 'HTTP 404' })) };
const handlers = createToolHandlers(client as never);
const result = await handlers.get_item({ number: 8 });
expect(result.isError).toBe(true);
expect(result.content[0]).toMatchObject({ type: 'text', text: 'HTTP 404' });

// L-035: 成功時は by-number パス（item 内部 id パスを使わない）
it('get_item uses by-number path', async () => {
  const client = {
    request: vi.fn(async () => ({ ok: true, status: 200, data: { id: 23, number: 8, projectId: 1 } })),
  };
  await createToolHandlers(client as never).get_item({ number: 8, projectId: 1 });
  expect(client.request).toHaveBeenCalledWith('GET', '/api/items/by-number/8?projectId=1');
});

it('update_status uses by-number status path', async () => {
  const client = {
    request: vi.fn(async () => ({ ok: true, status: 200, data: { number: 8 } })),
  };
  await createToolHandlers(client as never).update_status({ number: 8, status: 'Doing' });
  expect(client.request).toHaveBeenCalledWith(
    'PATCH',
    '/api/items/by-number/8/status',
    { status: 'Doing' },
  );
});
```

- [x] **Step 2: 実装して `npm test` PASS**

- [x] **Step 3: コミットしない**

---

### Task 4: create_item / update_item と stdio 起動

**Files:**
- Modify: `mcp/src/tools.ts`
- Modify: `mcp/src/tools.test.ts`
- Modify: `mcp/src/index.ts`

**Interfaces:**
- `create_item({ title, description, column, projectId?, assignee? })`
  1. `GET /api/board` → `columns` から `name === column`（大文字小文字は API の列名と完全一致）を探す。無ければ `errText('column_not_found')`
  2. `POST /api/items` body: `{ title, description, columnId, projectId?, assignee? }`
- `update_item({ number, projectId?, title?, description?, dueAt?, closeReason?, prUrls? })`
  - Zod: `number` 必須。パッチ用に `title`/`description`/`dueAt`（`z.union([z.string(), z.null()])`）/`closeReason`/`prUrls` を任意。**`projectId` は lookup のみ（PATCH に載せない）。パッチキーが 1 つも無い**（`projectId` だけでは不可）→ `errText('no_patch_fields')`
  - 手順: GET by-number → 正の `id`・`number`（と指定時 `projectId`）照合 → `PATCH /api/items/${id}` → 応答の `id` と `number` 再照合。所属変更は MCP MVP 外。

- [x] **Step 1: create_item / update_item のテスト（column 解決、get/PATCH identity_mismatch、no_patch_fields、dueAt null クリア、成功 PATCH）を追加**

```ts
it('update_item refuses patch when get number mismatches', async () => {
  const client = {
    request: vi.fn(async () => ({ ok: true, status: 200, data: { id: 99, number: 7, projectId: 1 } })),
  };
  const handlers = createToolHandlers(client as never);
  const result = await handlers.update_item({ number: 8, title: 'x' });
  expect(result.isError).toBe(true);
  expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
  expect(client.request).toHaveBeenCalledTimes(1); // no PATCH
});

it('update_item refuses when PATCH response number mismatches', async () => {
  const client = {
    request: vi.fn(async (method: string) => {
      if (method === 'GET') return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
      return { ok: true, status: 200, data: { id: 99, number: 9, projectId: 1 } };
    }),
  };
  const handlers = createToolHandlers(client as never);
  const result = await handlers.update_item({ number: 8, title: 'x' });
  expect(result.isError).toBe(true);
  expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
});

it('update_item sends dueAt null for clear', async () => {
  const client = {
    request: vi.fn(async (method: string) => {
      if (method === 'GET') return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1 } };
      return { ok: true, status: 200, data: { id: 99, number: 8, projectId: 1, dueAt: null } };
    }),
  };
  const handlers = createToolHandlers(client as never);
  await handlers.update_item({ number: 8, dueAt: null });
  expect(client.request).toHaveBeenCalledWith('PATCH', '/api/items/99', { dueAt: null });
});

it('update_item identity_mismatch when get projectId differs', async () => {
  const client = {
    request: vi.fn(async () => ({ ok: true, status: 200, data: { id: 99, number: 8, projectId: 2 } })),
  };
  const result = await createToolHandlers(client as never).update_item({
    number: 8,
    projectId: 1,
    title: 'x',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]).toMatchObject({ text: 'identity_mismatch' });
  expect(client.request).toHaveBeenCalledTimes(1);
});
```

- [x] **Step 2: 実装 + `index.ts`**

```ts
#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { createHttpClient } from './http.js';
import { registerTools } from './tools.js';

const config = loadConfig();
const client = createHttpClient(config);
const server = new McpServer({ name: 'scrum-board-mcp', version: '0.1.0' });
registerTools(server, client);
const transport = new StdioServerTransport();
await server.connect(transport);
```

- [x] **Step 3: `npm test` と `npm run build` が通ることを確認**

- [x] **Step 4: コミットしない**

---

### Task 5: README とカード #8 の不足 API 追記

**Files:**
- Create: `mcp/README.md`
- Modify: カード #8 description（HTTP API 経由。リポジトリ外）

- [x] **Step 1: `mcp/README.md` に次を含める**
  - 必要: Node 18+、動いているボード（例 `http://127.0.0.1:4200`）
  - `cd mcp && npm install && npm run build`
  - 環境変数表: `SCRUM_BOARD_BASE_URL`, `SCRUM_BOARD_AUTH_USER`, `SCRUM_BOARD_AUTH_PASSWORD`
  - Claude Code / Codex の `mcpServers` JSON 例（`command`: `node`, `args`: [`<repo>/mcp/dist/index.js`]）
  - ツール一覧（設計書の 8 個と引数の要約）
  - **不足 API** 節（設計書と同文）

- [x] **Step 2: カード #8 の description 末尾に不足 API を追記**

既存 description を `GET /api/items/by-number/8?projectId=1` で取得し、末尾に次を追加して内部 id で `PATCH /api/items/{id}`（MCP の update_item 相当、または curl）。**API エンドポイント自体は追加しない。**

```markdown
## 不足 API
1. PATCH /api/items/by-number/{number} の汎用部分更新が無い — タイトル・説明・dueAt・closeReason・projectId・prUrls 等は内部 id の PATCH /api/items/{id} が必要。MCP は get→number 照合→id→PATCH で回避。
```

本番 Basic Auth が必要なら環境の認証を使う。失敗したら停止して報告。

- [x] **Step 3: コミットしない**

---

## Spec coverage（自己確認）

| 要件 | Task |
|------|------|
| stdio MCP・`mcp/`・TS SDK | 1, 4 |
| 8 ツール | 3, 4 |
| 環境変数・任意 Basic Auth | 1, 2 |
| 失敗は isError・秘密なし | 2, 3, 4 |
| create は列名解決 | 4 |
| update_item L-018 照合（number / projectId・PATCH 応答） | 4 |
| L-035 by-number パス固定（get_item / update_status） | 3 |
| API 追加なし・不足はカード/README | 5 |
| ユニットテスト mock | 1–4 |

## 実行メモ

- `/feature` のためユーザー確認なしで **subagent-driven-development** 推奨経路で実装する（コミットステップはスキップ）。
