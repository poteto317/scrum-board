import { Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthSession } from './auth-session';
import { safeReturnUrl } from './auth';
import { errorMessage } from './api-error';
import { ProjectSession } from './project-session';
import { HeaderMenuSession } from './header-menu-session';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login {
  private readonly auth = inject(AuthSession);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly projects = inject(ProjectSession);
  private readonly headerMenu = inject(HeaderMenuSession);

  readonly submitting = signal(false);
  readonly error = signal('');

  readonly form = new FormGroup({
    loginName: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
  });

  submit() {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.submitting.set(true);
    this.error.set('');
    const { loginName, password } = this.form.getRawValue();
    this.auth.login(loginName.trim(), password).subscribe({
      next: () => {
        this.projects.load();
        this.headerMenu.load({ force: true });
        const dest = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl')) ?? '/';
        void this.router.navigateByUrl(dest);
        this.submitting.set(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.submitting.set(false);
      },
    });
  }
}
