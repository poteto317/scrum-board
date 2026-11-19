import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthSession } from './auth-session';
import { isUnauthorized, safeReturnUrl } from './auth';

export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthSession);
  const router = inject(Router);
  return auth.ensureMe().pipe(
    map(() => true),
    catchError((err) => {
      if (isUnauthorized(err)) {
        const returnUrl = safeReturnUrl(state.url);
        return of(
          router.createUrlTree(
            ['/login'],
            returnUrl ? { queryParams: { returnUrl } } : undefined,
          ),
        );
      }
      // 5xx / network: do not treat as logged-out redirect
      return of(true);
    }),
  );
};

export const guestGuard: CanActivateFn = (route) => {
  const auth = inject(AuthSession);
  const router = inject(Router);
  // Always re-hit /me so a dead cookie cannot trap the user off /login.
  return auth.ensureMe({ force: true }).pipe(
    map(() => {
      const raw = route.queryParamMap.get('returnUrl');
      const dest = safeReturnUrl(raw) ?? '/';
      return router.createUrlTree([dest]);
    }),
    catchError(() => of(true)),
  );
};
