import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { CommandTemplate } from './command-template';
import {
  COMMAND_CREATE_SUCCESS,
  COMMAND_DELETE_SUCCESS,
  COMMAND_LIST_LOAD_FAILURE,
  COMMAND_UPDATE_SUCCESS,
  CommandTemplatesSession,
} from './command-templates-session';

const existing: CommandTemplate = {
  id: 4,
  name: 'gh pr',
  template: 'gh pr view {{url}}',
  position: 0,
};

describe('CommandTemplatesSession', () => {
  let api: {
    listCommandTemplates: ReturnType<typeof vi.fn>;
    createCommandTemplate: ReturnType<typeof vi.fn>;
    updateCommandTemplate: ReturnType<typeof vi.fn>;
    deleteCommandTemplate: ReturnType<typeof vi.fn>;
  };
  let session: CommandTemplatesSession;

  beforeEach(() => {
    api = {
      listCommandTemplates: vi.fn(),
      createCommandTemplate: vi.fn(),
      updateCommandTemplate: vi.fn(),
      deleteCommandTemplate: vi.fn(),
    };
    TestBed.configureTestingModule({
      providers: [CommandTemplatesSession, { provide: Api, useValue: api }],
    });
    session = TestBed.inject(CommandTemplatesSession);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('loads templates and clears a previous list error', () => {
    session.listError.set('stale');
    api.listCommandTemplates.mockReturnValue(of({ templates: [existing] }));
    session.load();
    expect(api.listCommandTemplates).toHaveBeenCalledTimes(1);
    expect(session.templates()).toEqual([existing]);
    expect(session.listError()).toBe('');
  });

  it('clears templates and reports the load failure when listing fails', () => {
    session.templates.set([existing]);
    api.listCommandTemplates.mockReturnValue(throwError(() => ({ status: 0 })));
    session.load();
    expect(session.templates()).toEqual([]);
    expect(session.listError()).toBe(COMMAND_LIST_LOAD_FAILURE);
  });

  it('appends a created template after a synced list, resets the form, and reports success', () => {
    const created: CommandTemplate = {
      id: 8,
      name: 'new cmd',
      template: 'echo {{url}}',
      position: 2,
    };
    const pending = new Subject<CommandTemplate>();
    api.listCommandTemplates.mockReturnValue(of({ templates: [existing] }));
    session.load();
    api.createCommandTemplate.mockReturnValue(pending);
    session.createForm.setValue({ name: created.name, template: created.template });
    session.create();
    expect(session.saving()).toBe(true);
    session.create();
    expect(api.createCommandTemplate).toHaveBeenCalledTimes(1);
    expect(api.createCommandTemplate).toHaveBeenCalledWith({
      name: created.name,
      template: created.template,
    });
    pending.next(created);
    pending.complete();
    expect(session.saving()).toBe(false);
    expect(session.templates()).toEqual([existing, created]);
    expect(session.createForm.getRawValue()).toEqual({ name: '', template: '' });
    expect(session.adminMessage()).toBe(COMMAND_CREATE_SUCCESS);
    expect(session.listError()).toBe('');
  });

  it('reloads the list after create when the previous list fetch failed', () => {
    const created: CommandTemplate = {
      id: 8,
      name: 'new cmd',
      template: 'echo {{url}}',
      position: 2,
    };
    api.listCommandTemplates.mockReturnValueOnce(throwError(() => ({ status: 0 })));
    session.load();
    expect(session.templates()).toEqual([]);
    expect(session.listError()).toBe(COMMAND_LIST_LOAD_FAILURE);

    api.createCommandTemplate.mockReturnValue(of(created));
    api.listCommandTemplates.mockReturnValue(of({ templates: [existing, created] }));
    session.createForm.setValue({ name: created.name, template: created.template });
    session.create();

    expect(session.templates()).toEqual([existing, created]);
    expect(session.listError()).toBe('');
    expect(session.adminMessage()).toBe(COMMAND_CREATE_SUCCESS);
    expect(api.listCommandTemplates).toHaveBeenCalledTimes(2);
  });

  it('reports the API message when create fails and keeps the draft', () => {
    api.createCommandTemplate.mockReturnValue(
      throwError(() => ({ error: { message: '名前が長すぎます' } })),
    );
    session.createForm.setValue({ name: 'too long', template: 'echo' });
    session.create();
    expect(session.saving()).toBe(false);
    expect(session.templates()).toEqual([]);
    expect(session.createForm.getRawValue()).toEqual({ name: 'too long', template: 'echo' });
    expect(session.adminMessage()).toBe('名前が長すぎます');
    expect(session.adminMessage()).not.toBe(COMMAND_CREATE_SUCCESS);
  });

  it('replaces an updated template, closes edit, and reports success', () => {
    const updated: CommandTemplate = {
      ...existing,
      name: 'renamed',
      template: 'gh pr diff {{url}}',
    };
    const pending = new Subject<CommandTemplate>();
    api.listCommandTemplates.mockReturnValue(of({ templates: [existing] }));
    session.load();
    api.updateCommandTemplate.mockReturnValue(pending);
    session.startEdit(existing);
    session.editForm.setValue({ name: updated.name, template: updated.template });
    session.update(existing.id);
    expect(session.saving()).toBe(true);
    session.update(existing.id);
    expect(api.updateCommandTemplate).toHaveBeenCalledTimes(1);
    expect(api.updateCommandTemplate).toHaveBeenCalledWith(existing.id, {
      name: updated.name,
      template: updated.template,
    });
    pending.next(updated);
    pending.complete();
    expect(session.saving()).toBe(false);
    expect(session.templates()).toEqual([updated]);
    expect(session.editingId()).toBeNull();
    expect(session.adminMessage()).toBe(COMMAND_UPDATE_SUCCESS);
  });

  it('reports the API message when update fails and keeps the edit open', () => {
    api.listCommandTemplates.mockReturnValue(of({ templates: [existing] }));
    session.load();
    api.updateCommandTemplate.mockReturnValue(
      throwError(() => ({ error: { message: '本文が空です' } })),
    );
    session.startEdit(existing);
    session.update(existing.id);
    expect(session.saving()).toBe(false);
    expect(session.templates()).toEqual([existing]);
    expect(session.editingId()).toBe(existing.id);
    expect(session.adminMessage()).toBe('本文が空です');
    expect(session.adminMessage()).not.toBe(COMMAND_UPDATE_SUCCESS);
  });

  it('removes a deleted template, closes its edit, and reports success', () => {
    const other: CommandTemplate = { id: 5, name: 'other', template: 'echo', position: 1 };
    const pending = new Subject<void>();
    api.listCommandTemplates.mockReturnValue(of({ templates: [existing, other] }));
    session.load();
    api.deleteCommandTemplate.mockReturnValue(pending);
    session.startEdit(existing);
    session.delete(existing.id);
    expect(session.saving()).toBe(true);
    session.delete(existing.id);
    expect(api.deleteCommandTemplate).toHaveBeenCalledTimes(1);
    expect(api.deleteCommandTemplate).toHaveBeenCalledWith(existing.id);
    pending.next();
    pending.complete();
    expect(session.saving()).toBe(false);
    expect(session.templates()).toEqual([other]);
    expect(session.editingId()).toBeNull();
    expect(session.adminMessage()).toBe(COMMAND_DELETE_SUCCESS);
  });

  it('keeps a successful mutate when an older load resolves afterward', () => {
    const slow = new Subject<{ templates: CommandTemplate[] }>();
    const created: CommandTemplate = {
      id: 8,
      name: 'new cmd',
      template: 'echo {{url}}',
      position: 2,
    };
    api.listCommandTemplates.mockReturnValueOnce(of({ templates: [existing] }));
    session.load();
    expect(session.templates()).toEqual([existing]);

    api.listCommandTemplates.mockReturnValue(slow);
    session.load();
    api.createCommandTemplate.mockReturnValue(of(created));
    session.createForm.setValue({ name: created.name, template: created.template });
    session.create();
    expect(session.templates()).toEqual([existing, created]);

    slow.next({ templates: [existing] });
    slow.complete();

    expect(session.templates()).toEqual([existing, created]);
    expect(session.listError()).toBe('');
  });

  it('keeps a successful update when an older load resolves afterward', () => {
    const slow = new Subject<{ templates: CommandTemplate[] }>();
    const updated: CommandTemplate = {
      ...existing,
      name: 'renamed',
      template: 'gh pr diff {{url}}',
    };
    api.listCommandTemplates.mockReturnValueOnce(of({ templates: [existing] }));
    session.load();
    api.listCommandTemplates.mockReturnValue(slow);
    session.load();
    api.updateCommandTemplate.mockReturnValue(of(updated));
    session.startEdit(existing);
    session.editForm.setValue({ name: updated.name, template: updated.template });
    session.update(existing.id);
    expect(session.templates()).toEqual([updated]);

    slow.next({ templates: [existing] });
    slow.complete();

    expect(session.templates()).toEqual([updated]);
  });

  it('keeps a successful delete when an older load resolves afterward', () => {
    const slow = new Subject<{ templates: CommandTemplate[] }>();
    const other: CommandTemplate = { id: 5, name: 'other', template: 'echo', position: 1 };
    api.listCommandTemplates.mockReturnValueOnce(of({ templates: [existing, other] }));
    session.load();
    api.listCommandTemplates.mockReturnValue(slow);
    session.load();
    api.deleteCommandTemplate.mockReturnValue(of(undefined));
    session.delete(existing.id);
    expect(session.templates()).toEqual([other]);

    slow.next({ templates: [existing, other] });
    slow.complete();

    expect(session.templates()).toEqual([other]);
  });

  it('still applies an in-flight load when create fails', () => {
    const slow = new Subject<{ templates: CommandTemplate[] }>();
    api.listCommandTemplates.mockReturnValue(slow);
    api.createCommandTemplate.mockReturnValue(
      throwError(() => ({ error: { message: '名前が長すぎます' } })),
    );
    session.load();
    session.createForm.setValue({ name: 'too long', template: 'echo' });
    session.create();

    slow.next({ templates: [existing] });
    slow.complete();

    expect(session.templates()).toEqual([existing]);
    expect(session.listError()).toBe('');
  });

  it('ignores a stale load error after a successful create', () => {
    const slow = new Subject<{ templates: CommandTemplate[] }>();
    const created: CommandTemplate = {
      id: 8,
      name: 'new cmd',
      template: 'echo {{url}}',
      position: 2,
    };
    api.listCommandTemplates.mockReturnValueOnce(of({ templates: [] }));
    session.load();
    api.listCommandTemplates.mockReturnValue(slow);
    session.load();
    api.createCommandTemplate.mockReturnValue(of(created));
    session.createForm.setValue({ name: created.name, template: created.template });
    session.create();
    expect(session.templates()).toEqual([created]);

    slow.error({ status: 0 });

    expect(session.templates()).toEqual([created]);
    expect(session.listError()).toBe('');
  });

  it('reports a network failure when delete fails and keeps the template', () => {
    api.deleteCommandTemplate.mockReturnValue(throwError(() => ({ status: 0 })));
    session.templates.set([existing]);
    session.startEdit(existing);
    session.delete(existing.id);
    expect(session.saving()).toBe(false);
    expect(session.templates()).toEqual([existing]);
    expect(session.editingId()).toBe(existing.id);
    expect(session.adminMessage()).toBe('通信に失敗しました。接続を確認して再試行してください。');
    expect(session.adminMessage()).not.toBe(COMMAND_DELETE_SUCCESS);
  });
});
