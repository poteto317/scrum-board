import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Api } from './api';
import { effectivePublicOrigin, normalizePublicOrigin } from './public-origin';

/** Resolves the origin used for card links and {{url}} (PUBLIC_ORIGIN when set). */
@Injectable({ providedIn: 'root' })
export class AppOrigin {
  private readonly api = inject(Api);
  private load?: Promise<void>;
  private publicOrigin = '';

  /**
   * Prefer configured public origin; empty or failed config uses location.origin.
   * Load failures are not cached so the next resolve() retries GET /api/public-config.
   */
  async resolve(): Promise<string> {
    await this.ensureLoaded();
    return effectivePublicOrigin(
      this.publicOrigin,
      typeof window !== 'undefined' ? window.location.origin : '',
    );
  }

  private ensureLoaded(): Promise<void> {
    if (!this.load) {
      this.load = Promise.resolve()
        .then(() => firstValueFrom(this.api.publicConfig()))
        .then((res) => {
          this.publicOrigin = normalizePublicOrigin(res?.publicOrigin ?? '');
        })
        .catch(() => {
          this.publicOrigin = '';
          this.load = undefined;
        });
    }
    return this.load;
  }
}
