import { UserPublic } from './auth';
import { Item } from './models';

export type ItemACLState = {
  viewAccess: Item['viewAccess'];
  editAccess: Item['editAccess'];
  createdByUserId: number | null;
  viewUserIds: number[];
  editUserIds: number[];
};

export function itemACLState(item: Item): ItemACLState {
  return {
    viewAccess: item.viewAccess ?? 'open',
    editAccess: item.editAccess ?? 'open',
    createdByUserId: item.createdByUserId ?? null,
    viewUserIds: item.acl?.viewUserIds ?? [],
    editUserIds: item.acl?.editUserIds ?? [],
  };
}

export function canManageItem(item: Item, user: UserPublic | null): boolean {
  if (typeof item.canManage === 'boolean') {
    return item.canManage && !!user && !user.disabled;
  }
  if (!user || user.disabled) return false;
  if (user.role === 'admin') return true;
  return item.createdByUserId != null && item.createdByUserId === user.id;
}

export function canViewItem(item: Item, user: UserPublic | null): boolean {
  const st = itemACLState(item);
  switch (st.viewAccess) {
    case 'public':
      return true;
    case 'open':
      return !!user && !user.disabled;
    case 'restricted':
      if (!user || user.disabled) return false;
      if (user.role === 'admin' || st.createdByUserId === user.id) return true;
      return st.viewUserIds.includes(user.id) || st.editUserIds.includes(user.id);
    default:
      return false;
  }
}

export function canEditItem(item: Item, user: UserPublic | null): boolean {
  if (typeof item.canEdit === 'boolean') {
    return item.canEdit && !!user && !user.disabled;
  }
  if (!user || user.disabled) return false;
  if (!canViewItem(item, user)) return false;
  const st = itemACLState(item);
  if (st.editAccess === 'open') return true;
  if (user.role === 'admin' || st.createdByUserId === user.id) return true;
  return st.editUserIds.includes(user.id);
}

export function viewAccessLabel(viewAccess: Item['viewAccess']): string {
  switch (viewAccess) {
    case 'public':
      return '全公開';
    case 'restricted':
      return '制限';
    default:
      return '';
  }
}
