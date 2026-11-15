import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { RelatedItem } from './models';

export type RelatedDraft =
  | { kind: 'card'; number: number }
  | { kind: 'url'; url: string }
  | { kind: 'invalid' };

/** Positive integer → card number; http(s) URL → url; otherwise invalid. */
export function parseRelatedDraft(raw: string): RelatedDraft {
  const text = raw.trim();
  if (!text) return { kind: 'invalid' };
  if (/^[1-9][0-9]*$/.test(text)) {
    return { kind: 'card', number: Number(text) };
  }
  if (isHttpUrl(text)) {
    return { kind: 'url', url: text };
  }
  return { kind: 'invalid' };
}

export function isHttpUrl(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 2048 || /[\r\n]/.test(text)) return false;
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function httpUrlValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = String(control.value ?? '').trim();
    if (!value) return null;
    return isHttpUrl(value) ? null : { httpUrl: true };
  };
}

export function displayLabel(item: RelatedItem): string {
  const label = (item.label ?? '').trim();
  if (label) return label;
  if (item.kind === 'card') {
    return (item.title ?? '').trim() || `TASK-${item.number ?? ''}`;
  }
  const url = (item.url ?? '').trim();
  try {
    const host = new URL(url).host;
    return host || url;
  } catch {
    return url;
  }
}

export function relatedItemKey(item: RelatedItem): string {
  if (item.kind === 'card') return `card:${item.number}`;
  return `url:${item.url}`;
}

export function sameRelatedItem(a: RelatedItem, b: RelatedItem): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'card') return a.number === b.number;
  return a.url === b.url;
}
