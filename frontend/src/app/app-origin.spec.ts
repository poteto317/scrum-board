import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { describe, expect, it } from 'vitest';
import { AppOrigin } from './app-origin';

describe('AppOrigin', () => {
  it('uses publicOrigin when the config returns a non-empty value', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const pending = origin.resolve();
    http.expectOne('/api/public-config').flush({ publicOrigin: 'https://board.example/' });
    await expect(pending).resolves.toEqual({ ok: true, origin: 'https://board.example' });
    http.verify();
  });

  it('falls back to location.origin when publicOrigin is empty', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const pending = origin.resolve();
    http.expectOne('/api/public-config').flush({ publicOrigin: '' });
    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.origin).toBe(window.location.origin);
    http.verify();
  });

  it('reports failure when public-config cannot be loaded', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const pending = origin.resolve();
    http.expectOne('/api/public-config').flush('nope', { status: 500, statusText: 'err' });
    await expect(pending).resolves.toEqual({ ok: false });
    http.verify();
  });

  it('retries public-config after a failed load', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), AppOrigin],
    });
    const origin = TestBed.inject(AppOrigin);
    const http = TestBed.inject(HttpTestingController);
    const failed = origin.resolve();
    http.expectOne('/api/public-config').flush('nope', { status: 500, statusText: 'err' });
    await expect(failed).resolves.toEqual({ ok: false });

    const retry = origin.resolve();
    http.expectOne('/api/public-config').flush({ publicOrigin: 'https://retry.example/' });
    await expect(retry).resolves.toEqual({ ok: true, origin: 'https://retry.example' });
    http.verify();
  });
});
