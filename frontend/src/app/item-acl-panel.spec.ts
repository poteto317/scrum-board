import { describe, expect, it } from 'vitest';
import { aclDraftFromItem, withToggledAclUser } from './item-acl-panel';
import { Item } from './models';

const base = {
  viewAccess: 'open' as const,
  editAccess: 'open' as const,
} satisfies Pick<Item, 'viewAccess' | 'editAccess'>;

describe('aclDraftFromItem / withToggledAclUser', () => {
  it('normalizes unknown access to open and copies lists', () => {
    expect(aclDraftFromItem({ ...base, viewAccess: undefined, editAccess: undefined })).toEqual({
      viewAccess: 'open',
      editAccess: 'open',
      viewUserIds: [],
      editUserIds: [],
    });
    expect(
      aclDraftFromItem({
        viewAccess: 'restricted',
        editAccess: 'restricted',
        acl: { viewUserIds: [1], editUserIds: [2] },
      }),
    ).toEqual({
      viewAccess: 'restricted',
      editAccess: 'restricted',
      viewUserIds: [1],
      editUserIds: [2],
    });
  });

  it('toggles user ids without mutating input', () => {
    const ids = [1];
    expect(withToggledAclUser(ids, 2, true)).toEqual([1, 2]);
    expect(withToggledAclUser(ids, 1, false)).toEqual([]);
    expect(ids).toEqual([1]);
  });
});
