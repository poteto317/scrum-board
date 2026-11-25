import { describe, expect, it } from 'vitest';
import {
  catalogIdsForPageKind,
  catalogLabel,
  emptyWorkspaceHeaderMenu,
  resolvePageKind,
  visibleMenuItemIds,
} from './header-menu';
import { favoriteMenuLabel } from './item-menu-actions';

describe('header-menu pure helpers', () => {
  it('resolves pageKind from url', () => {
    expect(resolvePageKind('/')).toBe('board');
    expect(resolvePageKind('/backlog')).toBe('backlog');
    expect(resolvePageKind('/trash')).toBe('board');
    expect(resolvePageKind('/archive')).toBe('board');
    expect(resolvePageKind('/users')).toBe('board');
    expect(resolvePageKind('/projects')).toBe('board');
    expect(resolvePageKind('/recurring')).toBe('board');
    expect(resolvePageKind('/settings')).toBe('board');
    expect(resolvePageKind('/login')).toBeNull();
    expect(resolvePageKind('/items/12')).toBe('itemDetail');
    expect(resolvePageKind('/items/12/solution')).toBe('itemDetail');
    expect(resolvePageKind('/items/12/solution?project=1')).toBe('itemDetail');
    expect(resolvePageKind('/unknown')).toBeNull();
    expect(resolvePageKind('/items/foo')).toBeNull();
  });

  it('secondary routes share board catalog visibility (L-060)', () => {
    const boardIds = catalogIdsForPageKind('board');
    const hiddenPrefs = { hiddenIds: ['open_projects'] };
    for (const url of [
      '/trash',
      '/archive',
      '/users',
      '/projects',
      '/recurring',
      '/settings',
    ]) {
      const kind = resolvePageKind(url);
      expect(kind).toBe('board');
      expect(visibleMenuItemIds(kind!, { hiddenIds: [] })).toEqual(boardIds);
      expect(visibleMenuItemIds(kind!, hiddenPrefs)).toEqual(
        boardIds.filter((id) => id !== 'open_projects'),
      );
    }
    expect(resolvePageKind('/login')).toBeNull();
  });

  it('lists catalog ids per pageKind without cross-kind leakage', () => {
    expect(catalogIdsForPageKind('board')).toEqual([
      'open_projects',
      'open_trash',
      'open_archive',
      'open_users',
      'open_recurring',
      'open_settings',
    ]);
    expect(catalogIdsForPageKind('itemDetail')).toEqual([
      'open_projects',
      'open_trash',
      'open_archive',
      'open_users',
      'open_recurring',
      'open_settings',
      'item_history',
      'item_solution',
      'item_favorite',
    ]);
  });

  it('computes visible items as catalog minus hidden', () => {
    const prefs = { hiddenIds: ['open_trash', 'item_history'] };
    expect(visibleMenuItemIds('board', prefs)).toEqual([
      'open_projects',
      'open_archive',
      'open_users',
      'open_recurring',
      'open_settings',
    ]);
    expect(visibleMenuItemIds('itemDetail', prefs)).toEqual([
      'open_projects',
      'open_archive',
      'open_users',
      'open_recurring',
      'open_settings',
      'item_solution',
      'item_favorite',
    ]);
  });

  it('empty workspace has no hidden ids', () => {
    const empty = emptyWorkspaceHeaderMenu();
    expect(visibleMenuItemIds('board', empty.board)).toHaveLength(6);
    expect(visibleMenuItemIds('itemDetail', empty.itemDetail)).toHaveLength(9);
  });

  it('builds catalog and favorite labels', () => {
    expect(catalogLabel('open_projects', 'board')).toBe('プロジェクト');
    expect(
      catalogLabel('item_favorite', 'itemDetail', { favoriteDynamic: 'お気に入りから外す' }),
    ).toBe('お気に入りから外す');
    expect(favoriteMenuLabel(true)).toBe('お気に入りから外す');
    expect(favoriteMenuLabel(false)).toBe('お気に入りに追加');
    expect(favoriteMenuLabel(undefined)).toBe('お気に入り');
  });
});
