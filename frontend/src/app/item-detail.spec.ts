import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ItemDetail } from './item-detail';
import { AiChatContext } from './ai-chat-context';
import { Api } from './api';
import { AuthSession } from './auth-session';
import { formatDueAtUtc, fromLocalParts } from './due-at';
import { Item } from './models';
import { itemDetailUrl } from './item-link';
import { COPY_LINK_SUCCESS } from './copy-link-feedback';
import {
  COMMAND_ITEM_MENU_EMPTY,
  COPY_COMMAND_FAILURE,
  COPY_COMMAND_SUCCESS,
  resolveCommand,
} from './command-template';
import {
  clearReturnTo,
  LIST_RETURN_KEY,
  readBoardScroll,
  readReturnTo,
  saveBoardScroll,
  saveReturnTo,
} from './list-scroll-session';

const testUser = {
  id: 1,
  loginName: 'admin',
  displayName: 'Admin',
  role: 'admin' as const,
  disabled: false,
};

const authStub = {
  user: signal(testUser),
  status: signal<'authenticated'>('authenticated'),
  loadError: signal(''),
  ensureMe: () => of(testUser),
  isAdmin: () => true,
  clearSubject: () => undefined,
  login: () => of(testUser),
  logout: () => of(undefined),
};

const card: Item = {
  id: 18,
  projectId: 0,
  number: 3,
  columnId: 1,
  title: '学習',
  description: '元の説明',
  position: 0,
  backlogPosition: 0,
  offsetY: 0,
  prUrls: [],
  relatedItems: [],
  assignee: '',
  closeReason: '',
  solution: '',
  favorite: false,
  dueAt: null,
  createdAt: '',
  updatedAt: '',
  canEdit: true,
  canManage: true,
};
describe('ItemDetail autosave', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    listAIChat: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    restoreArchivedItem: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };
  let restoreDialog: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
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
    params = new BehaviorSubject(new Map([['number', '3']]));
    router = {
      navigate: vi.fn(),
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
            { id: 3, name: 'Close', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      restoreArchivedItem: vi.fn(() => of({ ...card, archivedAt: null })),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        { provide: Router, useValue: router },
      ],
    });
  });
  afterEach(() => {
    restoreDialog();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const create = () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return f;
  };
  it('does not render always-on inline AI chat (moved to fab)', async () => {
    const f = create();
    await Promise.resolve();
    f.detectChanges();
    expect(f.nativeElement.querySelector('app-item-ai-chat')).toBeNull();
  });
  it('keeps archived details read-only and offers restore to editors', async () => {
    api.itemByNumber.mockReturnValue(
      of({ ...card, archivedAt: '2026-11-12T12:00:00.000Z', canEdit: true }),
    );
    const f = create();
    await Promise.resolve();
    f.detectChanges();

    expect(f.componentInstance.isArchived()).toBe(true);
    expect(f.componentInstance.canEdit()).toBe(false);
    expect(f.componentInstance.canRestoreArchive()).toBe(true);
    expect(f.nativeElement.textContent).toContain('詳細は閲覧のみです');
    expect((f.nativeElement.querySelector('.favorite-toggle') as HTMLButtonElement).disabled).toBe(true);
    expect(f.nativeElement.textContent).toContain('元の列へ戻す');
    f.destroy();
  });
  it('clears AiChatContext when route number changes while item is null', async () => {
    const f = create();
    await Promise.resolve();
    f.detectChanges();
    const ctx = TestBed.inject(AiChatContext);
    expect(ctx.pageKind()).toBe('detail');
    expect(ctx.routeTarget()?.number).toBe(3);
    // Simulate navigation to another number before the new card arrives
    (f.componentInstance as unknown as { routeNumber: { set: (n: number) => void } }).routeNumber.set(
      99,
    );
    f.componentInstance.autosave.reset(null);
    f.detectChanges();
    expect(ctx.pageKind()).toBe('other');
    expect(ctx.routeTarget()).toBeNull();
  });
  it('shows solution property link (empty label) without form field', async () => {
    const f = create();
    await Promise.resolve();
    f.detectChanges();
    const link = f.nativeElement.querySelector('a.solution-link') as HTMLAnchorElement | null;
    expect(link).toBeTruthy();
    expect(link!.textContent?.trim()).toBe('ソリューション（未記入）');
    expect(Object.keys(f.componentInstance.form.getRawValue())).not.toContain('solution');
  });
  it('shows filled solution property label when solution is set', async () => {
    api.itemByNumber.mockReturnValue(of({ ...card, solution: 'メモ', projectId: 2 }));
    const f = create();
    await Promise.resolve();
    f.detectChanges();
    const link = f.nativeElement.querySelector('a.solution-link') as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe('ソリューション');
  });
  it('goBackToList navigates to saved returnTo and clears list-return', async () => {
    saveReturnTo('/backlog');
    const f = create();
    await f.componentInstance.goBackToList();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/backlog');
    expect(readReturnTo()).toBeNull();
  });
  it('goBackToList keeps list-return when navigateByUrl fails', async () => {
    saveReturnTo('/backlog');
    router.navigateByUrl.mockResolvedValue(false);
    const f = create();
    await f.componentInstance.goBackToList();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/backlog');
    expect(readReturnTo()).toBe('/backlog');
  });
  it('goBackToList falls back to / when returnTo missing', async () => {
    clearReturnTo();
    const f = create();
    await f.componentInstance.goBackToList();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
  });
  it('goBackToList falls back to / when returnTo raw is invalid', async () => {
    sessionStorage.setItem(LIST_RETURN_KEY, '{"returnTo":"//evil"}');
    const f = create();
    await f.componentInstance.goBackToList();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(readReturnTo()).toBeNull();
  });
  it('back link href uses list URL from returnTo', () => {
    saveReturnTo('/backlog');
    const f = create();
    const link = f.nativeElement.querySelector('.back-link') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/backlog');
  });
  it('delete clears board scroll and list-return then navigates to /', () => {
    saveReturnTo('/backlog');
    saveBoardScroll({ scrollY: 99, scrollLeft: 1 });
    const f = create();
    f.componentInstance.remove();
    expect(readReturnTo()).toBeNull();
    expect(readBoardScroll()).toBeNull();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
  });
  it('places comments above history', () => {
    const f = create();
    const comments = f.nativeElement.querySelector('app-item-comments');
    const history = f.nativeElement.querySelector('app-item-history');
    expect(comments).toBeTruthy();
    expect(history).toBeTruthy();
    expect(
      comments.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
  it('refreshes history after a successful autosave without resetting the draft', () => {
    api.updateItem.mockImplementation((_id, patch) =>
      of({ ...card, ...patch, updatedAt: '2026-11-13T00:00:00Z' }),
    );
    const f = create();
    expect(api.history).toHaveBeenCalledTimes(1);
    // The history is addressed by the public task number, never by the internal id.
    expect(api.history).toHaveBeenLastCalledWith(card.number, 0);
    f.componentInstance.form.controls.description.setValue('history refresh');
    f.componentInstance.autosave.flush();
    f.detectChanges();
    expect(api.history).toHaveBeenCalledTimes(2);
    expect(f.componentInstance.form.controls.description.value).toBe('history refresh');
  });
  it('has no manual save button and never saves just by loading', () => {
    const f = create();
    expect(f.nativeElement.querySelector('form.detail-layout button[type="submit"]')).toBeNull();
    vi.advanceTimersByTime(2500);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.eyebrow').textContent.trim()).toBe('ITEM-003');
  });
  it('saves the status selection immediately using the internal ID and leaves inputs enabled', () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const f = create();
    const select = f.nativeElement.querySelector('#detail-status') as HTMLSelectElement;
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change'));
    expect(api.updateItem).toHaveBeenCalledWith(18, { columnId: 2 });
    expect(f.componentInstance.form.enabled).toBe(true);
  });
  it('saves text on blur and displays failure without clearing edits', () => {
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: '通信失敗' } })));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-title') as HTMLInputElement;
    input.value = '編集中';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { title: '編集中' });
    expect(input.value).toBe('編集中');
    expect(f.nativeElement.textContent).toContain('通信失敗');
    expect(f.nativeElement.textContent).toContain('再試行');
  });
  const typed: Record<'title' | 'description', [string, string, unknown]> = {
    title: ['#detail-title', '新しいタイトル', { title: '新しいタイトル' }],
    description: ['textarea.block-input', '新しい本文', { description: '新しい本文' }],
  };
  it.each(['title', 'description'] as const)(
    'holds %s while composing and saves it after compositionend',
    (field) => {
      const [selector, value, patch] = typed[field];
      const f = create();
      const input = f.nativeElement.querySelector(selector) as HTMLInputElement;
      input.dispatchEvent(new Event('compositionstart'));
      input.value = value;
      input.dispatchEvent(new Event('input'));
      vi.advanceTimersByTime(2500);
      expect(api.updateItem).not.toHaveBeenCalled();
      input.dispatchEvent(new Event('compositionend'));
      vi.advanceTimersByTime(600);
      expect(api.updateItem).toHaveBeenCalledTimes(1);
      expect(api.updateItem).toHaveBeenCalledWith(18, patch);
    },
  );
  it('saves the final description after IME trailing-block deletion without duplication', async () => {
    api.itemByNumber.mockReturnValue(of({ ...card, description: 'a\nb' }));
    const f = create();
    await Promise.resolve();
    f.detectChanges();
    let blocks = [
      ...f.nativeElement.querySelectorAll('textarea.block-input'),
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
    vi.advanceTimersByTime(2500);
    expect(composingBackspace.defaultPrevented).toBe(false);
    expect(api.updateItem).not.toHaveBeenCalled();

    trailing.dispatchEvent(new Event('compositionend', { bubbles: true }));
    f.detectChanges();
    blocks = [...f.nativeElement.querySelectorAll('textarea.block-input')];
    const committed = blocks[1]!;
    committed.dispatchEvent(new Event('input', { bubbles: true }));
    committed.setSelectionRange(0, 0);
    committed.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    vi.advanceTimersByTime(600);

    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith(18, { description: 'a' });
    expect(f.componentInstance.form.controls.description.value).toBe('a');
    expect(
      [...f.nativeElement.querySelectorAll('textarea.block-input')].map(
        (area) => (area as HTMLTextAreaElement).value,
      ),
    ).toEqual(['a']);
    f.destroy();

    api.itemByNumber.mockReturnValue(of({ ...card, description: 'a' }));
    const reloaded = create();
    await Promise.resolve();
    reloaded.detectChanges();
    expect(
      [...reloaded.nativeElement.querySelectorAll('textarea.block-input')].map(
        (area) => (area as HTMLTextAreaElement).value,
      ),
    ).toEqual(['a']);
  });
  it.each(['title', 'description'] as const)('saves %s immediately on blur', (field) => {
    const [selector, value, patch] = typed[field];
    const f = create();
    const input = f.nativeElement.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    expect(api.updateItem).not.toHaveBeenCalled();
    input.dispatchEvent(new Event('blur'));
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(api.updateItem).toHaveBeenCalledWith(18, patch);
  });
  it('cancels the pending save when the screen is destroyed', () => {
    const f = create();
    const input = f.nativeElement.querySelector('#detail-title') as HTMLInputElement;
    input.value = '破棄される編集';
    input.dispatchEvent(new Event('input'));
    f.destroy();
    vi.advanceTimersByTime(2500);
    expect(api.updateItem).not.toHaveBeenCalled();
  });
  it('shows PR titles instead of raw URLs and omits related url secondary text', () => {
    const url = 'https://github.com/poteto317/scrum-board/pull/2';
    api.itemByNumber.mockReturnValue(
      of({
        ...card,
        prUrls: [url],
        prTitles: ['Nice title'],
        relatedItems: [{ kind: 'url', url: 'https://example.com/doc', label: 'Docs' }],
      }),
    );
    const f = create();
    const pr = f.nativeElement.querySelector(
      '.pr-list[aria-label="紐付けたGitHub PR"] .pr-link',
    ) as HTMLAnchorElement;
    expect(pr.getAttribute('href')).toBe(url);
    expect(pr.textContent?.replace(/\s+/g, ' ').trim()).toContain('Nice title');
    expect(pr.textContent).not.toContain(url);
    expect(pr.querySelector('.pr-link-url')).toBeNull();
    const related = f.nativeElement.querySelector(
      '.pr-list[aria-label="関連アイテム"] .pr-link',
    ) as HTMLAnchorElement;
    expect(related.textContent?.replace(/\s+/g, ' ').trim()).toContain('Docs');
    expect(related.querySelector('.pr-link-url')).toBeNull();
    expect(related.textContent).not.toContain('https://example.com/doc');
  });
  it('adds and removes PR URLs via immediate PATCH', () => {
    const url1 = 'https://github.com/poteto317/scrum-board/pull/2';
    const url2 = 'https://github.com/poteto317/scrum-board/pull/3';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url1] }));
    api.updateItem.mockReturnValueOnce(of({ ...card, prUrls: [url1, url2] }));
    api.updateItem.mockReturnValueOnce(of({ ...card, prUrls: [url1] }));
    const f = create();
    expect(f.nativeElement.querySelectorAll('.pr-link')).toHaveLength(1);
    const input = f.nativeElement.querySelector('#detail-pr-url') as HTMLInputElement;
    input.value = url2;
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('.pr-add button').click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { prUrls: [url1, url2] });
    expect(input.value).toBe('');
    expect(f.nativeElement.querySelectorAll('.pr-link')).toHaveLength(2);
    f.nativeElement.querySelectorAll('.pr-remove')[1].click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { prUrls: [url1] });
    expect(f.nativeElement.querySelectorAll('.pr-link')).toHaveLength(1);
  });
  it('keeps an invalid PR URL unsent and uses only the saved PRs as links', () => {
    const url = 'https://github.com/poteto317/scrum-board/pull/2';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url] }));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-pr-url') as HTMLInputElement;
    input.value = 'https://github.com.evil/a/b/pull/1';
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('.pr-add button').click();
    f.detectChanges();
    expect(api.updateItem).not.toHaveBeenCalled();
    const link = f.nativeElement.querySelector('.pr-link');
    expect(link.getAttribute('href')).toBe(url);
    expect(link.rel).toBe('noopener noreferrer');
    expect(f.nativeElement.textContent).toContain('GitHub PRのURLを入力してください');
  });
  it('keeps the PR list when add PATCH fails', () => {
    const url = 'https://github.com/poteto317/scrum-board/pull/2';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url] }));
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: '保存失敗' } })));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-pr-url') as HTMLInputElement;
    input.value = 'https://github.com/poteto317/scrum-board/pull/9';
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('.pr-add button').click();
    f.detectChanges();
    expect(f.nativeElement.querySelectorAll('.pr-link')).toHaveLength(1);
    expect(f.nativeElement.textContent).toContain('保存失敗');
  });
  it('reorders PR URLs with move buttons and hides controls for a single PR', () => {
    const url1 = 'https://github.com/poteto317/scrum-board/pull/2';
    const url2 = 'https://github.com/poteto317/scrum-board/pull/3';
    api.itemByNumber.mockReturnValue(
      of({ ...card, prUrls: [url1, url2], prTitles: ['First', 'Second'] }),
    );
    api.updateItem.mockReturnValue(
      of({ ...card, prUrls: [url2, url1], prTitles: undefined }),
    );
    const f = create();
    expect(f.nativeElement.querySelectorAll('.pr-move')).toHaveLength(4);
    const downs = f.nativeElement.querySelectorAll(
      '.pr-list[aria-label="紐付けたGitHub PR"] .pr-move',
    ) as NodeListOf<HTMLButtonElement>;
    downs[1].click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { prUrls: [url2, url1] });
    const links = [...f.nativeElement.querySelectorAll('.pr-list[aria-label="紐付けたGitHub PR"] .pr-link')].map(
      (a: HTMLAnchorElement) => ({
        href: a.getAttribute('href'),
        text: a.textContent?.replace(/\s+/g, ' ').trim(),
      }),
    );
    expect(links.map((l) => l.href)).toEqual([url2, url1]);
    expect(links[0].text).toContain('Second');
    expect(links[1].text).toContain('First');
  });
  it('hides PR reorder controls when only one PR is linked', () => {
    const url = 'https://github.com/poteto317/scrum-board/pull/2';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url] }));
    const f = create();
    const list = f.nativeElement.querySelector('.pr-list[aria-label="紐付けたGitHub PR"]');
    expect(list.querySelectorAll('.pr-move')).toHaveLength(0);
    expect(list.querySelectorAll('.card-drag-handle')).toHaveLength(0);
  });
  it('rolls PR order back when reorder PATCH fails', () => {
    const url1 = 'https://github.com/poteto317/scrum-board/pull/2';
    const url2 = 'https://github.com/poteto317/scrum-board/pull/3';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url1, url2] }));
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: '順序の保存に失敗' } })));
    const f = create();
    f.nativeElement.querySelectorAll('.pr-list[aria-label="紐付けたGitHub PR"] .pr-move')[1].click();
    f.detectChanges();
    const links = [...f.nativeElement.querySelectorAll('.pr-list[aria-label="紐付けたGitHub PR"] .pr-link')].map(
      (a: HTMLAnchorElement) => a.getAttribute('href'),
    );
    expect(links).toEqual([url1, url2]);
    expect(f.nativeElement.textContent).toContain('順序の保存に失敗');
  });
  it('reorders related items with move buttons', () => {
    const a = { kind: 'url' as const, url: 'https://example.com/a', label: 'A' };
    const b = { kind: 'url' as const, url: 'https://example.com/b', label: 'B' };
    api.itemByNumber.mockReturnValue(of({ ...card, relatedItems: [a, b] }));
    api.updateItem.mockReturnValue(of({ ...card, relatedItems: [b, a] }));
    const f = create();
    f.nativeElement.querySelectorAll('.pr-list[aria-label="関連アイテム"] .pr-move')[1].click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { relatedItems: [b, a] });
    const labels = [...f.nativeElement.querySelectorAll('.pr-list[aria-label="関連アイテム"] .pr-link')].map(
      (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels[0]).toContain('B');
    expect(labels[1]).toContain('A');
  });
  it('rolls related order back when reorder PATCH fails', () => {
    const a = { kind: 'url' as const, url: 'https://example.com/a', label: 'A' };
    const b = { kind: 'url' as const, url: 'https://example.com/b', label: 'B' };
    api.itemByNumber.mockReturnValue(of({ ...card, relatedItems: [a, b] }));
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: '関連の順序保存に失敗' } })));
    const f = create();
    f.nativeElement.querySelectorAll('.pr-list[aria-label="関連アイテム"] .pr-move')[1].click();
    f.detectChanges();
    const labels = [...f.nativeElement.querySelectorAll('.pr-list[aria-label="関連アイテム"] .pr-link')].map(
      (el: HTMLElement) => el.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(labels[0]).toContain('A');
    expect(labels[1]).toContain('B');
    expect(f.nativeElement.textContent).toContain('関連の順序保存に失敗');
  });
  it('pauses live refresh while a list item is dragging', () => {
    const url1 = 'https://github.com/poteto317/scrum-board/pull/2';
    const url2 = 'https://github.com/poteto317/scrum-board/pull/3';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url1, url2] }));
    const f = create();
    expect(f.componentInstance.listDragging()).toBe(false);
    f.componentInstance.onListDragStarted();
    expect(f.componentInstance.listDragging()).toBe(true);
    f.componentInstance.onListDragEnded();
    expect(f.componentInstance.listDragging()).toBe(false);
  });
  it('clears listDragging when navigating to another card', () => {
    const url1 = 'https://github.com/poteto317/scrum-board/pull/2';
    const url2 = 'https://github.com/poteto317/scrum-board/pull/3';
    api.itemByNumber.mockReturnValue(of({ ...card, prUrls: [url1, url2] }));
    const f = create();
    f.componentInstance.onListDragStarted();
    expect(f.componentInstance.listDragging()).toBe(true);
    api.itemByNumber.mockReturnValue(of({ ...card, number: 4, id: 19, prUrls: [] }));
    params.next(new Map([['number', '4']]));
    f.detectChanges();
    expect(f.componentInstance.listDragging()).toBe(false);
  });
  it('adds and removes related card/URL via immediate PATCH', () => {
    const related = [{ kind: 'url' as const, url: 'https://example.com/a', label: '仕様' }];
    api.itemByNumber.mockReturnValue(of({ ...card, relatedItems: related }));
    api.updateItem.mockReturnValueOnce(
      of({
        ...card,
        relatedItems: [
          ...related,
          { kind: 'item', number: 7, title: '他', label: '' },
        ],
      }),
    );
    api.updateItem.mockReturnValueOnce(of({ ...card, relatedItems: related }));
    const f = create();
    const list = () => f.nativeElement.querySelector('[aria-label="関連アイテム"]');
    expect(list().querySelectorAll('.pr-link')).toHaveLength(1);
    const input = f.nativeElement.querySelector('#detail-related-draft') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('.related-add button').click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, {
      relatedItems: [...related, { kind: 'item', number: 7, label: '', projectId: 0 }],
    });
    expect(list().querySelectorAll('.pr-link')).toHaveLength(2);
    list().querySelectorAll('.pr-remove')[1].click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { relatedItems: related });
  });
  it('sets a preset assignee with immediate PATCH', () => {
    api.updateItem.mockReturnValue(of({ ...card, assignee: 'Cursor' }));
    const f = create();
    const chip = Array.from(
      f.nativeElement.querySelectorAll('.assignee-chip') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Cursor')!;
    chip.click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { assignee: 'Cursor' });
    expect(f.componentInstance.item()?.assignee).toBe('Cursor');
    expect(chip.classList.contains('selected')).toBe(true);
  });
  it('clears the free-text draft when the selected preset is clicked again', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, assignee: 'Cursor' }));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-assignee') as HTMLInputElement;
    input.value = 'leftover';
    input.dispatchEvent(new Event('input'));
    const chip = Array.from(
      f.nativeElement.querySelectorAll('.assignee-chip') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Cursor')!;
    chip.click();
    f.detectChanges();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });
  it('applies free-text assignee and clears it', () => {
    api.updateItem
      .mockReturnValueOnce(of({ ...card, assignee: 'mash' }))
      .mockReturnValueOnce(of({ ...card, assignee: '' }));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-assignee') as HTMLInputElement;
    input.value = 'mash';
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('.assignee-custom button').click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { assignee: 'mash' });
    expect(f.componentInstance.item()?.assignee).toBe('mash');
    f.nativeElement.querySelector('.assignee-clear').click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { assignee: '' });
    expect(f.componentInstance.item()?.assignee).toBe('');
  });
  it('reverts assignee display when PATCH fails and keeps the draft', () => {
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: '対応の保存失敗' } })));
    const f = create();
    const input = f.nativeElement.querySelector('#detail-assignee') as HTMLInputElement;
    input.value = 'draft-name';
    input.dispatchEvent(new Event('input'));
    f.nativeElement.querySelector('.assignee-custom button').click();
    f.detectChanges();
    expect(f.componentInstance.item()?.assignee).toBe('');
    expect(input.value).toBe('draft-name');
    expect(f.nativeElement.textContent).toContain('対応の保存失敗');
  });
  it('toggles favorite with immediate PATCH and aria-label', () => {
    api.updateItem.mockReturnValue(
      of({ ...card, favorite: true, updatedAt: '2026-11-18T00:00:00.000Z' }),
    );
    const f = create();
    const btn = f.nativeElement.querySelector('.favorite-toggle') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('お気に入りに追加');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    btn.click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { favorite: true });
    expect(f.componentInstance.item()?.favorite).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('お気に入りから外す');
    expect(Object.keys(f.componentInstance.form.getRawValue())).not.toContain('favorite');
  });
  it('ignores second favorite toggle while saving and reverts on error', () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValueOnce(pending);
    const f = create();
    const btn = f.nativeElement.querySelector('.favorite-toggle') as HTMLButtonElement;
    btn.click();
    f.detectChanges();
    expect(f.componentInstance.busy()).toBe(true);
    btn.click();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    pending.error({ error: { message: 'お気に入りの保存失敗' } });
    f.detectChanges();
    expect(f.componentInstance.item()?.favorite).toBe(false);
    expect(f.nativeElement.textContent).toContain('お気に入りの保存失敗');
  });
  it('keeps favorite while saving when live refresh would overwrite (L-037)', () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValueOnce(pending);
    const f = create();
    const btn = f.nativeElement.querySelector('.favorite-toggle') as HTMLButtonElement;
    btn.click();
    f.detectChanges();
    expect(f.componentInstance.busy()).toBe(true);
    expect(f.componentInstance.item()?.favorite).toBe(true);
    // Simulate what live refresh apply would do — busy() must block callers.
    expect(f.componentInstance.busy()).toBe(true);
    pending.next({ ...card, favorite: true, updatedAt: '2026-11-18T00:00:00.000Z' });
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.item()?.favorite).toBe(true);
  });
  it('flushes edits before allowing navigation', async () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const f = create();
    f.componentInstance.form.controls.description.setValue('移動前');
    const leaving = f.componentInstance.canLeave();
    expect(api.updateItem).toHaveBeenCalledWith(18, { description: '移動前' });
    pending.next({ ...card, description: '移動前' });
    pending.complete();
    expect(await leaving).toBe(true);
  });
  it('lets the user reject discarding invalid edits', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const f = create();
    f.componentInstance.form.controls.title.setValue('');
    expect(await f.componentInstance.canLeave()).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
    expect(f.componentInstance.form.controls.title.value).toBe('');
  });
  it('ignores an old response after switching directly to another card', () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const f = create();
    f.componentInstance.form.controls.title.setValue('送信');
    f.componentInstance.autosave.flush();
    api.itemByNumber.mockReturnValue(of({ ...card, id: 99, number: 40, title: '別アイテム' }));
    params.next(new Map([['number', '40']]));
    pending.next({ ...card, title: '古い応答' });
    pending.complete();
    vi.advanceTimersByTime(2500);
    expect(f.componentInstance.item()?.id).toBe(99);
    expect(f.componentInstance.form.controls.title.value).toBe('別アイテム');
    expect(api.updateItem).toHaveBeenCalledTimes(1);
  });
  it('warns on unload with unsaved data', () => {
    const f = create();
    f.componentInstance.form.controls.title.setValue('未保存');
    const event = {
      preventDefault: vi.fn(),
      returnValue: undefined,
    } as unknown as BeforeUnloadEvent;
    f.componentInstance.beforeUnload(event);
    expect(event.preventDefault).toHaveBeenCalled();
  });
  it('deletes by internal ID, cancels pending save and bypasses discarded-draft warnings', async () => {
    const f = create();
    f.componentInstance.form.controls.description.setValue('未保存');
    f.componentInstance.remove();
    vi.advanceTimersByTime(2500);
    expect(api.deleteItem).toHaveBeenCalledWith(18);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/']);
    expect(await f.componentInstance.canLeave()).toBe(true);
  });
  it('shows trash-bin delete dialog copy without irreversible wording', () => {
    const f = create();
    f.componentInstance.confirmDelete.set(true);
    f.detectChanges();
    const copy = f.nativeElement.querySelector('.delete-copy')?.textContent ?? '';
    const title = f.nativeElement.querySelector('#delete-title')?.textContent ?? '';
    const action =
      [...(f.nativeElement.querySelectorAll('.danger-button') as NodeListOf<HTMLElement>)].find(
        (el) => el.textContent?.includes('ゴミ箱'),
      )?.textContent ?? '';
    expect(title).toContain('ゴミ箱');
    expect(copy).toContain('ゴミ箱に移します');
    expect(copy).toMatch(/30日以内.*復元/);
    expect(copy).not.toContain('取り消せません');
    expect(action).toContain('ゴミ箱に移す');
    f.destroy();
  });
  it('keeps Close reason dialog flow after trash dialog copy change', () => {
    const f = create();
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    f.detectChanges();
    expect(f.componentInstance.closeTransition.open()).toBe(true);
    expect(f.nativeElement.querySelector('#close-reason-modal-input')).toBeTruthy();
    expect(api.updateItem).not.toHaveBeenCalled();
    f.destroy();
  });
  it('confirms before leave while assignee PATCH is in flight', async () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const f = create();
    const chip = Array.from(
      f.nativeElement.querySelectorAll('.assignee-chip') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Cursor')!;
    chip.click();
    expect(await f.componentInstance.canLeave()).toBe(false);
    expect(confirm).toHaveBeenCalled();
    pending.complete();
  });
});

