import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { UsersSession } from './users-session';

describe('UsersSession', () => {
  it('treats GET failure as error, not empty list', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), UsersSession],
    });
    const session = TestBed.inject(UsersSession);
    const http = TestBed.inject(HttpTestingController);
    session.load();
    http.expectOne('/api/users').flush({ message: 'fail' }, { status: 500, statusText: 'err' });
    expect(session.users()).toBeNull();
    expect(session.loadError()).toBeTruthy();
  });

  it('keeps empty list distinct from load error', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), UsersSession],
    });
    const session = TestBed.inject(UsersSession);
    const http = TestBed.inject(HttpTestingController);
    session.load();
    http.expectOne('/api/users').flush([]);
    expect(session.users()).toEqual([]);
    expect(session.loadError()).toBe('');
  });

  it('drops stale create list updates after clear (subject switch)', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), UsersSession],
    });
    const session = TestBed.inject(UsersSession);
    const http = TestBed.inject(HttpTestingController);
    session.users.set([]);
    session.create({ loginName: 'a', password: 'p', displayName: 'A' }).subscribe();
    session.clear();
    http.expectOne('/api/users').flush({
      id: 2,
      loginName: 'a',
      displayName: 'A',
      role: 'member',
      disabled: false,
    });
    expect(session.users()).toBeNull();
  });
});
