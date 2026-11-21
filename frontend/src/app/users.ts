import { Component, OnInit, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthSession } from './auth-session';
import { UsersSession } from './users-session';
import { errorMessage } from './api-error';
import { Api } from './api';
import { UserPublic } from './auth';

@Component({
  selector: 'app-users',
  imports: [RouterLink, ReactiveFormsModule],
  templateUrl: './users.html',
  styleUrl: './users.css',
})
export class UsersPage implements OnInit {
  readonly auth = inject(AuthSession);
  readonly session = inject(UsersSession);
  private readonly api = inject(Api);
  private readonly router = inject(Router);

  readonly actionError = signal('');
  readonly creating = signal(false);
  readonly busyId = signal<number | null>(null);

  readonly createForm = new FormGroup({
    loginName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    displayName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    role: new FormControl<'admin' | 'member'>('member', { nonNullable: true }),
  });

  ngOnInit() {
    this.session.load();
  }

  get isAdmin() {
    return this.auth.isAdmin();
  }

  create() {
    if (!this.isAdmin || this.creating()) return;
    if (this.createForm.invalid) {
      this.createForm.markAllAsTouched();
      return;
    }
    this.creating.set(true);
    this.actionError.set('');
    const v = this.createForm.getRawValue();
    this.session
      .create({
        loginName: v.loginName.trim(),
        displayName: v.displayName.trim(),
        password: v.password,
        role: v.role,
      })
      .subscribe({
        next: () => {
          this.createForm.reset({ loginName: '', displayName: '', password: '', role: 'member' });
          this.creating.set(false);
        },
        error: (err) => {
          this.actionError.set(errorMessage(err));
          this.creating.set(false);
        },
      });
  }

  setDisabled(user: UserPublic, disabled: boolean) {
    if (!this.isAdmin || this.busyId() != null) return;
    this.busyId.set(user.id);
    this.actionError.set('');
    this.api.patchUser(user.id, { disabled }).subscribe({
      next: (updated) => {
        const list = this.session.users();
        if (list) {
          this.session.users.set(list.map((u) => (u.id === updated.id ? updated : u)));
        }
        this.busyId.set(null);
      },
      error: (err) => {
        this.actionError.set(errorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  setRole(user: UserPublic, role: 'admin' | 'member') {
    if (!this.isAdmin || this.busyId() != null) return;
    this.busyId.set(user.id);
    this.actionError.set('');
    this.api.patchUser(user.id, { role }).subscribe({
      next: (updated) => {
        const list = this.session.users();
        if (list) {
          this.session.users.set(list.map((u) => (u.id === updated.id ? updated : u)));
        }
        this.busyId.set(null);
      },
      error: (err) => {
        this.actionError.set(errorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  resetPassword(user: UserPublic) {
    if (!this.isAdmin || this.busyId() != null) return;
    const password = window.prompt(`「${user.loginName}」の新しいパスワード`);
    if (password == null || password === '') return;
    this.busyId.set(user.id);
    this.actionError.set('');
    this.api.patchUser(user.id, { password }).subscribe({
      next: () => this.busyId.set(null),
      error: (err) => {
        this.actionError.set(errorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  rename(user: UserPublic) {
    if (!this.isAdmin || this.busyId() != null) return;
    const name = window.prompt('表示名', user.displayName);
    if (name == null) return;
    const displayName = name.trim();
    if (!displayName) return;
    this.busyId.set(user.id);
    this.actionError.set('');
    this.api.patchUser(user.id, { displayName }).subscribe({
      next: (updated) => {
        const list = this.session.users();
        if (list) {
          this.session.users.set(list.map((u) => (u.id === updated.id ? updated : u)));
        }
        this.busyId.set(null);
      },
      error: (err) => {
        this.actionError.set(errorMessage(err));
        this.busyId.set(null);
      },
    });
  }

  logout() {
    this.auth.logout().subscribe({
      next: () => void this.router.navigateByUrl('/login'),
      error: () => void this.router.navigateByUrl('/login'),
    });
  }
}