describe('ItemDetail copy card link', () => {
  let params: BehaviorSubject<Map<string, string>>;
  const originalClipboard = navigator.clipboard;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    listAIChat: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    params = new BehaviorSubject(new Map([['number', '3']]));
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() =>
        of({
          columns: [{ id: 1, name: 'Todo', position: 0 }],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
  });
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const create = () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return f;
  };
  it('shows a copy button and keeps save-state aria-live separate from copy feedback', () => {
    const f = create();
    const copyBtn = f.nativeElement.querySelector('.copy-card-link');
    expect(copyBtn).not.toBeNull();
    expect(copyBtn.getAttribute('aria-label')).toBe('リンクをコピー');
    const saveState = f.nativeElement.querySelector('.save-state');
    expect(saveState.getAttribute('aria-live')).toBe('polite');
    const banner = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(banner).not.toBeNull();
    expect(banner.classList.contains('copy-feedback-banner--hidden')).toBe(true);
  });
  it('copies the public card detail URL on success and shows visible feedback', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const f = create();
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitUntil(() => f.componentInstance.copyLinkFeedback() !== '');
    f.detectChanges();
    const expected = itemDetailUrl(window.location.origin, card.number);
    expect(writeText).toHaveBeenCalledWith(expected);
    const feedback = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(feedback).not.toBeNull();
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.classList.contains('copy-feedback-banner--ok')).toBe(true);
    expect(feedback.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(feedback.textContent).toContain('リンクをコピーしました');
  });
  it('shows failure feedback when clipboard writeText rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const f = create();
    const copyBtn = f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement;
    copyBtn.click();
    await vi.waitUntil(() => f.componentInstance.copyLinkFeedback() !== '');
    f.detectChanges();
    const feedback = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(feedback.classList.contains('copy-feedback-banner--error')).toBe(true);
    expect(feedback.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(feedback.textContent).toContain('リンクをコピーできませんでした');
  });
  it('does nothing when card is not loaded', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const f = create();
    f.componentInstance.autosave.reset(null);
    await f.componentInstance.copyItemLink();
    expect(writeText).not.toHaveBeenCalled();
    expect(f.componentInstance.copyLinkFeedback()).toBe('');
  });
});

