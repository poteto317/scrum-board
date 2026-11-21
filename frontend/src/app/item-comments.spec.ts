import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import {
  SCRUM_ATTACHMENT_MIME,
  encodeAttachmentDragPayload,
} from './attachment-dnd';
import { buildAttachmentMarkup } from './description-link';
import {
  COMMENT_BODY_MAX,
  ItemComments,
  appendComment,
  displayCommentAuthor,
  removeComment,
  replaceComment,
  resolveAttachmentRefInsert,
} from './item-comments';
import { ItemComment } from './models';

function mockDataTransfer(opts: {
  types?: string[];
  data?: Record<string, string>;
  files?: File[];
}): DataTransfer {
  const store = { ...(opts.data ?? {}) };
  const types = opts.types ?? Object.keys(store);
  return {
    types,
    getData: (t: string) => store[t] ?? '',
    setData: (t: string, v: string) => {
      store[t] = v;
    },
    files: opts.files ?? [],
  } as unknown as DataTransfer;
}

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
    uploadAttachment?: ReturnType<typeof vi.fn>;
    deleteAttachment?: ReturnType<typeof vi.fn>;
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
          uploadAttachment: vi.fn(() => of({ id: 1, originalName: 'x.png' })),
          deleteAttachment: vi.fn(() => of(undefined)),
          listAttachments: vi.fn(() => of([])),
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

  it('resolveAttachmentRefInsert: noop / error / ok without I/O', () => {
    expect(
      resolveAttachmentRefInsert({
        hasMime: false,
        rawPayload: '',
        itemNumber: 3,
        body: 'hi',
        start: 2,
        end: 2,
      }),
    ).toEqual({ kind: 'noop' });

    expect(
      resolveAttachmentRefInsert({
        hasMime: true,
        rawPayload: '{',
        itemNumber: 3,
        body: 'hi',
        start: 2,
        end: 2,
      }),
    ).toEqual({ kind: 'error', message: '画像の参照を挿入できませんでした。' });

    expect(
      resolveAttachmentRefInsert({
        hasMime: true,
        rawPayload: encodeAttachmentDragPayload({
          itemNumber: 9,
          attachmentId: 1,
          alt: 'x',
        }),
        itemNumber: 3,
        body: 'hi',
        start: 2,
        end: 2,
      }),
    ).toEqual({ kind: 'error', message: '画像の参照を挿入できませんでした。' });

    const ok = resolveAttachmentRefInsert({
      hasMime: true,
      rawPayload: encodeAttachmentDragPayload({
        itemNumber: 3,
        attachmentId: 5,
        alt: 'shot',
      }),
      itemNumber: 3,
      body: 'ab',
      start: 1,
      end: 1,
    });
    expect(ok.kind).toBe('ok');
    if (ok.kind === 'ok') {
      expect(ok.text).toBe(`a${buildAttachmentMarkup(3, 5, 'shot')}b`);
    }

    const tooLong = resolveAttachmentRefInsert({
      hasMime: true,
      rawPayload: encodeAttachmentDragPayload({
        itemNumber: 3,
        attachmentId: 1,
        alt: 'x',
      }),
      itemNumber: 3,
      body: 'y'.repeat(COMMENT_BODY_MAX),
      start: COMMENT_BODY_MAX,
      end: COMMENT_BODY_MAX,
      maxLen: COMMENT_BODY_MAX,
    });
    expect(tooLong).toEqual({
      kind: 'error',
      message: '本文は4000文字以内にしてください。',
    });
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

  it('inserts attachment ref into draft without upload', () => {
    const upload = vi.fn(() => of({ id: 99, originalName: 'x.png' }));
    const f = setup({
      listComments: vi.fn(() => of([])),
      uploadAttachment: upload,
    });
    f.componentInstance.draftBody.set('hi');
    const dt = mockDataTransfer({
      types: [SCRUM_ATTACHMENT_MIME],
      data: {
        [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
          itemNumber: 3,
          attachmentId: 5,
          alt: 'shot',
        }),
      },
    });
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(dt, 'draft');
    expect(f.componentInstance.draftBody()).toContain(buildAttachmentMarkup(3, 5, 'shot'));
    expect(f.componentInstance.draftBody().startsWith('hi')).toBe(true);
    expect(upload).not.toHaveBeenCalled();
  });

  it('rejects broken MIME and wrong item without upload', () => {
    const f = setup({ listComments: vi.fn(() => of([])) });
    const api = TestBed.inject(Api) as unknown as { uploadAttachment: ReturnType<typeof vi.fn> };
    f.componentInstance.draftBody.set('keep');
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({ types: [SCRUM_ATTACHMENT_MIME], data: { [SCRUM_ATTACHMENT_MIME]: '' } }),
      'draft',
    );
    expect(f.componentInstance.draftBody()).toBe('keep');
    expect(f.componentInstance.actionError()).toContain('参照');
    expect(api.uploadAttachment).not.toHaveBeenCalled();

    f.componentInstance.actionError.set('');
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({
        types: [SCRUM_ATTACHMENT_MIME],
        data: {
          [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
            itemNumber: 99,
            attachmentId: 5,
            alt: 'x',
          }),
        },
      }),
      'draft',
    );
    expect(f.componentInstance.draftBody()).toBe('keep');
    expect(f.componentInstance.actionError()).toContain('参照');
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it('does not fall back to upload when MIME type is present with Files', () => {
    const upload = vi.fn(() => of({ id: 99, originalName: 'x.png' }));
    const f = setup({ listComments: vi.fn(() => of([])), uploadAttachment: upload });
    f.componentInstance.draftBody.set('keep');
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 1 });
    const good = mockDataTransfer({
      types: [SCRUM_ATTACHMENT_MIME, 'Files'],
      data: {
        [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
          itemNumber: 3,
          attachmentId: 5,
          alt: 'ok',
        }),
      },
      files: [file],
    });
    const goodEv = { preventDefault() {}, dataTransfer: good } as DragEvent;
    f.componentInstance.onDraftDrop(goodEv);
    expect(f.componentInstance.draftBody()).toContain(buildAttachmentMarkup(3, 5, 'ok'));
    expect(upload).not.toHaveBeenCalled();

    f.componentInstance.draftBody.set('keep2');
    f.componentInstance.actionError.set('');
    (f.componentInstance as unknown as { insertGuard: boolean }).insertGuard = false;
    const bad = mockDataTransfer({
      types: [SCRUM_ATTACHMENT_MIME, 'Files'],
      data: { [SCRUM_ATTACHMENT_MIME]: '' },
      files: [file],
    });
    f.componentInstance.onDraftDrop({ preventDefault() {}, dataTransfer: bad } as DragEvent);
    expect(f.componentInstance.draftBody()).toBe('keep2');
    expect(f.componentInstance.actionError()).toContain('参照');
    expect(upload).not.toHaveBeenCalled();
  });

  it('falls back to file upload only when MIME type is absent', () => {
    const f = setup({ listComments: vi.fn(() => of([])) });
    const api = TestBed.inject(Api) as unknown as { uploadAttachment: ReturnType<typeof vi.fn> };
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 3 });
    const dt = mockDataTransfer({ types: ['Files'], files: [file] });
    const ev = new Event('drop') as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    f.componentInstance.onDraftDrop(ev);
    expect(api.uploadAttachment).toHaveBeenCalled();
  });

  it('does not change draft when markup would exceed max length', () => {
    const f = setup({ listComments: vi.fn(() => of([])) });
    const almost = 'あ'.repeat(COMMENT_BODY_MAX - 5);
    f.componentInstance.draftBody.set(almost);
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({
        types: [SCRUM_ATTACHMENT_MIME],
        data: {
          [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
            itemNumber: 3,
            attachmentId: 1,
            alt: 'long',
          }),
        },
      }),
      'draft',
    );
    expect(f.componentInstance.draftBody()).toBe(almost);
    expect(f.componentInstance.actionError()).toContain('4000');
  });

  it('ignores drop when readOnly without error UI', () => {
    const f = setup({ listComments: vi.fn(() => of([])) });
    f.componentRef.setInput('readOnly', true);
    f.detectChanges();
    f.componentInstance.draftBody.set('x');
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({
        types: [SCRUM_ATTACHMENT_MIME],
        data: {
          [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
            itemNumber: 3,
            attachmentId: 1,
            alt: 'a',
          }),
        },
      }),
      'draft',
    );
    expect(f.componentInstance.draftBody()).toBe('x');
    expect(f.componentInstance.actionError()).toBe('');
  });

  it('guards double draft insert in the same turn', () => {
    const f = setup({ listComments: vi.fn(() => of([])) });
    const dt = mockDataTransfer({
      types: [SCRUM_ATTACHMENT_MIME],
      data: {
        [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
          itemNumber: 3,
          attachmentId: 2,
          alt: 'a',
        }),
      },
    });
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(dt, 'draft');
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(dt, 'draft');
    const body = f.componentInstance.draftBody();
    const needle = buildAttachmentMarkup(3, 2, 'a');
    expect(body.split(needle).length - 1).toBe(1);
  });

  it('inserts attachment ref into edit body without upload', () => {
    const f = setup({ listComments: vi.fn(() => of([c1])) });
    const api = TestBed.inject(Api) as unknown as { uploadAttachment: ReturnType<typeof vi.fn> };
    f.componentInstance.startEdit(c1);
    f.componentInstance.editBody.set('ab');
    f.detectChanges();
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({
        types: [SCRUM_ATTACHMENT_MIME],
        data: {
          [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
            itemNumber: 3,
            attachmentId: 8,
            alt: 'e',
          }),
        },
      }),
      'edit',
      { start: 1, end: 1 },
    );
    const markup = buildAttachmentMarkup(3, 8, 'e');
    expect(f.componentInstance.editBody()).toBe(`a${markup}b`);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it('guards double edit insert and rejects over-length edit insert', () => {
    const f = setup({ listComments: vi.fn(() => of([c1])) });
    f.componentInstance.startEdit(c1);
    f.componentInstance.editBody.set('');
    const dt = mockDataTransfer({
      types: [SCRUM_ATTACHMENT_MIME],
      data: {
        [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
          itemNumber: 3,
          attachmentId: 4,
          alt: 'z',
        }),
      },
    });
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(dt, 'edit');
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(dt, 'edit');
    const needle = buildAttachmentMarkup(3, 4, 'z');
    expect(f.componentInstance.editBody().split(needle).length - 1).toBe(1);

    const almost = 'あ'.repeat(COMMENT_BODY_MAX - 5);
    f.componentInstance.editBody.set(almost);
    f.componentInstance.actionError.set('');
    // clear guard from previous success
    (f.componentInstance as unknown as { insertGuard: boolean }).insertGuard = false;
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(dt, 'edit');
    expect(f.componentInstance.editBody()).toBe(almost);
    expect(f.componentInstance.actionError()).toContain('4000');
  });

  it('edit drop ignores files-only and rejects bad payload', () => {
    const f = setup({ listComments: vi.fn(() => of([c1])) });
    const api = TestBed.inject(Api) as unknown as { uploadAttachment: ReturnType<typeof vi.fn> };
    f.componentInstance.startEdit(c1);
    f.componentInstance.editBody.set('keep');
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    Object.defineProperty(file, 'size', { value: 1 });
    // tryInsert は MIME 無しでは何もしない（upload は onDraftDrop 側の責務）
    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({ types: ['Files'], files: [file] }),
      'edit',
    );
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(f.componentInstance.editBody()).toBe('keep');

    const fileEv = new Event('drop') as DragEvent;
    Object.defineProperty(fileEv, 'dataTransfer', {
      value: mockDataTransfer({ types: ['Files'], files: [file] }),
    });
    f.componentInstance.onEditDrop(fileEv);
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(f.componentInstance.editBody()).toBe('keep');

    f.componentInstance.tryInsertAttachmentRefFromDataTransfer(
      mockDataTransfer({
        types: [SCRUM_ATTACHMENT_MIME],
        data: {
          [SCRUM_ATTACHMENT_MIME]: encodeAttachmentDragPayload({
            itemNumber: 9,
            attachmentId: 1,
            alt: 'x',
          }),
        },
      }),
      'edit',
    );
    expect(f.componentInstance.editBody()).toBe('keep');
    expect(f.componentInstance.actionError()).toContain('参照');
  });
});
