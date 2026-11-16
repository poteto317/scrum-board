import { describe, expect, it } from 'vitest';
import { applyMeasuredOffsets, measurePackOffsets, measurePackOffsetsAsItems } from './board-layout-measure';
import { dropListIdForColumn } from './item-order';
import { Item } from './models';

function card(id: number, columnId: number, position: number, offsetY = 0): Item {
  return {
    id,
    number: id,
    columnId,
    title: `c${id}`,
    description: '',
    position,
    backlogPosition: position,
    offsetY,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    createdAt: '',
    updatedAt: '',
  };
}

describe('applyMeasuredOffsets', () => {
  it('uses map value, else existing offsetY, else 0', () => {
    const items = [card(1, 1, 0, 12), card(2, 1, 1), card(3, 1, 2, 5)];
    const byId = new Map<number, number>([[1, 40]]);
    expect(applyMeasuredOffsets(items, byId)).toEqual([
      { ...items[0], offsetY: 40 },
      { ...items[1], offsetY: 0 },
      { ...items[2], offsetY: 5 },
    ]);
  });
});

describe('measurePackOffsetsAsItems', () => {
  it('falls back to existing offsetY when root is missing', () => {
    const items = [card(1, 1, 0, 12), card(2, 1, 1)];
    expect(measurePackOffsets(null, [{ id: 1 }]).size).toBe(0);
    expect(measurePackOffsetsAsItems(null, [{ id: 1 }], items)).toEqual([
      { ...items[0], offsetY: 12 },
      { ...items[1], offsetY: 0 },
    ]);
  });

  it('reads card tops relative to each drop list', () => {
    const root = document.createElement('div');
    const list = document.createElement('div');
    list.id = dropListIdForColumn(1);
    Object.defineProperty(list, 'scrollTop', { value: 5 });
    list.getBoundingClientRect = () =>
      ({ top: 100, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    const cardEl = document.createElement('div');
    cardEl.className = 'task-card';
    cardEl.setAttribute('data-card-id', '7');
    cardEl.getBoundingClientRect = () =>
      ({ top: 140, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    list.appendChild(cardEl);
    root.appendChild(list);

    const items = [card(7, 1, 0, 99), card(8, 1, 1, 3)];
    const byId = measurePackOffsets(root, [{ id: 1 }]);
    expect(byId.get(7)).toBe(45); // 140 - 100 + 5
    expect(byId.has(8)).toBe(false);

    const measured = measurePackOffsetsAsItems(root, [{ id: 1 }], items);
    expect(measured.find((c) => c.id === 7)?.offsetY).toBe(45);
    expect(measured.find((c) => c.id === 8)?.offsetY).toBe(3);
  });
});
