# MCP 平文 HTTP + Basic 拒否 Implementation Plan

**Goal:** 資格情報付き MCP が平文 HTTP の非ループバックへ接続しない。

**Spec:** `docs/superpowers/specs/2026-11-23-mcp-plaintext-basic-design.md`

## Global Constraints

- `/feature` 中はコミットしない
- 変更は `mcp/src/config.ts`・`config.test.ts`・`mcp/README.md` と設計ドキュメント

### Task 1: `loadConfig` ガード

- [x] `isLoopbackHostname` を追加し、`http:` + auth 予定 + 非ループバックで `insecure_auth_transport`

### Task 2: テスト

- [x] 拒否・許可ケース 3 本を `config.test.ts` に追加

### Task 3: README

- [x] http+Basic 制約と nginx Basic（`AUTH_*`）とアプリログインの区別を追記

### Task 4: 検証

- [x] `cd mcp && npm test`