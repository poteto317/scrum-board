import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HttpClient } from './http.js';
import {
  collectUpdatePatch,
  patchedItemMatches,
  resolveColumnIdFromBoard,
  resolvedItemId,
  type UpdateItemArgs,
} from './item-helpers.js';

export type ToolResult = {
  content: [{ type: 'text'; text: string }];
  isError?: true;
};

export function okText(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

export function errText(reason: string): ToolResult {
  return { content: [{ type: 'text', text: reason }], isError: true };
}

function withProjectQuery(path: string, projectId?: number): string {
  return projectId !== undefined ? `${path}?projectId=${projectId}` : path;
}

const positiveInt = z.number().int().positive();

export function createToolHandlers(client: HttpClient) {

  return {
    async list_projects(): Promise<ToolResult> {
      const res = await client.request('GET', '/api/projects');
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async get_board(): Promise<ToolResult> {
      const res = await client.request('GET', '/api/board');
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async set_active_project(args: { activeProjectId: number }): Promise<ToolResult> {
      const res = await client.request('PATCH', '/api/board/settings', {
        activeProjectId: args.activeProjectId,
      });
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async get_item(args: { number: number; projectId?: number }): Promise<ToolResult> {
      const path = withProjectQuery(`/api/items/by-number/${args.number}`, args.projectId);
      const res = await client.request('GET', path);
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async update_status(args: {
      number: number;
      status: string;
      projectId?: number;
    }): Promise<ToolResult> {
      const path = withProjectQuery(
        `/api/items/by-number/${args.number}/status`,
        args.projectId,
      );
      const res = await client.request('PATCH', path, { status: args.status });
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async update_assignee(args: {
      number: number;
      assignee: string;
      projectId?: number;
    }): Promise<ToolResult> {
      const path = withProjectQuery(
        `/api/items/by-number/${args.number}/assignee`,
        args.projectId,
      );
      const res = await client.request('PATCH', path, { assignee: args.assignee });
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async create_item(args: {
      title: string;
      description: string;
      column: string;
      projectId?: number;
      assignee?: string;
    }): Promise<ToolResult> {
      const board = await client.request<unknown>('GET', '/api/board');
      if (!board.ok) return errText(board.reason);

      const columnId = resolveColumnIdFromBoard(board.data, args.column);
      if (columnId === null) return errText('column_not_found');

      const body: Record<string, unknown> = {
        title: args.title,
        description: args.description,
        columnId,
      };
      if (args.projectId !== undefined) body.projectId = args.projectId;
      if (args.assignee !== undefined) body.assignee = args.assignee;

      const res = await client.request('POST', '/api/items', body);
      if (!res.ok) return errText(res.reason);
      return okText(res.data);
    },

    async update_item(args: UpdateItemArgs): Promise<ToolResult> {
      const patch = collectUpdatePatch(args);
      if (!patch) return errText('no_patch_fields');

      const getPath = withProjectQuery(
        `/api/items/by-number/${args.number}`,
        args.projectId,
      );
      const got = await client.request<{ id: number; number: number; projectId: number }>(
        'GET',
        getPath,
      );
      if (!got.ok) return errText(got.reason);

      const id = resolvedItemId(got.data, args.number, args.projectId);
      if (id === null) return errText('identity_mismatch');

      const patched = await client.request<{ id: number; number: number; projectId: number }>(
        'PATCH',
        `/api/items/${id}`,
        patch,
      );
      if (!patched.ok) return errText(patched.reason);

      if (!patchedItemMatches(patched.data, id, args.number)) {
        return errText('identity_mismatch');
      }

      return okText(patched.data);
    },
  };
}

export type ToolHandlers = ReturnType<typeof createToolHandlers>;

export async function safeTool(run: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await run();
  } catch {
    return errText('internal_error');
  }
}

export function registerTools(server: McpServer, client: HttpClient): void {
  const handlers = createToolHandlers(client);

  server.registerTool(
    'list_projects',
    { description: 'List board projects' },
    async () => safeTool(() => handlers.list_projects()),
  );

  server.registerTool(
    'get_board',
    {
      description:
        'Get board columns, items, and settings for the active project. Item descriptions are truncated to the first 500 characters and solutions are omitted; use get_item for the full text',
    },
    async () => safeTool(() => handlers.get_board()),
  );

  server.registerTool(
    'set_active_project',
    {
      description: 'Set the active project',
      inputSchema: { activeProjectId: positiveInt },
    },
    async (args) => safeTool(() => handlers.set_active_project(args)),
  );

  server.registerTool(
    'get_item',
    {
      description: 'Get an item by public task number',
      inputSchema: {
        number: positiveInt,
        projectId: positiveInt.optional(),
      },
    },
    async (args) => safeTool(() => handlers.get_item(args)),
  );

  server.registerTool(
    'update_status',
    {
      description: 'Move an item to a column by status name',
      inputSchema: {
        number: positiveInt,
        status: z.string(),
        projectId: positiveInt.optional(),
      },
    },
    async (args) => safeTool(() => handlers.update_status(args)),
  );

  server.registerTool(
    'update_assignee',
    {
      description: 'Set or clear an item assignee',
      inputSchema: {
        number: positiveInt,
        assignee: z.string(),
        projectId: positiveInt.optional(),
      },
    },
    async (args) => safeTool(() => handlers.update_assignee(args)),
  );

  server.registerTool(
    'create_item',
    {
      description: 'Create a board item by column name',
      inputSchema: {
        title: z.string(),
        description: z.string(),
        column: z.string(),
        projectId: positiveInt.optional(),
        assignee: z.string().optional(),
      },
    },
    async (args) => safeTool(() => handlers.create_item(args)),
  );

  server.registerTool(
    'update_item',
    {
      description:
        'Partially update an item by public number (projectId is lookup only; not a project move)',
      inputSchema: {
        number: positiveInt,
        projectId: positiveInt.optional(),
        title: z.string().optional(),
        description: z.string().optional(),
        dueAt: z.union([z.string(), z.null()]).optional(),
        closeReason: z.string().optional(),
        prUrls: z.array(z.string()).optional(),
      },
    },
    async (args) => safeTool(() => handlers.update_item(args)),
  );
}
