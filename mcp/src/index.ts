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
