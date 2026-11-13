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
