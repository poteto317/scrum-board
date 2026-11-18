import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { routes } from './app.routes';
import { Api } from './api';
import { ItemDetail } from './item-detail';

it('guards real router reuse: rejecting discard retains the old card, then flushes before leaving', async () => {
  const api = {
    history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
    board: vi.fn(() => of({ columns: [{ id: 1, name: 'Todo', position: 0 }], items: [] })),
    itemByNumber: vi.fn((number: number) =>
      of({
        id: number + 20,
        number,
        columnId: 1,
        title: `Card ${number}`,
        description: '',
        position: 0,
        backlogPosition: 0,
    offsetY: 0,
        prUrls: [],
        relatedItems: [],
        assignee: '',
        closeReason: '',
        solution: '',
        favorite: false,
        dueAt: null,
        createdAt: '',
        updatedAt: '',
      }),
    ),
    updateItem: vi.fn((_id, patch) =>
      of({
        id: 23,
        number: 3,
        columnId: 1,
        title: 'Card 3',
        description: '',
        position: 0,
        backlogPosition: 0,
    offsetY: 0,
        prUrls: [],
        relatedItems: [],
        assignee: '',
        closeReason: '',
        solution: '',
        favorite: false,
        dueAt: null,
        createdAt: '',
        updatedAt: '',
        ...patch,
      }),
    ),
    listCommandTemplates: () => of({ templates: [] }),
    listItemCommandTemplatesByNumber: () => of({ templates: [] }),
  };
  TestBed.configureTestingModule({
    providers: [provideRouter(routes), { provide: Api, useValue: api }],
  });
  const harness = await RouterTestingHarness.create();
  const detail = await harness.navigateByUrl('/items/3', ItemDetail);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  try {
    detail.form.controls.title.setValue('');
    await harness.navigateByUrl('/items/7');
    expect(detail.item()?.number).toBe(3);
    expect(api.itemByNumber).not.toHaveBeenCalledWith(7);
    detail.form.controls.title.setValue('Before navigation');
    const next = await harness.navigateByUrl('/items/7', ItemDetail);
    expect(api.updateItem).toHaveBeenCalledWith(23, { title: 'Before navigation' });
    expect(next.item()?.number).toBe(7);
  } finally {
    confirm.mockRestore();
  }
});
