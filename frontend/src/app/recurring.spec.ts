import { Component } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, RecurringRule } from './api';
import { App } from './app';
import { catalogLabel, resolvePageKind } from './header-menu';
import { ProjectSession } from './project-session';
import { RecurringPage } from './recurring';
import { RecurringSession } from './recurring-session';

@Component({ standalone: true, template: '' })
class SpecStubPage {}

function rule(partial: Partial<RecurringRule> & Pick<RecurringRule, 'id' | 'name'>): RecurringRule {
  return {
    projectId: 1,
    title: partial.title ?? partial.name,
    description: '',
    cron: '0 9 * * 1',
    timezone: 'Asia/Tokyo',
    columnId: 1,
    enabled: true,
    lastFiredAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...partial,
  };
}

describe('Api recurring-rules client', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('uses list/create/patch/delete paths and bodies', async () => {
    const { provideHttpClient } = await import('@angular/common/http');
    const { provideHttpClientTesting, HttpTestingController } = await import(
      '@angular/common/http/testing'
    );
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    const api = TestBed.inject(Api);
    const http = TestBed.inject(HttpTestingController);

    api.listRecurringRules().subscribe();
    const list = http.expectOne('/api/recurring-rules');
    expect(list.request.method).toBe('GET');
    list.flush({ rules: [] });

    api
      .createRecurringRule({
        name: '週次',
        title: 'ライブラリのアップデート',
        cron: '0 9 * * 1',
        columnId: 2,
      })
      .subscribe();
    const create = http.expectOne('/api/recurring-rules');
    expect(create.request.method).toBe('POST');
    expect(create.request.body).toEqual({
      name: '週次',
      title: 'ライブラリのアップデート',
      cron: '0 9 * * 1',
      columnId: 2,
    });
    create.flush(rule({ id: 1, name: '週次' }), { status: 201, statusText: 'Created' });

    api.patchRecurringRule(1, { enabled: false }).subscribe();
    const patch = http.expectOne('/api/recurring-rules/1');
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ enabled: false });
    patch.flush(rule({ id: 1, name: '週次', enabled: false }));

    api.deleteRecurringRule(1).subscribe();
    const del = http.expectOne('/api/recurring-rules/1');
    expect(del.request.method).toBe('DELETE');
    del.flush(null);
    http.verify();
  });
});

