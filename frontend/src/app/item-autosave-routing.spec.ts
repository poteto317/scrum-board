import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { routes } from './app.routes';
import { Api } from './api';
import { AuthSession } from './auth-session';
import { ItemDetail } from './item-detail';

const testUser = {
  id: 1,
  loginName: 'admin',
  displayName: 'Admin',
  role: 'admin' as const,
  disabled: false,
};
const authStub = {
  user: signal(testUser),
  status: signal<'authenticated'>('authenticated'),
  loadError: signal(''),
  ensureMe: () => of(testUser),
  isAdmin: () => true,
  clearSubject: () => undefined,
  login: () => of(testUser),
  logout: () => of(undefined),
};

it('guards real router reuse: rejecting discard retains the old card, then flushes before leaving', async () => {
  const base = {
    columnId: 1,
    title: '',
    description: '',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [] as string[],
    relatedItems: [] as never[],
    assignee: '',
    closeReason: '',
    solution: '',
    favorite: false,
    dueAt: null as string | null,
    createdAt: '',
    updatedAt: '',
    canEdit: true,
    canManage: true,
    viewAccess: 'open' as const,
    editAccess: 'open' as const,
    projectId: 1,
  };
  const api = {
    history: vi.fn(() => of({ events: [], nextBefore: 0 })),
    listComments: vi.fn(() => of([])),
    listUsers: vi.fn(() => of([])),
    uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
    deleteAttachment: vi.fn(() => of(undefined)),
    listAttachments: vi.fn(() => of([])),
    board: vi.fn(() => of({ columns: [{ id: 1, name: 'Todo', position: 0 }], items: [] })),
    itemByNumber: vi.fn((number: number) =>
      of({
        ...base,
        id: number + 20,
        number,
        title: `Card ${number}`,
      }),
    ),
    updateItem: vi.fn((_id, patch) =>
      of({
        ...base,
        id: 23,
        number: 3,
        title: 'Card 3',
        ...patch,
      }),
    ),
    listCommandTemplates: () => of({ templates: [] }),
    listItemCommandTemplatesByNumber: () => of({ templates: [] }),
  };
  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: Api, useValue: api },
      { provide: AuthSession, useValue: authStub },
    ],
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
