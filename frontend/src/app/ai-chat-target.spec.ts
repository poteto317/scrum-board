import { describe, expect, it } from 'vitest';
import {
  detailChatAction,
  isAiChatRoute,
  isSameItem,
  isUnchangedItem,
  resolveChatProjectId,
  toFocusItem,
  type AiChatFocusItem,
} from './ai-chat-target';

const t = (n: number, partial: Partial<AiChatFocusItem> = {}): AiChatFocusItem => ({
  number: n,
  itemId: n * 10,
  title: `T${n}`,
  canEdit: true,
  ...partial,
});

describe('ai-chat-target', () => {
  it('detects board backlog and item detail routes', () => {
    expect(isAiChatRoute('/')).toBe(true);
    expect(isAiChatRoute('/?project=1')).toBe(true);
    expect(isAiChatRoute('/backlog')).toBe(true);
    expect(isAiChatRoute('/items/12')).toBe(true);
    expect(isAiChatRoute('/items/12/solution')).toBe(false);
    expect(isAiChatRoute('/settings')).toBe(false);
    expect(isAiChatRoute('/sprints')).toBe(false);
  });

  it('isUnchangedItem compares the content too: number itemId title canEdit', () => {
    expect(isUnchangedItem(t(1), t(1))).toBe(true);
    expect(isUnchangedItem(t(1), t(1, { itemId: 99 }))).toBe(false);
    expect(isUnchangedItem(t(1), t(2, { itemId: 10 }))).toBe(false);
    expect(isUnchangedItem(t(1), t(1, { title: 'renamed' }))).toBe(false);
    expect(isUnchangedItem(t(1), t(1, { canEdit: false }))).toBe(false);
    expect(isUnchangedItem(null, null)).toBe(true);
    expect(isUnchangedItem(t(1), null)).toBe(false);
  });

  it('uses the active project on board and backlog', () => {
    expect(
      resolveChatProjectId({ pageKind: 'board', detailProjectId: null, activeProjectId: 4 }),
    ).toBe(4);
    expect(
      resolveChatProjectId({ pageKind: 'backlog', detailProjectId: null, activeProjectId: 4 }),
    ).toBe(4);
  });

  it('uses the item project on detail, not the active project', () => {
    expect(
      resolveChatProjectId({ pageKind: 'detail', detailProjectId: 7, activeProjectId: 4 }),
    ).toBe(7);
    expect(
      resolveChatProjectId({ pageKind: 'detail', detailProjectId: null, activeProjectId: 4 }),
    ).toBeNull();
  });

  it('does not use the detail project on other pages', () => {
    expect(
      resolveChatProjectId({ pageKind: 'board', detailProjectId: 7, activeProjectId: 4 }),
    ).toBe(4);
    expect(
      resolveChatProjectId({ pageKind: 'other', detailProjectId: 7, activeProjectId: 4 }),
    ).toBeNull();
  });

  it('has no project when it is not decided', () => {
    expect(
      resolveChatProjectId({ pageKind: 'board', detailProjectId: null, activeProjectId: null }),
    ).toBeNull();
    expect(
      resolveChatProjectId({ pageKind: 'board', detailProjectId: null, activeProjectId: 0 }),
    ).toBeNull();
    expect(
      resolveChatProjectId({ pageKind: 'detail', detailProjectId: 0, activeProjectId: 4 }),
    ).toBeNull();
    expect(
      resolveChatProjectId({ pageKind: 'other', detailProjectId: null, activeProjectId: 4 }),
    ).toBeNull();
  });

  it('gives a focus item only on detail', () => {
    expect(toFocusItem('detail', t(3, { canEdit: false }))).toEqual({
      number: 3,
      itemId: 30,
      title: 'T3',
      canEdit: false,
    });
    expect(toFocusItem('detail', null)).toBeNull();
    expect(toFocusItem('board', t(3))).toBeNull();
    expect(toFocusItem('backlog', t(3))).toBeNull();
  });

  it('isSameItem compares the identity only (number and itemId)', () => {
    const a = { number: 3, itemId: 30, title: 'A', canEdit: true };
    expect(isSameItem(a, { ...a, title: 'B', canEdit: false })).toBe(true);
    expect(isSameItem(a, { ...a, number: 4 })).toBe(false);
    expect(isSameItem(a, { ...a, itemId: 31 })).toBe(false);
    expect(isSameItem(a, null)).toBe(false);
    expect(isSameItem(null, null)).toBe(true);
  });

  describe('detailChatAction', () => {
    const noItem = {
      hasItem: false as const,
      pageKind: 'detail' as const,
      routeNumber: 3,
      focusNumber: 3 as number | null,
      loading: false,
    };

    it('set: the item is loaded', () => {
      expect(detailChatAction({ hasItem: true })).toBe('set');
    });

    it('keep: the chat is not on a detail page', () => {
      for (const pageKind of ['board', 'backlog', 'other'] as const) {
        expect(detailChatAction({ ...noItem, pageKind, routeNumber: 4, loading: true })).toBe(
          'keep',
        );
        expect(detailChatAction({ ...noItem, pageKind, focusNumber: null })).toBe('keep');
      }
    });

    it('keep: the same number is reloading, or the route has no number', () => {
      expect(detailChatAction({ ...noItem, loading: true })).toBe('keep');
      expect(detailChatAction({ ...noItem, loading: false })).toBe('keep');
      expect(detailChatAction({ ...noItem, routeNumber: 0 })).toBe('keep');
      expect(detailChatAction({ ...noItem, routeNumber: Number.NaN })).toBe('keep');
    });

    it('keep: nothing is told yet and the next item is still loading', () => {
      expect(detailChatAction({ ...noItem, focusNumber: null, loading: true })).toBe('keep');
    });

    it('release: moved to another item that is loading', () => {
      expect(detailChatAction({ ...noItem, routeNumber: 4, loading: true })).toBe('release');
    });

    it('clear: moved to another item that is not loading', () => {
      expect(detailChatAction({ ...noItem, routeNumber: 4, loading: false })).toBe('clear');
    });

    it('clear: the next item ended without loading', () => {
      expect(detailChatAction({ ...noItem, focusNumber: null, loading: false })).toBe('clear');
    });
  });
});
