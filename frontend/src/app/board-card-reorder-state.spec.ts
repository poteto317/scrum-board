import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Card } from './models';

function card(id: number, columnId: number, position: number, title: string): Card {
  return {
    id,
    number: id,
    columnId,
    title,
    description: '',
    position,
    prUrl: '',
    createdAt: '',
    updatedAt: '',
  };
}

function initialBoard(): BoardData {
  return {
    columns: [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ],
    cards: [card(1, 1, 0, 'A'), card(2, 1, 1, 'B'), card(3, 2, 0, 'C')],
  };
}

async function setup(reorderCards: ReturnType<typeof vi.fn>) {
  const board = vi.fn(() => of(initialBoard()));
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: { board, reorderCards, reorderColumns: vi.fn() } },
    ],
  });
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  await f.whenStable();
  return { f, board, component: f.componentInstance };
}

function arrowDown(component: Board, index: number) {
  component.onCardKeydown(
    new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
    1,
    index,
  );
}

function dropIntoDoing(component: Board) {
  component.onCardDrop(
    {
      previousContainer: { id: 'card-list-1' },
      container: { id: 'card-list-2' },
      previousIndex: 0,
      currentIndex: 0,
      item: { data: initialBoard().cards[0] },
    } as never,
    2,
  );
}

describe('Board card reorder state', () => {
  it('ignores moves while a save is in flight or a modal is open', async () => {
    const pending = new Subject<{ cards: Card[] }>();
    const reorderCards = vi.fn(() => pending);
    const { f, component } = await setup(reorderCards);

    arrowDown(component, 0);
    expect(reorderCards).toHaveBeenCalledTimes(1);
    expect(component.canReorderCards()).toBe(false);

    // A second keyboard move and a drop while the first is saving must not reach the API,
    // otherwise the second save would roll back to the first save's optimistic state.
    arrowDown(component, 0);
    dropIntoDoing(component);
    expect(reorderCards).toHaveBeenCalledTimes(1);

    pending.next({ cards: initialBoard().cards });
    pending.complete();
    f.detectChanges();
    expect(component.canReorderCards()).toBe(true);

    // The add-card dialog blocks card moves too.
    component.openCard(1);
    expect(component.canReorderCards()).toBe(false);
    arrowDown(component, 0);
    dropIntoDoing(component);
    expect(reorderCards).toHaveBeenCalledTimes(1);
  });

  it('shows the optimistic order while saving and then adopts the server answer', async () => {
    const pending = new Subject<{ cards: Card[] }>();
    const { f, component } = await setup(vi.fn(() => pending));

    arrowDown(component, 0);
    const optimistic = component
      .data()
      .cards.filter((c) => c.columnId === 1)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.id);
    expect(optimistic).toEqual([2, 1]);
    expect(component.reorderAnnouncement()).toBe('');

    // The database is the authority: the answer replaces the optimistic cards, positions included.
    const answer = [card(1, 1, 5, 'A'), card(2, 1, 4, 'B'), card(3, 2, 0, 'C')];
    pending.next({ cards: answer });
    pending.complete();
    f.detectChanges();
    expect(component.data().cards).toEqual(answer);
    expect(component.reorderAnnouncement()).toContain('2番目');
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();
  });

  it('puts focus back on the moved card after a keyboard move, whether it saves or fails', async () => {
    const saved = new Subject<{ cards: Card[] }>();
    const failed = new Subject<{ cards: Card[] }>();
    const reorderCards = vi.fn().mockReturnValueOnce(saved).mockReturnValueOnce(failed);
    const { f, component } = await setup(reorderCards);
    const focused = () => document.activeElement?.getAttribute('data-card-id');

    arrowDown(component, 0);
    f.detectChanges();
    await f.whenStable();
    expect(focused()).toBe('1');
    saved.next({ cards: [card(1, 1, 1, 'A'), card(2, 1, 0, 'B'), card(3, 2, 0, 'C')] });
    saved.complete();
    f.detectChanges();
    await f.whenStable();
    expect(focused()).toBe('1');

    // Card A is now second, so ArrowUp moves it back; the save fails and focus must stay on it.
    (document.activeElement as HTMLElement).blur();
    component.onCardKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }),
      1,
      1,
    );
    failed.error({ status: 500, error: { message: '保存に失敗しました。' } });
    f.detectChanges();
    await f.whenStable();
    expect(focused()).toBe('1');
  });

  it('rolls back and offers "close" for a server error but not for a conflict', async () => {
    const serverError = new Subject<{ cards: Card[] }>();
    const conflict = new Subject<{ cards: Card[] }>();
    const reorderCards = vi.fn().mockReturnValueOnce(serverError).mockReturnValueOnce(conflict);
    const { f, board, component } = await setup(reorderCards);
    const before = initialBoard().cards;

    arrowDown(component, 0);
    serverError.error({ status: 500, error: { message: '保存に失敗しました。' } });
    f.detectChanges();
    expect(component.data().cards).toEqual(before);
    expect(component.reorderConflict()).toBe(false);
    expect(component.reorderAnnouncement()).toBe('カードの移動を保存できませんでした');
    let alert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(alert.textContent).toContain('保存に失敗しました。');
    expect(alert.querySelector('.reorder-dismiss')).not.toBeNull();
    (alert.querySelector('.reorder-dismiss') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();

    arrowDown(component, 0);
    conflict.error({ status: 409, error: { message: 'カードの構成が変更されています。' } });
    f.detectChanges();
    expect(component.data().cards).toEqual(before);
    expect(component.reorderConflict()).toBe(true);
    alert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(alert.querySelector('.reorder-dismiss')).toBeNull();

    // Reloading is the way out of a conflict: it fetches the board again and clears the banner.
    (alert.querySelector('.reorder-reload') as HTMLButtonElement).click();
    f.detectChanges();
    await f.whenStable();
    expect(board).toHaveBeenCalledTimes(2);
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();
    expect(component.reorderConflict()).toBe(false);
  });
});
