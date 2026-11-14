import { provideRouter, Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { cardDetailUrl } from './card-link';
import { BoardData, Column } from './models';

describe('Board create requests', () => {
  it('freezes card inputs while creating and retains them on failure', () => {
    const pending = new Subject<never>();
    const api = { createCard: vi.fn(() => pending) };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.cardForm.setValue({ title: '保存するタイトル', description: '本文', columnId: 1 });
    board.addCard();
    board.addCard();
    expect(api.createCard).toHaveBeenCalledTimes(1);
    expect(board.cardForm.disabled).toBe(true);
    pending.error({ error: { message: '失敗' } });
    expect(board.cardForm.enabled).toBe(true);
    expect(board.cardForm.controls.title.value).toBe('保存するタイトル');
    expect(board.formError()).toBe('失敗');
  });
  it('freezes column input while creating and restores it after failure', () => {
    const pending = new Subject<never>();
    const api = { createColumn: vi.fn(() => pending) };
    TestBed.configureTestingModule({ providers: [{ provide: Api, useValue: api }] });
    const board = TestBed.runInInjectionContext(() => new Board());
    board.columnForm.controls.name.setValue('Review');
    board.addColumn();
    expect(board.columnForm.disabled).toBe(true);
    pending.error({ error: { message: '重複' } });
    expect(board.columnForm.enabled).toBe(true);
    expect(board.columnForm.controls.name.value).toBe('Review');
  });
});

const singleCardBoard = () =>
  of({
    columns: [{ id: 1, name: 'Todo', position: 0 }],
    cards: [
      {
        id: 17,
        number: 2,
        columnId: 1,
        title: 'Task',
        description: '',
        position: 0,
        backlogPosition: 0,
        createdAt: '',
        updatedAt: '',
      },
    ],
  });

describe('Board task numbers', () => {
  it('links to the same public number shown on the card', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: { board: singleCardBoard } }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const card: HTMLElement = f.nativeElement.querySelector('.task-card');
    expect(card.tagName.toLowerCase()).toBe('article');
    expect(f.nativeElement.querySelector('.card-arrow')).toBeNull();
    const link: HTMLAnchorElement = card.querySelector('.task-card-body') as HTMLAnchorElement;
    expect(link.textContent).toContain('TASK-002');
    // A real link keeps "open in new tab", "copy link" and the status-bar URL working.
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/cards/2');
    expect(link.getAttribute('role')).toBeNull();
    // The accessible name stays the card's own text; the drag help is a description.
    expect(link.getAttribute('aria-label')).toBeNull();
    const helpId = link.getAttribute('aria-describedby') as string;
    expect(f.nativeElement.querySelector(`#${helpId}`)?.textContent).toContain('ドラッグ');
    expect(f.nativeElement.querySelector(`#${helpId}`)?.textContent).toContain('ステータス');
    const copyBtn = f.nativeElement.querySelector('.copy-card-link');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn.getAttribute('aria-label')).toBe('TASK-002 のリンクをコピー');
  });
});

describe('Board copy card link', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: { board: singleCardBoard } }],
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  const create = async () => {
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    return f;
  };

  it('copies the public card detail URL on success without navigating', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const f = await create();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
    f.detectChanges();
    expect(writeText).toHaveBeenCalledWith(cardDetailUrl(window.location.origin, 2));
    expect(navigateSpy).not.toHaveBeenCalled();
    const live = f.nativeElement.querySelector('.copy-link-live');
    expect(live).not.toBeNull();
    expect(live.textContent).toContain('リンクをコピーしました');
  });

  it('announces failure when clipboard writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const f = await create();
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-link-live').textContent).toContain(
      'リンクをコピーできませんでした',
    );
  });
});

function sampleBoard(columns: Column[]): BoardData {
  return {
    columns: columns.map((c) => ({ ...c })),
    cards: [
      {
        id: 1,
        number: 1,
        columnId: columns[0].id,
        title: 'Card 1',
        description: '',
        position: 0,
        backlogPosition: 0,
        prUrl: '',
        createdAt: '',
        updatedAt: '',
      },
    ],
  };
}

function makeColumns(): Column[] {
  return [
    { id: 1, name: 'Todo', position: 0 },
    { id: 2, name: 'Doing', position: 1 },
    { id: 3, name: 'Done', position: 2 },
    { id: 9, name: 'Review', position: 3 },
  ];
}

