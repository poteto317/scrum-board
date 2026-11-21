import { DestroyRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { Api } from './api';
import { FavoritesSession } from './favorites-session';
import { ItemFavorite } from './item-favorite';

describe('ItemFavorite', () => {
  let api: { updateItem: ReturnType<typeof vi.fn> };
  let favorites: {
    items: ReturnType<typeof vi.fn>;
    applyToggle: ReturnType<typeof vi.fn>;
    revertToggle: ReturnType<typeof vi.fn>;
  };
  let helper: ItemFavorite;
  let applyCalls: { favorite: boolean; updatedAt: string }[];
  let errorCalls: string[];
  let cancel$: Subject<unknown>;
  const card = {
    id: 10,
    number: 3,
    title: 't',
    projectId: 1,
    favorite: false,
    updatedAt: 'a',
  };

  beforeEach(() => {
    api = { updateItem: vi.fn() };
    favorites = {
      items: vi.fn(() => []),
      applyToggle: vi.fn(),
      revertToggle: vi.fn(),
    };
    applyCalls = [];
    errorCalls = [];
    cancel$ = new Subject();
    TestBed.configureTestingModule({
      providers: [
        ItemFavorite,
        { provide: Api, useValue: api },
        { provide: FavoritesSession, useValue: favorites },
        { provide: DestroyRef, useValue: { onDestroy: () => undefined } },
      ],
    });
    helper = TestBed.inject(ItemFavorite);
    helper.bind({
      item: () => card as never,
      applyFavoriteSave: (updated) => {
        applyCalls.push(updated);
      },
      onError: (message) => {
        errorCalls.push(message);
      },
      cancel$,
    });
  });

  it('toggles favorite and updates favorites list', () => {
    api.updateItem.mockReturnValue(
      of({ ...card, favorite: true, updatedAt: 'b', id: 10, number: 3, projectId: 1, title: 't' }),
    );
    helper.toggle();
    expect(api.updateItem).toHaveBeenCalledWith(10, { favorite: true });
    expect(favorites.applyToggle).toHaveBeenCalled();
    // optimistic then server updatedAt
    expect(applyCalls[0]).toEqual({ favorite: true, updatedAt: 'a' });
    expect(applyCalls.at(-1)).toEqual({ favorite: true, updatedAt: 'b' });
  });

  it('ignores second toggle while saving', () => {
    const pending = new Subject();
    api.updateItem.mockReturnValue(pending);
    helper.toggle();
    helper.toggle();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    pending.complete();
  });

  it('reverts list and favorite on error', () => {
    api.updateItem.mockReturnValue(throwError(() => ({ status: 500 })));
    helper.toggle();
    expect(favorites.revertToggle).toHaveBeenCalled();
    expect(applyCalls).toEqual([
      { favorite: true, updatedAt: 'a' },
      { favorite: false, updatedAt: 'a' },
    ]);
    expect(errorCalls.length).toBeGreaterThan(0);
  });

  it('reverts optimistic list when cancel$ fires before response', () => {
    const pending = new Subject();
    api.updateItem.mockReturnValue(pending);
    helper.toggle();
    expect(favorites.applyToggle).toHaveBeenCalled();
    cancel$.next(null);
    expect(favorites.revertToggle).toHaveBeenCalled();
    expect(applyCalls).toEqual([
      { favorite: true, updatedAt: 'a' },
      { favorite: false, updatedAt: 'a' },
    ]);
  });
});
