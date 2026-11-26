import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api, ProjectAIProposal } from './api';
import { AuthSession } from './auth-session';
import type { Item } from './models';
import { ProjectAiProposalCard } from './project-ai-proposal-card';
import { proposalCopy } from './project-ai-proposal-rules';

const base = { id: 1, messageId: 2, state: 'pending', createdAt: '', updatedAt: '' } as const;
const status: ProjectAIProposal = { ...base, kind: 'status_change', itemNumber: 7, itemTitle: 'ログイン', columnId: 2, columnName: 'Doing' };
const edit: ProjectAIProposal = { ...base, kind: 'description_edit', itemNumber: 7, itemTitle: 'ログイン', description: '目的\n新しい手順', baseDescription: '目的\n古い手順' };
const create: ProjectAIProposal = { ...base, kind: 'item_create', title: '作る', columnId: 1, columnName: 'Todo', description: '本文' };
const item = (over: Partial<Item> = {}) => ({ id: 70, number: 7, description: '目的\n古い手順', canEdit: true, ...over }) as Item;
const httpError = (status: number, error: unknown = {}) => throwError(() => ({ status, error }));
const flush = () => new Promise((r) => setTimeout(r, 0));

type Stub = ReturnType<typeof vi.fn>;
type Stubs = { itemByNumber: Stub; updateProjectAIProposal: Stub; updateItem: Stub; createItem: Stub };

function setup(proposal: ProjectAIProposal, api: Partial<Stubs> = {}) {
  const stubs: Stubs = {
    itemByNumber: vi.fn(() => of(item())),
    updateProjectAIProposal: vi.fn((_p: number, _id: number, body: { state: string; createdItemNumber?: number }) =>
      of({ ...proposal, state: body.state, createdItemNumber: body.createdItemNumber }),
    ),
    updateItem: vi.fn(() => of(item())),
    createItem: vi.fn(() => of(item({ id: 90, number: 12 }))),
    ...api,
  };
  TestBed.configureTestingModule({
    imports: [ProjectAiProposalCard],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: stubs },
      { provide: AuthSession, useValue: { user: signal({ id: 1 }) } },
    ],
  });
  const f = TestBed.createComponent(ProjectAiProposalCard);
  const changed: ProjectAIProposal[] = [];
  let itemsChanged = 0;
  // 親（ProjectAiChat）と同じく、受け取った提案で入力を置き換える
  f.componentInstance.changed.subscribe((p) => {
    changed.push(p);
    f.componentRef.setInput('proposal', p);
  });
  f.componentInstance.itemsChanged.subscribe(() => itemsChanged++);
  f.componentRef.setInput('proposal', proposal);
  f.componentRef.setInput('projectId', 1);
  f.detectChanges();
  return { f, c: f.componentInstance, api: stubs, changed, itemsChangedCount: () => itemsChanged };
}

const el = (f: { nativeElement: HTMLElement }) => f.nativeElement;
const applyButton = (f: { nativeElement: HTMLElement }) => el(f).querySelector<HTMLButtonElement>('.ai-proposal-apply')!;

afterEach(() => TestBed.resetTestingModule());

