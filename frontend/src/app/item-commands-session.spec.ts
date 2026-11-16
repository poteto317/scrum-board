import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import {
  ITEM_COMMANDS_SAVE_SUCCESS,
  ItemCommandsSession,
} from './item-commands-session';

describe('ItemCommandsSession', () => {
  let api: {
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    replaceItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
  };
  let session: ItemCommandsSession;

  beforeEach(() => {
    api = {
      listItemCommandTemplatesByNumber: vi.fn(),
      replaceItemCommandTemplatesByNumber: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [ItemCommandsSession, { provide: Api, useValue: api }],
    });
    session = TestBed.inject(ItemCommandsSession);
  });

  it('loads templates for a card number', () => {
    const templates = [{ id: 1, name: 'a', template: 'x', position: 0 }];
    api.listItemCommandTemplatesByNumber.mockReturnValue(of({ templates }));
    session.load(3);
    expect(api.listItemCommandTemplatesByNumber).toHaveBeenCalledWith(3);
    expect(session.templates()).toEqual(templates);
    expect(session.selectedIds()).toEqual([1]);
  });

  it('stores load errors without pretending the list is empty successfully', () => {
    api.listItemCommandTemplatesByNumber.mockReturnValue(throwError(() => ({ status: 0 })));
    session.load(3);
    expect(session.templates()).toEqual([]);
    expect(session.loadError()).toContain('通信に失敗しました');
  });

  it('saves selected ids and refreshes from the response', () => {
    api.listItemCommandTemplatesByNumber.mockReturnValue(of({ templates: [] }));
    session.load(3);
    session.toggle(9, true);
    const saved = [{ id: 9, name: 'b', template: 'y', position: 0 }];
    api.replaceItemCommandTemplatesByNumber.mockReturnValue(of({ templates: saved }));
    session.save();
    expect(api.replaceItemCommandTemplatesByNumber).toHaveBeenCalledWith(3, [9]);
    expect(session.templates()).toEqual(saved);
    expect(session.saveMessage()).toBe(ITEM_COMMANDS_SAVE_SUCCESS);
  });

  it('does not save while loading or after a load error', () => {
    const pending = new Subject<{ templates: { id: number; name: string; template: string; position: number }[] }>();
    api.listItemCommandTemplatesByNumber.mockReturnValue(pending);
    session.load(3);
    expect(session.loading()).toBe(true);
    session.save();
    expect(api.replaceItemCommandTemplatesByNumber).not.toHaveBeenCalled();
    pending.error({ status: 0 });
    expect(session.loading()).toBe(false);
    session.save();
    expect(api.replaceItemCommandTemplatesByNumber).not.toHaveBeenCalled();
  });

  it('marks dirty after toggle and clears the previous save message', () => {
    const templates = [{ id: 1, name: 'a', template: 'x', position: 0 }];
    api.listItemCommandTemplatesByNumber.mockReturnValue(of({ templates }));
    session.load(3);
    api.replaceItemCommandTemplatesByNumber.mockReturnValue(of({ templates }));
    session.save();
    expect(session.saveMessage()).toBe(ITEM_COMMANDS_SAVE_SUCCESS);
    expect(session.isDirty()).toBe(false);
    session.toggle(1, false);
    expect(session.isDirty()).toBe(true);
    expect(session.saveMessage()).toBe('');
  });
});
