import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LabelManagerDialog } from './label-manager-dialog';
import { LabelsSession } from './labels-session';

describe('LabelManagerDialog', () => {
  let http: HttpTestingController;
  let session: LabelsSession;
  let restoreDialog: () => void;

  beforeEach(() => {
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
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    session = TestBed.inject(LabelsSession);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    restoreDialog();
  });

  it('loads labels, blocks close while saving, and resets edit draft when reopened (L-542 / L-653 / L-1067)', () => {
    const fx = TestBed.createComponent(LabelManagerDialog);
    let closedCount = 0;
    fx.componentInstance.closed.subscribe(() => closedCount++);
    fx.detectChanges();

    http.expectOne('/api/labels').flush({
      labels: [{ id: 1, name: 'Bug', color: '#ef4444' }],
    });
    fx.detectChanges();

    // Start editing and leave dirty draft.
    (fx.nativeElement.querySelector('.mgr-actions .mgr-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    expect(fx.componentInstance.editingId()).toBe(1);
    fx.componentInstance.editForm.controls.name.setValue('ChangedDraft');

    // Submit edit -> saving locks close & Escape.
    (fx.nativeElement.querySelector('.mgr-edit-form .mgr-submit-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    expect(fx.componentInstance.saving()).toBe(true);
    fx.componentInstance.close();
    expect(closedCount).toBe(0);

    // 409 error -> saving releases, existing label preserved, error displayed (L-001).
    const patchReq = http.expectOne('/api/labels/1');
    patchReq.flush({ message: '同じ名前のラベルがすでにあります。' }, { status: 409, statusText: 'Conflict' });
    fx.detectChanges();
    expect(fx.componentInstance.saving()).toBe(false);
    expect(session.labels()[0].name).toBe('Bug');
    expect(fx.nativeElement.textContent).toContain('同じ名前のラベルがすでにあります。');

    // Closing resets edit draft (reopen starts clean).
    fx.componentInstance.close();
    expect(closedCount).toBe(1);
    expect(fx.componentInstance.editingId()).toBeNull();
    expect(fx.componentInstance.editForm.controls.name.value).toBe('');
    expect(fx.componentInstance.actionError()).toBe('');
    fx.destroy();
  });

  it('separates loading/error/empty states cleanly (L-002)', () => {
    const fx = TestBed.createComponent(LabelManagerDialog);
    fx.detectChanges();
    expect(fx.nativeElement.textContent).toContain('読み込み中');

    http.expectOne('/api/labels').flush({ message: 'net err' }, { status: 500, statusText: 'Err' });
    fx.detectChanges();
    expect(fx.nativeElement.textContent).toContain('net err');
    expect(fx.nativeElement.textContent).not.toContain('登録されているラベルはありません。');

    (fx.nativeElement.querySelector('.mgr-load-error button') as HTMLButtonElement).click();
    http.expectOne('/api/labels').flush({ labels: [] });
    fx.detectChanges();
    expect(fx.nativeElement.textContent).toContain('登録されているラベルはありません。');
    fx.destroy();
  });

  it('creates and deletes labels with inline confirmation and validation', () => {
    const fx = TestBed.createComponent(LabelManagerDialog);
    let closedCount = 0;
    fx.componentInstance.closed.subscribe(() => closedCount++);
    fx.detectChanges();
    http.expectOne('/api/labels').flush({ labels: [] });
    fx.detectChanges();

    // Blank name -> client validation error, no POST.
    fx.componentInstance.createForm.controls.name.setValue('   ');
    (fx.nativeElement.querySelector('.mgr-create-form .mgr-submit-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    expect(fx.componentInstance.actionError()).toContain('ラベル名は1〜40文字');
    http.expectNone('/api/labels');

    // Valid create -> POST /api/labels and reset form.
    fx.componentInstance.createForm.controls.name.setValue('Ops');
    (fx.nativeElement.querySelector('.mgr-create-form .mgr-submit-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    // Cancel/Escape while saving does not close.
    fx.nativeElement.querySelector('dialog')!.dispatchEvent(new Event('cancel'));
    expect(closedCount).toBe(0);

    http.expectOne({ method: 'POST', url: '/api/labels' }).flush({
      id: 7,
      name: 'Ops',
      color: '#3b82f6',
    });
    fx.detectChanges();
    expect(fx.componentInstance.createForm.controls.name.value).toBe('');
    expect(session.labels()).toEqual([{ id: 7, name: 'Ops', color: '#3b82f6' }]);

    // Request delete -> cancel -> request delete -> confirm delete.
    (fx.nativeElement.querySelector('.mgr-danger-outline-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    expect(fx.componentInstance.deletingId()).toBe(7);
    (fx.nativeElement.querySelector('.mgr-actions .mgr-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    expect(fx.componentInstance.deletingId()).toBeNull();

    (fx.nativeElement.querySelector('.mgr-danger-outline-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    (fx.nativeElement.querySelector('.mgr-danger-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    http.expectOne({ method: 'DELETE', url: '/api/labels/7' }).flush(null);
    fx.detectChanges();
    expect(session.labels()).toEqual([]);
    fx.destroy();
  });
});
