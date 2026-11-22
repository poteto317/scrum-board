import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { Login } from './login';
import { AuthSession } from './auth-session';
import { ProjectSession } from './project-session';
import { HeaderMenuSession } from './header-menu-session';

describe('Login page', () => {
  it('has labeled fields and role=alert on error', async () => {
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([{ path: 'login', component: Login }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthSession,
          useValue: {
            login: () => ({
              subscribe: (h: { error: (e: unknown) => void }) => h.error({ error: { message: 'ログインに失敗しました。' } }),
            }),
          },
        },
        { provide: ProjectSession, useValue: { load: () => undefined } },
        { provide: HeaderMenuSession, useValue: { load: () => undefined } },
      ],
    });
    const f = TestBed.createComponent(Login);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    expect(el.querySelector('label[for="login-name"]')).toBeTruthy();
    expect(el.querySelector('label[for="login-password"]')).toBeTruthy();
    f.componentInstance.form.setValue({ loginName: 'a', password: 'b' });
    f.componentInstance.submit();
    f.detectChanges();
    const alert = el.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('ログインに失敗');
  });

  it('shows a message when submit is empty and syncs DOM autofill into controls', async () => {
    TestBed.configureTestingModule({
      imports: [Login],
      providers: [
        provideRouter([{ path: 'login', component: Login }]),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: AuthSession,
          useValue: {
            login: () => ({
              subscribe: (h: { next: (u: unknown) => void }) =>
                h.next({ id: 1, loginName: 'kanban', displayName: 'kanban', role: 'admin', disabled: false }),
            }),
          },
        },
        { provide: ProjectSession, useValue: { load: () => undefined } },
        { provide: HeaderMenuSession, useValue: { load: () => undefined } },
      ],
    });
    const f = TestBed.createComponent(Login);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    f.componentInstance.submit();
    f.detectChanges();
    expect(el.querySelector('[role="alert"]')?.textContent).toContain('入力してください');

    const name = el.querySelector('#login-name') as HTMLInputElement;
    const pass = el.querySelector('#login-password') as HTMLInputElement;
    name.value = 'kanban';
    pass.value = 'secret-pass';
    // Controls still empty (simulates iOS autofill without input events)
    expect(f.componentInstance.form.getRawValue()).toEqual({ loginName: '', password: '' });
    f.componentInstance.submit();
    f.detectChanges();
    expect(f.componentInstance.form.getRawValue()).toEqual({ loginName: 'kanban', password: 'secret-pass' });
    expect(f.componentInstance.error()).toBe('');
  });
});
