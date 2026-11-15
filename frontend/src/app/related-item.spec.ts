import { FormControl } from '@angular/forms';
import {
  displayLabel,
  httpUrlValidator,
  parseRelatedDraft,
  sameRelatedItem,
} from './related-item';

describe('related-item helpers', () => {
  it('parses card numbers and http(s) URLs', () => {
    expect(parseRelatedDraft(' 12 ')).toEqual({ kind: 'card', number: 12 });
    expect(parseRelatedDraft('https://example.com/a')).toEqual({
      kind: 'url',
      url: 'https://example.com/a',
    });
    expect(parseRelatedDraft('0')).toEqual({ kind: 'invalid' });
    expect(parseRelatedDraft('ftp://x')).toEqual({ kind: 'invalid' });
    expect(parseRelatedDraft('not a url')).toEqual({ kind: 'invalid' });
  });

  it('displayLabel prefers label then title/host', () => {
    expect(displayLabel({ kind: 'card', number: 3, title: 'Hello', label: 'L' })).toBe('L');
    expect(displayLabel({ kind: 'card', number: 3, title: 'Hello', label: '' })).toBe('Hello');
    expect(displayLabel({ kind: 'card', number: 3 })).toBe('TASK-3');
    expect(displayLabel({ kind: 'url', url: 'https://docs.example.com/path' })).toBe(
      'docs.example.com',
    );
  });

  it('validates http URLs and compares items by identity', () => {
    const control = new FormControl('', { validators: [httpUrlValidator()] });
    control.setValue('https://ok.example');
    expect(control.valid).toBe(true);
    control.setValue('notaurl');
    expect(control.invalid).toBe(true);
    expect(
      sameRelatedItem({ kind: 'card', number: 1 }, { kind: 'card', number: 1, title: 'x' }),
    ).toBe(true);
    expect(
      sameRelatedItem(
        { kind: 'url', url: 'https://a.com' },
        { kind: 'url', url: 'https://b.com' },
      ),
    ).toBe(false);
  });
});
