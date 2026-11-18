import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { ItemAutosave } from './item-autosave';
import { Api } from './api';
import { Item, ItemInput } from './models';
const initial: Item = {
  id: 27,
  projectId: 0,
  number: 12,
  columnId: 1,
  title: '元のタイトル',
  description: '本文',
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
};
describe('ItemAutosave', () => {
  let edit: ItemAutosave;
  let requests: { patch: Partial<ItemInput>; response: Subject<Item> }[];
  let api: { updateItem: ReturnType<typeof vi.fn> };
  let stored: Item;
  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    stored = { ...initial };
    api = {
      updateItem: vi.fn((_id: number, patch: Partial<ItemInput>) => {
        const response = new Subject<Item>();
        requests.push({ patch, response });
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  const finish = (index: number) => {
    stored = { ...stored, ...requests[index].patch };
    requests[index].response.next(stored);
    requests[index].response.complete();
  };
  it('does not write on load; debounces text and uses internal ID', () => {
    vi.advanceTimersByTime(2500);
    expect(requests).toHaveLength(0);
    edit.form.controls.title.setValue('新しいタイトル');
    vi.advanceTimersByTime(599);
    expect(requests).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(api.updateItem).toHaveBeenCalledWith(27, { title: '新しいタイトル' });
    finish(0);
    expect(edit.hasChanges()).toBe(false);
  });
  it('keeps a trailing space that the server trims instead of rewriting the field', () => {
    edit.form.controls.title.setValue('hello ');
    vi.advanceTimersByTime(600);
    expect(api.updateItem).toHaveBeenCalledWith(27, { title: 'hello' });
    finish(0);
    // The user may keep typing after the pause; the saved response must not eat the space.
    expect(edit.form.controls.title.value).toBe('hello ');
    expect(edit.hasChanges()).toBe(false);
  });
  it('caps continuous typing at two seconds', () => {
    for (let i = 0; i < 5; i++) {
      edit.form.controls.title.setValue(`入力${i}`);
      vi.advanceTimersByTime(400);
    }
    expect(requests).toHaveLength(1);
    expect(requests[0].patch).toEqual({ title: '入力4' });
  });
  it('flushes status immediately without a duplicate blur write', () => {
    edit.form.controls.columnId.setValue(2);
    edit.flush();
    edit.flush();
    expect(requests).toHaveLength(1);
    finish(0);
    vi.advanceTimersByTime(2500);
    expect(requests).toHaveLength(1);
  });
  it('serializes new edits including returning a sent value to the original', () => {
    edit.form.controls.title.setValue('送信中');
    edit.flush();
    edit.form.controls.title.setValue(initial.title);
    expect(edit.hasChanges()).toBe(true);
    edit.form.controls.description.setValue('次の本文');
    vi.advanceTimersByTime(2500);
    expect(requests).toHaveLength(1);
    finish(0);
    expect(edit.form.controls.title.value).toBe(initial.title);
    expect(edit.form.controls.description.value).toBe('次の本文');
    expect(requests).toHaveLength(2);
    expect(requests[1].patch).toEqual({ title: initial.title, description: '次の本文' });
    finish(1);
    expect(edit.hasChanges()).toBe(false);
  });
  it('retains failures without a retry loop and supports retry', () => {
    edit.form.controls.description.setValue('失敗した本文');
    edit.flush();
    requests[0].response.error({ error: { message: '通信失敗' } });
    vi.advanceTimersByTime(10000);
    expect(requests).toHaveLength(1);
    expect(edit.error()).toBe('通信失敗');
    expect(edit.form.controls.description.value).toBe('失敗した本文');
    edit.flush();
    finish(1);
    expect(edit.error()).toBe('');
    expect(edit.hasChanges()).toBe(false);
  });
  it('clears the failure and in-flight state when switching to another card', () => {
    edit.form.controls.description.setValue('失敗した本文');
    edit.flush();
    requests[0].response.error({ error: { message: '通信失敗' } });
    expect(edit.error()).toBe('通信失敗');
    edit.reset({ ...initial, id: 99, number: 40, title: '別アイテム' });
    expect(edit.error()).toBe('');
    expect(edit.hasChanges()).toBe(false);
    edit.form.controls.title.setValue('送信中のタイトル');
    edit.flush();
    expect(edit.saving()).toBe(true);
    edit.reset({ ...initial, id: 100, number: 41, title: 'さらに別のアイテム' });
    expect(edit.saving()).toBe(false);
    expect(edit.hasChanges()).toBe(false);
  });
  it('saves valid independent properties while retaining invalid text', () => {
    edit.form.controls.title.setValue('　 ');
    edit.form.controls.columnId.setValue(2);
    edit.flush();
    expect(requests[0].patch).toEqual({ columnId: 2 });
    finish(0);
    expect(edit.form.controls.title.value).toBe('　 ');
    expect(edit.hasChanges()).toBe(true);
  });
  it('waits for IME confirmation but saves independent status', () => {
    edit.composition('title', true);
    edit.form.controls.title.setValue('変換中');
    vi.advanceTimersByTime(2500);
    edit.flush();
    expect(requests).toHaveLength(0);
    edit.form.controls.columnId.setValue(2);
    edit.flush();
    expect(requests[0].patch).toEqual({ columnId: 2 });
    finish(0);
    edit.composition('title', false);
    vi.advanceTimersByTime(600);
    expect(requests[1].patch).toEqual({ title: '変換中' });
  });
  it('settles before navigation and rejects invalid drafts', async () => {
    edit.form.controls.description.setValue('移動前');
    const result = edit.settle();
    expect(requests).toHaveLength(1);
    finish(0);
    expect(await result).toBe(true);
    edit.form.controls.title.setValue('');
    expect(await edit.settle()).toBe(false);
  });
  it('resets timers and ignores old route responses', () => {
    edit.form.controls.title.setValue('古い送信');
    edit.flush();
    edit.reset({ ...initial, id: 99, number: 40, title: '別アイテム' });
    requests[0].response.next({ ...initial, title: '古い応答' });
    requests[0].response.complete();
    vi.advanceTimersByTime(2500);
    expect(edit.item()?.id).toBe(99);
    expect(edit.form.controls.title.value).toBe('別アイテム');
    expect(requests).toHaveLength(1);
  });
});

describe('uncertain write failure', () => {
  it('retries the latest value even when it equals the last confirmed value', () => {
    const responses: Subject<Item>[] = [];
    const api = {
      updateItem: vi.fn(() => {
        const response = new Subject<Item>();
        responses.push(response);
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('結果不明の書込');
    edit.flush();
    edit.form.controls.title.setValue(initial.title);
    responses[0].error({ status: 0 });
    expect(edit.hasChanges()).toBe(true);
    edit.flush();
    expect(api.updateItem).toHaveBeenLastCalledWith(27, { title: initial.title });
    responses[1].next(initial);
    responses[1].complete();
    expect(edit.hasChanges()).toBe(false);
    TestBed.resetTestingModule();
  });
});

describe('side field preservation', () => {
  it('keeps a local assignee changed during an in-flight form flush', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.applyAssigneeSave({ assignee: 'Cursor', updatedAt: '2026-11-14T12:00:00Z' });
    response.next({ ...initial, title: '編集', assignee: '' });
    response.complete();
    expect(edit.item()?.assignee).toBe('Cursor');
    expect(edit.item()?.title).toBe('編集');
    TestBed.resetTestingModule();
  });
  it('keeps local relatedItems when marked dirty during an in-flight form flush', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.markRelatedSideDirty();
    edit.applyRelatedSave({
      relatedItems: [{ kind: 'url', url: 'https://example.com', label: '' }],
      updatedAt: '2026-11-15T12:00:00Z',
    });
    response.next({ ...initial, title: '編集', relatedItems: [] });
    response.complete();
    expect(edit.item()?.relatedItems).toEqual([{ kind: 'url', url: 'https://example.com', label: '' }]);
    expect(edit.item()?.title).toBe('編集');
    TestBed.resetTestingModule();
  });
  it('keeps local prUrls when marked dirty during an in-flight form flush', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.markPrSideDirty();
    edit.applyPrSave({
      prUrls: ['https://github.com/poteto317/scrum-board/pull/9'],
      updatedAt: '2026-11-16T12:00:00Z',
    });
    response.next({ ...initial, title: '編集', prUrls: [] });
    response.complete();
    expect(edit.item()?.prUrls).toEqual(['https://github.com/poteto317/scrum-board/pull/9']);
    expect(edit.item()?.title).toBe('編集');
    TestBed.resetTestingModule();
  });
  it('adopts a server assignee when the local side field was untouched during flush', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    response.next({ ...initial, title: '編集', assignee: 'Claude' });
    response.complete();
    expect(edit.item()?.assignee).toBe('Claude');
    TestBed.resetTestingModule();
  });
  it('does not keep a pre-flush assignee over a later server update on the next flush', () => {
    const first = new Subject<Item>();
    const second = new Subject<Item>();
    const api = {
      updateItem: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.applyAssigneeSave({ assignee: 'Cursor', updatedAt: 't0' });
    edit.form.controls.title.setValue('編集');
    edit.flush();
    first.next({ ...initial, title: '編集', assignee: 'Claude' });
    first.complete();
    expect(edit.item()?.assignee).toBe('Claude');
    TestBed.resetTestingModule();
  });
  it('keeps a set-then-cleared assignee over a stale in-flight form response', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.applyAssigneeSave({ assignee: 'Cursor', updatedAt: 't1' });
    edit.applyAssigneeSave({ assignee: '', updatedAt: 't2' });
    response.next({ ...initial, title: '編集', assignee: 'Cursor' });
    response.complete();
    expect(edit.item()?.assignee).toBe('');
    TestBed.resetTestingModule();
  });

  it('keeps null dueAt clear over a stale in-flight form flush via applyDueSave', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset({ ...initial, dueAt: '2026-11-17T08:30:00Z' });
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.markDueSideDirty();
    edit.applyDueSave({ dueAt: null, updatedAt: '2026-11-17T12:00:00Z' });
    expect(edit.item()?.dueAt).toBeNull();
    response.next({
      ...initial,
      title: '編集',
      dueAt: '2026-11-17T08:30:00Z',
    });
    response.complete();
    expect(edit.item()?.dueAt).toBeNull();
    expect(edit.item()?.title).toBe('編集');
    TestBed.resetTestingModule();
  });

  it('keeps a local dueAt set during an in-flight form flush via applyDueSave', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset({ ...initial, dueAt: null });
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.markDueSideDirty();
    edit.applyDueSave({ dueAt: '2026-11-17T08:30:00Z', updatedAt: '2026-11-17T12:00:00Z' });
    response.next({ ...initial, title: '編集', dueAt: null });
    response.complete();
    expect(edit.item()?.dueAt).toBe('2026-11-17T08:30:00Z');
    expect(edit.item()?.title).toBe('編集');
    TestBed.resetTestingModule();
  });

  it('keeps favorite set during an in-flight form flush via applyFavoriteSave', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi.fn(() => response),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset({ ...initial, favorite: false });
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.applyFavoriteSave({ favorite: true, updatedAt: '2026-11-18T12:00:00Z' });
    expect(edit.item()?.favorite).toBe(true);
    response.next({ ...initial, title: '編集', favorite: false });
    response.complete();
    expect(edit.item()?.favorite).toBe(true);
    expect(edit.item()?.title).toBe('編集');
    TestBed.resetTestingModule();
  });
});

