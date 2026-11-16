import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ItemDetail } from './item-detail';
import { Api } from './api';
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
const card: Item = {
  id: 18,
  number: 3,
  columnId: 1,
  title: '学習',
  description: '元の説明',
  position: 0,
  backlogPosition: 0,
  prUrls: [],
  relatedItems: [],
  assignee: '',
  createdAt: '',
  updatedAt: '',
};
describe('ItemDetail autosave', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn>; navigateByUrl: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
    params = new BehaviorSubject(new Map([['number', '3']]));
    router = {
      navigate: vi.fn(),
      navigateByUrl: vi.fn().mockResolvedValue(true),
    };
    api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: router },
      ],
    });
  });
  afterEach(() => {
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
    expect(f.nativeElement.querySelector('button[type="submit"]')).toBeNull();
    vi.advanceTimersByTime(2500);
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(f.nativeElement.querySelector('.eyebrow').textContent).toBe('ITEM-003');
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
    description: ['#detail-description', '新しい本文', { description: '新しい本文' }],
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
      relatedItems: [...related, { kind: 'item', number: 7, label: '' }],
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
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    params = new BehaviorSubject(new Map([['number', '3']]));
    api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
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
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
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
  ) => {
    const params = new BehaviorSubject(new Map([['number', '3']]));
    const api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
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
    };
    const router = { navigate: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
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
    expect(manage!.textContent).toContain('コマンドを管理');
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
              history: () => of({ events: [], nextBefore: 0 }),
              board: () => of({ columns: [], items: [] }),
              itemByNumber: () => of(card),
              updateItem: () => pending,
              listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
            },
          },
          { provide: ActivatedRoute, useValue: { paramMap: of(new Map([['number', '3']])) } },
          { provide: Router, useValue: { navigate: vi.fn() } },
        ],
      });
      const f = TestBed.createComponent(ItemDetail);
      f.detectChanges();
      const input = f.nativeElement.querySelector(`#detail-${field}`) as HTMLInputElement;
      const sent = field === 'title' ? '送信するタイトル' : '送信する本文';
      input.value = sent;
      input.dispatchEvent(new Event('input'));
      input.dispatchEvent(new Event('blur'));
      input.dispatchEvent(new Event('compositionstart'));
      input.value = '変換途中の日本語';
      input.dispatchEvent(new Event('input'));
      expect(f.componentInstance.form.controls[field].value).toBe(sent);
      // The response differs from what the user sees, so only the composing guard keeps the DOM value.
      const serverValue = '別の人の編集';
      pending.next({ ...card, [field]: serverValue });
      pending.complete();
      expect(input.value).toBe('変換途中の日本語');
      input.dispatchEvent(new Event('compositionend'));
      expect(f.componentInstance.form.controls[field].value).toBe('変換途中の日本語');
      f.destroy();
    },
  );
});

describe('ItemDetail live refresh', () => {
  let params: BehaviorSubject<Map<string, string>>;
  let api: {
    history: ReturnType<typeof vi.fn>;
    board: ReturnType<typeof vi.fn>;
    itemByNumber: ReturnType<typeof vi.fn>;
    updateItem: ReturnType<typeof vi.fn>;
    deleteItem: ReturnType<typeof vi.fn>;
    listCommandTemplates: ReturnType<typeof vi.fn>;
    listItemCommandTemplatesByNumber: ReturnType<typeof vi.fn>;
  };
  let router: { navigate: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    params = new BehaviorSubject(new Map([['number', '3']]));
    router = { navigate: vi.fn() };
    api = {
      history: vi.fn(() => of({ events: [], nextBefore: 0 })),
      board: vi.fn(() =>
        of({
          columns: [
            { id: 1, name: 'Todo', position: 0 },
            { id: 2, name: 'Doing', position: 0 },
          ],
          items: [],
        }),
      ),
      itemByNumber: vi.fn(() => of(card)),
      updateItem: vi.fn((_id, patch) => of({ ...card, ...patch })),
      deleteItem: vi.fn(() => of(undefined)),
      listCommandTemplates: vi.fn(() => of({ templates: [] })), listItemCommandTemplatesByNumber: vi.fn(() => of({ templates: [] })),
    };
    TestBed.configureTestingModule({
      imports: [ItemDetail],
      providers: [
        { provide: Api, useValue: api },
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
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
