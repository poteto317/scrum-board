import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabelsSession } from './labels-session';
import { ListFilterBar } from './list-filter-bar';
import { ListFilterSession } from './list-filter-session';

describe('ListFilterBar', () => {
  let http: HttpTestingController;
  let filterSession: ListFilterSession;
  let labelsSession: LabelsSession;
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
    vi.useFakeTimers();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    filterSession = TestBed.inject(ListFilterSession);
    labelsSession = TestBed.inject(LabelsSession);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
    restoreDialog();
  });

  it('toggles label pills, clears query/status/labels, and emits managingLabelsChange', async () => {
    labelsSession.labels.set([
      { id: 10, name: 'Bug', color: '#ef4444' },
      { id: 20, name: 'API', color: '#3b82f6' },
    ]);
    labelsSession.loaded.set(true);
    filterSession.load();
    http.expectOne('/api/list-filter').flush({
      board: { query: '', statusIds: [], labelIds: [] },
      backlog: { query: '', statusIds: [], labelIds: [] },
    });

    const fx = TestBed.createComponent(ListFilterBar);
    fx.componentRef.setInput('view', 'board');
    fx.componentRef.setInput('columns', [
      { id: 1, name: 'Todo', position: 0 },
      { id: 2, name: 'Doing', position: 1 },
    ]);
    const openedEvents: boolean[] = [];
    fx.componentInstance.managingLabelsChange.subscribe((v) => openedEvents.push(v));
    fx.detectChanges();

    const pills = Array.from<HTMLButtonElement>(
      fx.nativeElement.querySelectorAll('.list-filter-label-pill'),
    );
    expect(pills).toHaveLength(2);
    pills[0].click();
    fx.detectChanges();
    expect(filterSession.filter('board').labelIds).toEqual([10]);
    expect(pills[0].getAttribute('aria-pressed')).toBe('true');

    // Type query and check status checkbox, then click clear button.
    const search = fx.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    search.value = 'login';
    search.dispatchEvent(new Event('input'));
    const statusBox = fx.nativeElement.querySelector('.list-filter-status input') as HTMLInputElement;
    statusBox.click();
    fx.detectChanges();
    expect(filterSession.filter('board')).toEqual({
      query: 'login',
      statusIds: [1],
      labelIds: [10],
    });

    const clearBtn = Array.from<HTMLButtonElement>(fx.nativeElement.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'クリア',
    );
    expect(clearBtn).toBeTruthy();
    clearBtn!.click();
    fx.detectChanges();
    expect(filterSession.filter('board')).toEqual({
      query: '',
      statusIds: [],
      labelIds: [],
    });

    await vi.advanceTimersByTimeAsync(300);
    const putReq = http.expectOne('/api/list-filter');
    putReq.flush(putReq.request.body);

    // Manage button opens LabelManagerDialog (which triggers /api/labels load) and emits true.
    (fx.nativeElement.querySelector('.list-filter-manage-btn') as HTMLButtonElement).click();
    fx.detectChanges();
    http.expectOne('/api/labels').flush({ labels: labelsSession.labels() });
    expect(openedEvents).toEqual([true]);

    fx.componentInstance.setManagingLabels(false);
    fx.detectChanges();
    expect(openedEvents).toEqual([true, false]);
    fx.destroy();
  });
});
