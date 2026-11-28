import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { DESCRIPTION_MAX_LEN } from './description-blocks';
import { ItemSolution } from './item-solution';
import type { Item } from './models';
import { ProjectSession } from './project-session';

const card: Item = {
  id: 18,
  projectId: 1,
  number: 3,
  columnId: 1,
  title: '学習',
  description: '元の説明',
  solution: '',
  position: 0,
  backlogPosition: 0,
  offsetY: 0,
  prUrls: [],
  relatedItems: [],
  assignee: '',
  closeReason: '',
  favorite: false,
  dueAt: null,
  createdAt: '',
  updatedAt: '',
};

describe('ItemSolution', () => {
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let query: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let api: {
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
    listLabels?: ReturnType<typeof vi.fn>;
  };
  let restoreDialog: (() => void) | undefined;

  beforeEach(async () => {
    vi.useFakeTimers();
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
    params = new BehaviorSubject(convertToParamMap({ number: '3' }));
    query = new BehaviorSubject(convertToParamMap({ project: '1' }));
    api = {
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id: number, patch: { solution?: string }) =>
        of({ ...card, ...patch }),
      ),
      board: vi.fn(() =>
        of({ columns: [], items: [], settings: { cardLayout: 'pack', activeProjectId: 1 } }),
      ),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    await TestBed.configureTestingModule({
      imports: [ItemSolution],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: params.asObservable(),
            queryParamMap: query.asObservable(),
          },
        },
        {
          provide: ProjectSession,
          useValue: {
            activeId: () => 1,
            projects: () => [{ id: 1, name: 'P' }],
            switching: () => false,
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    restoreDialog?.();
    restoreDialog = undefined;
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function create() {
    const fixture = TestBed.createComponent(ItemSolution);
    fixture.detectChanges();
    return fixture;
  }

  it('loads with project query and shows empty placeholder', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    expect(api.itemByNumber).toHaveBeenCalledWith(3, 1);
    expect(fixture.nativeElement.textContent).toContain('未記入');
    fixture.destroy();
  });

  it('does not show comment UI on the solution page', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-item-comments')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('コメント');
    fixture.destroy();
  });

  it('PATCHes only solution after debounce', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('実装メモ');
    await vi.advanceTimersByTimeAsync(400);
    expect(api.updateItem).toHaveBeenCalledWith(18, { solution: '実装メモ' });
    fixture.destroy();
  });

  it('saves the final solution after IME trailing-block deletion without duplication', async () => {
    api.itemByNumber.mockReturnValue(of({ ...card, solution: 'a\nb' }));
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    let blocks = [
      ...fixture.nativeElement.querySelectorAll('textarea.block-input'),
    ] as HTMLTextAreaElement[];
    const trailing = blocks[1]!;
    trailing.dispatchEvent(new Event('compositionstart', { bubbles: true }));
    trailing.value = '';
    trailing.dispatchEvent(new Event('input', { bubbles: true }));
    trailing.setSelectionRange(0, 0);
    const composingBackspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    trailing.dispatchEvent(composingBackspace);
    await vi.advanceTimersByTimeAsync(500);
    expect(composingBackspace.defaultPrevented).toBe(false);
    expect(api.updateItem).not.toHaveBeenCalled();

    trailing.dispatchEvent(new Event('compositionend', { bubbles: true }));
    fixture.detectChanges();
    blocks = [...fixture.nativeElement.querySelectorAll('textarea.block-input')];
    const committed = blocks[1]!;
    committed.dispatchEvent(new Event('input', { bubbles: true }));
    committed.setSelectionRange(0, 0);
    committed.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(400);

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith(18, { solution: 'a' });
    expect(fixture.componentInstance.control.value).toBe('a');
    fixture.destroy();

    api.itemByNumber.mockReturnValue(of({ ...card, solution: 'a' }));
    const reloaded = create();
    await Promise.resolve();
    reloaded.detectChanges();
    const reloadedBlocks = [
      ...reloaded.nativeElement.querySelectorAll('textarea.block-input'),
    ] as HTMLTextAreaElement[];
    expect(reloadedBlocks.map((area) => area.value)).toEqual(['a']);
  });

  it('keeps draft and shows error when save fails', async () => {
    api.updateItem.mockReturnValueOnce(throwError(() => new Error('fail')));
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('失敗する本文');
    await vi.advanceTimersByTimeAsync(400);
    fixture.detectChanges();
    expect(cmp.control.value).toBe('失敗する本文');
    expect(fixture.nativeElement.textContent).toContain('保存に失敗');
    fixture.destroy();
  });

  it('marks dirty so live refresh stays blocked', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('下書き');
    expect(cmp['dirty']).toBe(true);
    fixture.destroy();
  });

  it('canLeave flushes pending changes', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('flush me');
    const leaveP = cmp.canLeave();
    await vi.advanceTimersByTimeAsync(0);
    await expect(leaveP).resolves.toBe(true);
    expect(api.updateItem).toHaveBeenCalledWith(18, { solution: 'flush me' });
    fixture.destroy();
  });

  it('opens link dialog from linkRequest and inserts markdown on confirm', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('');
    cmp.onLinkRequest({ blockIndex: 0, start: 0, end: 0, selectedText: '' });
    fixture.detectChanges();
    expect(cmp.descriptionEditor.open()).toBe(true);
    expect(fixture.nativeElement.querySelector('#solution-link-title')).toBeTruthy();
    cmp.descriptionEditor.setLabel('doc');
    cmp.descriptionEditor.setUrl('https://example.com');
    cmp.confirmDescriptionLink();
    fixture.detectChanges();
    expect(cmp.descriptionEditor.open()).toBe(false);
    expect(cmp.control.value).toBe('[doc](https://example.com)');
    fixture.destroy();
  });

  it('keeps empty block text when link dialog is cancelled', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.onTextChange('\n');
    cmp.onLinkRequest({ blockIndex: 0, start: 0, end: 0, selectedText: '' });
    fixture.detectChanges();
    cmp.descriptionEditor.cancel();
    fixture.detectChanges();
    expect(cmp.descriptionEditor.open()).toBe(false);
    expect(cmp.control.value).toBe('\n');
    fixture.destroy();
  });

  it('keeps blocks and shows ソリューション limit error when link apply fails', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    const almost = 'x'.repeat(DESCRIPTION_MAX_LEN - 1);
    cmp.onTextChange(almost);
    cmp.onLinkRequest({ blockIndex: 0, start: 0, end: 0, selectedText: '' });
    fixture.detectChanges();
    cmp.descriptionEditor.setLabel('a');
    cmp.descriptionEditor.setUrl('https://example.com');
    cmp.confirmDescriptionLink();
    fixture.detectChanges();
    expect(cmp.descriptionEditor.error()).toContain('ソリューション');
    expect(cmp.control.value).toBe(almost);
    expect(cmp.descriptionEditor.open()).toBe(true);
    fixture.destroy();
  });

  it('resets link dialog on reload', async () => {
    const fixture = create();
    await Promise.resolve();
    const cmp = fixture.componentInstance;
    cmp.onLinkRequest({ blockIndex: 0, start: 0, end: 0, selectedText: '' });
    expect(cmp.descriptionEditor.open()).toBe(true);
    cmp.load();
    await Promise.resolve();
    expect(cmp.descriptionEditor.open()).toBe(false);
    fixture.destroy();
  });

  it('does not poll while link dialog is open', async () => {
    const fixture = create();
    await Promise.resolve();
    fixture.detectChanges();
    const cmp = fixture.componentInstance;
    cmp.onLinkRequest({ blockIndex: 0, start: 0, end: 0, selectedText: '' });
    expect(cmp.descriptionEditor.open()).toBe(true);
    const beforeCalls = api.itemByNumber.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.itemByNumber.mock.calls.length).toBe(beforeCalls);
    expect(cmp.descriptionEditor.open()).toBe(true);
    fixture.destroy();
  });
});
