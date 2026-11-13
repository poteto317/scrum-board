import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { CardHistory } from './card-history';
import { Api } from './api';
import { HistoryPage } from './models';
const event = {
  id: 1,
  kind: 'restored',
  occurredAt: '2026-11-12T10:00:00Z',
  recordedAt: '2026-11-13T10:00:00Z',
  changes: [{ field: 'status', before: 'Todo', after: 'Done' }],
  note: '観測時点の復元',
  evidenceUrl: 'https://github.com/a/b/pull/2',
};
it('shows recovered evidence and appends the next page', () => {
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(of({ events: [event], nextBefore: 1 }))
      .mockReturnValueOnce(of({ events: [{ ...event, id: 2 }], nextBefore: 0 })),
  };
  TestBed.configureTestingModule({
    imports: [CardHistory],
    providers: [{ provide: Api, useValue: api }],
  });
  const f = TestBed.createComponent(CardHistory);
  f.componentRef.setInput('number', 3);
  f.detectChanges();
  expect(f.nativeElement.textContent).toContain('復元');
  expect(f.nativeElement.textContent).toContain('Todo');
  expect(f.nativeElement.textContent).toContain('Done');
  expect(f.nativeElement.querySelector('a').getAttribute('href')).toBe(event.evidenceUrl);
  f.componentInstance.more();
  f.detectChanges();
  expect(api.history).toHaveBeenLastCalledWith(3, 1);
  expect(f.componentInstance.events()).toHaveLength(2);
});
it('ignores old pages on route or revision change', () => {
  const pending = new Subject<HistoryPage>();
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValue(of({ events: [], nextBefore: 0 })),
  };
  TestBed.configureTestingModule({
    imports: [CardHistory],
    providers: [{ provide: Api, useValue: api }],
  });
  const f = TestBed.createComponent(CardHistory);
  f.componentRef.setInput('number', 3);
  f.detectChanges();
  f.componentRef.setInput('number', 7);
  f.detectChanges();
  pending.next({ events: [event], nextBefore: 0 });
  pending.complete();
  expect(f.componentInstance.events()).toEqual([]);
  expect(api.history).toHaveBeenLastCalledWith(7, 0);
  f.componentRef.setInput('revision', 'saved');
  f.detectChanges();
  expect(api.history).toHaveBeenCalledTimes(3);
});
it('retains prior events on pagination errors and retries', () => {
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(of({ events: [event], nextBefore: 1 }))
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValue(of({ events: [], nextBefore: 0 })),
  };
  TestBed.configureTestingModule({
    imports: [CardHistory],
    providers: [{ provide: Api, useValue: api }],
  });
  const f = TestBed.createComponent(CardHistory);
  f.componentRef.setInput('number', 3);
  f.detectChanges();
  f.componentInstance.more();
  f.detectChanges();
  expect(f.componentInstance.events()).toHaveLength(1);
  expect(f.nativeElement.textContent).toContain('再試行');
  f.componentInstance.retry();
  expect(api.history).toHaveBeenLastCalledWith(3, 1);
});
function setup(api: { history: ReturnType<typeof vi.fn> }, number = 3) {
  TestBed.configureTestingModule({
    imports: [CardHistory],
    providers: [{ provide: Api, useValue: api }],
  });
  const f = TestBed.createComponent(CardHistory);
  f.componentRef.setInput('number', number);
  f.detectChanges();
  return f;
}
const articles = (f: { nativeElement: HTMLElement }) => f.nativeElement.querySelectorAll('article');
it('keeps the loaded list while a revision refresh is pending and keeps the DOM', () => {
  const pending = new Subject<HistoryPage>();
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(of({ events: [{ ...event, id: 2 }, event], nextBefore: 0 }))
      .mockReturnValueOnce(pending),
  };
  const f = setup(api);
  const before = Array.from(articles(f));
  const details = f.nativeElement.querySelector('details') as HTMLDetailsElement;
  details.open = false;
  f.componentRef.setInput('revision', 'saved');
  f.detectChanges();
  expect(f.componentInstance.events()).toHaveLength(2);
  expect(articles(f)).toHaveLength(2);
  pending.next({ events: [{ ...event, id: 3 }, { ...event, id: 2 }, event], nextBefore: 0 });
  pending.complete();
  f.detectChanges();
  expect(articles(f)).toHaveLength(3);
  expect(articles(f)[1]).toBe(before[0]);
  expect(articles(f)[2]).toBe(before[1]);
  expect((articles(f)[1].querySelector('details') as HTMLDetailsElement).open).toBe(false);
});
it('keeps pages loaded with "more" when the revision refresh succeeds', () => {
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(of({ events: [{ ...event, id: 5 }], nextBefore: 5 }))
      .mockReturnValueOnce(of({ events: [{ ...event, id: 4 }], nextBefore: 0 }))
      .mockReturnValueOnce(
        of({
          events: [
            { ...event, id: 6 },
            { ...event, id: 5 },
          ],
          nextBefore: 5,
        }),
      ),
  };
  const f = setup(api);
  f.componentInstance.more();
  f.componentRef.setInput('revision', 'saved');
  f.detectChanges();
  expect(f.componentInstance.events().map((e) => e.id)).toEqual([6, 5, 4]);
  expect(f.componentInstance.nextBefore()).toBe(0);
});
it('clears the list at once when the card changes', () => {
  const pending = new Subject<HistoryPage>();
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(of({ events: [event], nextBefore: 1 }))
      .mockReturnValueOnce(pending),
  };
  const f = setup(api);
  f.componentRef.setInput('number', 7);
  f.detectChanges();
  expect(f.componentInstance.events()).toEqual([]);
  expect(f.componentInstance.nextBefore()).toBe(0);
  expect(articles(f)).toHaveLength(0);
});
it('keeps the list when a revision refresh fails and retries', () => {
  const api = {
    history: vi
      .fn()
      .mockReturnValueOnce(of({ events: [event], nextBefore: 0 }))
      .mockReturnValueOnce(throwError(() => ({ status: 500 })))
      .mockReturnValue(of({ events: [{ ...event, id: 2 }, event], nextBefore: 0 })),
  };
  const f = setup(api);
  f.componentRef.setInput('revision', 'saved');
  f.detectChanges();
  expect(f.componentInstance.events()).toHaveLength(1);
  expect(f.componentInstance.error()).toBe(true);
  f.componentInstance.retry();
  expect(f.componentInstance.events().map((e) => e.id)).toEqual([2, 1]);
  expect(f.componentInstance.error()).toBe(false);
});