function mockColumnRects(root: HTMLElement, rects: { left: number; width: number }[]) {
  const sections = Array.from(root.querySelectorAll<HTMLElement>('.kanban-column'));
  sections.forEach((el, i) => {
    const r = rects[i] ?? { left: i * 320, width: 300 };
    el.getBoundingClientRect = () =>
      ({
        left: r.left,
        right: r.left + r.width,
        width: r.width,
        top: 0,
        bottom: 200,
        height: 200,
        x: r.left,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
  });
}

function dispatchDragEvent(
  target: EventTarget,
  type: string,
  opts: { clientX?: number; clientY?: number; relatedTarget?: EventTarget | null } = {},
) {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    clientX: number;
    clientY: number;
    relatedTarget: EventTarget | null;
    dataTransfer: {
      setData: ReturnType<typeof vi.fn>;
      getData: ReturnType<typeof vi.fn>;
      effectAllowed: string;
      dropEffect: string;
    };
  };
  Object.defineProperty(ev, 'clientX', { value: opts.clientX ?? 0 });
  Object.defineProperty(ev, 'clientY', { value: opts.clientY ?? 0 });
  Object.defineProperty(ev, 'relatedTarget', { value: opts.relatedTarget ?? null });
  Object.defineProperty(ev, 'dataTransfer', {
    value: {
      setData: vi.fn(),
      getData: vi.fn(() => ''),
      effectAllowed: 'uninitialized',
      dropEffect: 'none',
    },
  });
  target.dispatchEvent(ev);
  return ev;
}

describe('Board column reordering', () => {
  it('reorders columns via drag-and-drop (including over column gap) and persists via API', async () => {
    const cols = makeColumns();
    const reorderColumns = vi.fn((ids: number[]) =>
      of({
        columns: ids.map((id, position) => ({ ...cols.find((c) => c.id === id)!, position })),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: () => of(sampleBoard(cols)), reorderColumns },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    mockColumnRects(f.nativeElement, [
      { left: 0, width: 300 }, // midpoint 150
      { left: 320, width: 300 }, // midpoint 470
      { left: 640, width: 300 }, // midpoint 790
      { left: 960, width: 300 }, // midpoint 1110
    ]);

    const dragZones = f.nativeElement.querySelectorAll(
      '.column-drag-zone',
    ) as NodeListOf<HTMLElement>;
    const scrollRegion = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    const columns = f.nativeElement.querySelectorAll('.kanban-column') as NodeListOf<HTMLElement>;

    // 後方→前方: Review (index 3, id=9) を Done (index 2, midpoint 790) の前（gap x=630）へドロップ
    dispatchDragEvent(dragZones[3], 'dragstart', { clientX: 980 });
    f.detectChanges();
    expect(f.componentInstance.draggingColumnId()).toBe(9);

    dispatchDragEvent(scrollRegion, 'dragover', { clientX: 630 });
    f.detectChanges();
    expect(f.componentInstance.dropSlot()).toBe(2);
    expect(columns[2].classList.contains('drop-before')).toBe(true);

    dispatchDragEvent(scrollRegion, 'drop', { clientX: 630 });
    dispatchDragEvent(dragZones[3], 'dragend');
    f.detectChanges();

    expect(reorderColumns).toHaveBeenCalledWith([1, 2, 9, 3]);
    let titles = Array.from(
      f.nativeElement.querySelectorAll('.column-heading h2') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Todo', 'Doing', 'Review', 'Done']);
    expect(f.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain('Review');

    // 前方→後方: Todo (index 0, id=1) を末尾（slot 4）へドロップし .drop-after を確認
    mockColumnRects(f.nativeElement, [
      { left: 0, width: 300 },
      { left: 320, width: 300 },
      { left: 640, width: 300 },
      { left: 960, width: 300 },
    ]);
    const updatedZones = f.nativeElement.querySelectorAll(
      '.column-drag-zone',
    ) as NodeListOf<HTMLElement>;
    const updatedColumns = f.nativeElement.querySelectorAll(
      '.kanban-column',
    ) as NodeListOf<HTMLElement>;
    dispatchDragEvent(updatedZones[0], 'dragstart', { clientX: 80 });
    dispatchDragEvent(scrollRegion, 'dragover', { clientX: 1200 });
    f.detectChanges();
    expect(f.componentInstance.dropSlot()).toBe(4);
    expect(updatedColumns[3].classList.contains('drop-after')).toBe(true);

    dispatchDragEvent(scrollRegion, 'drop', { clientX: 1200 });
    dispatchDragEvent(updatedZones[0], 'dragend');
    f.detectChanges();

    expect(reorderColumns).toHaveBeenCalledWith([2, 9, 3, 1]);
    titles = Array.from(
      f.nativeElement.querySelectorAll('.column-heading h2') as NodeListOf<HTMLElement>,
    ).map((el) => el.textContent?.trim());
    expect(titles).toEqual(['Doing', 'Review', 'Done', 'Todo']);
  });

  it('ignores same-position drop, external drags, and keeps add-card icon button outside draggable zone', async () => {
    const cols = makeColumns();
    const reorderColumns = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(sampleBoard(cols)), reorderColumns } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    mockColumnRects(f.nativeElement, [
      { left: 0, width: 300 },
      { left: 320, width: 300 },
      { left: 640, width: 300 },
      { left: 960, width: 300 },
    ]);

    const addBtn = f.nativeElement.querySelector('.column-heading .icon-button') as HTMLElement;
    expect(addBtn.closest('[draggable="true"]')).toBeNull();
    dispatchDragEvent(addBtn, 'dragstart', { clientX: 250 });
    expect(f.componentInstance.draggingColumnId()).toBeNull();

    const scrollRegion = f.nativeElement.querySelector('.board-scroll') as HTMLElement;
    // External / card link drag while draggingColumnId is null must be ignored
    const extOver = dispatchDragEvent(scrollRegion, 'dragover', { clientX: 700 });
    expect(extOver.defaultPrevented).toBe(false);
    dispatchDragEvent(scrollRegion, 'drop', { clientX: 700 });
    expect(reorderColumns).not.toHaveBeenCalled();

    // Same-position drop (Doing dragged over own midpoint 400 -> slot 1) is no-op
    const dragZones = f.nativeElement.querySelectorAll(
      '.column-drag-zone',
    ) as NodeListOf<HTMLElement>;
    dispatchDragEvent(dragZones[1], 'dragstart', { clientX: 350 });
    dispatchDragEvent(scrollRegion, 'dragover', { clientX: 400 });
    expect(f.componentInstance.dropSlot()).toBeNull();
    dispatchDragEvent(scrollRegion, 'drop', { clientX: 400 });
    dispatchDragEvent(dragZones[1], 'dragend');
    expect(reorderColumns).not.toHaveBeenCalled();
  });

  it('moves columns with ArrowLeft/ArrowRight keys, guards boundaries, and preserves handle focus', async () => {
    const cols = makeColumns();
    const reorderColumns = vi.fn((ids: number[]) =>
      of({
        columns: ids.map((id, position) => ({ ...cols.find((c) => c.id === id)!, position })),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(sampleBoard(cols)), reorderColumns } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const getHandles = () =>
      Array.from(
        f.nativeElement.querySelectorAll('.column-drag-handle') as NodeListOf<HTMLButtonElement>,
      );

    // First column ArrowLeft -> boundary no-op
    getHandles()[0].focus();
    const firstLeft = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    getHandles()[0].dispatchEvent(firstLeft);
    expect(reorderColumns).not.toHaveBeenCalled();
    expect(firstLeft.defaultPrevented).toBe(false);

    // Last column ArrowRight -> boundary no-op
    getHandles()[3].focus();
    const lastRight = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    getHandles()[3].dispatchEvent(lastRight);
    expect(reorderColumns).not.toHaveBeenCalled();

    // Move Review (index 3, id=9) left before Done -> [1, 2, 9, 3]
    const moveLeft = new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true });
    getHandles()[3].dispatchEvent(moveLeft);
    expect(moveLeft.defaultPrevented).toBe(true);
    f.detectChanges();
    await f.whenStable();

    expect(reorderColumns).toHaveBeenCalledWith([1, 2, 9, 3]);
    expect(document.activeElement).toBe(getHandles()[2]);
    expect(f.nativeElement.querySelector('[aria-live="polite"]')?.textContent).toContain('Review');

    // Move Todo (index 0, id=1) right after Doing -> [2, 1, 9, 3]
    getHandles()[0].focus();
    const moveRight = new KeyboardEvent('keydown', { key: 'ArrowRight', cancelable: true });
    getHandles()[0].dispatchEvent(moveRight);
    expect(moveRight.defaultPrevented).toBe(true);
    f.detectChanges();
    await f.whenStable();

    expect(reorderColumns).toHaveBeenCalledWith([2, 1, 9, 3]);
    expect(document.activeElement).toBe(getHandles()[1]);
  });

  it('locks concurrent reorder and add-column while saving, and disables reorder when <= 1 column', async () => {
    const pending = new Subject<{ columns: Column[] }>();
    const cols = makeColumns();
    const reorderColumns = vi.fn(() => pending);
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(sampleBoard(cols)), reorderColumns } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const handles = f.nativeElement.querySelectorAll(
      '.column-drag-handle',
    ) as NodeListOf<HTMLButtonElement>;
    handles[3].focus();
    handles[3].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    f.detectChanges();

    expect(f.componentInstance.reordering()).toBe(true);
    expect(f.componentInstance.canReorder()).toBe(false);
    expect(handles[3].hasAttribute('disabled')).toBe(false);
    expect(handles[3].getAttribute('aria-disabled')).toBe('true');
    const addColumnBtn = f.nativeElement.querySelector('.add-column-tile') as HTMLButtonElement;
    expect(addColumnBtn.disabled).toBe(true);

    // Second move while in-flight is ignored
    handles[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }));
    f.componentInstance.openColumn();
    expect(reorderColumns).toHaveBeenCalledTimes(1);
    expect(f.componentInstance.modal()).toBeNull();

    pending.next({ columns: [cols[0], cols[1], cols[3], cols[2]] });
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.reordering()).toBe(false);
    expect(f.componentInstance.canReorder()).toBe(true);

    // Single column disables reordering
    f.componentInstance.data.set(sampleBoard([cols[0]]));
    f.detectChanges();
    expect(f.componentInstance.canReorder()).toBe(false);
  });

  it('rolls back order on 500 or 409 error without hiding the board and recovers on reload', async () => {
    const cols = makeColumns();
    let boardCalls = 0;
    const reorderSubject = new Subject<{ columns: Column[] }>();
    const board = vi.fn(() => {
      boardCalls++;
      return of(
        sampleBoard(boardCalls === 1 ? cols : [...cols, { id: 10, name: 'QA', position: 4 }]),
      );
    });
    const reorderColumns = vi.fn(() => reorderSubject);

    TestBed.configureTestingModule({
      imports: [Board],
      providers: [provideRouter([]), { provide: Api, useValue: { board, reorderColumns } }],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    const getHandles = () =>
      Array.from(
        f.nativeElement.querySelectorAll('.column-drag-handle') as NodeListOf<HTMLButtonElement>,
      );

    // 500 error: rollback + alert with dismiss button + board stays visible + handle focus retained
    getHandles()[3].focus();
    getHandles()[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    );
    f.detectChanges();
    expect(f.componentInstance.data().columns.map((c) => c.id)).toEqual([1, 2, 9, 3]);

    reorderSubject.error({ status: 500, error: { message: '保存失敗' } });
    f.detectChanges();
    await f.whenStable();
    expect(f.componentInstance.data().columns.map((c) => c.id)).toEqual([1, 2, 3, 9]);
    expect(document.activeElement).toBe(getHandles()[3]);
    expect(f.nativeElement.querySelectorAll('.kanban-column').length).toBe(4);
    const alert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(alert.textContent).toContain('保存失敗');
    expect(alert.querySelector('.reorder-dismiss')).not.toBeNull();

    (alert.querySelector('.reorder-dismiss') as HTMLButtonElement).click();
    f.detectChanges();
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();

    // 409 conflict: rollback + reload button (no dismiss button) + handle focus retained -> reload clears alert
    const conflictSubject = new Subject<{ columns: Column[] }>();
    reorderColumns.mockReturnValueOnce(conflictSubject);
    getHandles()[3].focus();
    getHandles()[3].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
    );
    conflictSubject.error({
      status: 409,
      error: { message: '列の構成が変更されています。' },
    });
    f.detectChanges();
    await f.whenStable();

    expect(document.activeElement).toBe(getHandles()[3]);
    const conflictAlert = f.nativeElement.querySelector('.reorder-alert') as HTMLElement;
    expect(conflictAlert.textContent).toContain('列の構成が変更されています。');
    expect(conflictAlert.querySelector('.reorder-dismiss')).toBeNull();
    const reloadBtn = conflictAlert.querySelector('.reorder-reload') as HTMLButtonElement;
    expect(reloadBtn).not.toBeNull();

    reloadBtn.click();
    f.detectChanges();
    await f.whenStable();
    expect(board).toHaveBeenCalledTimes(2);
    expect(f.nativeElement.querySelector('.reorder-alert')).toBeNull();
    expect(f.componentInstance.data().columns.length).toBe(5);
  });

  it('handles non-element dragstart targets without throwing and does not steal focus when modal is open', async () => {
    const cols = makeColumns();
    const pending = new Subject<{ columns: Column[] }>();
    const reorderColumns = vi.fn(() => pending);
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(sampleBoard(cols)), reorderColumns } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();

    // Text node inside <h2> bubbling dragstart must be prevented without TypeError
    const headingText = f.nativeElement.querySelector('.column-heading h2')?.firstChild as Text;
    const textDrag = dispatchDragEvent(headingText, 'dragstart', { clientX: 50 });
    expect(textDrag.defaultPrevented).toBe(true);
    expect(f.componentInstance.draggingColumnId()).toBeNull();

    // Open card modal while reorder request is in-flight -> settling must not steal focus
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
    try {
      f.componentInstance.openCard(1);
      f.detectChanges();
      const titleInput = f.nativeElement.querySelector('#card-title') as HTMLInputElement;
      titleInput.focus();

      const handles = f.nativeElement.querySelectorAll(
        '.column-drag-handle',
      ) as NodeListOf<HTMLButtonElement>;
      handles[3].focus();
      handles[3].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
      );
      f.detectChanges();
      titleInput.focus();

      pending.next({ columns: [cols[0], cols[1], cols[3], cols[2]] });
      pending.complete();
      f.detectChanges();
      await f.whenStable();

      expect(document.activeElement).toBe(titleInput);
    } finally {
      f.componentInstance.close();
      f.detectChanges();
      proto.showModal = origShowModal;
      proto.close = origClose;
    }
  });
});

