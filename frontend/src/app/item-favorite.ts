import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Observable, finalize, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Api } from './api';
import { errorMessage } from './api-error';
import { FavoritesSession, FavoriteListItem } from './favorites-session';
import { Item } from './models';

/** Immediate favorite PATCH — separate from title/description autosave. */
@Injectable()
export class ItemFavorite {
  private readonly api = inject(Api);
  private readonly favorites = inject(FavoritesSession);
  private readonly destroyRef = inject(DestroyRef);
  readonly saving = signal(false);
  private cancel$?: Observable<unknown>;
  private apply!: (updated: Pick<Item, 'favorite' | 'updatedAt'>) => void;
  private reportError!: (message: string) => void;
  private current!: () => Item | null;

  bind(opts: {
    item: () => Item | null;
    applyFavoriteSave: (updated: Pick<Item, 'favorite' | 'updatedAt'>) => void;
    onError: (message: string) => void;
    cancel$: Observable<unknown>;
  }) {
    this.current = opts.item;
    this.apply = opts.applyFavoriteSave;
    this.reportError = opts.onError;
    this.cancel$ = opts.cancel$;
  }

  reset() {
    this.saving.set(false);
  }

  toggle() {
    const card = this.current();
    if (!card || this.saving() || !this.cancel$) return;
    const next = !card.favorite;
    const snapshot: FavoriteListItem[] = this.favorites.items().map((i) => ({ ...i }));
    this.saving.set(true);
    this.reportError('');
    this.apply({ favorite: next, updatedAt: card.updatedAt });
    this.favorites.applyToggle({
      id: card.id,
      number: card.number,
      title: card.title,
      projectId: card.projectId,
      favorite: next,
    });
    let settled = false;
    this.api
      .updateItem(card.id, { favorite: next })
      .pipe(
        takeUntil(this.cancel$),
        takeUntilDestroyed(this.destroyRef),
        finalize(() => {
          this.saving.set(false);
          if (!settled) {
            // cancel$ / destroy aborted before next|error — undo optimistic state (L-001).
            this.favorites.revertToggle(snapshot);
            this.apply({ favorite: card.favorite, updatedAt: card.updatedAt });
          }
        }),
      )
      .subscribe({
        next: (updated) => {
          settled = true;
          this.apply({ favorite: updated.favorite === true, updatedAt: updated.updatedAt });
          this.favorites.applyToggle({
            id: updated.id,
            number: updated.number,
            title: updated.title,
            projectId: updated.projectId,
            favorite: updated.favorite === true,
          });
        },
        error: (error) => {
          settled = true;
          this.favorites.revertToggle(snapshot);
          this.apply({ favorite: card.favorite, updatedAt: card.updatedAt });
          this.reportError(errorMessage(error));
        },
      });
  }
}
