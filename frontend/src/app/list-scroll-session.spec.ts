import { describe, expect, it } from 'vitest';
import {
  BACKLOG_SCROLL_KEY,
  BOARD_SCROLL_KEY,
  LIST_RETURN_KEY,
  parseBoardScroll,
  parseBacklogScroll,
  parseReturnTo,
  saveBoardScroll,
  saveBacklogScroll,
  saveReturnTo,
  readBoardScroll,
  readBacklogScroll,
  readReturnTo,
  clearReturnTo,
  clearBoardScroll,
  clearBacklogScroll,
} from './list-scroll-session';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear() { map.clear(); },
    getItem(k) { return map.has(k) ? map.get(k)! : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
    key() { return null; },
  };
}

describe('parseBoardScroll', () => {
  it('parses finite numbers', () => {
    expect(parseBoardScroll('{"scrollY":120,"scrollLeft":40}')).toEqual({
      scrollY: 120,
      scrollLeft: 40,
    });
  });
  it('returns null for invalid JSON, NaN, missing fields, non-number', () => {
    expect(parseBoardScroll(null)).toBeNull();
    expect(parseBoardScroll('{')).toBeNull();
    expect(parseBoardScroll('{"scrollY":"x","scrollLeft":1}')).toBeNull();
    expect(parseBoardScroll('{"scrollY":NaN,"scrollLeft":1}')).toBeNull();
    expect(parseBoardScroll('{"scrollY":1}')).toBeNull();
  });
});

describe('parseBacklogScroll', () => {
  it('parses finite numbers and rejects invalid', () => {
    expect(parseBacklogScroll('{"scrollTop":30,"scrollLeft":4}')).toEqual({
      scrollTop: 30,
      scrollLeft: 4,
    });
    expect(parseBacklogScroll('{"scrollTop":Infinity,"scrollLeft":1}')).toBeNull();
    expect(parseBacklogScroll('{"scrollLeft":1}')).toBeNull();
  });
});

describe('parseReturnTo', () => {
  it('accepts only / and /backlog', () => {
    expect(parseReturnTo('{"returnTo":"/"}')).toBe('/');
    expect(parseReturnTo('{"returnTo":"/backlog"}')).toBe('/backlog');
    expect(parseReturnTo('{"returnTo":"/items/1"}')).toBeNull();
    expect(parseReturnTo(null)).toBeNull();
  });
});

describe('storage roundtrip', () => {
  it('saves and reads without overwriting bad values with empty object', () => {
    const s = memoryStorage();
    s.setItem(BOARD_SCROLL_KEY, '{broken');
    expect(readBoardScroll(s)).toBeNull();
    expect(s.getItem(BOARD_SCROLL_KEY)).toBe('{broken');
    saveBoardScroll({ scrollY: 10, scrollLeft: 2 }, s);
    expect(readBoardScroll(s)).toEqual({ scrollY: 10, scrollLeft: 2 });
    saveBacklogScroll({ scrollTop: 8, scrollLeft: 1 }, s);
    expect(readBacklogScroll(s)).toEqual({ scrollTop: 8, scrollLeft: 1 });
    saveReturnTo('/backlog', s);
    expect(readReturnTo(s)).toBe('/backlog');
    clearReturnTo(s);
    clearBoardScroll(s);
    clearBacklogScroll(s);
    expect(s.getItem(LIST_RETURN_KEY)).toBeNull();
    expect(s.getItem(BOARD_SCROLL_KEY)).toBeNull();
    expect(s.getItem(BACKLOG_SCROLL_KEY)).toBeNull();
  });

  it('swallows setItem failures so navigate is not blocked', () => {
    const s = memoryStorage();
    s.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    expect(() => saveBoardScroll({ scrollY: 1, scrollLeft: 0 }, s)).not.toThrow();
    expect(() => saveBacklogScroll({ scrollTop: 1, scrollLeft: 0 }, s)).not.toThrow();
    expect(() => saveReturnTo('/', s)).not.toThrow();
  });
});
