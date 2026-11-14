import { CdkDrag } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { CARD_TOUCH_DRAG_DELAY_MS } from './card-order';

// Cards fill most of a column, so a swipe that starts on a card must scroll the list/board instead of dragging.
// CDK decides this from the pointer events alone (it adds no touch-action at rest), so synthetic events are enough
// to check our configuration; how a real browser then arbitrates the scroll is not covered here.
describe('Board card drag start', () => {
  // CDK reads the pointer from touches[0].pageX/pageY and listens for touchmove on the document.
  function touch(type: string, x: number, y: number) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    const point = { identifier: 0, pageX: x, pageY: y, clientX: x, clientY: y };
    for (const key of ['touches', 'targetTouches']) {
      Object.defineProperty(e, key, { value: type === 'touchend' ? [] : [point] });
    }
    Object.defineProperty(e, 'changedTouches', { value: [point] });
    return e;
  }

  async function renderCard() {
    const board = {
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      cards: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'A',
          description: '',
          position: 0,
          prUrl: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
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
    const el: HTMLElement = f.nativeElement.querySelector('.task-card');
    const started = vi.fn();
    f.debugElement.query(By.directive(CdkDrag)).injector.get(CdkDrag).started.subscribe(started);
    return { el, started };
  }

  it('does not start a drag when a swipe begins on a card, so the page and lists can scroll', async () => {
    vi.useFakeTimers();
    try {
      const { el, started } = await renderCard();
      el.dispatchEvent(touch('touchstart', 100, 100));
      vi.advanceTimersByTime(50); // well inside the hold time
      const move = touch('touchmove', 100, 130); // far past the 8px threshold
      document.dispatchEvent(move);
      expect(started).not.toHaveBeenCalled();
      expect(move.defaultPrevented).toBe(false); // the browser keeps the scroll
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts a drag after the finger has rested on the card', async () => {
    vi.useFakeTimers();
    try {
      const { el, started } = await renderCard();
      el.dispatchEvent(touch('touchstart', 100, 100));
      vi.advanceTimersByTime(CARD_TOUCH_DRAG_DELAY_MS + 50);
      const move = touch('touchmove', 100, 130);
      document.dispatchEvent(move);
      expect(started).toHaveBeenCalledTimes(1);
      expect(move.defaultPrevented).toBe(true);
      document.dispatchEvent(touch('touchend', 100, 130));
    } finally {
      vi.useRealTimers();
    }
  });

  it('still starts a mouse drag at once', async () => {
    const { el, started } = await renderCard();
    // CDK ignores a mousedown whose buttons or detail is 0 as a screen reader's fake click.
    el.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 100, clientY: 130 }),
    );
    expect(started).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 130 }),
    );
  });
});
