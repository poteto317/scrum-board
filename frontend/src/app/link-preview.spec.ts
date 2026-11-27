import { of, throwError } from 'rxjs';
import { hostnameFallback } from './description-link';
import { loadLinkPreviews } from './link-preview';

describe('link-preview', () => {
  it('uses normalized keys and hostname fallback on failure', () => {
    const api = {
      linkPreviews: vi.fn(() => throwError(() => new Error('network'))),
    };
    let titles: Record<string, string> | undefined;
    loadLinkPreviews(api, ['https://example.com/a', 'not-a-url']).subscribe(
      (t) => (titles = t),
    );
    expect(api.linkPreviews).toHaveBeenCalledWith(['https://example.com/a']);
    expect(titles?.['https://example.com/a']).toBe(hostnameFallback('https://example.com/a'));
  });

  it('maps ok titles and falls back when ok is false', () => {
    const api = {
      linkPreviews: vi.fn(() =>
        of({
          previews: {
            'https://example.com/ok': { ok: true, title: 'Nice' },
            'https://example.com/no': { ok: false },
          },
        }),
      ),
    };
    let titles: Record<string, string> | undefined;
    loadLinkPreviews(api, ['https://example.com/ok', 'https://example.com/no']).subscribe(
      (t) => (titles = t),
    );
    expect(titles).toEqual({
      'https://example.com/ok': 'Nice',
      'https://example.com/no': 'example.com',
    });
  });
});
