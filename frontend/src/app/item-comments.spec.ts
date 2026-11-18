import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import {
  ItemComments,
  appendComment,
  displayCommentAuthor,
  removeComment,
  replaceComment,
} from './item-comments';
import { ItemComment } from './models';

const c1: ItemComment = {
  id: 1,
  itemId: 10,
  author: '',
  body: 'hello',
  createdAt: '2026-11-18T00:00:00Z',
  updatedAt: '2026-11-18T00:00:00Z',
};
const c2: ItemComment = {
  id: 2,
  itemId: 10,
  author: 'Alice',
  body: 'world',
  createdAt: '2026-11-18T01:00:00Z',
  updatedAt: '2026-11-18T01:00:00Z',
};

function setup(
  api: {
    listComments: ReturnType<typeof vi.fn>;
    createComment?: ReturnType<typeof vi.fn>;
    updateComment?: ReturnType<typeof vi.fn>;
    deleteComment?: ReturnType<typeof vi.fn>;
  },
  number = 3,
  projectId?: number,
) {
  TestBed.configureTestingModule({
    imports: [ItemComments],
    providers: [
      {
        provide: Api,
        useValue: {
          createComment: vi.fn(() => of(c2)),
          updateComment: vi.fn((_n, _id, patch) => of({ ...c1, ...patch, id: c1.id })),
          deleteComment: vi.fn(() => of(undefined)),
          ...api,
        },
      },
    ],
  });
  const f = TestBed.createComponent(ItemComments);
  f.componentRef.setInput('number', number);
  if (projectId != null) f.componentRef.setInput('projectId', projectId);
  f.detectChanges();
  return f;
}

describe('ItemComments pure helpers', () => {
  it('appends, replaces, removes, and displays anonymous author', () => {
    expect(appendComment([c1], c2)).toEqual([c1, c2]);
    expect(replaceComment([c1, c2], { ...c1, body: 'x' })[0].body).toBe('x');
    expect(removeComment([c1, c2], 1)).toEqual([c2]);
    expect(displayCommentAuthor('')).toBe('（無名）');
    expect(displayCommentAuthor('Bob')).toBe('Bob');
  });
});

describe('ItemComments', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('shows heading and empty success copy', () => {
    const f = setup({ listComments: vi.fn(() => of([])) });
    expect(f.nativeElement.textContent).toContain('コメント');
    expect(f.nativeElement.textContent).toContain('まだコメントはありません。');
  });

  it('shows error on GET failure, not empty copy', () => {
    const f = setup({ listComments: vi.fn(() => throwError(() => new Error('fail'))) });
    expect(f.nativeElement.textContent).toContain('コメントを読み込めませんでした');
    expect(f.nativeElement.textContent).not.toContain('まだコメントはありません。');
  });

  it('appends on post success and leaves list unchanged on failure', () => {
    const create = vi
      .fn()
      .mockReturnValueOnce(of(c2))
      .mockReturnValueOnce(throwError(() => new Error('no')));
    const f = setup({
      listComments: vi.fn(() => of([c1])),
      createComment: create,
    });
    f.componentInstance.draftBody.set('world');
    f.componentInstance.draftAuthor.set('Alice');
    f.componentInstance.submit();
    f.detectChanges();
    expect(f.componentInstance.comments()).toHaveLength(2);
    expect(f.componentInstance.comments()[1].body).toBe('world');
    expect(f.componentInstance.draftBody()).toBe('');

    f.componentInstance.draftBody.set('fail');
    f.componentInstance.submit();
    f.detectChanges();
    expect(f.componentInstance.comments()).toHaveLength(2);
    expect(f.nativeElement.textContent).toContain('投稿できませんでした');
  });

  it('disables compose while posting', () => {
    const pending = new Subject<ItemComment>();
    const f = setup({
      listComments: vi.fn(() => of([])),
      createComment: vi.fn(() => pending),
    });
    f.componentInstance.draftBody.set('x');
    f.componentInstance.submit();
    f.detectChanges();
    expect(f.componentInstance.posting()).toBe(true);
    const btn = f.nativeElement.querySelector('form.compose button[type="submit"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    pending.next(c1);
    pending.complete();
    f.detectChanges();
    expect(f.componentInstance.posting()).toBe(false);
  });

  it('reloads on number/project change and ignores stale GET', () => {
    const pending = new Subject<ItemComment[]>();
    const list = vi
      .fn()
      .mockReturnValueOnce(pending)
      .mockReturnValue(of([c2]));
    const f = setup({ listComments: list }, 3, 1);
    f.componentRef.setInput('number', 7);
    f.detectChanges();
    pending.next([c1]);
    pending.complete();
    expect(f.componentInstance.comments()).toEqual([c2]);
    expect(list).toHaveBeenLastCalledWith(7, 1);
  });

  it('ignores stale mutation success after number change', () => {
    const pending = new Subject<ItemComment>();
    const f = setup({
      listComments: vi.fn(() => of([c1])),
      createComment: vi.fn(() => pending),
    });
    f.componentInstance.draftBody.set('late');
    f.componentInstance.submit();
    expect(f.componentInstance.posting()).toBe(true);
    f.componentRef.setInput('number', 9);
    f.detectChanges();
    expect(f.componentInstance.posting()).toBe(false);
    pending.next({ ...c2, body: 'late' });
    pending.complete();
    expect(f.componentInstance.comments().some((c) => c.body === 'late')).toBe(false);
  });

  it('rolls back edit on failure and restores on cancel', () => {
    const update = vi.fn(() => throwError(() => new Error('no')));
    const f = setup({
      listComments: vi.fn(() => of([c1])),
      updateComment: update,
    });
    f.componentInstance.startEdit(c1);
    f.componentInstance.editBody.set('changed');
    f.componentInstance.saveEdit(c1);
    f.detectChanges();
    expect(f.componentInstance.comments()[0].body).toBe('hello');
    expect(f.nativeElement.textContent).toContain('保存できませんでした');

    f.componentInstance.startEdit(c1);
    f.componentInstance.editBody.set('temp');
    f.componentInstance.cancelEdit();
    expect(f.componentInstance.editingId()).toBeNull();
    expect(f.componentInstance.comments()[0].body).toBe('hello');
  });

  it('keeps row when delete is cancelled', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const del = vi.fn(() => of(undefined));
    const f = setup({
      listComments: vi.fn(() => of([c1])),
      deleteComment: del,
    });
    f.componentInstance.remove(c1);
    expect(confirm).toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(f.componentInstance.comments()).toHaveLength(1);
  });

  it('does not apply delayed success after destroy', () => {
    const pending = new Subject<ItemComment>();
    const f = setup({
      listComments: vi.fn(() => of([])),
      createComment: vi.fn(() => pending),
    });
    f.componentInstance.draftBody.set('x');
    f.componentInstance.submit();
    f.destroy();
    pending.next(c1);
    pending.complete();
    // destroyed instance must not throw; comments stay empty on the last snapshot
    expect(f.componentInstance.comments()).toEqual([]);
  });
});
