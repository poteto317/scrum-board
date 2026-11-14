import { CDK_DRAG_CONFIG, CdkDrag, DragRefConfig } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { CARD_TOUCH_DRAG_DELAY_MS } from './card-order';

// Dragging is restricted to the left-center handle (.card-drag-handle) so clicking or selecting the card body
// never starts an accidental drag, while swiping quickly on the handle still lets the page/list scroll.
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
          backlogPosition: 0,
          prUrls: [],
          assignee: '',
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
    const target = (selector: string): HTMLElement => f.nativeElement.querySelector(selector);
    const started = vi.fn();
    const drag = f.debugElement.query(By.directive(CdkDrag));
    drag.injector.get(CdkDrag).started.subscribe(started);
    const config = drag.injector.get(CDK_DRAG_CONFIG) as DragRefConfig;
    return { target, started, config };
  }

  const handleTargets = ['.card-drag-handle', '.card-drag-handle span'];
  const nonHandleTargets = ['.task-card', '.task-card-body', '.copy-card-link'];

  it.each([...handleTargets, ...nonHandleTargets])(
    'does not start a drag when a quick swipe begins on %s, so the page and lists can scroll',
    async (selector) => {
      vi.useFakeTimers();
      try {
        const { target, started } = await renderCard();
        const el = target(selector);
        el.dispatchEvent(touch('touchstart', 100, 100));
        vi.advanceTimersByTime(50); // well inside the hold time
        const move = touch('touchmove', 100, 130); // far past the 8px threshold
        document.dispatchEvent(move);
        expect(started).not.toHaveBeenCalled();
        expect(move.defaultPrevented).toBe(false); // the browser keeps the scroll
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(handleTargets)(
    'starts a touch drag after the finger has rested on the handle (%s)',
    async (selector) => {
      vi.useFakeTimers();
      try {
        const { target, started } = await renderCard();
        const el = target(selector);
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
    },
  );

  it.each(handleTargets)('starts a mouse drag at once from the handle (%s)', async (selector) => {
    const { target, started } = await renderCard();
    const el = target(selector);
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

  it.each(nonHandleTargets)(
    'never starts a mouse drag from outside the handle (%s)',
    async (selector) => {
      const { target, started } = await renderCard();
      const el = target(selector);
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
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 130,
        }),
      );
      expect(started).not.toHaveBeenCalled();
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 130 }),
      );
    },
  );

  it.each(nonHandleTargets)(
    'never starts a touch drag even after holding outside the handle (%s)',
    async (selector) => {
      vi.useFakeTimers();
      try {
        const { target, started } = await renderCard();
        const el = target(selector);
        el.dispatchEvent(touch('touchstart', 100, 100));
        vi.advanceTimersByTime(CARD_TOUCH_DRAG_DELAY_MS + 50);
        const move = touch('touchmove', 100, 130);
        document.dispatchEvent(move);
        expect(started).not.toHaveBeenCalled();
        expect(move.defaultPrevented).toBe(false);
        document.dispatchEvent(touch('touchend', 100, 130));
      } finally {
        vi.useRealTimers();
      }
    },
  );

  // A click on the handle that wobbles a little must not start a drag until the pointer has travelled 8px.
  it('starts a mouse drag from the handle only once the pointer has travelled the 8px threshold', async () => {
    const { target, started, config } = await renderCard();
    expect(config.dragStartThreshold).toBe(8);
    const el = target('.card-drag-handle');
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
    const moveTo = (x: number, y: number) =>
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
    moveTo(107, 100);
    expect(started).not.toHaveBeenCalled();
    moveTo(100, 107);
    expect(started).not.toHaveBeenCalled();
    moveTo(108, 100);
    expect(started).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 108, clientY: 100 }),
    );
  });
});
