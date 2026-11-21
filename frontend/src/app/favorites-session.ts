import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Api } from './api';
import { normalizeBoardData } from './board-data';
import { Item } from './models';
import { ProjectSession } from './project-session';

export type FavoriteListItem = Pick<Item, 'id' | 'number' | 'title' | 'projectId' | 'favorite'>;

/** Sidebar favorites for the active project. Does not sync activeProjectId (L-860). */
@Injectable({ providedIn: 'root' })
export class FavoritesSession {
  private readonly api = inject(Api);
  private readonly projectSession = inject(ProjectSession);
  readonly items = signal<FavoriteListItem[]>([]);
  private loadGeneration = 0;

  constructor() {
    // Own the reload trigger here so App stays shell-only. Clear while switching
    // so old-project links never pair with the new activeId (L-040). Do not use
    // ProjectSession.onSwitched — that increments listeners.
    effect(() => {
      const activeId = this.projectSession.activeId();
      const switching = this.projectSession.switching();
      if (activeId == null || switching) {
        untracked(() => {
          this.loadGeneration++;
          this.items.set([]);
        });
        return;
      }
      untracked(() => this.loadForActiveProject());
    });
  }

  /**
   * Reload from board GET for the current active project.
   * Stale responses are dropped via generation + activeId match (L-040).
   * Does not write activeProjectId (L-860).
   */
  loadForActiveProject(): void {
    const activeId = this.projectSession.activeId();
    if (activeId == null || this.projectSession.switching()) return;
    const generation = ++this.loadGeneration;
    this.api.board().subscribe({
      next: (board) => {
        if (generation !== this.loadGeneration) return;
        if (this.projectSession.switching()) return;
        if (this.projectSession.activeId() !== activeId) return;
        this.items.set(favoritesFromBoard(board));
      },
      error: () => {
        if (generation !== this.loadGeneration) return;
        // Keep previous list on failure (L-001).
      },
    });
  }

  applyToggle(item: FavoriteListItem): void {
    const activeId = this.projectSession.activeId();
    if (activeId != null && item.projectId !== activeId) return;
    if (item.favorite) {
      this.items.update((list) => sortFavorites([...list.filter((i) => i.id !== item.id), toListItem(item)]));
      return;
    }
    this.items.update((list) => list.filter((i) => i.id !== item.id));
  }

  revertToggle(snapshot: FavoriteListItem[]): void {
    this.items.set(snapshot.map((i) => ({ ...i })));
  }
}

/** Display title for sidebar links; empty/whitespace → （無題）. */
export function displayFavoriteTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed === '' ? '（無題）' : trimmed;
}

/** Pure: normalize board → favorite list items (no I/O). */
export function favoritesFromBoard(board: Parameters<typeof normalizeBoardData>[0]): FavoriteListItem[] {
  return sortFavorites(
    normalizeBoardData(board)
      .items.filter((i) => i.favorite === true)
      .map(toListItem),
  );
}

export function sortFavorites(items: FavoriteListItem[]): FavoriteListItem[] {
  return [...items].sort((a, b) => {
    const cmp = a.title.trim().localeCompare(b.title.trim(), 'ja', { sensitivity: 'base' });
    if (cmp !== 0) return cmp;
    return a.number - b.number;
  });
}

function toListItem(item: Pick<Item, 'id' | 'number' | 'title' | 'projectId' | 'favorite'>): FavoriteListItem {
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    projectId: item.projectId,
    favorite: item.favorite === true,
  };
}
