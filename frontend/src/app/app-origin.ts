import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';
import { effectivePublicOrigin, normalizePublicOrigin } from './public-origin';

/** Resolves the origin used for card links and {{url}} (PUBLIC_ORIGIN when set). */
@Injectable({ providedIn: 'root' })
export class AppOrigin {
  private readonly api = inject(Api);
  private load?: Promise<'ready' | 'error'>;
  private publicOrigin = '';

  /** Prefer configured public origin; empty config uses location.origin. Load failure → ok false. */
  async resolve(): Promise<{ ok: true; origin: string } | { ok: false }> {
    const status = await this.ensureLoaded();
    if (status === 'error') return { ok: false };
    return {
      ok: true,
      origin: effectivePublicOrigin(
        this.publicOrigin,
        typeof window !== 'undefined' ? window.location.origin : '',
      ),
    };
  }

  private ensureLoaded(): Promise<'ready' | 'error'> {
    if (!this.load) {
      this.load = firstValueFrom(this.api.publicConfig())
        .then((res) => {
          this.publicOrigin = normalizePublicOrigin(res?.publicOrigin ?? '');
          return 'ready' as const;
        })
        .catch(() => {
          this.load = undefined;
          return 'error' as const;
        });
    }
    return this.load;
  }
}