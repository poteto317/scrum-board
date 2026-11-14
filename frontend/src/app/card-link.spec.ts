import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cardDetailUrl, copyText } from './card-link';

describe('cardDetailUrl', () => {
  it('builds an absolute card detail URL from origin and public number', () => {
    expect(cardDetailUrl('http://127.0.0.1:4200', 27)).toBe('http://127.0.0.1:4200/cards/27');
    expect(cardDetailUrl('http://127.0.0.1:4200/', 3)).toBe('http://127.0.0.1:4200/cards/3');
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
    await expect(copyText('http://example/cards/1')).resolves.toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://example/cards/1');
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
