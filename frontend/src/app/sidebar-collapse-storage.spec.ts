import { describe, expect, it } from 'vitest';
import {
  SIDEBAR_COLLAPSED_KEY,
  readSidebarCollapsed,
  writeSidebarCollapsed,
} from './sidebar-collapse-storage';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(k) {
      return map.has(k) ? map.get(k)! : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    key() {
      return null;
    },
  };
}

describe('readSidebarCollapsed', () => {
  it('returns false for missing, empty, zero, and junk', () => {
    const s = memoryStorage();
    expect(readSidebarCollapsed(s)).toBe(false);
    s.setItem(SIDEBAR_COLLAPSED_KEY, '');
    expect(readSidebarCollapsed(s)).toBe(false);
    s.setItem(SIDEBAR_COLLAPSED_KEY, '0');
    expect(readSidebarCollapsed(s)).toBe(false);
    s.setItem(SIDEBAR_COLLAPSED_KEY, 'yes');
    expect(readSidebarCollapsed(s)).toBe(false);
  });

  it('returns true only for "1"', () => {
    const s = memoryStorage();
    s.setItem(SIDEBAR_COLLAPSED_KEY, '1');
    expect(readSidebarCollapsed(s)).toBe(true);
  });

  it('returns false when getItem throws', () => {
    const s = memoryStorage();
    s.getItem = () => {
      throw new Error('denied');
    };
    expect(readSidebarCollapsed(s)).toBe(false);
  });
});

describe('writeSidebarCollapsed', () => {
  it('writes "1" / "0" and reports success', () => {
    const s = memoryStorage();
    expect(writeSidebarCollapsed(true, s)).toBe(true);
    expect(s.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('1');
    expect(writeSidebarCollapsed(false, s)).toBe(true);
    expect(s.getItem(SIDEBAR_COLLAPSED_KEY)).toBe('0');
  });

  it('returns false without throwing when setItem fails', () => {
    const s = memoryStorage();
    s.setItem = () => {
      throw new DOMException('QuotaExceededError');
    };
    expect(() => writeSidebarCollapsed(true, s)).not.toThrow();
    expect(writeSidebarCollapsed(true, s)).toBe(false);
  });
});
