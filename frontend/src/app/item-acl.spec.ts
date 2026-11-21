import { describe, expect, it } from 'vitest';
import { UserPublic } from './auth';
import { canEditItem, canManageItem, canViewItem } from './item-acl';
import { Item } from './models';

const base = {
  number: 1,
  id: 1,
  projectId: 1,
  columnId: 1,
  title: 't',
  description: '',
  solution: '',
  position: 0,
  backlogPosition: 0,
  offsetY: 0,
  prUrls: [],
  relatedItems: [],
  assignee: '',
  closeReason: '',
  favorite: false,
  dueAt: null,
  createdAt: '',
  updatedAt: '',
  viewAccess: 'open' as const,
  editAccess: 'open' as const,
  createdByUserId: 10,
};

const admin: UserPublic = {
  id: 1,
  loginName: 'a',
  displayName: 'a',
  role: 'admin',
  disabled: false,
};
const member: UserPublic = {
  id: 2,
  loginName: 'm',
  displayName: 'm',
  role: 'member',
  disabled: false,
};

describe('item-acl helpers', () => {
  it('allows anonymous only for public view', () => {
    const pub = { ...base, viewAccess: 'public' as const } satisfies Item;
    expect(canViewItem(pub, null)).toBe(true);
    expect(canEditItem(pub, null)).toBe(false);
    expect(canViewItem({ ...base }, null)).toBe(false);
  });

  it('restricted: edit list implies view; manage is admin or creator', () => {
    const item: Item = {
      ...base,
      viewAccess: 'restricted',
      editAccess: 'restricted',
      acl: { viewUserIds: [], editUserIds: [2] },
    };
    expect(canViewItem(item, member)).toBe(true);
    expect(canEditItem(item, member)).toBe(true);
    expect(canManageItem(item, member)).toBe(false);
    expect(canManageItem(item, admin)).toBe(true);
    expect(canManageItem(item, { ...member, id: 10 })).toBe(true);
  });

  it('prefers server canEdit/canManage flags over client ACL lists', () => {
    const item: Item = {
      ...base,
      viewAccess: 'restricted',
      editAccess: 'restricted',
      canEdit: true,
      canManage: false,
    };
    expect(canEditItem(item, member)).toBe(true);
    expect(canManageItem(item, member)).toBe(false);
    expect(canEditItem({ ...item, canEdit: false }, member)).toBe(false);
  });
});