describe('Board card reordering', () => {
  function twoCardBoard(): BoardData {
    return {
      columns: makeColumns().slice(0, 2),
      cards: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'A',
          description: '',
          position: 0,
          backlogPosition: 0,
          prUrl: '',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 2,
          number: 2,
          columnId: 1,
          title: 'B',
          description: '',
          position: 1,
          backlogPosition: 1,
          prUrl: '',
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 3,
          number: 3,
          columnId: 2,
          title: 'C',
          description: '',
          position: 0,
          backlogPosition: 0,
          prUrl: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
  }

  it('reorders within a column via drop and persists', async () => {
    const reorderCards = vi.fn(() =>
      of({
        cards: [
          { ...twoCardBoard().cards[1], position: 0 },
          { ...twoCardBoard().cards[0], position: 1 },
          twoCardBoard().cards[2],
        ],
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: () => of(twoCardBoard()), reorderCards, reorderColumns: vi.fn() },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onCardDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-1' },
        previousIndex: 0,
        currentIndex: 1,
        item: { data: twoCardBoard().cards[0] },
      } as never,
      1,
    );
    expect(reorderCards).toHaveBeenCalledWith([{ columnId: 1, cardIds: [2, 1] }]);
  });

  it('skips API for no-op drops and rolls back on failure', async () => {
    const err = Object.assign(new Error('conflict'), { status: 409 });
    const reorderCards = vi.fn(() => throwError(() => err));
    const initial = twoCardBoard();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(initial),
            reorderCards,
            reorderColumns: vi.fn(),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onCardDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-1' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: initial.cards[0] },
      } as never,
      1,
    );
    expect(reorderCards).not.toHaveBeenCalled();

    f.componentInstance.onCardDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: initial.cards[0] },
      } as never,
      2,
    );
    expect(reorderCards).toHaveBeenCalled();
    expect(f.componentInstance.reorderConflict()).toBe(true);
    expect(f.componentInstance.data().cards.map((c) => c.columnId)).toEqual(
      initial.cards.map((c) => c.columnId),
    );
  });

  it('moves within a column with ArrowDown (focus is covered in board-card-reorder-state.spec.ts)', async () => {
    const reorderCards = vi.fn(() => of({ cards: twoCardBoard().cards }));
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: () => of(twoCardBoard()), reorderCards, reorderColumns: vi.fn() },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onCardKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      1,
      0,
    );
    expect(reorderCards).toHaveBeenCalledWith([{ columnId: 1, cardIds: [2, 1] }]);
  });

  it('drops into an empty column', async () => {
    const boardData: BoardData = {
      columns: makeColumns().slice(0, 2),
      cards: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'A',
          description: '',
          position: 0,
          backlogPosition: 0,
          prUrl: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    const reorderCards = vi.fn(() =>
      of({ cards: [{ ...boardData.cards[0], columnId: 2, position: 0 }] }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: () => of(boardData), reorderCards, reorderColumns: vi.fn() },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onCardDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: boardData.cards[0] },
      } as never,
      2,
    );
    expect(reorderCards).toHaveBeenCalledWith([
      { columnId: 1, cardIds: [] },
      { columnId: 2, cardIds: [1] },
    ]);
  });

  it('opens detail on a plain click', async () => {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderCards: vi.fn(),
            reorderColumns: vi.fn(),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    (board as unknown as { router: { navigate: typeof navigate } }).router = {
      navigate,
    } as never;
    board.onCardClick(new MouseEvent('click', { cancelable: true }), twoCardBoard().cards[0]);
    expect(navigate).toHaveBeenCalledWith(['/cards', 1]);
  });

  it('announces the new position so consecutive moves read differently', async () => {
    // The server answers with the order it was given, as the real API does.
    const reorderCards = vi.fn((columns: { columnId: number; cardIds: number[] }[]) => {
      const byId = new Map(twoCardBoard().cards.map((c) => [c.id, c]));
      return of({
        cards: columns.flatMap((col) =>
          col.cardIds.map((id, position) => ({
            ...byId.get(id)!,
            columnId: col.columnId,
            position,
            backlogPosition: position,
          })),
        ),
      });
    });
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderCards,
            reorderColumns: vi.fn(),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    const press = (key: string, index: number) =>
      board.onCardKeydown(new KeyboardEvent('keydown', { key, cancelable: true }), 1, index);
    press('ArrowDown', 0);
    const first = board.reorderAnnouncement();
    expect(first).toContain('2番目');
    press('ArrowUp', 1);
    const second = board.reorderAnnouncement();
    expect(second).toContain('1番目');
    expect(second).not.toBe(first);
  });

  it('announces the destination column and position after a cross-column drop', async () => {
    const boardData = twoCardBoard();
    const reorderCards = vi.fn(() =>
      of({
        cards: boardData.cards.map((c) => (c.id === 1 ? { ...c, columnId: 2, position: 0 } : c)),
      }),
    );
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(boardData),
            reorderCards,
            reorderColumns: vi.fn(),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    f.componentInstance.onCardDrop(
      {
        previousContainer: { id: 'card-list-1' },
        container: { id: 'card-list-2' },
        previousIndex: 0,
        currentIndex: 0,
        item: { data: boardData.cards[0] },
      } as never,
      2,
    );
    const name = boardData.columns.find((c) => c.id === 2)?.name;
    expect(f.componentInstance.reorderAnnouncement()).toBe(
      `${boardData.cards[0].title}を${name}の1番目へ移動しました`,
    );
  });

  it('leaves modified and non-primary clicks to the browser', async () => {
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderCards: vi.fn(),
            reorderColumns: vi.fn(),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const board = f.componentInstance;
    (board as unknown as { router: { navigate: typeof navigate } }).router = {
      navigate,
    } as never;
    const card = twoCardBoard().cards[0];
    for (const init of [
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ]) {
      const ev = new MouseEvent('click', { cancelable: true, ...init });
      board.onCardClick(ev, card);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(navigate).not.toHaveBeenCalled();

    const plain = new MouseEvent('click', { cancelable: true });
    board.onCardClick(plain, card);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/cards', 1]);
  });

  it('keeps browser and assistive shortcuts that use modifier keys', async () => {
    const reorderCards = vi.fn(() => of({ cards: twoCardBoard().cards }));
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: { board: () => of(twoCardBoard()), reorderCards, reorderColumns: vi.fn() },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    for (const init of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
    ]) {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true, ...init });
      f.componentInstance.onCardKeydown(ev, 1, 0);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(reorderCards).not.toHaveBeenCalled();

    const plain = new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    f.componentInstance.onCardKeydown(plain, 1, 0);
    expect(plain.defaultPrevented).toBe(true);
    expect(reorderCards).toHaveBeenCalledTimes(1);
  });

  it('describes card dragging differently while reordering is unavailable', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () => of(twoCardBoard()),
            reorderCards: () => new Subject(),
            reorderColumns: vi.fn(),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const help = () =>
      f.nativeElement.querySelector(
        '#' + f.nativeElement.querySelector('.task-card-body').getAttribute('aria-describedby'),
      )?.textContent as string;
    expect(help()).toContain('上下矢印');
    f.componentInstance.onCardKeydown(
      new KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true }),
      1,
      0,
    );
    f.detectChanges();
    expect(f.componentInstance.canReorderCards()).toBe(false);
    expect(help()).toContain('保存中');
  });
});
