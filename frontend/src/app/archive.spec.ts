import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { ProjectSession } from './project-session';
import { Archive } from './archive';
import { Item } from './models';

function archivedItem(partial: Partial<Item> & Pick<Item, 'id' | 'title'>): Item {
  return {
    ...partial,
    number: partial.number ?? partial.id,
    projectId: partial.projectId ?? 1,
    columnId: partial.columnId ?? 3,
    description: partial.description ?? '',
    solution: partial.solution ?? '',
    position: partial.position ?? 0,
    backlogPosition: partial.backlogPosition ?? 0,
    offsetY: partial.offsetY ?? 0,
    prUrls: partial.prUrls ?? [],
    relatedItems: partial.relatedItems ?? [],
    assignee: partial.assignee ?? '',
    closeReason: partial.closeReason ?? '',
    favorite: partial.favorite ?? false,
    dueAt: partial.dueAt ?? null,
    doneAt: partial.doneAt === undefined ? '2026-11-01T00:00:00.000Z' : partial.doneAt,
    archivedAt: partial.archivedAt === undefined ? '2026-11-12T12:00:00.000Z' : partial.archivedAt,
    canEdit: partial.canEdit ?? true,
    createdAt: partial.createdAt ?? '',
    updatedAt: partial.updatedAt ?? '',
  };
}

describe('Archive page', () => {
  function setup(apiOverrides: Record<string, unknown> = {}) {
    const api = {
      listArchivedItems: vi.fn(() => of({ items: [archivedItem({ id: 7, title: 'Archived task' })] })),
      restoreArchivedItem: vi.fn(() => of(archivedItem({ id: 7, title: 'Archived task', archivedAt: null }))),
      ...apiOverrides,
    };
    TestBed.configureTestingModule({
      imports: [Archive],
      providers: [
        provideRouter([{ path: 'archive', component: Archive }]),
        { provide: Api, useValue: api },
      ],
    });
    const f = TestBed.createComponent(Archive);
    const session = TestBed.inject(ProjectSession);
    session.activeId.set(1);
    session.bootstrapped.set(true);
    f.detectChanges();
    return {
      f,
      session,
      listArchivedItems: api.listArchivedItems as ReturnType<typeof vi.fn>,
      restoreArchivedItem: api.restoreArchivedItem as ReturnType<typeof vi.fn>,
    };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('renders the archived item and restores it using the active project', () => {
    const { f, restoreArchivedItem } = setup();
    expect(f.nativeElement.textContent).toContain('ITEM-007');
    expect(f.nativeElement.textContent).toContain('Archived task');
    expect(f.nativeElement.textContent).toMatch(/アーカイブ:/);

    (f.nativeElement.querySelector('[aria-label="ITEM-007 をアーカイブ解除"]') as HTMLButtonElement).click();
    f.detectChanges();
    expect(restoreArchivedItem).toHaveBeenCalledWith(7, 1);
    expect(f.nativeElement.textContent).toContain('アーカイブは空です');
    f.destroy();
  });

  it('shows an empty state only when the list request succeeds with no items', () => {
    const { f } = setup({ listArchivedItems: vi.fn(() => of({ items: [] })) });
    expect(f.nativeElement.textContent).toContain('アーカイブは空です');
    f.destroy();
  });

  it('shows a load error instead of the empty state when the request fails', () => {
    const { f } = setup({ listArchivedItems: vi.fn(() => throwError(() => ({ status: 500 }))) });
    expect(f.nativeElement.textContent).not.toContain('アーカイブは空です');
    expect(f.nativeElement.querySelector('[role="alert"]')).toBeTruthy();
    f.destroy();
  });

  it('ignores a delayed restore response after switching projects', () => {
    const pending = new Subject<Item>();
    const { f, session, listArchivedItems, restoreArchivedItem } = setup({
      restoreArchivedItem: vi.fn(() => pending.asObservable()),
    });
    (f.nativeElement.querySelector('[aria-label="ITEM-007 をアーカイブ解除"]') as HTMLButtonElement).click();
    expect(restoreArchivedItem).toHaveBeenCalled();

    listArchivedItems.mockReturnValueOnce(
      of({ items: [archivedItem({ id: 9, title: 'Other project', number: 9, projectId: 2 })] }),
    );
    session.switching.set(true);
    f.componentInstance.reloadForProjectSwitch();
    f.detectChanges();
    pending.next(archivedItem({ id: 7, title: 'Archived task', archivedAt: null }));
    pending.complete();
    f.detectChanges();
    expect(f.nativeElement.textContent).toContain('Other project');
    expect(f.nativeElement.textContent).not.toContain('Archived task');
    f.destroy();
  });
});

describe('Archive route', () => {
  it('registers /archive', async () => {
    const { routes } = await import('./app.routes');
    expect(routes.some((route) => route.path === 'archive')).toBe(true);
  });
});
