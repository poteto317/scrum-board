import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { authGuard, guestGuard } from './auth.guard';
import { AuthSession } from './auth-session';

describe('authGuard', () => {
  it('redirects to /login only on 401', async () => {
    const ensureMe = vi.fn().mockReturnValue(throwError(() => ({ status: 401 })));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthSession, useValue: { ensureMe } }],
    });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/backlog' } as never),
    );
    const got = await firstValueFrom(result as import('rxjs').Observable<unknown>);
    expect(String(got)).toContain('login');
  });

  it('does not redirect on 5xx', async () => {
    const ensureMe = vi.fn().mockReturnValue(throwError(() => ({ status: 500 })));
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthSession, useValue: { ensureMe } }],
    });
    const result = TestBed.runInInjectionContext(() =>
      authGuard({} as never, { url: '/' } as never),
    );
    const got = await firstValueFrom(result as import('rxjs').Observable<unknown>);
    expect(got).toBe(true);
  });
});

describe('guestGuard', () => {
  it('sends authenticated users away from /login', async () => {
    const ensureMe = vi
      .fn()
      .mockReturnValue(
        of({ id: 1, loginName: 'a', displayName: 'a', role: 'admin', disabled: false }),
      );
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthSession, useValue: { ensureMe } }],
    });
    const result = TestBed.runInInjectionContext(() =>
      guestGuard({ queryParamMap: { get: () => null } } as never, {} as never),
    );
    const got = await firstValueFrom(result as import('rxjs').Observable<unknown>);
    expect(String(got)).not.toContain('login');
  });
});
