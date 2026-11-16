import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, it, expect, onTestFinished, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { ITEM_AUTO_SCROLL_INTERVAL_MS } from './item-order';
import { BoardData, Item } from './models';

function mockPageScroller() {
  const page = { scrollTop: 0, scrollHeight: 5000 };
  Object.defineProperty(document, 'scrollingElement', {
    configurable: true,
    get: () => page,
  });
  onTestFinished(() => {
    Reflect.deleteProperty(document, 'scrollingElement');
  });
  return page;
}

function card(id: number, columnId: number, position: number, title: string): Item {
  return {
    id,
    number: id,
    columnId,
    title,
    description: '',
    position,
    backlogPosition: position,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    assignee: '',
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
    items: [card(1, 1, 0, 'A'), card(2, 1, 1, 'B'), card(3, 2, 0, 'C')],
    settings: { cardLayout: 'pack' },
  };
}

async function setup(reorderItems: ReturnType<typeof vi.fn>) {
  const board = vi.fn(() => of(initialBoard()));
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      {
        provide: Api,
        useValue: {
          board,
          reorderItems,
          reorderColumns: vi.fn(),
          listCommandTemplates: () => of({ templates: [] }),
        },
      },
    ],
  });
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  await f.whenStable();
  return { f, board, component: f.componentInstance };
}

function arrowDown(component: Board, index: number) {
  component.onItemKeydown(
    new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
    1,
    index,
  );
}

function dropIntoDoing(component: Board) {
  component.onItemDrop(
    {
      previousContainer: { id: 'card-list-1' },
      container: { id: 'card-list-2' },
      previousIndex: 0,
      currentIndex: 0,
      item: { data: initialBoard().items[0] },
    } as never,
    2,
  );
}

function startItemDrag(component: Board, item: Item) {
  component.onItemDragStarted(
    {
      event: new MouseEvent('mousedown', { clientY: 100 }),
      source: {
        element: {
          nativeElement: {
            getBoundingClientRect: () =>
              ({
                top: 80,
                left: 0,
                right: 100,
                bottom: 160,
                width: 100,
                height: 80,
                x: 0,
                y: 80,
                toJSON: () => ({}),
              }) as DOMRect,
          },
        },
      },
    } as never,
    item,
  );
}

