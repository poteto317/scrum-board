import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { normalizeBoardData } from './board-data';
import { Item } from './models';

// Real Board wiring: removing the layout guard or signal equality breaks these tests.
describe('Board card height measurement', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mount(layout: 'pack' | 'free', mobile = false) {
    const media = { matches: mobile, addEventListener: vi.fn((_type: string, _cb: () => void) => {}), removeEventListener: vi.fn() };
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    const data = normalizeBoardData({
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      items: [{ id: 1, projectId: 1, number: 1, columnId: 1, title: 'A', description: '',
        position: 0, backlogPosition: 0, offsetY: 40, prUrls: [], relatedItems: [],
        assignee: '', closeReason: '', solution: '', favorite: false, dueAt: null,
        createdAt: '', updatedAt: '' } satisfies Item],
      settings: { cardLayout: layout, activeProjectId: 1 },
    });
    TestBed.configureTestingModule({ imports: [Board], providers: [provideRouter([]), {
      provide: Api, useValue: {
        board: () => of(data), listCommandTemplates: () => of({ templates: [] }),
        listLabels: () => of({ labels: [] }),
        listFilter: () => of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
      },
    }] });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.detectChanges();
    const c = f.componentInstance;
    const internals = c as unknown as {
      scheduleCardHeightMeasure: () => void;
      cardHeights: () => ReadonlyMap<number, number>;
    };
    const el = f.nativeElement.querySelector('.task-card') as HTMLElement;
    const rect = vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height: 80 } as DOMRect);
    const flush = async () => { f.detectChanges(); await f.whenStable(); };
    return { f, c, internals, rect, media, flush };
  }

  it.each([['pack', false], ['free', true]] as const)(
    'does not read card dimensions in %s with mobile=%s', async (layout, mobile) => {
      const { internals, rect, flush } = await mount(layout, mobile);
      internals.scheduleCardHeightMeasure();
      await flush();
      expect(rect).not.toHaveBeenCalled();
    },
  );

  it('rechecks the layout when a queued measurement runs', async () => {
    const { c, internals, rect, flush } = await mount('free');
    internals.scheduleCardHeightMeasure();
    c.data.update(d => ({ ...d, settings: { ...d.settings, cardLayout: 'pack' } }));
    await flush();
    expect(rect).not.toHaveBeenCalled();
  });

  it('keeps equal height maps and updates changed heights and removed cards', async () => {
    const { f, internals, rect, flush } = await mount('free');
    internals.scheduleCardHeightMeasure(); await flush();
    const first = internals.cardHeights();
    expect(first.get(1)).toBe(80);
    internals.scheduleCardHeightMeasure(); await flush();
    expect(internals.cardHeights()).toBe(first);
    rect.mockReturnValue({ height: 95 } as DOMRect);
    internals.scheduleCardHeightMeasure(); await flush();
    expect(internals.cardHeights().get(1)).toBe(95);
    expect(internals.cardHeights()).not.toBe(first);
    // Same number of cards, different ID must not compare equal.
    f.nativeElement.querySelector('.task-card').setAttribute('data-card-id', '2');
    internals.scheduleCardHeightMeasure(); await flush();
    expect([...internals.cardHeights()]).toEqual([[2, 95]]);
    f.nativeElement.querySelector('.task-card').remove();
    internals.scheduleCardHeightMeasure(); await flush();
    expect(internals.cardHeights().size).toBe(0);
  });

  it.each(['free', 'pack'] as const)('remeasures desktop return only for free (%s)', async layout => {
    const { media, internals, rect, flush } = await mount(layout, true);
    media.matches = false;
    const listener = media.addEventListener.mock.calls.find(call => call[0] === 'change')?.[1];
    expect(listener).toBeTypeOf('function');
    listener!();
    await flush();
    if (layout === 'free') {
      expect(rect).toHaveBeenCalled();
      expect(internals.cardHeights().get(1)).toBe(80);
    } else expect(rect).not.toHaveBeenCalled();
  });

  it('does not read dimensions after destruction', async () => {
    const { f, internals, rect } = await mount('free');
    internals.scheduleCardHeightMeasure();
    f.destroy();
    TestBed.tick();
    expect(rect).not.toHaveBeenCalled();
  });
});
