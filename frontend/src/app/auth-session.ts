import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, map, of, shareReplay, tap, throwError } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { UserPublic, isUnauthorized } from './auth';
import { UsersSession } from './users-session';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous' | 'error';

@Injectable({ providedIn: 'root' })
export class AuthSession {
  private readonly api = inject(Api);
  private readonly usersSession = inject(UsersSession);

  readonly user = signal<UserPublic | null>(null);
  readonly status = signal<AuthStatus>('unknown');
  readonly loadError = signal('');
  private meInflight: Observable<UserPublic | null> | null = null;
  private meGeneration = 0;

  /** Clears FE auth/users state on logout or subject switch. */
  clearSubject() {
    this.meGeneration++;
    this.meInflight = null;
    this.user.set(null);
    this.status.set('anonymous');
    this.loadError.set('');
    this.usersSession.clear();
  }

  ensureMe(options?: { force?: boolean }): Observable<UserPublic | null> {
    if (options?.force) {
      this.meInflight = null;
    }
    if (this.meInflight) return this.meInflight;
    const generation = ++this.meGeneration;
    this.meInflight = this.api.me().pipe(
      tap((user) => {
        if (generation !== this.meGeneration) return;
        this.user.set(user);
        this.status.set('authenticated');
        this.loadError.set('');
      }),
      map((user) => user),
      catchError((err) => {
        if (generation !== this.meGeneration) {
          return throwError(() => err);
        }
        this.meInflight = null;
        if (isUnauthorized(err)) {
          this.user.set(null);
          this.status.set('anonymous');
          this.loadError.set('');
          return throwError(() => err);
        }
        this.status.set('error');
        this.loadError.set(errorMessage(err));
        return throwError(() => err);
      }),
      shareReplay(1),
    );
    return this.meInflight;
  }

  login(loginName: string, password: string): Observable<UserPublic> {
    return this.api.login(loginName, password).pipe(
      tap((user) => {
        this.clearSubject();
        this.user.set(user);
        this.status.set('authenticated');
        this.loadError.set('');
        this.meGeneration++;
        this.meInflight = of(user).pipe(shareReplay(1));
      }),
    );
  }

  logout(): Observable<void> {
    return this.api.logout().pipe(
      tap(() => this.clearSubject()),
      map(() => undefined),
      catchError((err) => {
        this.clearSubject();
        return throwError(() => err);
      }),
    );
  }

  isAdmin(): boolean {
    return this.user()?.role === 'admin';
  }
}