describe('ItemDetail copy command menu and management', () => {
  const originalClipboard = navigator.clipboard;
  const template = {
    id: 7,
    name: 'gh pr',
    template: 'gh pr view {{url}}',
    position: 1,
  };
  let restoreDialog: () => void;

  beforeEach(() => {
    vi.useRealTimers();
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
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    TestBed.resetTestingModule();
    restoreDialog();
    vi.restoreAllMocks();
  });

  const create = (
    overrides: Record<string, unknown> = {},
    templates: { id: number; name: string; template: string; position: number }[] = [template],
    auth: {
      user: ReturnType<typeof signal>;
      status: ReturnType<typeof signal>;
      loadError: ReturnType<typeof signal>;
      ensureMe: () => unknown;
      isAdmin: () => boolean;
      clearSubject: () => unknown;
      login: () => unknown;
      logout: () => unknown;
    } = authStub,
  ) => {
    const params = new BehaviorSubject(new Map([['number', '3']]));
    const api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() => of({ columns: [{ id: 1, name: 'Todo', position: 0 }], items: [] })),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn(),
      deleteItem: vi.fn(),
      listCommandTemplates: vi.fn(() => of({ templates })),
      listItemCommandTemplatesByNumber: vi.fn(() => of({ templates })),
      replaceItemCommandTemplatesByNumber: vi.fn(() => of({ templates })),
      applyCommandTemplatesToAllItems: vi.fn(() => of(undefined)),
      replaceCommandTemplateDefaults: vi.fn(() => of({ templateIds: [] })),
      listCommandTemplateDefaults: vi.fn(() => of({ templateIds: [] })),
      createCommandTemplate: vi.fn(),
      updateCommandTemplate: vi.fn(),
      deleteCommandTemplate: vi.fn(),
      ...overrides,
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    const router = { navigate: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: auth },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        { provide: Router, useValue: router },
      ],
    });
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return { f, api, router };
  };

  const openMenu = (f: { nativeElement: HTMLElement; detectChanges(): void }) => {
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('aria-haspopup')).toBe('menu');
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    button!.click();
    f.detectChanges();
    const menu = f.nativeElement.querySelector('.copy-command-menu') as HTMLElement | null;
    expect(menu).not.toBeNull();
    expect(button!.getAttribute('aria-expanded')).toBe('true');
    return { button: button!, menu: menu! };
  };

  const openDialog = (f: { nativeElement: HTMLElement; detectChanges(): void }) => {
    const manage = f.nativeElement.querySelector('.manage-commands') as HTMLButtonElement | null;
    expect(manage).not.toBeNull();
    expect(manage!.textContent).toMatch(/コマンドを管理|コマンド一覧/);
    manage!.click();
    f.detectChanges();
    const dialog = f.nativeElement.querySelector(
      'dialog.command-templates-dialog',
    ) as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.hasAttribute('appmodal')).toBe(true);
    return dialog!;
  };

  const buttonByText = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
      HTMLButtonElement | undefined;

  const setControl = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };

  it('copies immediately when only one template is linked without opening the menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f, api, router } = create();
    expect(api.listCommandTemplates).toHaveBeenCalled();
    expect(api.listItemCommandTemplatesByNumber).toHaveBeenCalled();
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    await vi.waitUntil(() => {
      f.detectChanges();
      const feedback = f.nativeElement.querySelector('.copy-feedback-banner');
      return (feedback?.textContent ?? '').includes(COPY_COMMAND_SUCCESS);
    });
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    expect(button!.getAttribute('aria-expanded')).toBe('false');
    const feedback = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(feedback.getAttribute('aria-live')).toBe('polite');
    expect(feedback.classList.contains('copy-feedback-banner--ok')).toBe(true);
    expect(feedback.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(feedback.textContent).toContain(COPY_COMMAND_SUCCESS);
    expect(writeText).toHaveBeenCalledWith(
      resolveCommand(template.template, itemDetailUrl(window.location.origin, card.number)),
    );
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('keeps the menu for multiple templates and copies the chosen item', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 2 };
    const { f } = create({}, [template, second]);
    const { menu } = openMenu(f);
    expect(menu.textContent).toContain(template.name);
    expect(menu.textContent).toContain(second.name);
    (menu.querySelector('button') as HTMLButtonElement).click();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_SUCCESS,
      );
    });
    expect(writeText).toHaveBeenCalledWith(
      resolveCommand(template.template, itemDetailUrl(window.location.origin, card.number)),
    );
  });

  it('shows only the latest copy feedback when a link copy follows a command copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f } = create();
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_SUCCESS,
      );
    });
    (f.nativeElement.querySelector('.copy-card-link') as HTMLButtonElement).click();
    await vi.waitUntil(() => {
      f.detectChanges();
      return f.componentInstance.copyFeedback() === COPY_LINK_SUCCESS;
    });
    const feedback = f.nativeElement.querySelector('.copy-feedback-banner').textContent ?? '';
    expect(feedback).toContain(COPY_LINK_SUCCESS);
    expect(feedback).not.toContain(COPY_COMMAND_SUCCESS);
    expect(f.componentInstance.copyCommandFeedback()).toBe(COPY_COMMAND_SUCCESS);
  });

  it('shows command copy failure in the visible live feedback', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const { f } = create();
    const button = f.nativeElement.querySelector(
      '.copy-command-button',
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    button!.click();
    f.detectChanges();
    await vi.waitUntil(() => {
      f.detectChanges();
      return (f.nativeElement.querySelector('.copy-feedback-banner')?.textContent ?? '').includes(
        COPY_COMMAND_FAILURE,
      );
    });
    const feedback = f.nativeElement.querySelector('.copy-feedback-banner') as HTMLElement;
    expect(feedback.classList.contains('copy-feedback-banner--error')).toBe(true);
    expect(feedback.querySelector('.copy-feedback-banner__icon')).not.toBeNull();
    expect(feedback.textContent).toContain(COPY_COMMAND_FAILURE);
  });

  it('shows an empty notice and does not copy when no templates exist', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const { f } = create({}, []);
    const { menu } = openMenu(f);
    expect(menu.textContent).toContain(COMMAND_ITEM_MENU_EMPTY);
    expect(menu.querySelector('button, [role="menuitem"]')).toBeNull();
    menu.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('shows the card-empty notice even when the catalog has templates', () => {
    const { f } = create(
      {
        listCommandTemplates: vi.fn(() => of({ templates: [template] })),
        listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      },
      [template],
    );
    const { menu } = openMenu(f);
    expect(menu.textContent).toContain(COMMAND_ITEM_MENU_EMPTY);
    expect(menu.textContent).not.toContain(template.name);
  });

  it('shows a load failure instead of the empty-registration notice when listing templates fails', () => {
    const { f } = create({
      listItemCommandTemplatesByNumber: vi.fn(() => throwError(() => ({ status: 0 }))),
      listCommandTemplates: vi.fn(() => throwError(() => ({ status: 0 }))),
    });
    const { menu } = openMenu(f);
    expect(menu.textContent).not.toContain(COMMAND_ITEM_MENU_EMPTY);
    expect(menu.textContent).toContain('通信に失敗しました');
    expect(menu.querySelector('button, [role="menuitem"]')).toBeNull();
    const dialog = openDialog(f);
    expect(dialog.textContent).toContain('コマンド一覧を読み込めませんでした');
  });

  it('closes the command menu on Escape and on an outside click', () => {
    const second = { id: 8, name: 'echo', template: 'echo {{url}}', position: 2 };
    const { f } = create({}, [template, second]);
    openMenu(f);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
    openMenu(f);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    f.detectChanges();
    expect(f.nativeElement.querySelector('.copy-command-menu')).toBeNull();
  });

  it('opens the manage dialog with an add form and url help', () => {
    const { f } = create({}, []);
    const dialog = openDialog(f);
    expect(dialog.querySelector('#command-name')).not.toBeNull();
    expect(dialog.querySelector('#command-template')).not.toBeNull();
    expect(dialog.querySelector('form button[type="submit"]')).not.toBeNull();
    expect(dialog.textContent).toContain('{{url}} はこのアイテムのリンクに置き換わります。');
  });

  it('hides catalog mutate controls for members while showing name and body', () => {
    const member = {
      id: 2,
      loginName: 'mem',
      displayName: 'Mem',
      role: 'member' as const,
      disabled: false,
    };
    const memberAuth = {
      ...authStub,
      user: signal(member),
      ensureMe: () => of(member),
      isAdmin: () => false,
      login: () => of(member),
    };
    const { f } = create({}, [template], memberAuth);
    const dialog = openDialog(f);
    expect(dialog.textContent).toContain(template.name);
    expect(dialog.querySelector('.command-template-body')?.textContent).toContain(template.template);
    expect(dialog.querySelector('.command-template-bulk')).toBeNull();
    expect(dialog.querySelector('#command-name')).toBeNull();
    expect(dialog.querySelector('.command-create-form')).toBeNull();
    expect(buttonByText(dialog, '編集')).toBeUndefined();
    expect(buttonByText(dialog, '削除')).toBeUndefined();
    expect(buttonByText(dialog, '全アイテムに適用')).toBeUndefined();
    expect(buttonByText(dialog, '新規の初期にする')).toBeUndefined();
    expect(buttonByText(dialog, '追加')).toBeUndefined();
  });

  it('adds a template, refreshes the list, and reports success', () => {
    const created = { id: 8, name: 'new cmd', template: 'echo {{url}}', position: 2 };
    const { f, api } = create(
      {
        createCommandTemplate: vi.fn(() => of(created)),
        listCommandTemplates: vi
          .fn()
          .mockReturnValueOnce(of({ templates: [] }))
          .mockReturnValue(of({ templates: [created] })),
      },
      [],
    );
    const dialog = openDialog(f);
    setControl(dialog.querySelector('#command-name') as HTMLInputElement, created.name);
    setControl(dialog.querySelector('#command-template') as HTMLInputElement, created.template);
    buttonByText(dialog, '追加')!.click();
    f.detectChanges();
    expect(api.createCommandTemplate).toHaveBeenCalledWith({
      name: created.name,
      template: created.template,
    });
    expect(dialog.textContent).toContain('コマンドを追加しました');
    expect(dialog.textContent).toContain(created.name);
    expect(dialog.querySelector('.command-template-body')?.textContent).toContain(created.template);
  });

  it('shows the API message when create returns 400', () => {
    const { f, api } = create({
      createCommandTemplate: vi.fn(() =>
        throwError(() => ({ error: { message: '名前が長すぎます' } })),
      ),
    });
    const dialog = openDialog(f);
    setControl(dialog.querySelector('#command-name') as HTMLInputElement, 'too long');
    setControl(dialog.querySelector('#command-template') as HTMLInputElement, 'echo');
    buttonByText(dialog, '追加')!.click();
    f.detectChanges();
    expect(api.createCommandTemplate).toHaveBeenCalled();
    expect(dialog.textContent).toContain('名前が長すぎます');
    expect(dialog.textContent).not.toContain('コマンドを追加しました');
  });

  it('shows a failure message when create hits a network or 5xx error', () => {
    const { f } = create({
      createCommandTemplate: vi.fn(() => throwError(() => ({ status: 500 }))),
    });
    const dialog = openDialog(f);
    setControl(dialog.querySelector('#command-name') as HTMLInputElement, 'gh');
    setControl(dialog.querySelector('#command-template') as HTMLInputElement, 'echo {{url}}');
    buttonByText(dialog, '追加')!.click();
    f.detectChanges();
    expect(dialog.textContent).toContain('通信に失敗しました。接続を確認して再試行してください。');
    expect(dialog.textContent).not.toContain('コマンドを追加しました');
  });

  it('updates a template and reports success', () => {
    const updated = { ...template, name: 'renamed', template: 'gh pr diff {{url}}' };
    const { f, api } = create({
      updateCommandTemplate: vi.fn(() => of(updated)),
      listCommandTemplates: vi
        .fn()
        .mockReturnValueOnce(of({ templates: [template] }))
        .mockReturnValue(of({ templates: [updated] })),
    });
    const dialog = openDialog(f);
    buttonByText(dialog, '編集')!.click();
    f.detectChanges();
    setControl(dialog.querySelector('.command-edit-name') as HTMLInputElement, updated.name);
    setControl(
      dialog.querySelector('.command-edit-template') as HTMLInputElement,
      updated.template,
    );
    (dialog.querySelector('.command-edit-form') as HTMLFormElement).requestSubmit();
    f.detectChanges();
    expect(api.updateCommandTemplate).toHaveBeenCalledWith(template.id, {
      name: updated.name,
      template: updated.template,
    });
    expect(dialog.textContent).toContain('コマンドを更新しました');
    expect(dialog.textContent).toContain(updated.name);
    expect(dialog.querySelector('.command-template-body')?.textContent).toContain(updated.template);
  });

  it('shows the API message when update returns 400', () => {
    const { f } = create({
      updateCommandTemplate: vi.fn(() =>
        throwError(() => ({ error: { message: '本文が空です' } })),
      ),
    });
    const dialog = openDialog(f);
    buttonByText(dialog, '編集')!.click();
    f.detectChanges();
    (dialog.querySelector('.command-edit-form') as HTMLFormElement).requestSubmit();
    f.detectChanges();
    expect(dialog.textContent).toContain('本文が空です');
    expect(dialog.textContent).not.toContain('コマンドを更新しました');
  });

  it('deletes a template and reports success', () => {
    const { f, api } = create({
      deleteCommandTemplate: vi.fn(() => of(undefined)),
      listCommandTemplates: vi
        .fn()
        .mockReturnValueOnce(of({ templates: [template] }))
        .mockReturnValue(of({ templates: [] })),
    });
    const dialog = openDialog(f);
    expect(dialog.textContent).toContain(template.template);
    buttonByText(dialog, '削除')!.click();
    f.detectChanges();
    expect(api.deleteCommandTemplate).toHaveBeenCalledWith(template.id);
    expect(dialog.textContent).toContain('コマンドを削除しました');
    expect(dialog.textContent).not.toContain(template.template);
  });

  it('shows a failure message when delete hits a network error', () => {
    const { f } = create({
      deleteCommandTemplate: vi.fn(() => throwError(() => ({ status: 0 }))),
    });
    const dialog = openDialog(f);
    buttonByText(dialog, '削除')!.click();
    f.detectChanges();
    expect(dialog.textContent).toContain('通信に失敗しました。接続を確認して再試行してください。');
    expect(dialog.textContent).toContain(template.template);
    expect(dialog.textContent).not.toContain('コマンドを削除しました');
  });

  it('renders the template body as text, not HTML', () => {
    const hostile = {
      id: 9,
      name: 'safe',
      template: '<img src=x onerror=alert(1)>',
      position: 0,
    };
    const { f } = create({}, [hostile]);
    const dialog = openDialog(f);
    const body = dialog.querySelector('.command-template-body');
    expect(body).not.toBeNull();
    expect(body!.textContent).toContain(hostile.template);
    expect(body!.querySelector('img')).toBeNull();
    expect(dialog.querySelector('img')).toBeNull();
  });
});