describe('ProjectAiProposalCard', () => {
  it('shows the line diff against the current description, with the target in the labels', () => {
    const { f, api } = setup(edit);
    expect(api.itemByNumber).toHaveBeenCalledWith(7, 1);
    const lines = Array.from(el(f).querySelectorAll('.ai-proposal-diff-line')).map((l) => l.getAttribute('data-kind'));
    expect(lines).toEqual(['same', 'del', 'add']);
    expect(applyButton(f).getAttribute('aria-label')).toBe('#7 の説明の編集を適用');
    expect(el(f).querySelector('[role="status"]')!.getAttribute('aria-live')).toBe('polite');
  });

  it('disables apply for an item the user cannot edit', () => {
    const { f } = setup(status, { itemByNumber: vi.fn(() => of(item({ canEdit: undefined }))) });
    expect(applyButton(f).disabled).toBe(true);
    expect(el(f).textContent).toContain(proposalCopy.notEditable);
  });

  it('disables apply when the item cannot be read, with a reason for 404 and others', () => {
    const notFound = setup(status, { itemByNumber: vi.fn(() => httpError(404)) });
    expect(applyButton(notFound.f).disabled).toBe(true);
    expect(el(notFound.f).textContent).toContain(proposalCopy.notFound);
    TestBed.resetTestingModule();
    const broken = setup(status, { itemByNumber: vi.fn(() => httpError(500)) });
    expect(el(broken.f).textContent).toContain(proposalCopy.loadFailed);
  });

  it('applies a status change: reads with the project, claims once, patches that item id', async () => {
    const { f, c, api, itemsChangedCount } = setup(status);
    const claim = new Subject<ProjectAIProposal>();
    api.updateProjectAIProposal.mockReturnValueOnce(claim);
    void c.apply();
    void c.apply();
    await flush();
    f.detectChanges();
    expect(applyButton(f).disabled).toBe(true);
    expect(api.updateProjectAIProposal).toHaveBeenCalledTimes(1);
    expect(api.updateProjectAIProposal).toHaveBeenCalledWith(1, 1, { state: 'applied' });
    claim.next({ ...status, state: 'applied' });
    claim.complete();
    await flush();
    expect(api.itemByNumber).toHaveBeenLastCalledWith(7, 1);
    expect(api.updateItem).toHaveBeenCalledWith(70, { columnId: 2 });
    expect(itemsChangedCount()).toBe(1);
    f.detectChanges();
    expect(el(f).textContent).toContain(proposalCopy.applied);
  });

  it('does not apply a stale description edit and shows the diff against the latest', async () => {
    const { f, c, api } = setup(edit);
    api.itemByNumber.mockReturnValue(of(item({ description: '目的\n別の人の手順' })));
    await c.apply();
    f.detectChanges();
    expect(api.updateProjectAIProposal).not.toHaveBeenCalled();
    expect(api.updateItem).not.toHaveBeenCalled();
    expect(el(f).textContent).toContain('提案のあとで説明が変わりました');
    expect(el(f).textContent).toContain('別の人の手順');
    expect(applyButton(f).disabled).toBe(true);
  });

  it('does not claim when the check read fails', async () => {
    const { c, api } = setup(status);
    api.itemByNumber.mockReturnValue(httpError(500));
    await c.apply();
    expect(api.updateProjectAIProposal).not.toHaveBeenCalled();
    expect(c.failure()).toBe(proposalCopy.loadFailed);
  });

  it('creates in the proposal Todo column with the project and records the number', async () => {
    const { c, api, changed, itemsChangedCount } = setup(create);
    expect(api.itemByNumber).not.toHaveBeenCalled();
    await c.apply();
    expect(api.createItem).toHaveBeenCalledWith({ title: '作る', description: '本文', columnId: 1, projectId: 1 });
    expect(api.updateProjectAIProposal).toHaveBeenLastCalledWith(1, 1, { state: 'applied', createdItemNumber: 12 });
    expect(changed.at(-1)!.createdItemNumber).toBe(12);
    expect(itemsChangedCount()).toBe(1);
  });

  it('keeps a created proposal applied when recording the number fails', async () => {
    const calls: unknown[] = [];
    const { c } = setup(create, {
      updateProjectAIProposal: vi.fn((_p: number, _id: number, body: { state: string; createdItemNumber?: number }) => {
        calls.push(body);
        return body.createdItemNumber ? httpError(500) : of({ ...create, state: body.state });
      }),
    });
    await c.apply();
    expect(calls).toEqual([{ state: 'applied' }, { state: 'applied', createdItemNumber: 12 }]);
    expect(c.status()).toBe('#12 を作成しました（結果の記録に失敗しました）。');
  });

  it('releases the claim when the item API fails, and says so when releasing fails too', async () => {
    const failing = setup(status, { updateItem: vi.fn(() => httpError(403, { message: '権限がありません。' })) });
    await failing.c.apply();
    expect(failing.api.updateProjectAIProposal).toHaveBeenLastCalledWith(1, 1, { state: 'pending' });
    expect(failing.c.failure()).toBe('権限がありません。');
    expect(failing.itemsChangedCount()).toBe(0);
    TestBed.resetTestingModule();
    const both = setup(status, {
      updateItem: vi.fn(() => httpError(403, { message: '権限がありません。' })),
      updateProjectAIProposal: vi.fn((_p: number, _id: number, body: { state: string }) =>
        body.state === 'pending' ? httpError(500) : of({ ...status, state: body.state }),
      ),
    });
    await both.c.apply();
    expect(both.c.failure()).toBe(`権限がありません。${proposalCopy.releaseFailed}`);
  });

  it('takes the server proposal on 409 and does not call the item API on other claim failures', async () => {
    const taken = setup(status, {
      updateProjectAIProposal: vi.fn(() => httpError(409, { proposal: { ...status, state: 'dismissed' } })),
    });
    await taken.c.apply();
    expect(taken.changed.at(-1)!.state).toBe('dismissed');
    expect(taken.c.failure()).toBe(proposalCopy.alreadyHandled);
    expect(taken.api.updateItem).not.toHaveBeenCalled();
    TestBed.resetTestingModule();
    const broken = setup(status, { updateProjectAIProposal: vi.fn(() => httpError(500)) });
    await broken.c.apply();
    expect(broken.api.updateItem).not.toHaveBeenCalled();
    expect(broken.c.proposal().state).toBe('pending');
  });

  it('stops when the project changes during the apply (L-571)', async () => {
    const check = new Subject<Item>();
    const first = setup(status);
    first.api.itemByNumber.mockReturnValue(check as Observable<Item>);
    const done = first.c.apply();
    first.f.componentRef.setInput('projectId', 2);
    first.f.detectChanges();
    check.next(item());
    check.complete();
    await done;
    expect(first.api.updateProjectAIProposal).not.toHaveBeenCalled();
    TestBed.resetTestingModule();

    const body = new Subject<Item>();
    const second = setup(status, { updateItem: vi.fn(() => body as Observable<Item>) });
    const running = second.c.apply();
    await flush();
    second.f.componentRef.setInput('projectId', 2);
    second.f.detectChanges();
    body.error({ status: 500 });
    await running;
    expect(second.api.updateProjectAIProposal).toHaveBeenCalledTimes(1);
    expect(second.itemsChangedCount()).toBe(0);
  });

  it('dismisses', async () => {
    const { f, c, api } = setup(create);
    await c.dismiss();
    f.detectChanges();
    expect(api.updateProjectAIProposal).toHaveBeenCalledWith(1, 1, { state: 'dismissed' });
    expect(el(f).textContent).toContain(proposalCopy.dismissed);
    expect(el(f).querySelector('.ai-proposal-apply')).toBeNull();
  });

  it('does nothing more after it is destroyed during the apply', async () => {
    const claim = new Subject<ProjectAIProposal>();
    const { f, c, api, changed } = setup(status, { updateProjectAIProposal: vi.fn(() => claim as Observable<ProjectAIProposal>) });
    const running = c.apply();
    await flush();
    f.destroy();
    claim.next({ ...status, state: 'applied' });
    claim.complete();
    await running;
    expect(changed).toEqual([]);
    expect(api.updateItem).not.toHaveBeenCalled();
  });
});
