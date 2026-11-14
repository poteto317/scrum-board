import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
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

describe('Board task numbers', () => {
  it('links to the same public number shown on the card', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () =>
              of({
                columns: [{ id: 1, name: 'Todo', position: 0 }],
                cards: [
                  {
                    id: 17,
                    number: 2,
                    columnId: 1,
                    title: 'Task',
                    description: '',
                    backlogPosition: 0,
                    createdAt: '',
                    updatedAt: '',
                  },
                ],
              }),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const link: HTMLAnchorElement = f.nativeElement.querySelector('.task-card');
    expect(link.textContent).toContain('TASK-002');
    expect(link.getAttribute('href')).toBe('/cards/2');
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
      const handles = f.nativeElement.querySelectorAll(
        '.column-drag-handle',
      ) as NodeListOf<HTMLButtonElement>;
      handles[3].focus();
      handles[3].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', cancelable: true }),
      );
      f.detectChanges();

      f.componentInstance.openCard(1);
      f.detectChanges();
      const titleInput = f.nativeElement.querySelector('#card-title') as HTMLInputElement;
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