describe('ItemDetail IME response handling', () => {
  it.each(['title', 'description'] as const)(
    'preserves buffered IME input in %s when an earlier save responds',
    (field) => {
      const pending = new Subject<Item>();
      TestBed.configureTestingModule({
        imports: [ItemDetail],
        providers: [
          {
            provide: Api,
            useValue: {
              listUsers: () => of([]),
              history: () => of({ events: [], nextBefore: 0 }),
              listComments: () => of([]),
              listAIChat: () => of([]),
              listAttachments: () => of([]),
              uploadAttachment: () => of({ id: 1, originalName: 'x.png' }),
              deleteAttachment: () => of(undefined),
              board: () => of({ columns: [], items: [] }),
              itemByNumber: () => of(card),
              updateItem: () => pending,
              listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
            },
          },
          { provide: AuthSession, useValue: authStub },
          {
            provide: ActivatedRoute,
            useValue: {
              paramMap: of(new Map([['number', '3']])),
              queryParamMap: of(new Map()),
            },
          },
          { provide: Router, useValue: { navigate: vi.fn() } },
        ],
      });
      const f = TestBed.createComponent(ItemDetail);
      f.detectChanges();
      const input = f.nativeElement.querySelector(field === 'description' ? 'textarea.block-input' : `#detail-${field}`) as HTMLInputElement;
      const sent = field === 'title' ? '送信するタイトル' : '送信する本文';
      input.value = sent;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      const composing = f.nativeElement.querySelector(field === 'description' ? 'textarea.block-input' : `#detail-${field}`) as HTMLInputElement;
      composing.dispatchEvent(new Event('compositionstart'));
      composing.value = '変換途中の日本語';
      composing.dispatchEvent(new Event('input'));
      expect(f.componentInstance.form.controls[field].value).toBe(sent);
      // The response differs from what the user sees, so only the composing guard keeps the DOM value.
      const serverValue = '別の人の編集';
      pending.next({ ...card, [field]: serverValue });
      pending.complete();
      expect(composing.value).toBe('変換途中の日本語');
      composing.dispatchEvent(new Event('compositionend'));
      expect(f.componentInstance.form.controls[field].value).toBe('変換途中の日本語');
      f.destroy();
    },
  );
});

