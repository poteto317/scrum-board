import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';

describe('Board create requests', () => {
  it('freezes card inputs while creating and retains them on failure', () => {
    const pending = new Subject<never>();
    const api = { createCard: vi.fn(() => pending) };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.cardForm.setValue({ title: '保存するタイトル', description: '本文', columnId: 1 });
    board.addCard();
    board.addCard();
    expect(api.createCard).toHaveBeenCalledTimes(1);
    expect(board.cardForm.disabled).toBe(true);
    pending.error({ error: { message: '失敗' } });
    expect(board.cardForm.enabled).toBe(true);
    expect(board.cardForm.controls.title.value).toBe('保存するタイトル');
    expect(board.formError()).toBe('失敗');
  });
  it('freezes column input while creating and restores it after failure', () => {
    const pending = new Subject<never>();
    const api = { createColumn: vi.fn(() => pending) };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.columnForm.controls.name.setValue('Review');
    board.addColumn();
    expect(board.columnForm.disabled).toBe(true);
    pending.error({ error: { message: '重複' } });
    expect(board.columnForm.enabled).toBe(true);
    expect(board.columnForm.controls.name.value).toBe('Review');
  });
});
