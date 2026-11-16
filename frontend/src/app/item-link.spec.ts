import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { itemAppPath, itemDetailUrl, copyText } from './item-link';

describe('itemAppPath', () => {
  it('builds the app-relative item detail path', () => {
    expect(itemAppPath(27)).toBe('/items/27');
    expect(itemAppPath(3)).toBe('/items/3');
  });
});

describe('itemDetailUrl', () => {
  it('builds an absolute card detail URL from origin and public number', () => {
    expect(itemDetailUrl('http://127.0.0.1:4200', 27)).toBe('http://127.0.0.1:4200/items/27');
    expect(itemDetailUrl('http://127.0.0.1:4200/', 3)).toBe('http://127.0.0.1:4200/items/3');
  });
});

describe('copyText', () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
    vi.restoreAllMocks();
  });

  it('returns true when clipboard.writeText resolves', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    await expect(copyText('http://example/items/1')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://example/items/1');
  });

  it('returns false when writeText rejects without trying execCommand', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });
    const exec = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    await expect(copyText('denied-url')).resolves.toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it('uses execCommand when clipboard API is missing', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    const exec = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    await expect(copyText('fallback-url')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('returns false when clipboard API is missing and execCommand fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    vi.spyOn(document, 'execCommand').mockReturnValue(false);
    await expect(copyText('x')).resolves.toBe(false);
  });
});
