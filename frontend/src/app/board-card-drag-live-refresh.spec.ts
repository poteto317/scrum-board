import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Card } from './models';

// The board polls every 5 seconds (live-refresh.ts). CDK reports previousIndex / currentIndex against the list
// as it was when the drag began, so a poll that swaps the board's data mid-drag makes onCardDrop move the wrong card.
const POLL_MS = 5000;

function card(id: number, position: number, title: string): Card {
  return {
    id,
    number: id,
    columnId: 1,
    title,
    description: '',
    position,
    backlogPosition: position,
    prUrls: [],
    assignee: '',
    createdAt: '',
    updatedAt: '',
  };
}

const A = card(1, 0, 'A');
const B = card(2, 1, 'B');
const C = card(3, 2, 'C');
const D = card(4, 3, 'D');
const E = card(5, 4, 'E');

function todoBoard(cards: Card[]): BoardData {
  return { columns: [{ id: 1, name: 'Todo', position: 0 }], cards };
}

/** The positions as the server renumbers them after a card is deleted elsewhere. */
function withoutA(): BoardData {
  return todoBoard([B, C, D, E].map((c, position) => ({ ...c, position })));
}

async function setup(reorderCards: ReturnType<typeof vi.fn> = vi.fn()) {
  vi.useFakeTimers();
  const board = vi.fn(() => of(todoBoard([A, B, C, D, E])));
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
  return { f, board, reorderCards, component: f.componentInstance };
}

function titles(component: Board): string[] {
  return (component.grouped().get(1) ?? []).map((c) => c.title);
}

function mouse(type: string, x: number, y: number, target: EventTarget = document) {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === 'mouseup' ? 0 : 1,
      detail: 1,
      clientX: x,
      clientY: y,
    }),
  );
}

/** Holds card `cardId` with a real mouse drag: down, past CDK's 8px threshold, then a little further. */
function grab(f: { nativeElement: HTMLElement }, cardId: number) {
  const body = f.nativeElement.querySelector(
    `[data-card-id="${cardId}"] .task-card-body`,
  ) as HTMLElement;
  mouse('mousedown', 300, 300, body);
  mouse('mousemove', 320, 320);
  mouse('mousemove', 330, 340);
}

/** What CDK sends to (cdkDropListDropped) for a card dragged from `previousIndex` to `currentIndex` in Todo. */
function dropEvent(dragged: Card, previousIndex: number, currentIndex: number) {
  return {
    previousContainer: { id: 'card-list-1' },
    container: { id: 'card-list-1' },
    previousIndex,
    currentIndex,
    item: { data: dragged },
  } as never;
}

