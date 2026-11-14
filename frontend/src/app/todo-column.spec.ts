import { describe, expect, it } from 'vitest';
import { TODO_COLUMN_MISSING, todoColumnId } from './todo-column';

describe('todoColumnId', () => {
  it('returns the Todo column id', () => {
    expect(
      todoColumnId([
        { id: 2, name: 'Doing' },
        { id: 1, name: 'Todo' },
      ]),
    ).toBe(1);
  });

  it('returns undefined when Todo is absent', () => {
    expect(todoColumnId([{ id: 2, name: 'Doing' }])).toBeUndefined();
  });

  it('allows an empty-card Todo column (id still resolves)', () => {
    expect(todoColumnId([{ id: 9, name: 'Todo' }])).toBe(9);
  });
});

describe('TODO_COLUMN_MISSING', () => {
  it('is the shared form error copy', () => {
    expect(TODO_COLUMN_MISSING).toBe('Todo 列が見つかりません。');
  });
});