describe('ItemDetail live refresh', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    listAIChat: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    params = new BehaviorSubject(new Map([['number', '3']]));
    router = { navigate: vi.fn() };
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
            { id: 3, name: 'Close', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        { provide: Router, useValue: router },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const create = () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return f;
  };

  it('refreshes card from poll when no local edits', async () => {
    const f = create();
    expect(f.componentInstance.loading()).toBe(false);
    api.itemByNumber.mockReturnValue(
      of({ ...card, title: '外部更新', updatedAt: '2026-11-14T12:00:00Z' }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.item()?.title).toBe('外部更新');
    expect(f.componentInstance.loading()).toBe(false);
    f.destroy();
  });

  it('does not overwrite card while autosave.hasChanges()', async () => {
    const f = create();
    // emitEvent: false avoids scheduling autosave; advancing 5s would flush a save and clear hasChanges.
    f.componentInstance.form.controls.title.setValue('編集中', { emitEvent: false });
    expect(f.componentInstance.autosave.hasChanges()).toBe(true);
    api.itemByNumber.mockReturnValue(of({ ...card, title: 'サーバ側' }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.form.controls.title.value).toBe('編集中');
    expect(f.componentInstance.item()?.title).not.toBe('サーバ側');
    f.destroy();
  });

  it('ignores poll for a different card number after navigation', async () => {
    const slow = new Subject<Item>();
    const f = create();
    expect(f.componentInstance.item()?.number).toBe(3);
    // Next poll returns a slow observable for card #3
    api.itemByNumber.mockReturnValue(slow.asObservable());
    await vi.advanceTimersByTimeAsync(5000);
    const other = { ...card, id: 90, number: 9, title: '別アイテム' };
    api.itemByNumber.mockReturnValue(of(other));
    api.board.mockReturnValue(
      of({
        columns: [
          { id: 1, name: 'Todo', position: 0 },
          { id: 2, name: 'Doing', position: 0 },
          { id: 3, name: 'Close', position: 0 },
        ],
        items: [],
      }),
    );
    params.next(new Map([['number', '9']]));
    expect(f.componentInstance.item()?.number).toBe(9);
    expect(f.componentInstance.item()?.title).toBe('別アイテム');
    slow.next({ ...card, title: '遅延した旧アイテム' });
    slow.complete();
    expect(f.componentInstance.item()?.number).toBe(9);
    expect(f.componentInstance.item()?.title).not.toBe('遅延した旧アイテム');
    f.destroy();
  });
});

describe('ItemDetail board meta wiring (#118)', () => {
  let api: Record<string, ReturnType<typeof vi.fn>>;
  const metaColumns = [
    { id: 1, name: 'Todo', position: 0 },
    { id: 2, name: 'Doing', position: 0 },
    { id: 3, name: 'Close', position: 0 },
  ];
  beforeEach(() => {
    vi.useFakeTimers();
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      // The full board must never be requested: items are not needed here (L-060: assert wiring).
      board: vi.fn(() => {
        throw new Error('GET /api/board must not be used by item detail');
      }),
      boardMeta: vi.fn(() => of({ columns: metaColumns, settings: { cardLayout: 'pack' } })),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })),
      listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: new BehaviorSubject(new Map([['number', '3']])).asObservable(),
            queryParamMap: of(new Map()),
          },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('loads columns from boardMeta on the initial load and never from board', () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    expect(api['boardMeta']).toHaveBeenCalledTimes(1);
    expect(api['board']).not.toHaveBeenCalled();
    expect(f.componentInstance.columns().map((c) => c.id)).toEqual([1, 2, 3]);
    f.destroy();
  });

  it('polls boardMeta (not board) and applies its columns', async () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    api['boardMeta'].mockReturnValue(
      of({ columns: [...metaColumns, { id: 4, name: 'Review', position: 0 }], settings: { cardLayout: 'pack' } }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(api['boardMeta'].mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(api['board']).not.toHaveBeenCalled();
    expect(f.componentInstance.columns().map((c) => c.id)).toEqual([1, 2, 3, 4]);
    f.destroy();
  });
});

