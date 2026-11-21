import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatContext } from './ai-chat-context';

describe('AiChatContext', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('stores board candidates including non-editable', () => {
    TestBed.configureTestingModule({ providers: [AiChatContext] });
    const ctx = TestBed.inject(AiChatContext);
    ctx.setBoard([
      { number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true },
      { number: 2, projectId: 1, itemId: 20, title: 'B', canEdit: false },
    ]);
    expect(ctx.pageKind()).toBe('board');
    expect(ctx.candidates()).toHaveLength(2);
    expect(ctx.routeTarget()).toBeNull();
  });

  it('registers detail apply callbacks', () => {
    TestBed.configureTestingModule({ providers: [AiChatContext] });
    const ctx = TestBed.inject(AiChatContext);
    const onDescriptionApplied = vi.fn();
    const onCommentApplied = vi.fn();
    ctx.setDetail(
      { number: 3, projectId: 1, itemId: 30 },
      { onDescriptionApplied, onCommentApplied },
    );
    expect(ctx.pageKind()).toBe('detail');
    expect(ctx.routeTarget()?.number).toBe(3);
    ctx.onDescriptionApplied()?.({} as never);
    ctx.onCommentApplied()?.();
    expect(onDescriptionApplied).toHaveBeenCalled();
    expect(onCommentApplied).toHaveBeenCalled();
  });

  it('clears to other', () => {
    TestBed.configureTestingModule({ providers: [AiChatContext] });
    const ctx = TestBed.inject(AiChatContext);
    ctx.setBacklog([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    ctx.clear();
    expect(ctx.pageKind()).toBe('other');
    expect(ctx.candidates()).toEqual([]);
  });

  it('skips candidates set when board list is unchanged', () => {
    TestBed.configureTestingModule({ providers: [AiChatContext] });
    const ctx = TestBed.inject(AiChatContext);
    const list = [{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }];
    ctx.setBoard(list);
    const first = ctx.candidates();
    ctx.setBoard([{ number: 1, projectId: 1, itemId: 10, title: 'A', canEdit: true }]);
    expect(ctx.candidates()).toBe(first);
  });

  it('skips routeTarget set when detail target is unchanged', () => {
    TestBed.configureTestingModule({ providers: [AiChatContext] });
    const ctx = TestBed.inject(AiChatContext);
    const target = { number: 3, projectId: 1, itemId: 30 };
    const handlers = { onDescriptionApplied: () => {}, onCommentApplied: () => {} };
    ctx.setDetail(target, handlers);
    const first = ctx.routeTarget();
    ctx.setDetail({ ...target }, handlers);
    expect(ctx.routeTarget()).toBe(first);
  });
});
