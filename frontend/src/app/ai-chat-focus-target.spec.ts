import { describe, expect, it } from 'vitest';
import { isEditableFocusTarget } from './ai-chat-focus-target';

describe('isEditableFocusTarget', () => {
  it('is true for textarea input select and contenteditable attribute', () => {
    expect(isEditableFocusTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableFocusTarget(document.createElement('input'))).toBe(true);
    expect(isEditableFocusTarget(document.createElement('select'))).toBe(true);
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    expect(isEditableFocusTarget(div)).toBe(true);
    const empty = document.createElement('div');
    empty.setAttribute('contenteditable', '');
    expect(isEditableFocusTarget(empty)).toBe(true);
  });

  it('is false for buttons and null', () => {
    expect(isEditableFocusTarget(document.createElement('button'))).toBe(false);
    expect(isEditableFocusTarget(null)).toBe(false);
  });
});
