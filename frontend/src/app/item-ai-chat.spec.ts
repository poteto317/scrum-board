import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, AIChatMessage } from './api';
import { ItemAiChat } from './item-ai-chat';

const m1: AIChatMessage = {
  id: 1,
  role: 'user',
  body: '要約して',
  createdAt: '2026-11-21T00:00:00Z',
};
const m2: AIChatMessage = {
  id: 2,
  role: 'assistant',
  body: '要約です',
  createdAt: '2026-11-21T00:00:01Z',
};

function setup(api: {
  listAIChat?: ReturnType<typeof vi.fn>;
  postAIChat?: ReturnType<typeof vi.fn>;
  clearAIChat?: ReturnType<typeof vi.fn>;
  updateItem?: ReturnType<typeof vi.fn>;
  createComment?: ReturnType<typeof vi.fn>;
}) {
  TestBed.configureTestingModule({
    imports: [ItemAiChat],
    providers: [
      {
        provide: Api,
        useValue: {
          listAIChat: vi.fn(() => of([m1, m2])),
          postAIChat: vi.fn(() => of({ messages: [m1, m2] })),
          clearAIChat: vi.fn(() => of(undefined)),
          updateItem: vi.fn(() => of({ id: 10 })),
          createComment: vi.fn(() => of({ id: 1 })),
          ...api,
        },
      },
    ],
  });
  const f = TestBed.createComponent(ItemAiChat);
  f.componentRef.setInput('number', 3);
  f.componentRef.setInput('projectId', 1);
  f.componentRef.setInput('itemId', 10);
  f.detectChanges();
  return f;
}

describe('ItemAiChat', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('loads history on init', () => {
    const listAIChat = vi.fn(() => of([m1, m2]));
    const f = setup({ listAIChat });
    expect(listAIChat).toHaveBeenCalledWith(3, 1);
    expect(f.componentInstance.messages()).toEqual([m1, m2]);
  });

  it('sends a message and replaces history', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const f = setup({ postAIChat });
    f.componentInstance.draft.set('要約して');
    f.componentInstance.send();
    expect(postAIChat).toHaveBeenCalledWith(3, '要約して', 1);
    expect(f.componentInstance.draft()).toBe('');
    expect(f.componentInstance.sending()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
  });

  it('keeps draft and shows error when send fails (L-001)', () => {
    const postAIChat = vi.fn(() => throwError(() => ({ status: 503, error: { message: '未設定' } })));
    const f = setup({ postAIChat });
    f.componentInstance.draft.set('hi');
    f.componentInstance.send();
    expect(f.componentInstance.draft()).toBe('hi');
    expect(f.componentInstance.sending()).toBe(false);
    expect(f.componentInstance.error()).toBeTruthy();
  });

  it('does not clear applying flag as success when description apply fails (L-001)', () => {
    const updateItem = vi.fn(() => throwError(() => ({ status: 500, error: { message: '失敗' } })));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const f = setup({ updateItem });
    const applied: unknown[] = [];
    f.componentInstance.descriptionApplied.subscribe((item) => applied.push(item));
    f.componentInstance.applyToDescription('新説明');
    expect(updateItem).toHaveBeenCalledWith(10, { description: '新説明' });
    expect(f.componentInstance.applying()).toBe(false);
    expect(f.componentInstance.error()).toBeTruthy();
    expect(applied).toEqual([]);
  });

  it('emits descriptionApplied on successful apply', () => {
    const updated = { id: 10, description: '新説明', updatedAt: 't2' };
    const updateItem = vi.fn(() => of(updated));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const f = setup({ updateItem });
    const applied: unknown[] = [];
    f.componentInstance.descriptionApplied.subscribe((item) => applied.push(item));
    f.componentInstance.applyToDescription('新説明');
    expect(applied).toEqual([updated]);
  });

  it('applies assistant text as comment after confirm', () => {
    const createComment = vi.fn(() => of({ id: 9 }));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const f = setup({ createComment });
    const applied: unknown[] = [];
    f.componentInstance.commentApplied.subscribe(() => applied.push(true));
    f.componentInstance.applyAsComment('要約です');
    expect(createComment).toHaveBeenCalledWith(3, { body: '要約です' }, 1);
    expect(f.componentInstance.applying()).toBe(false);
    expect(f.componentInstance.error()).toBe('');
    expect(applied).toEqual([true]);
  });

  it('ignores Enter while IME is composing', () => {
    const postAIChat = vi.fn(() => of({ messages: [m1, m2] }));
    const f = setup({ postAIChat });
    f.componentInstance.draft.set('途中');
    f.componentInstance.onComposeKeydown({
      key: 'Enter',
      shiftKey: false,
      isComposing: true,
      keyCode: 229,
      preventDefault: () => undefined,
    } as KeyboardEvent);
    expect(postAIChat).not.toHaveBeenCalled();
  });

  it('skips apply when confirm is cancelled (L-408)', () => {
    const updateItem = vi.fn(() => of({ id: 10 }));
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const f = setup({ updateItem });
    f.componentInstance.applyToDescription('x');
    expect(updateItem).not.toHaveBeenCalled();
  });
});
