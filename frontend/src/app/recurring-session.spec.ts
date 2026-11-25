import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import {
  RecurringSession,
  withCreatedRule,
  withPatchedRule,
  withoutRule,
} from './recurring-session';

const sampleRule = {
  id: 1,
  projectId: 1,
  name: '週次',
  title: 'ライブラリのアップデート',
  description: '',
  cron: '0 9 * * 1',
  timezone: 'Asia/Tokyo',
  columnId: 1,
  enabled: true,
  lastFiredAt: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

describe('recurring list merge helpers', () => {
  it('withCreatedRule inserts sorted by id', () => {
    const a = { ...sampleRule, id: 2 };
    const b = { ...sampleRule, id: 1, name: 'first' };
    expect(withCreatedRule([a], b).map((r) => r.id)).toEqual([1, 2]);
  });

  it('withPatchedRule replaces matching id', () => {
    const cur = [sampleRule, { ...sampleRule, id: 2, name: 'b' }];
    const next = withPatchedRule(cur, { ...sampleRule, id: 2, name: 'patched' });
    expect(next.map((r) => r.name)).toEqual(['週次', 'patched']);
  });

  it('withoutRule drops by id', () => {
    expect(withoutRule([sampleRule, { ...sampleRule, id: 2 }], 1).map((r) => r.id)).toEqual([
      2,
    ]);
  });
});

describe('RecurringSession', () => {
  function setup() {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), RecurringSession],
    });
    return {
      session: TestBed.inject(RecurringSession),
      http: TestBed.inject(HttpTestingController),
    };
  }

  it('treats GET failure as error, not empty list', () => {
    const { session, http } = setup();
    session.load();
    http
      .expectOne('/api/recurring-rules')
      .flush({ message: 'fail' }, { status: 500, statusText: 'err' });
    expect(session.rules()).toBeNull();
    expect(session.loadError()).toBeTruthy();
  });

  it('keeps empty list distinct from load error', () => {
    const { session, http } = setup();
    session.load();
    http.expectOne('/api/recurring-rules').flush({ rules: [] });
    expect(session.rules()).toEqual([]);
    expect(session.loadError()).toBe('');
  });

  it('drops stale create updates after reloadForProjectSwitch', () => {
    const { session, http } = setup();
    session.rules.set([]);
    session
      .create({
        name: 'a',
        title: 't',
        cron: '0 9 * * 1',
        columnId: 1,
      })
      .subscribe();
    const createReq = http.expectOne('/api/recurring-rules');
    expect(createReq.request.method).toBe('POST');
    session.reloadForProjectSwitch(() => undefined);
    const listReq = http.expectOne('/api/recurring-rules');
    createReq.flush(sampleRule);
    expect(session.rules()).toBeNull();
    listReq.flush({ rules: [] });
  });

  it('reloadForProjectSwitch owns list fetch and calls onSettled once', () => {
    const { session, http } = setup();
    let settled = 0;
    session.reloadForProjectSwitch(() => {
      settled++;
    });
    expect(session.loading()).toBe(true);
    expect(session.rules()).toBeNull();
    http.expectOne('/api/recurring-rules').flush({ rules: [sampleRule] });
    expect(session.rules()).toEqual([sampleRule]);
    expect(session.loading()).toBe(false);
    expect(settled).toBe(1);
  });

  it('reloadForProjectSwitch onSettled runs on GET failure', () => {
    const { session, http } = setup();
    let settled = 0;
    session.reloadForProjectSwitch(() => {
      settled++;
    });
    http
      .expectOne('/api/recurring-rules')
      .flush({ message: 'fail' }, { status: 500, statusText: 'err' });
    expect(session.rules()).toBeNull();
    expect(session.loadError()).toBeTruthy();
    expect(settled).toBe(1);
  });

  it('newer reloadForProjectSwitch supersedes an in-flight list fetch', () => {
    const { session, http } = setup();
    let settled = 0;
    session.reloadForProjectSwitch(() => {
      settled++;
    });
    const first = http.expectOne('/api/recurring-rules');
    session.reloadForProjectSwitch(() => {
      settled++;
    });
    expect(first.cancelled).toBe(true);
    const second = http.expectOne('/api/recurring-rules');
    second.flush({ rules: [{ ...sampleRule, id: 2, name: 'fresh' }] });
    expect(session.rules()?.map((r) => r.name)).toEqual(['fresh']);
    expect(settled).toBe(1);
    http.verify();
  });

  it('refetches list when create succeeds while rules are null (L-001)', () => {
    const { session, http } = setup();
    expect(session.rules()).toBeNull();
    const sub = session
      .create({
        name: 'a',
        title: 't',
        cron: '0 9 * * 1',
        columnId: 1,
      })
      .subscribe();
    try {
      const createReq = http.expectOne('/api/recurring-rules');
      expect(createReq.request.method).toBe('POST');
      createReq.flush(sampleRule);
      const listReq = http.expectOne('/api/recurring-rules');
      expect(listReq.request.method).toBe('GET');
      listReq.flush({ rules: [sampleRule] });
      expect(session.rules()).toEqual([sampleRule]);
      expect(session.loadError()).toBe('');
    } finally {
      sub.unsubscribe();
      http.verify();
    }
  });

  it('surfaces loadError when create succeeds but refetch fails', () => {
    const { session, http } = setup();
    const sub = session
      .create({
        name: 'a',
        title: 't',
        cron: '0 9 * * 1',
        columnId: 1,
      })
      .subscribe();
    try {
      http.expectOne('/api/recurring-rules').flush(sampleRule);
      http
        .expectOne('/api/recurring-rules')
        .flush({ message: 'fail' }, { status: 500, statusText: 'err' });
      expect(session.rules()).toBeNull();
      expect(session.loadError()).toBeTruthy();
    } finally {
      sub.unsubscribe();
      http.verify();
    }
  });
});
