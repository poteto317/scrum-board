import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardDetail } from './card-detail';
import { Api } from './api';

describe('CardDetail', () => {
  const card = {
    id: 1,
    number: 1,
    columnId: 1,
    title: '学習',
    description: '元の説明',
    prUrl: '',
    createdAt: '',
    updatedAt: '',
  };
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    board: ReturnType<typeof vi.fn>;
    cardByNumber: ReturnType<typeof vi.fn>;
    updateCard: ReturnType<typeof vi.fn>;
    deleteCard: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    params = new BehaviorSubject(new Map([['number', '1']]));
    api = {
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
          ],
          cards: [card],
        }),
      ),
      cardByNumber: vi.fn((number: number) =>
        of({
          ...card,
          number,
          id: number === 1 ? 1 : 17,
          title: number === 1 ? '学習' : '別のカード',
        }),
      ),
      updateCard: vi.fn(() => throwError(() => ({ error: { message: '保存できません' } }))),
      deleteCard: vi.fn(),
    };
    TestBed.configureTestingModule({
      imports: [CardDetail],
      providers: [
        { provide: Api, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            snapshot: { paramMap: new Map([['number', '1']]) },
          },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
  });
  it('rejects whitespace titles without sending a request', () => {
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    f.componentInstance.form.controls.title.setValue('　 ');
    f.componentInstance.save();
    expect(api.updateCard).not.toHaveBeenCalled();
  });
  it('retains edits and selected status after a failed save', () => {
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    const c = f.componentInstance;
    c.form.patchValue({ title: '編集したタイトル', description: '編集中', columnId: 2 });
    c.save();
    expect(api.updateCard).toHaveBeenCalledWith(1, {
      title: '編集したタイトル',
      description: '編集中',
      columnId: 2,
      prUrl: '',
    });
    expect(c.form.controls.title.value).toBe('編集したタイトル');
    expect(c.form.controls.columnId.value).toBe(2);
    expect(c.error()).toBe('保存できません');
    expect(c.saving()).toBe(false);
  });
  it('reloads a reused detail component when the route ID changes', () => {
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    params.next(new Map([['number', '2']]));
    expect(api.cardByNumber).toHaveBeenLastCalledWith(2);
    expect(f.componentInstance.card()?.id).toBe(17);
    expect(f.componentInstance.form.controls.title.value).toBe('別のカード');
    f.componentInstance.save();
    expect(api.updateCard).toHaveBeenLastCalledWith(
      17,
      expect.objectContaining({ title: '別のカード' }),
    );
  });
  it('cancels stale save responses when moving directly to another card', () => {
    const pending = new Subject<typeof card>();
    api.updateCard.mockReturnValue(pending);
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    f.componentInstance.save();
    params.next(new Map([['number', '2']]));
    pending.next({ ...card, title: '古い応答' });
    pending.complete();
    expect(f.componentInstance.card()?.id).toBe(17);
    expect(f.componentInstance.form.controls.title.value).toBe('別のカード');
    expect(f.componentInstance.saving()).toBe(false);
  });
  it('loads URL number 3 and saves by the returned internal ID 18', () => {
    params.next(new Map([['number', '3']]));
    api.cardByNumber.mockReturnValue(of({ ...card, id: 18, number: 3 }));
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    expect(api.cardByNumber).toHaveBeenCalledWith(3);
    expect(f.nativeElement.querySelector('.eyebrow').textContent).toBe('TASK-003');
    f.componentInstance.save();
    expect(api.updateCard).toHaveBeenCalledWith(18, expect.any(Object));
  });
  it('deletes by internal ID 18 from URL number 3', () => {
    params.next(new Map([['number', '3']]));
    api.cardByNumber.mockReturnValue(of({ ...card, id: 18, number: 3 }));
    api.deleteCard.mockReturnValue(of(undefined));
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    f.componentInstance.remove();
    expect(api.deleteCard).toHaveBeenCalledWith(18);
  });
  it('loads, edits, saves and clears the PR link using the internal ID', () => {
    const url = 'https://github.com/poteto317/scrum-board/pull/2';
    api.cardByNumber.mockReturnValue(of({ ...card, id: 18, number: 3, prUrl: url }));
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    const input = f.nativeElement.querySelector('#detail-pr-url') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe(url);
    const link = () => f.nativeElement.querySelector('.pr-link') as HTMLAnchorElement | null;
    expect(link()?.getAttribute('href')).toBe(url);
    expect(link()?.target).toBe('_blank');
    expect(link()?.rel).toBe('noopener noreferrer');
    input.value = 'https://github.com/poteto317/scrum-board/pull/3';
    input.dispatchEvent(new Event('input'));
    f.detectChanges();
    expect(link()?.getAttribute('href')).toBe(url);
    f.componentInstance.save();
    expect(api.updateCard).toHaveBeenLastCalledWith(
      18,
      expect.objectContaining({ prUrl: input.value }),
    );
    expect(input.value).toContain('/pull/3'); // Failed save retains the edit.
    api.updateCard.mockReturnValue(of({ ...card, id: 18, number: 3, prUrl: '' }));
    input.value = '';
    input.dispatchEvent(new Event('input'));
    f.componentInstance.save();
    f.detectChanges();
    expect(api.updateCard).toHaveBeenLastCalledWith(18, expect.objectContaining({ prUrl: '' }));
    expect(link()).toBeNull();
  });
  it('does not submit an invalid PR URL', () => {
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    const input = f.nativeElement.querySelector('#detail-pr-url') as HTMLInputElement;
    expect(input).not.toBeNull();
    input.value = 'https://github.com.evil/a/b/pull/1';
    input.dispatchEvent(new Event('input'));
    f.componentInstance.save();
    f.detectChanges();
    expect(api.updateCard).not.toHaveBeenCalled();
    expect(f.nativeElement.textContent).toContain('GitHub PRのURLを入力してください');
  });
});