describe('Board live refresh while a card is dragged', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('keeps the board as it was when the card was picked up, however many polls come in', async () => {
    const { f, board, component } = await setup();
    grab(f, B.id);
    board.mockReturnValue(of(withoutA()));

    await vi.advanceTimersByTimeAsync(POLL_MS * 3);

    expect(titles(component)).toEqual(['A', 'B', 'C', 'D', 'E']);
    // Not just "the answer was thrown away": no request is made while a card is held.
    expect(board).toHaveBeenCalledTimes(1);
    f.destroy();
  });

  it('still holds the board between letting go of the card and CDK reporting the end', async () => {
    const { f, board, component } = await setup();
    grab(f, B.id);
    board.mockReturnValue(of(withoutA()));
    // The pointer is released, but the preview is still settling into place (CDK ends the drag up to 300ms later).
    component.onCardDragReleased();

    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(titles(component)).toEqual(['A', 'B', 'C', 'D', 'E']);
    f.destroy();
  });

  it('drops the answer of a poll that was already on its way when the card was picked up', async () => {
    const { f, board, component } = await setup();
    const slow = new Subject<BoardData>();
    board.mockReturnValue(slow.asObservable());
    await vi.advanceTimersByTimeAsync(POLL_MS); // the request goes out ...
    grab(f, B.id); // ... the card is picked up ...
    slow.next(withoutA()); // ... and the answer arrives.

    expect(titles(component)).toEqual(['A', 'B', 'C', 'D', 'E']);
    f.destroy();
  });

  it('moves the card that was picked up, using the indexes CDK reports, after a poll during the drag', async () => {
    const reorderCards = vi.fn(() => new Subject<{ cards: Card[] }>());
    const { f, board, component } = await setup(reorderCards);
    grab(f, B.id);
    board.mockReturnValue(of(withoutA())); // A was deleted elsewhere
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);

    // CDK ends the drag and then drops, one straight after the other: B (index 1) goes to the end (index 4).
    component.onCardDragEnded();
    component.onCardDrop(dropEvent(B, 1, 4), 1);

    expect(reorderCards).toHaveBeenCalledWith([{ columnId: 1, cardIds: [1, 3, 4, 5, 2] }]);
    f.destroy();
  });

  it('polls again once the drag is over, also when the card is dropped where it was', async () => {
    const { f, board, component } = await setup();
    grab(f, B.id);
    board.mockReturnValue(of(withoutA()));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(titles(component)).toEqual(['A', 'B', 'C', 'D', 'E']);

    component.onCardDragEnded();
    component.onCardDrop(dropEvent(B, 1, 1), 1); // no-op drop: nothing is saved
    await vi.advanceTimersByTimeAsync(POLL_MS);

    expect(titles(component)).toEqual(['B', 'C', 'D', 'E']);
    f.destroy();
  });

  it('ends a real mouse drag: holds while it lasts and resumes once CDK has finished it', async () => {
    const { f, board, component } = await setup();
    grab(f, B.id);
    board.mockReturnValue(of(withoutA()));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(titles(component)).toEqual(['A', 'B', 'C', 'D', 'E']);

    mouse('mouseup', 330, 340);
    await vi.advanceTimersByTimeAsync(POLL_MS); // CDK finishes the drag; the next poll is free to run

    expect(titles(component)).toEqual(['B', 'C', 'D', 'E']);
    f.destroy();
  });

  it('saves nothing when the card CDK reports is not the one at its previous index', async () => {
    const reorderCards = vi.fn(() => of({ cards: [] }));
    const { f, component } = await setup(reorderCards);

    // The list was swapped under the drag: index 1 now holds C, not the dragged B.
    component.data.set(todoBoard([A, C, D, E].map((c, position) => ({ ...c, position }))));
    component.onCardDrop(dropEvent(B, 1, 3), 1);

    expect(reorderCards).not.toHaveBeenCalled();
    expect(titles(component)).toEqual(['A', 'C', 'D', 'E']);
    expect(component.reordering()).toBe(false);
    f.destroy();
  });

  it('saves nothing when the drop carries no card', async () => {
    const reorderCards = vi.fn(() => of({ cards: [] }));
    const { f, component } = await setup(reorderCards);

    component.onCardDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-1' },
        previousIndex: 1,
        currentIndex: 3,
        item: {},
      } as never,
      1,
    );

    expect(reorderCards).not.toHaveBeenCalled();
    f.destroy();
  });

  it('does not poll while a move is being saved, and adopts the answer of the save afterwards', async () => {
    const saving = new Subject<{ cards: Card[] }>();
    const { f, board, component } = await setup(vi.fn(() => saving));
    component.onCardDrop(dropEvent(B, 1, 4), 1);
    expect(component.reordering()).toBe(true);
    board.mockReturnValue(of(withoutA()));

    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    expect(board).toHaveBeenCalledTimes(1);
    expect(titles(component)).toEqual(['A', 'C', 'D', 'E', 'B']);

    saving.next({
      cards: [A, C, D, E, B].map((c, position) => ({ ...c, position })),
    });
    saving.complete();
    expect(titles(component)).toEqual(['A', 'C', 'D', 'E', 'B']);
    f.destroy();
  });

  it('does not let a poll that started before a save overwrite the saved order when it answers late', async () => {
    const reorderCards = vi.fn(() =>
      of({ cards: [B, A, C, D, E].map((c, position) => ({ ...c, position })) }),
    );
    const { f, board, component } = await setup(reorderCards);
    const slow = new Subject<BoardData>();
    board.mockReturnValue(slow.asObservable());
    await vi.advanceTimersByTimeAsync(POLL_MS); // the request goes out, with the old order ...

    component.onCardKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }), 1, 0); // ... A moves down, saved ...
    expect(titles(component)).toEqual(['B', 'A', 'C', 'D', 'E']);
    expect(component.reordering()).toBe(false);
    slow.next(todoBoard([A, B, C, D, E])); // ... and then the old answer arrives.

    expect(titles(component)).toEqual(['B', 'A', 'C', 'D', 'E']);
    f.destroy();
  });
});
