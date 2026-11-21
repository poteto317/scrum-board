import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ItemMenuActions } from './item-menu-actions';

describe('ItemMenuActions', () => {
  it('disables favorite until registered and clears on unregister', () => {
    TestBed.configureTestingModule({});
    const actions = TestBed.inject(ItemMenuActions);
    expect(actions.registered()).toBe(false);
    expect(actions.favoriteDisabled()).toBe(true);

    const goToSolution = vi.fn(() => false);
    const favoriteLabel = vi.fn(() => 'お気に入りから外す');
    actions.register({
      scrollToHistory: vi.fn(),
      goToSolution,
      toggleFavorite: vi.fn(),
      favoriteLabel,
      favoriteDisabled: () => false,
    });
    expect(actions.registered()).toBe(true);
    expect(actions.favoriteDisabled()).toBe(false);
    expect(actions.favoriteLabel()).toBe('お気に入りから外す');
    expect(actions.goToSolution()).toBe(false);
    expect(goToSolution).toHaveBeenCalled();

    actions.unregister();
    expect(actions.registered()).toBe(false);
    expect(actions.favoriteDisabled()).toBe(true);
  });
});