describe('Board card reorder state', () => {
  it('ignores moves while a save is in flight or a modal is open', async () => {
    const pending = new Subject<{ items: Item[] }>();
    const reorderItems = vi.fn(() => pending);
    const { f, component } = await setup(reorderItems);

    arrowDown(component, 0);
    expect(reorderItems).toHaveBeenCalledTimes(1);
    expect(component.canReorderItems()).toBe(false);

    // A second keyboard move and a drop while the first is saving must not reach the API,
    // otherwise the second save would roll back to the first save's optimistic state.
    arrowDown(component, 0);
    dropIntoDoing(component);
    expect(reorderItems).toHaveBeenCalledTimes(1);

    pending.next({ items: initialBoard().items });
    pending.complete();
    f.detectChanges();
    expect(component.canReorderItems()).toBe(true);

    // The add-card dialog blocks card moves too.
    component.openItem(1);
    expect(component.canReorderItems()).toBe(false);
    arrowDown(component, 0);
    dropIntoDoing(component);
    expect(reorderItems).toHaveBeenCalledTimes(1);
  });

  it('disables reordering while layout switching or settings saving', async () => {
    const reorderItems = vi.fn(() => of({ items: initialBoard().items }));
    const { f, component } = await setup(reorderItems);
    expect(component.canReorderItems()).toBe(true);

    component.layoutSwitching.set(true);
    f.detectChanges();
    expect(component.canReorderItems()).toBe(false);
    expect(
      (f.nativeElement.querySelector('.card-list') as HTMLElement).classList.contains(
        'cdk-drop-list-disabled',
      ) || f.nativeElement.querySelector('[cdkdroplistdisabled], .cdk-drop-list-disabled'),
    ).toBeTruthy();
    arrowDown(component, 0);
    dropIntoDoing(component);
    expect(reorderItems).not.toHaveBeenCalled();

    component.layoutSwitching.set(false);
    component.settingsSaving.set(true);
    f.detectChanges();
    expect(component.canReorderItems()).toBe(false);
    arrowDown(component, 0);
    dropIntoDoing(component);
    expect(reorderItems).not.toHaveBeenCalled();

    component.settingsSaving.set(false);
    f.detectChanges();
    expect(component.canReorderItems()).toBe(true);
  });

  it('shows the optimistic order while saving and then adopts the server answer', async () => {
    const pending = new Subject<{ items: Item[] }>();
    const { f, component } = await setup(vi.fn(() => pending));

    arrowDown(component, 0);
    const optimistic = component
      .data()
      .items.filter((c) => c.columnId === 1)
      .sort((a, b) => a.position - b.position)
      .map((c) => c.id);
    expect(optimistic).toEqual([2, 1]);
    expect(component.reorderAnnouncement()).toBe('');

    // The database is the authority: the answer replaces the optimistic cards, positions included.
    const answer = [card(1, 1, 5, 'A'), card(2, 1, 4, 'B'), card(3, 2, 0, 'C')];
    pending.next({ items: answer });
    pending.complete();
    f.detectChanges();
    expect(component.data().items).toEqual(answer);
    expect(component.reorderAnnouncement()).toContain('2番目');
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();
  });

  it('puts focus back on the moved card after a keyboard move, whether it saves or fails', async () => {
    const saved = new Subject<{ items: Item[] }>();
    const failed = new Subject<{ items: Item[] }>();
    const reorderItems = vi.fn().mockReturnValueOnce(saved).mockReturnValueOnce(failed);
    const { f, component } = await setup(reorderItems);
    // The card's reorder tab stop is its drag handle; data-card-id sits on the article around it.
    const focused = () => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.classList.contains('card-drag-handle')).toBe(true);
      return active?.closest('[data-card-id]')?.getAttribute('data-card-id');
    };

    arrowDown(component, 0);
    f.detectChanges();
    await f.whenStable();
    expect(focused()).toBe('1');
    saved.next({ items: [card(1, 1, 1, 'A'), card(2, 1, 0, 'B'), card(3, 2, 0, 'C')] });
    saved.complete();
    f.detectChanges();
    await f.whenStable();
    expect(focused()).toBe('1');

    // Item A is now second, so ArrowUp moves it back; the save fails and focus must stay on it.
    (document.activeElement as HTMLElement).blur();
    component.onItemKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true }),
      1,
      1,
    );
    failed.error({ status: 500, error: { message: '保存に失敗しました。' } });
    f.detectChanges();
    await f.whenStable();
    expect(focused()).toBe('1');
  });

  // The synchronous focus call at the start of a move does not survive the wait for the server; the answer has
  // to put it back, because the board re-renders and the user may have tabbed away in the meantime.
  it.each([
    [
      'saved',
      (subject: Subject<{ items: Item[] }>) => subject.next({ items: initialBoard().items }),
    ],
    ['failed', (subject: Subject<{ items: Item[] }>) => subject.error({ status: 500, error: {} })],
  ] as const)(
    'puts focus back on the moved card when the answer arrives late and the move %s',
    async (_name, answer) => {
      const pending = new Subject<{ items: Item[] }>();
      const { f, component } = await setup(vi.fn(() => pending));

      arrowDown(component, 0);
      f.detectChanges();
      await f.whenStable();
      // The user moves on while the save is still in flight.
      const elsewhere = f.nativeElement.querySelector('.column-drag-handle') as HTMLElement;
      elsewhere.focus();
      expect(document.activeElement).toBe(elsewhere);
      expect(component.reordering()).toBe(true);

      answer(pending);
      pending.complete();
      f.detectChanges();
      await f.whenStable();
      const active = document.activeElement as HTMLElement;
      expect(active.classList.contains('card-drag-handle')).toBe(true);
      expect(active.closest('[data-card-id]')?.getAttribute('data-card-id')).toBe('1');
    },
  );

  // A banner from the last failed move would still be on screen next to a move that went through.
  it.each([
    ['a server error', 500, false],
    ['a conflict', 409, true],
  ] as const)(
    'clears the banner of a failed move as soon as the next move starts (%s)',
    async (_name, status, conflict) => {
      const failed = new Subject<{ items: Item[] }>();
      const next = new Subject<{ items: Item[] }>();
      const reorderItems = vi.fn().mockReturnValueOnce(failed).mockReturnValueOnce(next);
      const { f, component } = await setup(reorderItems);

      arrowDown(component, 0);
      failed.error({ status, error: { message: '保存に失敗しました。' } });
      f.detectChanges();
      expect(component.reorderError()).toBe('保存に失敗しました。');
      expect(component.reorderConflict()).toBe(conflict);
      expect(f.nativeElement.querySelector('.reorder-alert')).not.toBeNull();

      arrowDown(component, 0);
      expect(reorderItems).toHaveBeenCalledTimes(2);
      expect(component.reorderError()).toBe('');
      expect(component.reorderConflict()).toBe(false);
      f.detectChanges();
      expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();

      next.next({ items: initialBoard().items });
      next.complete();
      f.detectChanges();
      expect(component.reorderError()).toBe('');
      expect(component.reorderConflict()).toBe(false);
      expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();
    },
  );

  it('rolls back and offers "close" for a server error but not for a conflict', async () => {
    const serverError = new Subject<{ items: Item[] }>();
    const conflict = new Subject<{ items: Item[] }>();
    const reorderItems = vi.fn().mockReturnValueOnce(serverError).mockReturnValueOnce(conflict);
    const { f, board, component } = await setup(reorderItems);
    const before = initialBoard().items;

    arrowDown(component, 0);
    serverError.error({ status: 500, error: { message: '保存に失敗しました。' } });
    f.detectChanges();
    expect(component.data().items).toEqual(before);
    expect(component.reorderConflict()).toBe(false);
    expect(component.reorderAnnouncement()).toBe('アイテムの移動を保存できませんでした');
    let alert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(alert.textContent).toContain('保存に失敗しました。');
    expect(alert.querySelector('.reorder-dismiss')).not.toBeNull();
    (alert.querySelector('.reorder-dismiss') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();

    arrowDown(component, 0);
    conflict.error({ status: 409, error: { message: 'アイテムの構成が変更されています。' } });
    f.detectChanges();
    expect(component.data().items).toEqual(before);
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

  it('does not give each column its own vertical scroll', async () => {
    await setup(vi.fn());
    // Component CSS is injected into <style> tags (jsdom getComputedStyle does not apply it).
    const css = Array.from(document.querySelectorAll('style'))
      .map((s) => s.textContent ?? '')
      .join('\n');
    expect(css).toMatch(/\.card-list/);
    expect(css).not.toMatch(/\.card-list[^{]*\{[^}]*max-height:\s*min\(60vh/s);
    expect(css).not.toMatch(/\.card-list[^{]*\{[^}]*overflow-y:\s*auto/s);
  });

  // CDK's own edge scrolling is switched off (it would fight page scrolling), so this is the only
  // thing that scrolls the board sideways and the document up and down while a card is dragged to an edge.
  it('scrolls the board sideways and the page vertically when a card is dragged to an edge', async () => {
    const { f, component } = await setup(vi.fn());
    const page = mockPageScroller();
    const scroller = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    const rect = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue(rect(0, 0, 1000, 600));
    scroller.scrollLeft = 0;
    const move = (x: number, y: number) => component.onItemDragMoved({ pointerPosition: { x, y } });

    move(500, 300); // the middle of both: nothing scrolls
    expect([scroller.scrollLeft, page.scrollTop]).toEqual([0, 0]);

    move(990, 300); // the board's right edge
    expect(scroller.scrollLeft).toBeGreaterThan(0);
    const right = scroller.scrollLeft;
    move(5, 300); // the board's left edge
    expect(scroller.scrollLeft).toBeLessThan(right);

    move(200, window.innerHeight - 5); // the viewport's bottom edge
    expect(page.scrollTop).toBeGreaterThan(0);
    const down = page.scrollTop;
    move(200, 5); // the viewport's top edge
    expect(page.scrollTop).toBeLessThan(down);
  });

  // A column drag keeps scrolling while its pointer rests at an edge (dragover repeats); a card drag must too,
  // otherwise carrying a card to a column that is off screen needs the pointer to keep wiggling.
  it('keeps scrolling while the dragged card rests at the board edge, and stops when the drag ends', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { f, component } = await setup(vi.fn());
    // The board's live refresh keeps one polling interval running; count only the auto-scroll timer on top of it.
    const baselineTimers = vi.getTimerCount();
    const scroller = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
    } as DOMRect);
    scroller.scrollLeft = 0;

    startItemDrag(component, initialBoard().items[0]);
    component.onItemDragMoved({ pointerPosition: { x: 990, y: 300 } });
    const first = scroller.scrollLeft;
    expect(first).toBeGreaterThan(0);

    // The tick right after a move adds nothing (the move already scrolled); a resting pointer then scrolls each tick.
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS);
    expect(scroller.scrollLeft).toBe(first);
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS);
    const second = scroller.scrollLeft;
    expect(second).toBeGreaterThan(first);
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS * 3);
    expect(scroller.scrollLeft).toBeGreaterThan(second);

    // Away from the edge the timer does not scroll.
    component.onItemDragMoved({ pointerPosition: { x: 500, y: 300 } });
    const middle = scroller.scrollLeft;
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS * 4);
    expect(scroller.scrollLeft).toBe(middle);

    // Letting go stops it at once, before CDK reports the end (the preview is still settling into place).
    component.onItemDragMoved({ pointerPosition: { x: 990, y: 300 } });
    component.onItemDragReleased();
    expect(vi.getTimerCount()).toBe(baselineTimers);
    const released = scroller.scrollLeft;
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS * 3);
    expect(scroller.scrollLeft).toBe(released);

    // At the edge again, then the drag ends: nothing scrolls afterwards.
    startItemDrag(component, initialBoard().items[0]);
    component.onItemDragMoved({ pointerPosition: { x: 990, y: 300 } });
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS * 2);
    expect(vi.getTimerCount()).toBe(baselineTimers + 1);
    component.onItemDragEnded();
    expect(vi.getTimerCount()).toBe(baselineTimers); // no auto-scroll interval is left running
    const ended = scroller.scrollLeft;
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS * 5);
    expect(scroller.scrollLeft).toBe(ended);
  });

  it('keeps scrolling the page while the dragged card rests at the viewport edge without growing scrollHeight', async () => {
    vi.useFakeTimers();
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { f, component } = await setup(vi.fn());
    const page = mockPageScroller();
    const scroller = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    vi.spyOn(scroller, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 1000,
      bottom: 600,
      width: 1000,
      height: 600,
    } as DOMRect);

    startItemDrag(component, initialBoard().items[0]);
    component.onItemDragMoved({ pointerPosition: { x: 500, y: window.innerHeight - 5 } });
    const first = page.scrollTop;
    expect(first).toBeGreaterThan(0);
    const height = page.scrollHeight;

    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS);
    expect(page.scrollTop).toBe(first);
    vi.advanceTimersByTime(ITEM_AUTO_SCROLL_INTERVAL_MS);
    expect(page.scrollTop).toBeGreaterThan(first);
    expect(page.scrollHeight).toBe(height);

    component.onItemDragReleased();
  });
});