describe('ItemDetail Close reason', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    listAIChat: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
  };
  let restoreDialog: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
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
    params = new BehaviorSubject(new Map([['number', '3']]));
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
            { id: 3, name: 'Close', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })),
      listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        { provide: Router, useValue: { navigate: vi.fn(), navigateByUrl: vi.fn().mockResolvedValue(true) } },
      ],
    });
  });
  afterEach(() => {
    restoreDialog();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  const create = () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return f;
  };

  it('opens Close reason modal when moving to Close and does not save yet', () => {
    const f = create();
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    f.detectChanges();
    expect(f.componentInstance.closeTransition.open()).toBe(true);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('#close-reason-modal-input')).toBeTruthy();
    f.destroy();
  });

  it('seeds modal draft from saved closeReason', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, closeReason: '既存理由' }));
    const f = create();
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    expect(f.componentInstance.closeTransition.draft()).toBe('既存理由');
    f.destroy();
  });

  it('confirm saves columnId and closeReason then shows reason field', () => {
    api.updateItem.mockReturnValue(
      of({ ...card, columnId: 3, closeReason: '完了', updatedAt: '2026-11-17T00:00:00Z' }),
    );
    const f = create();
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    f.componentInstance.closeTransition.draft.set('完了');
    f.componentInstance.closeTransition.confirm();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { columnId: 3, closeReason: '完了' });
    expect(f.componentInstance.closeTransition.open()).toBe(false);
    expect(f.componentInstance.item()?.columnId).toBe(3);
    expect(f.componentInstance.item()?.closeReason).toBe('完了');
    expect(f.nativeElement.querySelector('#detail-close-reason')).toBeTruthy();
    f.destroy();
  });

  it('cancel restores columnId and does not change closeReason', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, closeReason: '保持' }));
    const f = create();
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    f.componentInstance.closeTransition.draft.set('破棄される下書き');
    f.componentInstance.closeTransition.cancel();
    f.detectChanges();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(f.componentInstance.form.controls.columnId.value).toBe(1);
    expect(f.componentInstance.item()?.closeReason).toBe('保持');
    expect(f.componentInstance.closeTransition.open()).toBe(false);
    f.destroy();
  });

  it('failed confirm reverts columnId and keeps prior closeReason', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, closeReason: '旧' }));
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: 'Close保存失敗' } })));
    const f = create();
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    f.componentInstance.closeTransition.draft.set('新');
    f.componentInstance.closeTransition.confirm();
    f.detectChanges();
    expect(f.componentInstance.form.controls.columnId.value).toBe(1);
    expect(f.componentInstance.item()?.closeReason).toBe('旧');
    expect(f.componentInstance.error()).toBe('Close保存失敗');
    expect(f.componentInstance.closeTransition.open()).toBe(false);
    f.destroy();
  });

  it('shows closeReason textarea while already Close and hides otherwise', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, columnId: 3, closeReason: 'メモ' }));
    const f = create();
    f.detectChanges();
    expect(f.nativeElement.querySelector('#detail-close-reason')).toBeTruthy();
    f.destroy();

    api.itemByNumber.mockReturnValue(of({ ...card, columnId: 1 }));
    const f2 = create();
    f2.detectChanges();
    expect(f2.nativeElement.querySelector('#detail-close-reason')).toBeNull();
    f2.destroy();
  });

  it('Close confirm drops in-flight autosave so a late flush cannot rewind Close', () => {
    const titleFlush = new Subject<Item>();
    const closeSave = new Subject<Item>();
    api.updateItem
      .mockReturnValueOnce(titleFlush)
      .mockReturnValueOnce(closeSave);
    const f = create();
    f.componentInstance.form.controls.title.setValue('編集中');
    f.componentInstance.autosave.flush();
    expect(f.componentInstance.autosave.saving()).toBe(true);
    f.componentInstance.form.controls.columnId.setValue(3);
    f.componentInstance.closeTransition.onStatusChange();
    f.componentInstance.closeTransition.draft.set('理由');
    f.componentInstance.closeTransition.confirm();
    expect(api.updateItem).toHaveBeenLastCalledWith(18, { columnId: 3, closeReason: '理由' });
    closeSave.next({
      ...card,
      columnId: 3,
      closeReason: '理由',
      solution: '',
      favorite: false,
      dueAt: null,
      title: '編集中',
      updatedAt: '2026-11-17T01:00:00Z',
    });
    closeSave.complete();
    titleFlush.next({ ...card, title: '編集中', columnId: 1, closeReason: '' });
    titleFlush.complete();
    f.detectChanges();
    expect(f.componentInstance.item()?.columnId).toBe(3);
    expect(f.componentInstance.item()?.closeReason).toBe('理由');
    f.destroy();
  });
});

