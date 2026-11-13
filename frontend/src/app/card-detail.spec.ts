import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CardDetail } from './card-detail';
import { Api } from './api';
import { Card } from './models';
const card: Card = {
  id: 18,
  number: 3,
  columnId: 1,
  title: '学習',
  description: '元の説明',
  prUrl: '',
  createdAt: '',
  updatedAt: '',
};
describe('CardDetail autosave', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    cardByNumber: ReturnType<typeof vi.fn>;
    updateCard: ReturnType<typeof vi.fn>;
    deleteCard: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    params = new BehaviorSubject(new Map([['number', '3']]));
    router = { navigate: vi.fn() };
    api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
          ],
          cards: [],
        }),
      ),
      cardByNumber: vi.fn(() => of(card)),
      updateCard: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteCard: vi.fn(() => of(undefined)),
    };
    TestBed.configureTestingModule({
      imports: [CardDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: router },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const create = () => {
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    return f;
  };
  it('refreshes history after a successful autosave without resetting the draft', () => {
    api.updateCard.mockImplementation((_id, patch) =>
      of({ ...card, ...patch, updatedAt: '2026-11-13T00:00:00Z' }),
    );
    const f = create();
    expect(api.history).toHaveBeenCalledTimes(1);
    f.componentInstance.form.controls.description.setValue('history refresh');
    f.componentInstance.autosave.flush();
    f.detectChanges();
    expect(api.history).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.form.controls.description.value).toBe('history refresh');
  });
  it('has no manual save button and never saves just by loading', () => {
    const f = create();
    expect(f.nativeElement.querySelector('button[type="submit"]')).toBeNull();
    vi.advanceTimersByTime(2500);
    expect(api.updateCard).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.eyebrow').textContent).toBe('TASK-003');
  });
  it('saves the status selection immediately using the internal ID and leaves inputs enabled', () => {
    const pending = new Subject<Card>();
    api.updateCard.mockReturnValue(pending);
    const f = create();
    const select = f.nativeElement.querySelector('#detail-status') as HTMLSelectElement;
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    expect(api.updateCard).toHaveBeenCalledWith(18, { columnId: 2 });
    expect(f.componentInstance.form.enabled).toBe(true);
  });
  it('saves text on blur and displays failure without clearing edits', () => {
    api.updateCard.mockReturnValue(throwError(() => ({ error: { message: '通信失敗' } })));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-title') as HTMLInputElement;
    input.value = '編集中';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(api.updateCard).toHaveBeenCalledWith(18, { title: '編集中' });
    expect(input.value).toBe('編集中');
    expect(f.nativeElement.textContent).toContain('通信失敗');
    expect(f.nativeElement.textContent).toContain('再試行');
  });
  const typed: Record<'title' | 'description' | 'prUrl', [string, string, unknown]> = {
    title: ['#detail-title', '新しいタイトル', { title: '新しいタイトル' }],
    description: ['#detail-description', '新しい本文', { description: '新しい本文' }],
    prUrl: [
      '#detail-pr-url',
      'https://github.com/poteto317/scrum-board/pull/9',
      { prUrl: 'https://github.com/poteto317/scrum-board/pull/9' },
    ],
  };
  it.each(['title', 'description', 'prUrl'] as const)(
    'holds %s while composing and saves it after compositionend',
    (field) => {
      const [selector, value, patch] = typed[field];
      const f = create();
      const input = f.nativeElement.querySelector(selector) as HTMLInputElement;
      input.dispatchEvent(new Event('compositionstart'));
      input.value = value;
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(2500);
      expect(api.updateCard).not.toHaveBeenCalled();
      input.dispatchEvent(new Event('compositionend'));
      vi.advanceTimersByTime(600);
      expect(api.updateCard).toHaveBeenCalledTimes(1);
      expect(api.updateCard).toHaveBeenCalledWith(18, patch);
    },
  );
  it.each(['title', 'description', 'prUrl'] as const)('saves %s immediately on blur', (field) => {
    const [selector, value, patch] = typed[field];
    const f = create();
    const input = f.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    expect(api.updateCard).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('blur'));
    expect(api.updateCard).toHaveBeenCalledTimes(1);
    expect(api.updateCard).toHaveBeenCalledWith(18, patch);
  });
  it('cancels the pending save when the screen is destroyed', () => {
    const f = create();
    const input = f.nativeElement.querySelector('#detail-title') as HTMLInputElement;
    input.value = '破棄される編集';
    input.dispatchEvent(new Event('input'));
    f.destroy();
    vi.advanceTimersByTime(2500);
    expect(api.updateCard).not.toHaveBeenCalled();
  });
  it('keeps an invalid PR URL unsent and uses only the saved PR as a link', () => {
    const url = 'https://github.com/poteto317/scrum-board/pull/2';
    api.cardByNumber.mockReturnValue(of({ ...card, prUrl: url }));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-pr-url') as HTMLInputElement;
    input.value = 'https://github.com.evil/a/b/pull/1';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(api.updateCard).not.toHaveBeenCalled();
    const link = f.nativeElement.querySelector('.pr-link');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.rel).toBe('noopener noreferrer');
    expect(f.nativeElement.textContent).toContain('GitHub PRのURLを入力してください');
  });
  it('flushes edits before allowing navigation', async () => {
    const pending = new Subject<Card>();
    api.updateCard.mockReturnValue(pending);
    const f = create();
    f.componentInstance.form.controls.description.setValue('移動前');
    const leaving = f.componentInstance.canLeave();
    expect(api.updateCard).toHaveBeenCalledWith(18, { description: '移動前' });
    pending.next({ ...card, description: '移動前' });
    pending.complete();
    expect(await leaving).toBe(true);
  });
  it('lets the user reject discarding invalid edits', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const f = create();
    f.componentInstance.form.controls.title.setValue('');
    expect(await f.componentInstance.canLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(f.componentInstance.form.controls.title.value).toBe('');
  });
  it('ignores an old response after switching directly to another card', () => {
    const pending = new Subject<Card>();
    api.updateCard.mockReturnValue(pending);
    const f = create();
    f.componentInstance.form.controls.title.setValue('送信');
    f.componentInstance.autosave.flush();
    api.cardByNumber.mockReturnValue(of({ ...card, id: 99, number: 40, title: '別カード' }));
    params.next(new Map([['number', '40']]));
    pending.next({ ...card, title: '古い応答' });
    pending.complete();
    vi.advanceTimersByTime(2500);
    expect(f.componentInstance.card()?.id).toBe(99);
    expect(f.componentInstance.form.controls.title.value).toBe('別カード');
    expect(api.updateCard).toHaveBeenCalledTimes(1);
  });
  it('warns on unload with unsaved data', () => {
    const f = create();
    f.componentInstance.form.controls.title.setValue('未保存');
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent;
    f.componentInstance.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
  it('deletes by internal ID, cancels pending save and bypasses discarded-draft warnings', async () => {
    const f = create();
    f.componentInstance.form.controls.description.setValue('未保存');
    f.componentInstance.remove();
    vi.advanceTimersByTime(2500);
    expect(api.deleteCard).toHaveBeenCalledWith(18);
    expect(api.updateCard).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
    expect(await f.componentInstance.canLeave()).toBe(true);
  });
});

