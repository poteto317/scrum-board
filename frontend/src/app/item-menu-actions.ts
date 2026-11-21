import { Injectable, signal } from '@angular/core';

export function favoriteMenuLabel(favorite: boolean | null | undefined): string {
  if (favorite == null) return 'お気に入り';
  return favorite ? 'お気に入りから外す' : 'お気に入りに追加';
}

export type ItemMenuHandlers = {
  scrollToHistory: () => void;
  /** Returns false when already on solution (no navigation). */
  goToSolution: () => boolean;
  toggleFavorite: () => void;
  favoriteLabel: () => string;
  favoriteDisabled: () => boolean;
};

@Injectable({ providedIn: 'root' })
export class ItemMenuActions {
  private readonly handlers = signal<ItemMenuHandlers | null>(null);

  readonly registered = () => this.handlers() !== null;

  register(h: ItemMenuHandlers) {
    this.handlers.set(h);
  }

  unregister() {
    this.handlers.set(null);
  }

  scrollToHistory() {
    this.handlers()?.scrollToHistory();
  }

  goToSolution(): boolean {
    const h = this.handlers();
    if (!h) return false;
    return h.goToSolution();
  }

  toggleFavorite() {
    this.handlers()?.toggleFavorite();
  }

  favoriteLabel(): string {
    return this.handlers()?.favoriteLabel() ?? 'お気に入り';
  }

  favoriteDisabled(): boolean {
    return this.handlers()?.favoriteDisabled() ?? true;
  }
}