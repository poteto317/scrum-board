import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { routes } from './app.routes';
import { Api } from './api';
import { CardDetail } from './card-detail';

it('guards real router reuse: rejecting discard retains the old card, then flushes before leaving', async () => {
  const api = {
    history: vi.fn(() => of({ events: [], nextBefore: 0 })),
    board: vi.fn(() => of({ columns: [{ id: 1, name: 'Todo', position: 0 }], cards: [] })),
    cardByNumber: vi.fn((number: number) =>
      of({
        id: number + 20,
        number,
        columnId: 1,
        title: `Card ${number}`,
        description: '',
        backlogPosition: 0,
        prUrl: '',
        createdAt: '',
        updatedAt: '',
      }),
    ),
    updateCard: vi.fn((_id, patch) =>
      of({
        id: 23,
        number: 3,
        columnId: 1,
        title: 'Card 3',
        description: '',
        backlogPosition: 0,
        prUrl: '',
        createdAt: '',
        updatedAt: '',
        ...patch,
      }),
    ),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), { provide: Api, useValue: api }],
  });
  const harness = await RouterTestingHarness.create();
  const detail = await harness.navigateByUrl('/cards/3', CardDetail);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    detail.form.controls.title.setValue('');
    await harness.navigateByUrl('/cards/7');
    expect(detail.card()?.number).toBe(3);
    expect(api.cardByNumber).not.toHaveBeenCalledWith(7);
    detail.form.controls.title.setValue('Before navigation');
    const next = await harness.navigateByUrl('/cards/7', CardDetail);
    expect(api.updateCard).toHaveBeenCalledWith(23, { title: 'Before navigation' });
    expect(next.card()?.number).toBe(7);
  } finally {
    confirm.mockRestore();
  }
});
