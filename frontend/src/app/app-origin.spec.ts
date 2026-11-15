import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { AppOrigin } from './app-origin';

async function flushPublicConfig(
  http: HttpTestingController,
  body: object | string,
  opts?: { status: number; statusText: string },
) {
  await Promise.resolve();
  const req = http.expectOne('/api/public-config');
  if (opts) req.flush(body, opts);
  else req.flush(body);
}

describe('AppOrigin', () => {
  it('uses publicOrigin when the config returns a non-empty value', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const pending = origin.resolve();
    await flushPublicConfig(http, { publicOrigin: 'https://board.example/' });
    await expect(pending).resolves.toBe('https://board.example');
    http.verify();
  });

  it('falls back to location.origin when publicOrigin is empty', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const pending = origin.resolve();
    await flushPublicConfig(http, { publicOrigin: '' });
    await expect(pending).resolves.toBe(window.location.origin);
    http.verify();
  });

  it('falls back to location.origin when public-config cannot be loaded', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const pending = origin.resolve();
    await flushPublicConfig(http, 'nope', { status: 500, statusText: 'err' });
    await expect(pending).resolves.toBe(window.location.origin);
    http.verify();
  });

  it('retries public-config after a failed load and uses the new origin', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const failed = origin.resolve();
    await flushPublicConfig(http, 'nope', { status: 500, statusText: 'err' });
    await expect(failed).resolves.toBe(window.location.origin);

    const retry = origin.resolve();
    await flushPublicConfig(http, { publicOrigin: 'https://retry.example/' });
    await expect(retry).resolves.toBe('https://retry.example');
    http.verify();
  });
});
