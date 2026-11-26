import { describe, expect, it } from 'vitest';
import type { ProjectAIMessage, ProjectAIProposal } from './api';
import type { Item } from './models';
import {
  applyLabel,
  checkBlockReason,
  createdSuffix,
  createdUnrecordedMessage,
  diffBase,
  dismissLabel,
  loadFailureMessage,
  proposalBlockReason,
  proposalCopy,
  proposalHeading,
  proposalItemRequest,
  proposalPrecheck,
  replaceProposal,
} from './project-ai-proposal-rules';

const base = { id: 1, messageId: 2, state: 'pending', createdAt: '', updatedAt: '' } as const;
const status: ProjectAIProposal = { ...base, kind: 'status_change', itemNumber: 7, itemTitle: 'ログイン', columnId: 2, columnName: 'Doing' };
const edit: ProjectAIProposal = { ...base, kind: 'description_edit', itemNumber: 7, itemTitle: 'ログイン', description: '新', baseDescription: '' };
const create: ProjectAIProposal = { ...base, kind: 'item_create', title: '作る', columnId: 1, columnName: 'Todo', description: '' };
const item = (over: Partial<Item> = {}) => ({ id: 70, number: 7, description: '', canEdit: true, ...over }) as Item;

describe('project-ai-proposal-rules', () => {
  it('names the target in headings and button labels', () => {
    expect(proposalHeading(status)).toBe('ステータスの変更: #7 ログイン → Doing');
    expect(proposalHeading(edit)).toBe('説明の編集: #7 ログイン');
    expect(proposalHeading(create)).toBe('アイテムの作成（Todo）: 作る');
    expect(applyLabel(edit)).toBe('#7 の説明の編集を適用');
    expect(dismissLabel(status)).toBe('#7 のステータスの変更を破棄');
    expect(applyLabel(create)).toBe('アイテム「作る」の作成を適用');
  });

  it('blocks items the user cannot edit, also when canEdit is left out', () => {
    expect(proposalBlockReason(status, item({ canEdit: false }))).toBe(proposalCopy.notEditable);
    expect(proposalBlockReason(status, item({ canEdit: undefined }))).toBe(proposalCopy.notEditable);
    expect(proposalBlockReason(status, item({ archivedAt: '2026-11-01T00:00:00Z' }))).toBe(proposalCopy.archived);
    expect(proposalBlockReason(status, item())).toBeNull();
    expect(proposalBlockReason(create, item({ canEdit: false }))).toBeNull();
  });

  it('calls a description edit stale when the description changed after the proposal', () => {
    expect(proposalPrecheck(edit, item({ description: '' }))).toEqual({ kind: 'apply' });
    expect(proposalPrecheck(edit, item({ description: null as unknown as string }))).toEqual({ kind: 'apply' });
    expect(proposalPrecheck(edit, item({ description: '別の人が書いた' }))).toEqual({ kind: 'stale', message: proposalCopy.stale });
    expect(proposalPrecheck(status, item({ description: '何でも' }))).toEqual({ kind: 'apply' });
  });

  it('separates not found from other load failures', () => {
    expect(loadFailureMessage({ status: 404 })).toBe(proposalCopy.notFound);
    expect(loadFailureMessage({ status: 500 })).toBe(proposalCopy.loadFailed);
  });

  it('uses the loaded description as the diff base, the proposal base before that', () => {
    const p = { ...edit, baseDescription: '提案のとき' };
    expect(diffBase(p, { kind: 'loading' })).toBe('提案のとき');
    expect(diffBase(p, { kind: 'loaded', item: item({ description: '今' }) })).toBe('今');
  });

  it('blocks on a failed load but not while loading', () => {
    expect(checkBlockReason(status, { kind: 'loading' })).toBeNull();
    expect(checkBlockReason(status, { kind: 'failed', message: 'x' })).toBe('x');
    expect(checkBlockReason(edit, { kind: 'loaded', item: item({ description: '変わった' }) })).toBe(proposalCopy.stale);
  });

  it('words the created result', () => {
    expect(`#12${createdSuffix}`).toBe('#12 を作成しました。');
    expect(createdUnrecordedMessage(12)).toBe('#12 を作成しました（結果の記録に失敗しました）。');
  });

  it('replaces the proposal of the same id only', () => {
    const msgs = [{ id: 2, proposals: [status, { ...create, id: 3 }] }, { id: 4 }] as ProjectAIMessage[];
    const out = replaceProposal(msgs, { ...status, state: 'applied' });
    expect(out[0].proposals!.map((p) => p.state)).toEqual(['applied', 'pending']);
    expect(out[1]).toBe(msgs[1]);
    expect(replaceProposal(msgs, { ...status, id: 99 })).toBe(msgs);
  });

  it('decides the item request from the proposal and the item read just before', () => {
    expect(proposalItemRequest(status, item({ id: 71 }), 1)).toEqual({ kind: 'update', itemId: 71, patch: { columnId: 2 } });
    expect(proposalItemRequest(edit, item({ id: 72 }), 1)).toEqual({ kind: 'update', itemId: 72, patch: { description: '新' } });
    expect(proposalItemRequest(create, null, 3)).toEqual({
      kind: 'create', input: { title: '作る', description: '', columnId: 1, projectId: 3 },
    });
    expect(proposalItemRequest(status, null, 1)).toBeNull();
    expect(proposalItemRequest({ ...create, columnId: undefined }, null, 1)).toBeNull();
  });
});

describe('conflictBody', () => {
  it('gives the body of a 409 only', async () => {
    const { conflictBody } = await import('./api-error');
    expect(conflictBody<{ proposal: number }>({ status: 409, error: { proposal: 1 } })).toEqual({ proposal: 1 });
    expect(conflictBody({ status: 500, error: { proposal: 1 } })).toBeNull();
    expect(conflictBody(null)).toBeNull();
  });
});
