import { Injectable, inject, signal } from '@angular/core';
import { Observable, finalize, tap } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { UserPublic } from './auth';

export const USERS_LOAD_FAILURE = 'ユーザー一覧を読み込めませんでした。再試行してください。';

@Injectable({ providedIn: 'root' })
export class UsersSession {
  private readonly api = inject(Api);

  readonly users = signal<UserPublic[] | null>(null);
  readonly loading = signal(false);
  readonly loadError = signal('');
  private loadGeneration = 0;
  private createGeneration = 0;

  clear() {
    this.loadGeneration++;
    this.createGeneration++;
    this.users.set(null);
    this.loading.set(false);
    this.loadError.set('');
  }

  load(): void {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .listUsers()
      .pipe(
        finalize(() => {
          if (generation === this.loadGeneration) this.loading.set(false);
        }),
      )
      .subscribe({
        next: (list) => {
          if (generation !== this.loadGeneration) return;
          this.users.set(list);
          this.loadError.set('');
        },
        error: (err) => {
          if (generation !== this.loadGeneration) return;
          // GET fail ≠ empty success
          this.users.set(null);
          this.loadError.set(errorMessage(err) || USERS_LOAD_FAILURE);
        },
      });
  }

  create(input: {
    loginName: string;
    password: string;
    displayName: string;
    role?: string;
  }): Observable<UserPublic> {
    const generation = ++this.createGeneration;
    return this.api.createUser(input).pipe(
      tap((created) => {
        if (generation !== this.createGeneration) return;
        const cur = this.users();
        if (cur) this.users.set([...cur, created]);
      }),
    );
  }

  /** Assignee chips: include disabled users (UI marks them non-selectable). */
  assigneeChipUsers(): { name: string; disabled: boolean }[] {
    const list = this.users();
    if (!list) return [];
    return list.map((u) => ({ name: u.displayName, disabled: u.disabled }));
  }
}
