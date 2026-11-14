import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Card } from './models';

// board.spec.ts feeds onCardDrop hand-made events; this drives the real CdkDropList / CdkDrag instances the
// template creates, so a broken binding (ids, connections, disabled state, output wiring) is caught too.
function card(id: number, columnId: number, position: number): Card {
  return {
    id,
    number: id,
    columnId,
    title: `card ${id}`,
    description: '',
    position,
    backlogPosition: position,
    prUrls: [],
    createdAt: '',
    updatedAt: '',
  };
}

describe('Board template CDK wiring', () => {
  it('wires every column to the CDK: ids, connections, disabled state and the dropped handler', async () => {
    const board: BoardData = {
      columns: [
        { id: 1, name: 'Todo', position: 0 },
        { id: 2, name: 'Doing', position: 1 },
      ],
      cards: [card(1, 1, 0), card(2, 1, 1), card(3, 2, 0)],
    };
    const reorderCards = vi.fn(() => new Subject<{ cards: Card[] }>());
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(board), reorderCards } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const lists = () =>
      f.debugElement.queryAll(By.directive(CdkDropList)).map((d) => d.injector.get(CdkDropList));
    const drags = () =>
      f.debugElement.queryAll(By.directive(CdkDrag)).map((d) => d.injector.get(CdkDrag));

    // Each column's list has its own id and is connected to every other column's list, so a card can cross.
    expect(lists().map((l) => l.id)).toEqual(['card-list-1', 'card-list-2']);
    for (const list of lists()) {
      const connected = list.connectedTo as string[];
      for (const other of lists().filter((l) => l !== list)) expect(connected).toContain(other.id);
    }
    // Our own scrolling replaces the CDK's, and dragging is on while reordering is available.
    expect(lists().every((l) => l.autoScrollDisabled)).toBe(true);
    expect(lists().every((l) => !l.disabled)).toBe(true);
    expect(drags().length).toBe(3);
    expect(drags().every((d) => !d.disabled)).toBe(true);

    // The list's dropped output reaches onCardDrop with that column's id: a real cross-column drop.
    const [todo, doing] = lists();
    doing.dropped.emit({
      previousContainer: todo,
      container: doing,
      previousIndex: 0,
      currentIndex: 1,
      item: drags()[0],
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
      event: new MouseEvent('mouseup'),
    });
    expect(reorderCards).toHaveBeenCalledWith([
      { columnId: 1, cardIds: [2] },
      { columnId: 2, cardIds: [3, 1] },
    ]);

    // While the save is pending, every list and card turns its dragging off.
    f.detectChanges();
    expect(f.componentInstance.reordering()).toBe(true);
    expect(lists().every((l) => l.disabled)).toBe(true);
    expect(drags().every((d) => d.disabled)).toBe(true);
  });

  // CDK's own edge scrolling is switched off, so (cdkDragMoved) is the only thing that scrolls while a card is
  // dragged. Driving a real mouse drag checks the template binding itself, not just onCardDragMoved.
  it('scrolls the board while a real mouse drag is held at its edge, reading the pointer as (x, y)', async () => {
    const board: BoardData = {
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      cards: [card(1, 1, 0)],
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(board), reorderCards: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const scroller = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    const list = f.nativeElement.querySelector('.card-list') as HTMLElement;
    const rect = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 600));
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 400, 600));
    const original = document.elementFromPoint;
    const elementFromPoint = vi.fn((x: number, y: number) =>
      x === 990 && y === 590 ? list : null,
    );
    document.elementFromPoint = elementFromPoint;
    onTestFinished(() => {
      document.elementFromPoint = original;
    });
    scroller.scrollLeft = 0;
    list.scrollTop = 0;
    const moved = vi.spyOn(f.componentInstance, 'onCardDragMoved');

    const body = f.nativeElement.querySelector('.task-card-body') as HTMLElement;
    body.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 300,
        clientY: 300,
      }),
    );
    // The first move past the threshold only starts the drag; the later ones are what CDK reports as moved.
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 320, clientY: 320 }),
    );
    expect(moved).not.toHaveBeenCalled();
    // x and y differ, and only the point (990, 590) is over the list: swapped arguments find nothing.
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 990, clientY: 590 }),
    );

    expect(moved).toHaveBeenCalled();
    expect(elementFromPoint).toHaveBeenCalledWith(990, 590);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    expect(list.scrollTop).toBeGreaterThan(0);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 990, clientY: 590 }),
    );
  });
});
