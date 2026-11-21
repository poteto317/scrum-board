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
    expect(resolvePageKind('/trash')).toBeNull();
    expect(resolvePageKind('/users')).toBeNull();
    expect(resolvePageKind('/projects')).toBeNull();
    expect(resolvePageKind('/recurring')).toBeNull();
    expect(resolvePageKind('/settings')).toBeNull();
    expect(resolvePageKind('/items/12')).toBe('itemDetail');
    expect(resolvePageKind('/items/12/solution')).toBe('itemDetail');
    expect(resolvePageKind('/items/12/solution?project=1')).toBe('itemDetail');
    expect(resolvePageKind('/unknown')).toBeNull();
    expect(resolvePageKind('/items/foo')).toBeNull();
  });

  it('lists catalog ids per pageKind without cross-kind leakage', () => {
    expect(catalogIdsForPageKind('board')).toEqual([
      'open_projects',
      'open_trash',
      'open_users',
      'open_recurring',
      'open_settings',
    ]);
    expect(catalogIdsForPageKind('itemDetail')).toEqual([
      'open_projects',
      'open_trash',
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
      'open_users',
      'open_recurring',
      'open_settings',
    ]);
    expect(visibleMenuItemIds('itemDetail', prefs)).toEqual([
      'open_projects',
      'open_users',
      'open_recurring',
      'open_settings',
      'item_solution',
      'item_favorite',
    ]);
  });

  it('empty workspace has no hidden ids', () => {
    const empty = emptyWorkspaceHeaderMenu();
    expect(visibleMenuItemIds('board', empty.board)).toHaveLength(5);
    expect(visibleMenuItemIds('itemDetail', empty.itemDetail)).toHaveLength(8);
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
