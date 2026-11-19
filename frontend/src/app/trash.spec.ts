import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api, TrashItem } from './api';
import { ProjectSession } from './project-session';
import { Trash, trashRemainingDays } from './trash';

function trashItem(partial: Partial<TrashItem> & Pick<TrashItem, 'id' | 'title'>): TrashItem {
  return {
    number: partial.number ?? partial.id,
    projectId: partial.projectId ?? 1,
    deletedAt: partial.deletedAt ?? '2026-11-01T00:00:00.000Z',
    ...partial,
  };
}

describe('trashRemainingDays', () => {
  it('ceils remaining whole days and hits 0 at/after retention', () => {
    const deleted = Date.parse('2026-10-20T00:00:00.000Z');
    const now = Date.parse('2026-11-10T00:00:00.000Z'); // 21 days later → 9 left
    expect(trashRemainingDays(new Date(deleted), now)).toBe(9);
    expect(trashRemainingDays(new Date(deleted), deleted + 30 * 24 * 60 * 60 * 1000)).toBe(0);
  });
});

describe('Trash page', () => {
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
      listTrash: vi.fn(() => of({ items: [trashItem({ id: 7, title: 'Gone', number: 7 })] })),
      restoreItem: vi.fn(() => of({ id: 7 })),
      hardDeleteTrashItem: vi.fn(() => of(undefined)),
      ...apiOverrides,
    };
    TestBed.configureTestingModule({
      imports: [Trash],
      providers: [
        provideRouter([{ path: 'trash', component: Trash }]),
        { provide: Api, useValue: api },
      ],
    });
    const f = TestBed.createComponent(Trash);
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.bootstrapped.set(true);
    f.detectChanges();
    return {
      f,
      session,
      listTrash: api.listTrash as ReturnType<typeof vi.fn>,
      restoreItem: api.restoreItem as ReturnType<typeof vi.fn>,
      hardDeleteTrashItem: api.hardDeleteTrashItem as ReturnType<typeof vi.fn>,
    };
  }

  it('renders number, title, deletedAt, remaining days, restore and hard-delete', () => {
    const { f } = setup({
      listTrash: vi.fn(() =>
        of({
          items: [
            trashItem({
              id: 7,
              number: 7,
              title: 'Gone',
              deletedAt: '2026-11-10T12:00:00.000Z',
            }),
          ],
        }),
      ),
    });
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('ITEM-007');
    expect(text).toContain('Gone');
    expect(text).toMatch(/削除:/);
    expect(text).toMatch(/残りおよそ/);
    expect(f.nativeElement.querySelector('[aria-label="ITEM-007 を復元"]')).toBeTruthy();
    expect(f.nativeElement.querySelector('[aria-label="ITEM-007 を完全削除"]')).toBeTruthy();
    f.destroy();
  });

  it('shows empty only on successful zero-item GET', () => {
    const { f } = setup({ listTrash: vi.fn(() => of({ items: [] })) });
    expect(f.nativeElement.textContent).toContain('ゴミ箱は空です');
    f.destroy();
  });

  it('shows error and not empty copy when GET fails', () => {
    const { f } = setup({
      listTrash: vi.fn(() => throwError(() => ({ status: 500 }))),
    });
    const text = f.nativeElement.textContent as string;
    expect(text).not.toContain('ゴミ箱は空です');
    expect(text).toMatch(/失敗|エラー|読み込み|通信/);
    f.destroy();
  });

  it('confirms hard delete once then calls API', () => {
    const { f, hardDeleteTrashItem } = setup();
    (f.nativeElement.querySelector('[aria-label="ITEM-007 を完全削除"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#hard-delete-title')).toBeTruthy();
    expect(hardDeleteTrashItem).not.toHaveBeenCalled();
    (f.nativeElement.querySelector('[aria-label="ITEM-007 を完全削除する"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(hardDeleteTrashItem).toHaveBeenCalledWith(7, 1);
    f.destroy();
  });

  it('ignores delayed restore after project switch generation advances', () => {
    const pending = new Subject<{ id: number }>();
    const { f, session, restoreItem, listTrash } = setup({
      restoreItem: vi.fn(() => pending.asObservable()),
    });
    (f.nativeElement.querySelector('[aria-label="ITEM-007 を復元"]') as HTMLButtonElement).click();
    expect(restoreItem).toHaveBeenCalled();

    listTrash.mockReturnValueOnce(
      of({ items: [trashItem({ id: 9, title: 'Other PJ', number: 9, projectId: 2 })] }),
    );
    session.switching.set(true);
    f.componentInstance.reloadForProjectSwitch();
    f.detectChanges();
    pending.next({ id: 7 });
    pending.complete();
    f.detectChanges();
    const text = f.nativeElement.textContent as string;
    expect(text).toContain('Other PJ');
    expect(text).not.toContain('Gone');
    f.destroy();
  });

  it('ignores delayed hard-delete success after generation advances', () => {
    const pending = new Subject<void>();
    const { f, hardDeleteTrashItem, listTrash, session } = setup({
      hardDeleteTrashItem: vi.fn(() => pending.asObservable()),
    });
    (f.nativeElement.querySelector('[aria-label="ITEM-007 を完全削除"]') as HTMLButtonElement).click();
    f.detectChanges();
    (f.nativeElement.querySelector('[aria-label="ITEM-007 を完全削除する"]') as HTMLButtonElement).click();
    expect(hardDeleteTrashItem).toHaveBeenCalled();

    listTrash.mockReturnValueOnce(
      of({ items: [trashItem({ id: 9, title: 'Switched', number: 9 })] }),
    );
    session.switching.set(true);
    f.componentInstance.reloadForProjectSwitch();
    f.detectChanges();
    pending.next();
    pending.complete();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Switched');
    expect(f.nativeElement.textContent).toContain('ITEM-009');
    f.destroy();
  });
});

describe('Header open_trash navigation', () => {
  it('catalog label is ゴミ箱', async () => {
    const { catalogLabel } = await import('./header-menu');
    expect(catalogLabel('open_trash', 'board')).toBe('ゴミ箱');
    expect(catalogLabel('open_trash', 'itemDetail')).toBe('ゴミ箱');
  });
});

describe('Router trash path', () => {
  it('has /trash route', async () => {
    const { routes } = await import('./app.routes');
    expect(routes.some((r) => r.path === 'trash')).toBe(true);
  });
});
