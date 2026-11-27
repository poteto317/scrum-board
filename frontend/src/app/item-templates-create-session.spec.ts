import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { Api } from './api';
import { ItemTemplatesCreateSession } from './item-templates-create-session';
import { ITEM_TEMPLATE_CREATE_SUCCESS } from './item-template';

describe('ItemTemplatesCreateSession', () => {
  it('ignores an older list response after a newer load', () => {
    const first = new Subject<{ templates: never[] }>();
    const second = new Subject<{ templates: { id: number }[] }>();
    let calls = 0;
    const listItemTemplates = vi.fn(() => {
      calls += 1;
      return calls === 1 ? first : second;
    });
    TestBed.configureTestingModule({
      providers: [
        ItemTemplatesCreateSession,
        { provide: Api, useValue: { listItemTemplates } },
      ],
    });
    const session = TestBed.inject(ItemTemplatesCreateSession);
    session.load(1);
    session.load(1);
    second.next({ templates: [{ id: 9 } as never] });
    first.next({ templates: [] });
    expect(session.templates()).toEqual([{ id: 9 }]);
  });

  it('does not create while saving is true', () => {
    const createItemTemplate = vi.fn(() => of({ id: 1 }));
    TestBed.configureTestingModule({
      providers: [
        ItemTemplatesCreateSession,
        { provide: Api, useValue: { createItemTemplate, listItemTemplates: () => of({ templates: [] }) } },
      ],
    });
    const session = TestBed.inject(ItemTemplatesCreateSession);
    session.createForm.setValue({ name: 'n', titleTemplate: 't', descriptionTemplate: '' });
    const saving = signal(true);
    session.create(1, saving);
    expect(createItemTemplate).not.toHaveBeenCalled();
  });

  it('sets adminMessage on successful create', () => {
    TestBed.configureTestingModule({
      providers: [
        ItemTemplatesCreateSession,
        {
          provide: Api,
          useValue: {
            createItemTemplate: () => of({ id: 2, projectId: 1, name: 'n', titleTemplate: 't', descriptionTemplate: '', position: 0 }),
            listItemTemplates: () => of({ templates: [] }),
          },
        },
      ],
    });
    const session = TestBed.inject(ItemTemplatesCreateSession);
    session.createForm.setValue({ name: 'n', titleTemplate: 't', descriptionTemplate: '' });
    const saving = signal(false);
    session.create(1, saving);
    expect(session.adminMessage()).toBe(ITEM_TEMPLATE_CREATE_SUCCESS);
  });

  it('skips delete when confirmFn returns false', () => {
    const deleteItemTemplate = vi.fn(() => of(void 0));
    TestBed.configureTestingModule({
      providers: [
        ItemTemplatesCreateSession,
        { provide: Api, useValue: { deleteItemTemplate, listItemTemplates: () => of({ templates: [] }) } },
      ],
    });
    const session = TestBed.inject(ItemTemplatesCreateSession);
    session.remove(1, 3, signal(false), () => false);
    expect(deleteItemTemplate).not.toHaveBeenCalled();
  });
});
