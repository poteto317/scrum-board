import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { CardAutosave } from './card-autosave';
import { Api } from './api';
import { Card, CardInput } from './models';
const initial: Card = {
  id: 27,
  number: 12,
  columnId: 1,
  title: '元のタイトル',
  description: '本文',
  position: 0,
  prUrl: '',
  createdAt: '',
  updatedAt: '',
};
describe('CardAutosave', () => {
  let edit: CardAutosave;
  let requests: { patch: Partial<CardInput>; response: Subject<Card> }[];
  let api: { updateCard: ReturnType<typeof vi.fn> };
  let stored: Card;
  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    stored = { ...initial };
    api = {
      updateCard: vi.fn((_id: number, patch: Partial<CardInput>) => {
        const response = new Subject<Card>();
        requests.push({ patch, response });
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [CardAutosave, { provide: Api, useValue: api }] });
    edit = TestBed.inject(CardAutosave);
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
    expect(api.updateCard).toHaveBeenCalledWith(27, { title: '新しいタイトル' });
    finish(0);
    expect(edit.hasChanges()).toBe(false);
  });
  it('keeps a trailing space that the server trims instead of rewriting the field', () => {
    edit.form.controls.title.setValue('hello ');
    vi.advanceTimersByTime(600);
    expect(api.updateCard).toHaveBeenCalledWith(27, { title: 'hello' });
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
    edit.reset({ ...initial, id: 99, number: 40, title: '別カード' });
    expect(edit.error()).toBe('');
    expect(edit.hasChanges()).toBe(false);
    edit.form.controls.title.setValue('送信中のタイトル');
    edit.flush();
    expect(edit.saving()).toBe(true);
    edit.reset({ ...initial, id: 100, number: 41, title: 'さらに別のカード' });
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
    edit.reset({ ...initial, id: 99, number: 40, title: '別カード' });
    requests[0].response.next({ ...initial, title: '古い応答' });
    requests[0].response.complete();
    vi.advanceTimersByTime(2500);
    expect(edit.card()?.id).toBe(99);
    expect(edit.form.controls.title.value).toBe('別カード');
    expect(requests).toHaveLength(1);
  });
});

describe('uncertain write failure', () => {
  it('retries the latest value even when it equals the last confirmed value', () => {
    const responses: Subject<Card>[] = [];
    const api = {
      updateCard: vi.fn(() => {
        const response = new Subject<Card>();
        responses.push(response);
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [CardAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(CardAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('結果不明の書込');
    edit.flush();
    edit.form.controls.title.setValue(initial.title);
    responses[0].error({ status: 0 });
    expect(edit.hasChanges()).toBe(true);
    edit.flush();
    expect(api.updateCard).toHaveBeenLastCalledWith(27, { title: initial.title });
    responses[1].next(initial);
    responses[1].complete();
    expect(edit.hasChanges()).toBe(false);
    TestBed.resetTestingModule();
  });
});

describe('server changes to untouched fields', () => {
  it('adopts server-only changes without sending the old form value back', () => {
    const response = new Subject<Card>();
    const api = {
      updateCard: vi
        .fn()
        .mockReturnValueOnce(response)
        .mockImplementation(() => new Subject<Card>()),
    };
    TestBed.configureTestingModule({ providers: [CardAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(CardAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    response.next({ ...initial, title: '編集', columnId: 2 });
    response.complete();
    expect(api.updateCard).toHaveBeenCalledTimes(1);
    expect(edit.form.controls.columnId.value).toBe(2);
    expect(edit.hasChanges()).toBe(false);
    TestBed.resetTestingModule();
  });
  it('preserves a deliberately reverted unsent field instead of adopting a remote change', () => {
    const responses: Subject<Card>[] = [];
    const api = {
      updateCard: vi.fn(() => {
        const response = new Subject<Card>();
        responses.push(response);
        return response;
      }),
    };
    TestBed.configureTestingModule({ providers: [CardAutosave, { provide: Api, useValue: api }] });
    const edit = TestBed.inject(CardAutosave);
    edit.reset(initial);
    edit.form.controls.title.setValue('編集');
    edit.flush();
    edit.form.controls.columnId.setValue(2);
    edit.form.controls.columnId.setValue(1);
    responses[0].next({ ...initial, title: '編集', columnId: 2 });
    responses[0].complete();
    expect(api.updateCard).toHaveBeenLastCalledWith(27, { columnId: 1 });
    TestBed.resetTestingModule();
  });
});