describe('CardDetail IME response handling', () => {
  it.each(['title', 'description', 'prUrl'] as const)(
    'preserves buffered IME input in %s when an earlier save responds',
    (field) => {
      const pending = new Subject<Card>();
      TestBed.configureTestingModule({
        imports: [CardDetail],
        providers: [
          {
            provide: Api,
            useValue: {
              history: () => of({ events: [], nextBefore: 0 }),
              board: () => of({ columns: [], cards: [] }),
              cardByNumber: () => of(card),
              updateCard: () => pending,
            },
          },
          { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['number', '3']])) } },
          { provide: Router, useValue: { navigate: vi.fn() } },
        ],
      });
      const f = TestBed.createComponent(CardDetail);
      f.detectChanges();
      const selector = field === 'prUrl' ? '#detail-pr-url' : `#detail-${field}`;
      const input = f.nativeElement.querySelector(selector) as HTMLInputElement;
      const sent = field === 'prUrl' ? 'https://github.com/a/b/pull/1' : '送信するタイトル';
      input.value = sent;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      input.dispatchEvent(new Event('compositionstart'));
      input.value = '変換途中の日本語';
      input.dispatchEvent(new Event('input'));
      expect(f.componentInstance.form.controls[field].value).toBe(sent);
      // The response differs from what the user sees, so only the composing guard keeps the DOM value.
      const serverValue = field === 'prUrl' ? 'https://github.com/a/b/pull/2' : '別の人の編集';
      pending.next({ ...card, [field]: serverValue });
      pending.complete();
      expect(input.value).toBe('変換途中の日本語');
      input.dispatchEvent(new Event('compositionend'));
      expect(f.componentInstance.form.controls[field].value).toBe('変換途中の日本語');
      f.destroy();
    },
  );
});