describe('closeReason form field', () => {
  it('debounces closeReason like title and is not a side field', () => {
    vi.useFakeTimers();
    const requests: { patch: Partial<ItemInput>; response: Subject<Item> }[] = [];
    const api = {
      updateItem: vi.fn((_id: number, patch: Partial<ItemInput>) => {
        const response = new Subject<Item>();
        requests.push({ patch, response });
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset({ ...initial, closeReason: '' });
    edit.form.controls.closeReason.setValue('  終わった  ');
    vi.advanceTimersByTime(599);
    expect(requests).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(api.updateItem).toHaveBeenCalledWith(27, { closeReason: '終わった' });
    requests[0].response.next({ ...initial, closeReason: '終わった' });
    requests[0].response.complete();
    expect(edit.hasChanges()).toBe(false);
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  it('suspendFlush blocks schedule and flush until released', () => {
    vi.useFakeTimers();
    const api = { updateItem: vi.fn(() => of({ ...initial, columnId: 3 })) };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.suspendFlush(true);
    edit.form.controls.columnId.setValue(3);
    vi.advanceTimersByTime(2500);
    edit.flush();
    expect(api.updateItem).not.toHaveBeenCalled();
    edit.suspendFlush(false);
    edit.flush();
    expect(api.updateItem).toHaveBeenCalledWith(27, { columnId: 3 });
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  it('suspendFlush(false) reschedules when form is still dirty', () => {
    vi.useFakeTimers();
    const api = { updateItem: vi.fn(() => of({ ...initial, title: '編集' })) };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.suspendFlush(true);
    edit.form.controls.title.setValue('編集');
    edit.suspendFlush(false);
    vi.advanceTimersByTime(600);
    expect(api.updateItem).toHaveBeenCalledWith(27, { title: '編集' });
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  it('dropInFlight ignores a late form flush response', () => {
    vi.useFakeTimers();
    const response = new Subject<Item>();
    const api = { updateItem: vi.fn(() => response) };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('送信中');
    edit.flush();
    expect(edit.saving()).toBe(true);
    edit.dropInFlight();
    expect(edit.saving()).toBe(false);
    response.next({ ...initial, title: '送信中', columnId: 1, closeReason: '' });
    response.complete();
    expect(edit.item()?.title).toBe(initial.title);
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
  it('applyCloseSave keeps local prTitles when the PATCH omits them', () => {
    const api = { updateItem: vi.fn() };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    const url = 'https://github.com/a/b/pull/1';
    edit.reset({
      ...initial,
      prUrls: [url],
      prTitles: ['表示名'],
      closeReason: '',
      solution: '',
      favorite: false,
      dueAt: null,
    });
    edit.applyCloseSave({
      ...initial,
      columnId: 3,
      closeReason: '理由',
      solution: '',
      dueAt: null,
      prUrls: [url],
      updatedAt: '2026-11-17T02:00:00Z',
    });
    expect(edit.item()?.columnId).toBe(3);
    expect(edit.item()?.closeReason).toBe('理由');
    expect(edit.item()?.prTitles).toEqual(['表示名']);
    TestBed.resetTestingModule();
  });
  it('dropInFlight resolves settle waiters so navigation is not stuck', async () => {
    vi.useFakeTimers();
    const response = new Subject<Item>();
    const api = { updateItem: vi.fn(() => response) };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('送信中');
    const settled = edit.settle();
    expect(edit.saving()).toBe(true);
    edit.dropInFlight();
    expect(await settled).toBe(false);
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });
});

describe('server changes to untouched fields', () => {
  it('adopts server-only changes without sending the old form value back', () => {
    const response = new Subject<Item>();
    const api = {
      updateItem: vi
        .fn()
        .mockReturnValueOnce(response)
        .mockImplementation(() => new Subject<Item>()),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    response.next({ ...initial, title: '編集', columnId: 2 });
    response.complete();
    expect(api.updateItem).toHaveBeenCalledTimes(1);
    expect(edit.form.controls.columnId.value).toBe(2);
    expect(edit.hasChanges()).toBe(false);
    TestBed.resetTestingModule();
  });
  it('preserves a deliberately reverted unsent field instead of adopting a remote change', () => {
    const responses: Subject<Item>[] = [];
    const api = {
      updateItem: vi.fn(() => {
        const response = new Subject<Item>();
        responses.push(response);
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [ItemAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(ItemAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.form.controls.columnId.setValue(2);
    edit.form.controls.columnId.setValue(1);
    responses[0].next({ ...initial, title: '編集', columnId: 2 });
    responses[0].complete();
    expect(api.updateItem).toHaveBeenLastCalledWith(27, { columnId: 1 });
    TestBed.resetTestingModule();
  });
});
