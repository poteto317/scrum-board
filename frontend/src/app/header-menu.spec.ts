import { describe, expect, it } from 'vitest';
import {
  catalogIdsForPageKind,
  catalogLabel,
  emptyWorkspaceHeaderMenu,
  projectMenuActionDisabled,
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
    expect(resolvePageKind('/recurring')).toBeNull();
    expect(resolvePageKind('/items/12')).toBe('itemDetail');
    expect(resolvePageKind('/items/12/solution')).toBe('itemDetail');
    expect(resolvePageKind('/items/12/solution?project=1')).toBe('itemDetail');
    expect(resolvePageKind('/unknown')).toBeNull();
    expect(resolvePageKind('/items/foo')).toBeNull();
  });

  it('lists catalog ids per pageKind without cross-kind leakage', () => {
    expect(catalogIdsForPageKind('board')).toEqual([
      'project_add',
      'project_rename',
      'project_delete',
      'open_trash',
      'open_users',
      'open_recurring',
    ]);
    expect(catalogIdsForPageKind('itemDetail')).toEqual([
      'open_trash',
      'open_users',
      'open_recurring',
      'item_history',
      'item_solution',
      'item_favorite',
    ]);
  });

  it('computes visible items as catalog minus hidden', () => {
    const prefs = { hiddenIds: ['project_delete', 'item_history'] };
    expect(visibleMenuItemIds('board', prefs)).toEqual([
      'project_add',
      'project_rename',
      'open_trash',
      'open_users',
      'open_recurring',
    ]);
    expect(visibleMenuItemIds('itemDetail', prefs)).toEqual([
      'open_trash',
      'open_users',
      'open_recurring',
      'item_solution',
      'item_favorite',
    ]);
  });

  it('empty workspace has no hidden ids', () => {
    const empty = emptyWorkspaceHeaderMenu();
    expect(visibleMenuItemIds('board', empty.board)).toHaveLength(6);
    expect(visibleMenuItemIds('itemDetail', empty.itemDetail)).toHaveLength(6);
  });

  it('disables project menu actions with the same rules as the old header buttons', () => {
    const base = {
      switching: false,
      mutating: false,
      saving: false,
      modalOpen: false,
      canRename: true,
      canDelete: true,
    };
    expect(projectMenuActionDisabled('project_add', { ...base, modalOpen: true })).toBe(true);
    expect(projectMenuActionDisabled('project_rename', { ...base, canRename: false })).toBe(true);
    expect(projectMenuActionDisabled('project_delete', { ...base, canDelete: false })).toBe(true);
    expect(projectMenuActionDisabled('project_add', base)).toBe(false);
  });

  it('builds catalog and favorite labels', () => {
    expect(catalogLabel('project_add', 'board')).toBe('プロジェクトを追加');
    expect(
      catalogLabel('item_favorite', 'itemDetail', { favoriteDynamic: 'お気に入りから外す' }),
    ).toBe('お気に入りから外す');
    expect(favoriteMenuLabel(true)).toBe('お気に入りから外す');
    expect(favoriteMenuLabel(false)).toBe('お気に入りに追加');
    expect(favoriteMenuLabel(undefined)).toBe('お気に入り');
  });
});
