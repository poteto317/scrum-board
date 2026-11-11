import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CardDetail } from './card-detail';
import { Api } from './api';

describe('CardDetail', () => {
  const card = {
    id: 1,
    columnId: 1,
    title: '学習',
    description: '元の説明',
    createdAt: '',
    updatedAt: '',
  };
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    board: ReturnType<typeof vi.fn>;
    card: ReturnType<typeof vi.fn>;
    updateCard: ReturnType<typeof vi.fn>;
    deleteCard: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    params = new BehaviorSubject(new Map([['id', '1']]));
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
      card: vi.fn((id: number) => of({ ...card, id, title: id === 1 ? '学習' : '別のカード' })),
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
            snapshot: { paramMap: new Map([['id', '1']]) },
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
    });
    expect(c.form.controls.title.value).toBe('編集したタイトル');
    expect(c.form.controls.columnId.value).toBe(2);
    expect(c.error()).toBe('保存できません');
    expect(c.saving()).toBe(false);
  });
  it('reloads a reused detail component when the route ID changes', () => {
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    params.next(new Map([['id', '2']]));
    expect(api.card).toHaveBeenLastCalledWith(2);
    expect(f.componentInstance.card()?.id).toBe(2);
    expect(f.componentInstance.form.controls.title.value).toBe('別のカード');
    f.componentInstance.save();
    expect(api.updateCard).toHaveBeenLastCalledWith(
      2,
      expect.objectContaining({ title: '別のカード' }),
    );
  });
  it('cancels stale save responses when moving directly to another card', () => {
    const pending = new Subject<typeof card>();
    api.updateCard.mockReturnValue(pending);
    const f = TestBed.createComponent(CardDetail);
    f.detectChanges();
    f.componentInstance.save();
    params.next(new Map([['id', '2']]));
    pending.next({ ...card, title: '古い応答' });
    pending.complete();
    expect(f.componentInstance.card()?.id).toBe(2);
    expect(f.componentInstance.form.controls.title.value).toBe('別のカード');
    expect(f.componentInstance.saving()).toBe(false);
  });
});