describe('ItemDetail description text links', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    listAIChat: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
  };
  const buttonByText = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
      | HTMLButtonElement
      | undefined;
  let restoreDialog: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
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
    params = new BehaviorSubject(new Map([['number', '3']]));
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
            { id: 3, name: 'Close', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() =>
        of({
          ...card,
          description: 'see [Docs](https://example.com) end',
        }),
      ),
      updateItem: vi.fn((_id, patch) =>
        of({ ...card, description: 'see [Docs](https://example.com) end', ...patch }),
      ),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })),
      listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(), navigateByUrl: vi.fn().mockResolvedValue(true) },
        },
      ],
    });
  });
  afterEach(() => {
    restoreDialog?.();
    sessionStorage.clear();
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  const create = () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return f;
  };

  it('always shows borderless block inputs with raw markdown (no description-view)', () => {
    const f = create();
    expect(f.nativeElement.querySelector('.description-view')).toBeNull();
    const area = f.nativeElement.querySelector('textarea.block-input') as HTMLTextAreaElement;
    expect(area).not.toBeNull();
    expect(area.value).toContain('[Docs](https://example.com)');
    expect(f.nativeElement.querySelector('.page-title')).not.toBeNull();
    f.destroy();
  });

  it('inserts a markdown link and flushes; prefill uses block selection', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, description: 'hello world' }));
    const f = create();
    f.detectChanges();
    const area = f.nativeElement.querySelector('textarea.block-input') as HTMLTextAreaElement;
    area.focus();
    area.setSelectionRange(0, 0);
    buttonByText(f.nativeElement, 'リンク')!.click();
    f.detectChanges();
    expect(f.componentInstance.descriptionEditor.label()).toBe('');
    expect(f.componentInstance.busy()).toBe(true);
    f.componentInstance.descriptionEditor.setLabel('Docs');
    f.componentInstance.descriptionEditor.setUrl('https://example.com');
    f.componentInstance.confirmDescriptionLink();
    f.detectChanges();
    expect(f.componentInstance.form.controls.description.value).toBe(
      '[Docs](https://example.com)hello world',
    );
    expect(api.updateItem).toHaveBeenCalledWith(18, {
      description: '[Docs](https://example.com)hello world',
    });
    expect(f.componentInstance.descriptionEditor.open()).toBe(false);

    area.setSelectionRange(0, 5);
    f.componentInstance.onDescriptionLinkRequest({
      blockIndex: 0,
      start: 0,
      end: 5,
      selectedText: area.value.slice(0, 5),
    });
    expect(f.componentInstance.descriptionEditor.label()).toBe('[Docs');
    f.componentInstance.descriptionEditor.cancel();
    f.destroy();
  });

  it('inserts a link into the second block without using absolute offsets', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, description: 'first\nhello' }));
    const f = create();
    f.detectChanges();
    f.componentInstance.onDescriptionLinkRequest({
      blockIndex: 1,
      start: 0,
      end: 5,
      selectedText: 'hello',
    });
    f.componentInstance.descriptionEditor.setLabel('Docs');
    f.componentInstance.descriptionEditor.setUrl('https://example.com');
    f.componentInstance.confirmDescriptionLink();
    f.detectChanges();
    expect(f.componentInstance.form.controls.description.value).toBe(
      'first\n[Docs](https://example.com)',
    );
    expect(api.updateItem).toHaveBeenCalledWith(18, {
      description: 'first\n[Docs](https://example.com)',
    });
    f.destroy();
  });

  it('rejects bad label/url without changing the form', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, description: 'body' }));
    const f = create();
    f.detectChanges();
    f.componentInstance.onDescriptionLinkRequest({
      blockIndex: 0,
      start: 0,
      end: 0,
      selectedText: '',
    });
    f.componentInstance.descriptionEditor.setLabel('');
    f.componentInstance.descriptionEditor.setUrl('https://example.com');
    expect(f.componentInstance.confirmDescriptionLink()).toBeUndefined();
    expect(f.componentInstance.form.controls.description.value).toBe('body');
    expect(f.componentInstance.descriptionEditor.error()).toContain('表示名');
    f.componentInstance.descriptionEditor.setLabel('a]b');
    f.componentInstance.confirmDescriptionLink();
    expect(f.componentInstance.form.controls.description.value).toBe('body');
    f.componentInstance.descriptionEditor.setLabel('ok');
    f.componentInstance.descriptionEditor.setUrl('http://example.com');
    f.componentInstance.confirmDescriptionLink();
    expect(f.componentInstance.form.controls.description.value).toBe('body');
    expect(f.componentInstance.descriptionEditor.error()).toContain('https');
    f.destroy();
  });

  it('keeps busy while the link dialog is open, then clears after cancel', () => {
    const f = create();
    f.detectChanges();
    f.componentInstance.onDescriptionLinkRequest({
      blockIndex: 0,
      start: 0,
      end: 0,
      selectedText: '',
    });
    expect(f.componentInstance.busy()).toBe(true);
    f.componentInstance.descriptionEditor.cancel();
    expect(f.componentInstance.busy()).toBe(false);
    f.destroy();
  });

  it('closes the link dialog when the card number changes', () => {
    const f = create();
    f.detectChanges();
    f.componentInstance.onDescriptionLinkRequest({
      blockIndex: 0,
      start: 0,
      end: 0,
      selectedText: '',
    });
    expect(f.componentInstance.descriptionEditor.open()).toBe(true);
    params.next(new Map([['number', '9']]));
    f.detectChanges();
    expect(f.componentInstance.descriptionEditor.open()).toBe(false);
    f.destroy();
  });

  it('re-parses description blocks when navigating to another card', () => {
    api.itemByNumber.mockImplementation((n: number) =>
      of({
        ...card,
        number: n,
        description: n === 3 ? 'see [Docs](https://example.com) end' : 'other\ncard',
      }),
    );
    const f = create();
    f.detectChanges();
    expect(
      (f.nativeElement.querySelector('textarea.block-input') as HTMLTextAreaElement).value,
    ).toContain('[Docs]');
    params.next(new Map([['number', '9']]));
    f.detectChanges();
    const areas = f.nativeElement.querySelectorAll(
      'textarea.block-input',
    ) as NodeListOf<HTMLTextAreaElement>;
    expect(areas.length).toBe(2);
    expect(areas[0]!.value).toBe('other');
    expect(areas[1]!.value).toBe('card');
    f.destroy();
  });

  it('rejects inserts that would exceed 10000 characters', () => {
    api.itemByNumber.mockReturnValue(of({ ...card, description: 'a'.repeat(9990) }));
    const f = create();
    f.detectChanges();
    f.componentInstance.onDescriptionLinkRequest({
      blockIndex: 0,
      start: 0,
      end: 0,
      selectedText: '',
    });
    f.componentInstance.descriptionEditor.setLabel('lab');
    f.componentInstance.descriptionEditor.setUrl('https://a.com');
    f.componentInstance.confirmDescriptionLink();
    expect(f.componentInstance.form.controls.description.value).toBe('a'.repeat(9990));
    expect(f.componentInstance.descriptionEditor.error()).toContain('10000');
    f.destroy();
  });
});

