import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiChatContext } from './ai-chat-context';

const handlers = { onDescriptionApplied: () => {}, onCommentApplied: () => {} };
const item = { number: 3, itemId: 30, title: 'T', canEdit: true };
const target = { projectId: 1, item };

describe('AiChatContext', () => {
  afterEach(() => TestBed.resetTestingModule());

  function create() {
    TestBed.configureTestingModule({ providers: [AiChatContext] });
    return TestBed.inject(AiChatContext);
  }

  it('tells only the page kind for board and backlog', () => {
    const ctx = create();
    ctx.setBoard();
    expect(ctx.pageKind()).toBe('board');
    expect(ctx.focusItem()).toBeNull();
    ctx.setBacklog();
    expect(ctx.pageKind()).toBe('backlog');
    expect(ctx.focusItem()).toBeNull();
  });

  it('drops the detail target and handlers when moving to a list page', () => {
    const ctx = create();
    ctx.setDetail(target, handlers);
    ctx.setBoard();
    expect(ctx.focusItem()).toBeNull();
    expect(ctx.onDescriptionApplied()).toBeNull();
    expect(ctx.onCommentApplied()).toBeNull();
  });

  it('registers detail target and apply callbacks', () => {
    const ctx = create();
    const onDescriptionApplied = vi.fn();
    const onCommentApplied = vi.fn();
    ctx.setDetail(target, { onDescriptionApplied, onCommentApplied });
    expect(ctx.pageKind()).toBe('detail');
    expect(ctx.focusItem()).toEqual(item);
    expect(ctx.detailProjectId()).toBe(1);
    ctx.onDescriptionApplied()?.({} as never);
    ctx.onCommentApplied()?.();
    expect(onDescriptionApplied).toHaveBeenCalled();
    expect(onCommentApplied).toHaveBeenCalled();
  });

  it('clears to other', () => {
    const ctx = create();
    ctx.setDetail(target, handlers);
    ctx.clear();
    expect(ctx.pageKind()).toBe('other');
    expect(ctx.focusItem()).toBeNull();
    expect(ctx.onDescriptionApplied()).toBeNull();
  });

  it('remembers the project of the detail page', () => {
    const ctx = create();
    expect(ctx.detailProjectId()).toBeNull();
    ctx.setDetail({ ...target, projectId: 7 }, handlers);
    expect(ctx.detailProjectId()).toBe(7);
    ctx.setBoard();
    expect(ctx.detailProjectId()).toBeNull();
    ctx.setDetail(target, handlers);
    ctx.clear();
    expect(ctx.detailProjectId()).toBeNull();
  });

  it('releases only the open item while the next one loads: page kind and project stay', () => {
    const ctx = create();
    ctx.setDetail({ ...target, projectId: 7 }, handlers);
    ctx.releaseDetailItem();
    expect(ctx.pageKind()).toBe('detail');
    expect(ctx.detailProjectId()).toBe(7);
    expect(ctx.focusItem()).toBeNull();
    expect(ctx.onDescriptionApplied()).toBeNull();
    expect(ctx.onCommentApplied()).toBeNull();
    // 次のアイテムが別のプロジェクトなら、そこで切り替わる
    ctx.setDetail({ projectId: 9, item: { ...item, number: 4, itemId: 40 } }, handlers);
    expect(ctx.detailProjectId()).toBe(9);
  });

  it('does not turn another page into a detail when releasing', () => {
    const ctx = create();
    ctx.setBoard();
    ctx.releaseDetailItem();
    expect(ctx.pageKind()).toBe('board');
    expect(ctx.detailProjectId()).toBeNull();
  });

  it('skips focusItem set when detail target is unchanged', () => {
    const ctx = create();
    ctx.setDetail(target, handlers);
    const first = ctx.focusItem();
    ctx.setDetail({ projectId: 1, item: { ...item } }, handlers);
    expect(ctx.focusItem()).toBe(first);
  });

  it('updates focusItem when canEdit or title changes', () => {
    const ctx = create();
    ctx.setDetail(target, handlers);
    ctx.setDetail({ projectId: 1, item: { ...item, canEdit: false } }, handlers);
    expect(ctx.focusItem()?.canEdit).toBe(false);
    ctx.setDetail({ projectId: 1, item: { ...item, canEdit: false, title: 'renamed' } }, handlers);
    expect(ctx.focusItem()?.title).toBe('renamed');
  });
});