describe('Recurring page', () => {
  let restoreDialog: () => void;

  beforeEach(() => {
    const proto = HTMLDialogElement.prototype as HTMLDialogElement & {
      showModal?: () => void;
      close?: () => void;
    };
    const origShowModal = proto.showModal;
    const origClose = proto.close;
    proto.showModal = function () {
      this.open = true;
    };
    proto.close = function () {
      this.open = false;
    };
    restoreDialog = () => {
      proto.showModal = origShowModal;
      proto.close = origClose;
    };
  });

  afterEach(() => {
    restoreDialog();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup(apiOverrides: Record<string, unknown> = {}) {
    const api = {
      listRecurringRules: vi.fn(() =>
        of({ rules: [rule({ id: 7, name: '週次ライブラリ', title: 'ライブラリのアップデート' })] }),
      ),
      createRecurringRule: vi.fn((body: unknown) =>
        of(rule({ id: 8, name: '新規', ...(body as object) })),
      ),
      patchRecurringRule: vi.fn((id: number, patch: Partial<RecurringRule>) =>
        of(rule({ id, name: '週次ライブラリ', title: 'ライブラリのアップデート', ...patch })),
      ),
      deleteRecurringRule: vi.fn(() => of(undefined)),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 1 },
          ],
          items: [],
          settings: { cardLayout: 'pack', activeProjectId: 1 },
        }),
      ),
      ...apiOverrides,
    };
    TestBed.configureTestingModule({
      imports: [RecurringPage],
      providers: [
        provideRouter([{ path: 'recurring', component: RecurringPage }]),
        { provide: Api, useValue: api },
        RecurringSession,
      ],
    });
    const f = TestBed.createComponent(RecurringPage);
    const projectSession = TestBed.inject(ProjectSession);
    projectSession.activeId.set(1);
    projectSession.bootstrapped.set(true);
    f.detectChanges();
    return {
      f,
      projectSession,
      listRecurringRules: api.listRecurringRules as ReturnType<typeof vi.fn>,
      patchRecurringRule: api.patchRecurringRule as ReturnType<typeof vi.fn>,
      deleteRecurringRule: api.deleteRecurringRule as ReturnType<typeof vi.fn>,
      createRecurringRule: api.createRecurringRule as ReturnType<typeof vi.fn>,
    };
  }

  it('shows empty only on successful zero-rule GET', () => {
    const { f } = setup({ listRecurringRules: vi.fn(() => of({ rules: [] })) });
    expect(f.nativeElement.textContent).toContain('繰り返しルールはまだありません');
    f.destroy();
  });

  it('shows error and not empty copy when GET fails', () => {
    const { f } = setup({
      listRecurringRules: vi.fn(() => throwError(() => ({ status: 500 }))),
    });
    const text = f.nativeElement.textContent as string;
    expect(text).not.toContain('繰り返しルールはまだありません');
    expect(text).toMatch(/失敗|エラー|読み込み|通信/);
    f.destroy();
  });

  it('applies textLimit on name/title/description like board forms', () => {
    const { f } = setup({ listRecurringRules: vi.fn(() => of({ rules: [] })) });
    const form = f.componentInstance.form;
    form.controls.name.setValue('x'.repeat(81));
    expect(form.controls.name.invalid).toBe(true);
    form.controls.title.setValue('y'.repeat(201));
    expect(form.controls.title.invalid).toBe(true);
    form.controls.description.setValue('z'.repeat(10001));
    expect(form.controls.description.invalid).toBe(true);
    form.controls.name.setValue('ok');
    form.controls.title.setValue('ok');
    form.controls.description.setValue('ok');
    expect(form.controls.name.valid).toBe(true);
    expect(form.controls.title.valid).toBe(true);
    expect(form.controls.description.valid).toBe(true);
    f.destroy();
  });

  it('disables add when list failed (rules null)', () => {
    const { f } = setup({
      listRecurringRules: vi.fn(() => throwError(() => ({ status: 500 }))),
    });
    const addBtn = [...f.nativeElement.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('ルールを追加'),
    ) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    f.destroy();
  });

  it('shows actionError inside editor dialog on save failure (L-001)', () => {
    const { f } = setup({
      listRecurringRules: vi.fn(() => of({ rules: [] })),
      createRecurringRule: vi.fn(() => throwError(() => ({ status: 400 }))),
    });
    const addBtn = [...f.nativeElement.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('ルールを追加'),
    ) as HTMLButtonElement;
    addBtn.click();
    f.detectChanges();
    f.componentInstance.form.setValue({
      name: 'n',
      title: 't',
      description: '',
      cron: '0 9 * * 1',
      timezone: 'Asia/Tokyo',
      columnId: 1,
      enabled: true,
    });
    f.componentInstance.save();
    f.detectChanges();
    expect(f.componentInstance.editorOpen()).toBe(true);
    const dialog = f.nativeElement.querySelector('dialog[open], dialog.modal-backdrop');
    expect(dialog?.textContent ?? '').toMatch(/失敗|エラー|保存|通信|できません/);
    f.destroy();
  });

  it('documents card examples in help without seeding rules', () => {
    const { f } = setup({ listRecurringRules: vi.fn(() => of({ rules: [] })) });
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('ライブラリのアップデート');
    expect(text).toContain('リファクタリング');
    expect(text).toContain('API Doc');
    expect(text).toContain('0 9 * * 1');
    expect(text).toContain('繰り返しルールはまだありません');
    f.destroy();
  });

  it('toggles enabled via PATCH and reflects success; failure keeps prior state', () => {
    const { f, patchRecurringRule } = setup();
    const toggle = f.nativeElement.querySelector(
      '[aria-label="週次ライブラリ の有効／無効を切替"]',
    ) as HTMLButtonElement;
    toggle.click();
    f.detectChanges();
    expect(patchRecurringRule).toHaveBeenCalledWith(7, { enabled: false });
    expect(f.nativeElement.textContent).toContain('無効');
    f.destroy();
  });

  it('does not treat failed enabled toggle as success', () => {
    const pending = new Subject<RecurringRule>();
    const { f, patchRecurringRule } = setup({
      patchRecurringRule: vi.fn(() => pending.asObservable()),
      listRecurringRules: vi.fn(() =>
        of({ rules: [rule({ id: 7, name: '週次ライブラリ', enabled: true })] }),
      ),
    });
    (
      f.nativeElement.querySelector(
        '[aria-label="週次ライブラリ の有効／無効を切替"]',
      ) as HTMLButtonElement
    ).click();
    expect(patchRecurringRule).toHaveBeenCalledWith(7, { enabled: false });
    pending.error({ status: 500 });
    f.detectChanges();
    const session = TestBed.inject(RecurringSession);
    expect(session.rules()?.[0]?.enabled).toBe(true);
    expect(
      (
        f.nativeElement.querySelector(
          '[aria-label="週次ライブラリ の有効／無効を切替"]',
        ) as HTMLButtonElement
      ).textContent,
    ).toContain('無効化');
    f.destroy();
  });

  it('disables editor controls while busy (L-879)', () => {
    const pending = new Subject<RecurringRule>();
    const { f } = setup({
      createRecurringRule: vi.fn(() => pending.asObservable()),
      listRecurringRules: vi.fn(() => of({ rules: [] })),
    });
    (f.nativeElement.querySelector('button') as HTMLButtonElement).click(); // ルールを追加 — first primary may vary
    const addBtn = [...f.nativeElement.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('ルールを追加'),
    ) as HTMLButtonElement;
    addBtn.click();
    f.detectChanges();
    f.componentInstance.form.setValue({
      name: 'n',
      title: 't',
      description: '',
      cron: '0 9 * * 1',
      timezone: 'Asia/Tokyo',
      columnId: 1,
      enabled: true,
    });
    f.componentInstance.save();
    f.detectChanges();
    expect(f.componentInstance.busy()).toBe(true);
    const submit = f.nativeElement.querySelector(
      'button[type="submit"]',
    ) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    const fieldset = f.nativeElement.querySelector('fieldset') as HTMLFieldSetElement;
    expect(fieldset.disabled).toBe(true);
    pending.next(rule({ id: 9, name: 'n' }));
    pending.complete();
    f.destroy();
  });

  it('blocks re-entrant save/delete/toggle with sync lock (L-653)', () => {
    const pending = new Subject<RecurringRule>();
    const { f, patchRecurringRule } = setup({
      patchRecurringRule: vi.fn(() => pending.asObservable()),
    });
    const c = f.componentInstance;
    c.toggleEnabled(rule({ id: 7, name: '週次ライブラリ' }));
    c.toggleEnabled(rule({ id: 7, name: '週次ライブラリ' }));
    c.save();
    expect(patchRecurringRule).toHaveBeenCalledTimes(1);
    pending.next(rule({ id: 7, name: '週次ライブラリ', enabled: false }));
    pending.complete();
    f.destroy();
  });

  it('ignores key repeat and double-click on delete confirm (L-408)', () => {
    const { f, deleteRecurringRule } = setup();
    (
      f.nativeElement.querySelector('[aria-label="週次ライブラリ を削除"]') as HTMLButtonElement
    ).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#recurring-delete-title')).toBeTruthy();

    const confirmBtn = f.nativeElement.querySelector(
      '[aria-label="週次ライブラリ を削除する"]',
    ) as HTMLButtonElement;
    confirmBtn.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, detail: 2 }),
    );
    f.detectChanges();
    expect(deleteRecurringRule).not.toHaveBeenCalled();

    confirmBtn.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, repeat: true }),
    );
    f.detectChanges();
    expect(deleteRecurringRule).not.toHaveBeenCalled();

    confirmBtn.click();
    f.detectChanges();
    expect(deleteRecurringRule).toHaveBeenCalledWith(7);
    f.destroy();
  });

  it('replaces list on project switch and ignores stale mutations', () => {
    const pending = new Subject<RecurringRule>();
    const { f, projectSession, listRecurringRules, patchRecurringRule } = setup({
      patchRecurringRule: vi.fn(() => pending.asObservable()),
    });
    (
      f.nativeElement.querySelector(
        '[aria-label="週次ライブラリ の有効／無効を切替"]',
      ) as HTMLButtonElement
    ).click();
    expect(patchRecurringRule).toHaveBeenCalled();

    listRecurringRules.mockReturnValueOnce(
      of({ rules: [rule({ id: 9, name: '他PJ', title: '他' })] }),
    );
    projectSession.switching.set(true);
    f.componentInstance.reloadForProjectSwitch();
    f.detectChanges();
    pending.next(rule({ id: 7, name: '週次ライブラリ', enabled: false }));
    pending.complete();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('他PJ');
    expect(f.nativeElement.textContent).not.toContain('週次ライブラリ');
    f.destroy();
  });
});

