import { HttpInterceptorFn } from '@angular/common/http';

/** Send cookies (sb_session) on same-origin API calls. */
export const credentialsInterceptor: HttpInterceptorFn = (req, next) =>
  next(req.clone({ withCredentials: true }));
