import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import {
  CARD_COMMANDS_SAVE_SUCCESS,
  CardCommandsSession,
} from './card-commands-session';

describe('CardCommandsSession', () => {
  let api: {
    listCardCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    replaceCardCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
  };
  let session: CardCommandsSession;

  beforeEach(() => {
    api = {
      listCardCommandTemplatesByNumber: vi.fn(),
      replaceCardCommandTemplatesByNumber: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [CardCommandsSession, { provide: Api, useValue: api }],
    });
    session = TestBed.inject(CardCommandsSession);
  });

  it('loads templates for a card number', () => {
    const templates = [{ id: 1, name: 'a', template: 'x', position: 0 }];
    api.listCardCommandTemplatesByNumber.mockReturnValue(of({ templates }));
    session.load(3);
    expect(api.listCardCommandTemplatesByNumber).toHaveBeenCalledWith(3);
    expect(session.templates()).toEqual(templates);
    expect(session.selectedIds()).toEqual([1]);
  });

  it('stores load errors without pretending the list is empty successfully', () => {
    api.listCardCommandTemplatesByNumber.mockReturnValue(throwError(() => ({ status: 0 })));
    session.load(3);
    expect(session.templates()).toEqual([]);
    expect(session.loadError()).toContain('通信に失敗しました');
  });

  it('saves selected ids and refreshes from the response', () => {
    api.listCardCommandTemplatesByNumber.mockReturnValue(of({ templates: [] }));
    session.load(3);
    session.toggle(9, true);
    const saved = [{ id: 9, name: 'b', template: 'y', position: 0 }];
    api.replaceCardCommandTemplatesByNumber.mockReturnValue(of({ templates: saved }));
    session.save();
    expect(api.replaceCardCommandTemplatesByNumber).toHaveBeenCalledWith(3, [9]);
    expect(session.templates()).toEqual(saved);
    expect(session.saveMessage()).toBe(CARD_COMMANDS_SAVE_SUCCESS);
  });

  it('does not save while loading or after a load error', () => {
    const pending = new Subject<{ templates: { id: number; name: string; template: string; position: number }[] }>();
    api.listCardCommandTemplatesByNumber.mockReturnValue(pending);
    session.load(3);
    expect(session.loading()).toBe(true);
    session.save();
    expect(api.replaceCardCommandTemplatesByNumber).not.toHaveBeenCalled();
    pending.error({ status: 0 });
    expect(session.loading()).toBe(false);
    session.save();
    expect(api.replaceCardCommandTemplatesByNumber).not.toHaveBeenCalled();
  });

  it('marks dirty after toggle and clears the previous save message', () => {
    const templates = [{ id: 1, name: 'a', template: 'x', position: 0 }];
    api.listCardCommandTemplatesByNumber.mockReturnValue(of({ templates }));
    session.load(3);
    api.replaceCardCommandTemplatesByNumber.mockReturnValue(of({ templates }));
    session.save();
    expect(session.saveMessage()).toBe(CARD_COMMANDS_SAVE_SUCCESS);
    expect(session.isDirty()).toBe(false);
    session.toggle(1, false);
    expect(session.isDirty()).toBe(true);
    expect(session.saveMessage()).toBe('');
  });
});