describe('ItemDetail dueAt picker', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    listComments: ReturnType<typeof vi.fn>;
    listAIChat: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
    listUsers: ReturnType<typeof vi.fn>;
    uploadAttachment: ReturnType<typeof vi.fn>;
    deleteAttachment: ReturnType<typeof vi.fn>;
    listAttachments: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    params = new BehaviorSubject(new Map([['number', '3']]));
    api = {
      listUsers: vi.fn(() => of([])),
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      listComments: vi.fn(() => of([])),
      listAIChat: vi.fn(() => of([])),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
            { id: 3, name: 'Close', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })),
      listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
      uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
      deleteAttachment: vi.fn(() => of(undefined)),
      listAttachments: vi.fn(() => of([])),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: AuthSession, useValue: authStub },
        {
          provide: ActivatedRoute,
          useValue: { paramMap: params.asObservable(), queryParamMap: of(new Map()) },
        },
        {
          provide: Router,
          useValue: { navigate: vi.fn(), navigateByUrl: vi.fn().mockResolvedValue(true) },
        },
      ],
    });
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  const create = () => {
    const f = TestBed.createComponent(ItemDetail);
    f.detectChanges();
    return f;
  };

  const dueField = (root: HTMLElement) =>
    root.querySelector('.due-at-field') as HTMLElement | null;

  const buttonByText = (root: ParentNode, text: string) =>
    Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
      | HTMLButtonElement
      | undefined;

  it('shows 期限なし when dueAt is unset', () => {
    const f = create();
    const field = dueField(f.nativeElement);
    expect(field).not.toBeNull();
    expect(field!.textContent).toContain('期限なし');
    expect(buttonByText(field!, '設定')).toBeTruthy();
    f.destroy();
  });

  it('shows local YYYY/MM/DD HH:mm when dueAt is set', () => {
    const dueAt = '2026-11-17T08:30:00Z';
    api.itemByNumber.mockReturnValue(of({ ...card, dueAt }));
    const f = create();
    const local = new Date(dueAt);
    const expected = `${local.getFullYear()}/${String(local.getMonth() + 1).padStart(2, '0')}/${String(local.getDate()).padStart(2, '0')} ${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
    expect(dueField(f.nativeElement)!.textContent).toContain(expected);
    expect(buttonByText(dueField(f.nativeElement)!, '編集')).toBeTruthy();
    f.destroy();
  });

  it('opens picker with existing dueAt as local parts', () => {
    const dueAt = '2026-11-17T08:30:00Z';
    api.itemByNumber.mockReturnValue(of({ ...card, dueAt }));
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '編集')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.open()).toBe(true);
    const local = new Date(dueAt);
    expect(f.componentInstance.dueAt.draft()).toEqual({
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
      hour: local.getHours(),
      minute: local.getMinutes(),
    });
    expect(f.nativeElement.querySelector('app-due-at-picker')).not.toBeNull();
    f.destroy();
  });

  it('keeps out-of-range dueAt year on open and unchanged confirm', () => {
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    const dueAt = '2099-06-15T03:00:00Z';
    api.itemByNumber.mockReturnValue(of({ ...card, dueAt }));
    api.updateItem.mockClear();
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '編集')!.click();
    f.detectChanges();
    const local = new Date(dueAt);
    expect(f.componentInstance.dueAt.draft()?.year).toBe(local.getFullYear());
    const yearWheel = f.nativeElement.querySelector(
      '.due-at-wheel[data-unit="year"]',
    ) as HTMLElement;
    const years = Array.from(yearWheel.querySelectorAll('[data-value]')).map((el) =>
      Number((el as HTMLElement).dataset['value']),
    );
    expect(years).toContain(2099);
    buttonByText(dueField(f.nativeElement)!, '確定')!.click();
    f.detectChanges();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(f.componentInstance.item()?.dueAt).toBe(dueAt);
    f.destroy();
  });

  it('opens picker with now truncated to the minute when unset', () => {
    vi.setSystemTime(new Date(2026, 10, 17, 17, 45, 30, 500));
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.open()).toBe(true);
    expect(f.componentInstance.dueAt.draft()).toEqual({
      year: 2026,
      month: 11,
      day: 17,
      hour: 17,
      minute: 45,
    });
    f.destroy();
  });

  it('offers year options from currentYear-1 through currentYear+5', () => {
    vi.setSystemTime(new Date(2026, 5, 1, 12, 0, 0));
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    const yearWheel = f.nativeElement.querySelector(
      '.due-at-wheel[data-unit="year"]',
    ) as HTMLElement;
    const years = Array.from(yearWheel.querySelectorAll('[data-value]')).map((el) =>
      Number((el as HTMLElement).dataset['value']),
    );
    expect(years).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031]);
    f.destroy();
  });

  it('confirm PATCHes updateItem with dueAt UTC', () => {
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    f.componentInstance.dueAt.draft.set({
      year: 2026,
      month: 11,
      day: 17,
      hour: 17,
      minute: 30,
    });
    buttonByText(dueField(f.nativeElement)!, '確定')!.click();
    f.detectChanges();
    const expected = formatDueAtUtc(fromLocalParts({ year: 2026, month: 11, day: 17, hour: 17, minute: 30 }));
    expect(api.updateItem).toHaveBeenCalledWith(18, { dueAt: expected });
    expect(f.componentInstance.item()?.dueAt).toBe(expected);
    expect(f.componentInstance.dueAt.open()).toBe(false);
    f.destroy();
  });

  it('clear PATCHes updateItem with dueAt null', () => {
    const dueAt = '2026-11-17T08:30:00Z';
    api.itemByNumber.mockReturnValue(of({ ...card, dueAt }));
    api.updateItem.mockReturnValue(of({ ...card, dueAt: null }));
    const f = create();
    buttonByText(dueField(f.nativeElement)!, 'クリア')!.click();
    f.detectChanges();
    expect(api.updateItem).toHaveBeenCalledWith(18, { dueAt: null });
    expect(f.componentInstance.item()?.dueAt).toBeNull();
    expect(dueField(f.nativeElement)!.textContent).toContain('期限なし');
    f.destroy();
  });

  it('rolls back display and shows error when dueAt PATCH fails (L-001)', () => {
    api.updateItem.mockReturnValue(throwError(() => ({ error: { message: '期限の保存失敗' } })));
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    f.componentInstance.dueAt.draft.set({
      year: 2026,
      month: 11,
      day: 17,
      hour: 17,
      minute: 30,
    });
    buttonByText(dueField(f.nativeElement)!, '確定')!.click();
    f.detectChanges();
    expect(f.componentInstance.item()?.dueAt).toBeNull();
    expect(f.componentInstance.dueAt.open()).toBe(false);
    expect(dueField(f.nativeElement)!.textContent).toContain('期限なし');
    expect(f.nativeElement.textContent).toContain('期限の保存失敗');
    f.destroy();
  });

  it('busy includes picker open and dueAt saving', () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const f = create();
    expect(f.componentInstance.busy()).toBe(false);
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.open()).toBe(true);
    expect(f.componentInstance.busy()).toBe(true);
    expect(f.componentInstance.savingBusy()).toBe(false);
    f.componentInstance.dueAt.draft.set({
      year: 2026,
      month: 11,
      day: 17,
      hour: 10,
      minute: 0,
    });
    buttonByText(dueField(f.nativeElement)!, '確定')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.saving()).toBe(true);
    expect(f.componentInstance.busy()).toBe(true);
    expect(f.componentInstance.savingBusy()).toBe(true);
    pending.next({
      ...card,
      dueAt: formatDueAtUtc(fromLocalParts({ year: 2026, month: 11, day: 17, hour: 10, minute: 0 })),
    });
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.busy()).toBe(false);
    f.destroy();
  });

  it('does not overwrite dueAt draft while picker is open (L-037)', async () => {
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    const draft = {
      year: 2026,
      month: 11,
      day: 17,
      hour: 17,
      minute: 30,
    };
    f.componentInstance.dueAt.draft.set(draft);
    expect(f.componentInstance.busy()).toBe(true);
    api.itemByNumber.mockReturnValue(
      of({ ...card, dueAt: '2026-11-17T00:00:00Z', title: 'サーバ側' }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.dueAt.open()).toBe(true);
    expect(f.componentInstance.dueAt.draft()).toEqual(draft);
    expect(f.componentInstance.item()?.dueAt).toBeNull();
    expect(f.componentInstance.item()?.title).not.toBe('サーバ側');
    f.destroy();
  });

  it('does not overwrite item while dueAt saving (L-037)', async () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    f.componentInstance.dueAt.draft.set({
      year: 2026,
      month: 11,
      day: 17,
      hour: 10,
      minute: 0,
    });
    buttonByText(dueField(f.nativeElement)!, '確定')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.saving()).toBe(true);
    api.itemByNumber.mockReturnValue(
      of({ ...card, dueAt: '2099-01-01T00:00:00Z', title: 'サーバ側' }),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.componentInstance.item()?.dueAt).toBeNull();
    expect(f.componentInstance.item()?.title).not.toBe('サーバ側');
    pending.next({
      ...card,
      dueAt: formatDueAtUtc(fromLocalParts({ year: 2026, month: 11, day: 17, hour: 10, minute: 0 })),
    });
    pending.complete();
    f.destroy();
  });

  it('closes the picker when switching cards', () => {
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.open()).toBe(true);
    api.itemByNumber.mockReturnValue(of({ ...card, id: 99, number: 9, title: '別' }));
    params.next(new Map([['number', '9']]));
    f.detectChanges();
    expect(f.componentInstance.dueAt.open()).toBe(false);
    expect(f.componentInstance.dueAt.draft()).toBeNull();
    f.destroy();
  });

  it('unsubscribes in-flight dueAt PATCH on card switch via cancel$', () => {
    const pending = new Subject<Item>();
    api.updateItem.mockReturnValue(pending);
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    f.componentInstance.dueAt.draft.set({
      year: 2026,
      month: 11,
      day: 17,
      hour: 12,
      minute: 0,
    });
    buttonByText(dueField(f.nativeElement)!, '確定')!.click();
    expect(api.updateItem).toHaveBeenCalledWith(18, {
      dueAt: formatDueAtUtc(
        fromLocalParts({ year: 2026, month: 11, day: 17, hour: 12, minute: 0 }),
      ),
    });
    api.itemByNumber.mockReturnValue(of({ ...card, id: 99, number: 9, title: '別', dueAt: null }));
    params.next(new Map([['number', '9']]));
    f.detectChanges();
    pending.next({
      ...card,
      dueAt: formatDueAtUtc(
        fromLocalParts({ year: 2026, month: 11, day: 17, hour: 12, minute: 0 }),
      ),
      updatedAt: 'late',
    });
    pending.complete();
    expect(f.componentInstance.item()?.id).toBe(99);
    expect(f.componentInstance.item()?.dueAt).toBeNull();
    f.destroy();
  });

  it('closes the picker when the detail screen is destroyed', () => {
    const f = create();
    buttonByText(dueField(f.nativeElement)!, '設定')!.click();
    f.detectChanges();
    expect(f.componentInstance.dueAt.open()).toBe(true);
    f.destroy();
    // Destroy tears down ItemDueAt (takeUntilDestroyed); recreate must start closed.
    const f2 = create();
    expect(f2.componentInstance.dueAt.open()).toBe(false);
    f2.destroy();
  });
});
