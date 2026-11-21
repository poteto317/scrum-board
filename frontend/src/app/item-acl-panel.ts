import { Injectable, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { Item } from './models';

export type AclDraft = {
  viewAccess: 'public' | 'open' | 'restricted';
  editAccess: 'open' | 'restricted';
  viewUserIds: number[];
  editUserIds: number[];
};

export function aclDraftFromItem(card: Pick<Item, 'viewAccess' | 'editAccess' | 'acl'>): AclDraft {
  return {
    viewAccess:
      card.viewAccess === 'public' || card.viewAccess === 'restricted' ? card.viewAccess : 'open',
    editAccess: card.editAccess === 'restricted' ? 'restricted' : 'open',
    viewUserIds: [...(card.acl?.viewUserIds ?? [])],
    editUserIds: [...(card.acl?.editUserIds ?? [])],
  };
}

export function withToggledAclUser(
  ids: number[],
  userId: number,
  checked: boolean,
): number[] {
  const cur = new Set(ids);
  if (checked) cur.add(userId);
  else cur.delete(userId);
  return [...cur];
}

/** Detail ACL draft + PATCH — kept out of ItemDetail (SRP). */
@Injectable()
export class ItemAclPanel {
  private readonly api = inject(Api);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly viewAccess = signal<'public' | 'open' | 'restricted'>('open');
  readonly editAccess = signal<'open' | 'restricted'>('open');
  readonly viewUserIds = signal<number[]>([]);
  readonly editUserIds = signal<number[]>([]);
  private generation = 0;
  private current!: () => Item | null;
  private canManage!: () => boolean;
  private applySaved!: (saved: Item) => void;

  bind(opts: {
    item: () => Item | null;
    canManage: () => boolean;
    applySaved: (saved: Item) => void;
  }) {
    this.current = opts.item;
    this.canManage = opts.canManage;
    this.applySaved = opts.applySaved;
  }

  syncFrom(card: Pick<Item, 'viewAccess' | 'editAccess' | 'acl'>) {
    this.generation++;
    this.error.set('');
    const draft = aclDraftFromItem(card);
    this.viewAccess.set(draft.viewAccess);
    this.editAccess.set(draft.editAccess);
    this.viewUserIds.set(draft.viewUserIds);
    this.editUserIds.set(draft.editUserIds);
  }

  toggleUser(kind: 'view' | 'edit', userId: number, checked: boolean) {
    const sig = kind === 'view' ? this.viewUserIds : this.editUserIds;
    sig.set(withToggledAclUser(sig(), userId, checked));
  }

  save() {
    const card = this.current();
    if (!card || !this.canManage() || this.saving()) return;
    const generation = ++this.generation;
    this.saving.set(true);
    this.error.set('');
    this.api
      .patchItemAcl(card.id, {
        viewAccess: this.viewAccess(),
        editAccess: this.editAccess(),
        viewUserIds: this.viewUserIds(),
        editUserIds: this.editUserIds(),
      })
      .pipe(
        finalize(() => {
          if (generation === this.generation) this.saving.set(false);
        }),
      )
      .subscribe({
        next: (saved) => {
          if (generation !== this.generation) return;
          this.applySaved(saved);
          this.syncFrom(saved);
        },
        error: (err) => {
          if (generation !== this.generation) return;
          this.error.set(errorMessage(err) || 'アクセス設定を保存できませんでした。');
        },
      });
  }
}
