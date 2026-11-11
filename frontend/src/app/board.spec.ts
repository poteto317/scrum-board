import { provideRouter } from '@angular/router';
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

describe('Board task numbers', () => {
  it('shows the task number while linking to the stable internal ID', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () =>
              of({
                columns: [{ id: 1, name: 'Todo', position: 0 }],
                cards: [
                  {
                    id: 17,
                    number: 2,
                    columnId: 1,
                    title: 'Task',
                    description: '',
                    createdAt: '',
                    updatedAt: '',
                  },
                ],
              }),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const link: HTMLAnchorElement = f.nativeElement.querySelector('.task-card');
    expect(link.textContent).toContain('TASK-002');
    expect(link.getAttribute('href')).toBe('/cards/17');
  });
});
