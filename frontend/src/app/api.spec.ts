import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Api } from './api';

describe('Api', () => {
  let api: Api;
  let http: HttpTestingController;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('sends the selected status as columnId', () => {
    api.updateCard(7, { columnId: 3 }).subscribe();
    const req = http.expectOne('/api/cards/7');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ columnId: 3 });
    req.flush({ id: 7, columnId: 3, title: '学習', description: '' });
  });
  it('propagates save failures so inputs can be retained', () => {
    let status = 0;
    api.updateCard(7, { title: '編集中' }).subscribe({ error: (e) => (status = e.status) });
    http.expectOne('/api/cards/7').flush({ message: '失敗' }, { status: 500, statusText: 'Error' });
    expect(status).toBe(500);
  });
  it('resolves a public number through the number-specific endpoint', () => {
    api.cardByNumber(3).subscribe((card) => expect(card.id).toBe(18));
    const req = http.expectOne('/api/cards/by-number/3');
    expect(req.request.method).toBe('GET');
    req.flush({ id: 18, number: 3, columnId: 1, title: 'Task', description: '' });
  });
});

it('requests history by public number and an optional event cursor',()=>{
 TestBed.configureTestingModule({providers:[provideHttpClient(),provideHttpClientTesting()]});
 const api=TestBed.inject(Api),http=TestBed.inject(HttpTestingController);
 api.history(13,42).subscribe();const req=http.expectOne('/api/cards/by-number/13/history?before=42');expect(req.request.method).toBe('GET');req.flush({events:[],nextBefore:0});http.verify();
});