describe('Header open_recurring', () => {
  it('catalog label is 繰り返し on board/backlog/itemDetail', () => {
    expect(catalogLabel('open_recurring', 'board')).toBe('繰り返し');
    expect(catalogLabel('open_recurring', 'backlog')).toBe('繰り返し');
    expect(catalogLabel('open_recurring', 'itemDetail')).toBe('繰り返し');
  });

  it('resolvePageKind(/recurring) is null', () => {
    expect(resolvePageKind('/recurring')).toBeNull();
  });

  it('has /recurring route with authGuard', async () => {
    const { routes } = await import('./app.routes');
    const route = routes.find((r) => r.path === 'recurring');
    expect(route).toBeTruthy();
    expect(route?.canActivate).toBeTruthy();
  });
});

describe('App host open_recurring wiring (L-925)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('navigates to /recurring when menu item is clicked', async () => {
    const api = {
      me: vi.fn(() =>
        of({ id: 1, loginName: 'admin', displayName: 'admin', role: 'admin', disabled: false }),
      ),
      listProjects: vi.fn(() => of({ projects: [{ id: 1, name: 'P', position: 0 }] })),
      board: vi.fn(() =>
        of({
          columns: [],
          items: [],
          settings: { cardLayout: 'pack', activeProjectId: 1 },
        }),
      ),
      patchBoardSettings: vi.fn(),
      headerMenu: vi.fn(() =>
        of({
          board: { hiddenIds: [] },
          backlog: { hiddenIds: [] },
          itemDetail: { hiddenIds: [] },
        }),
      ),
      listUsers: vi.fn(() => of([])),
      listRecurringRules: vi.fn(() => of({ rules: [] })),
    };
    TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([
          { path: '', component: SpecStubPage },
          { path: 'recurring', component: SpecStubPage },
        ]),
        { provide: Api, useValue: api },
      ],
    });
    const f = TestBed.createComponent(App);
    f.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate');

    (f.nativeElement.querySelector('#header-menu-trigger') as HTMLButtonElement).click();
    f.detectChanges();
    const item = f.nativeElement.querySelector(
      '#header-menu-item-open_recurring',
    ) as HTMLButtonElement;
    expect(item).toBeTruthy();
    expect(item.textContent?.trim()).toBe('繰り返し');
    item.click();
    f.detectChanges();
    expect(navigateSpy).toHaveBeenCalledWith(['/recurring']);
    f.destroy();
  });
});
