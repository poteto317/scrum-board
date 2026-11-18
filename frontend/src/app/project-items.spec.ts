import { describe, expect, it } from 'vitest';
import { Item } from './models';
import { itemsForActiveProject } from './project-items';

function stub(projectId: number, id: number): Item {
  return {
    id,
    number: id,
    projectId,
    columnId: 1,
    title: `t${id}`,
    description: '',
    position: 0,
    backlogPosition: 0,
    offsetY: 0,
    prUrls: [],
    relatedItems: [],
    assignee: '',
    closeReason: '',
    solution: '',
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('itemsForActiveProject', () => {
  it('keeps only items matching activeId', () => {
    const items = [stub(1, 1), stub(2, 2), stub(1, 3)];
    expect(itemsForActiveProject(items, 2).map((i) => i.id)).toEqual([2]);
  });

  it('returns empty when activeId is missing or invalid', () => {
    const items = [stub(1, 1)];
    expect(itemsForActiveProject(items, null)).toEqual([]);
    expect(itemsForActiveProject(items, undefined)).toEqual([]);
    expect(itemsForActiveProject(items, 0)).toEqual([]);
    expect(itemsForActiveProject(items, Number.NaN)).toEqual([]);
    expect(itemsForActiveProject(items, 2.7)).toEqual([]);
  });
});
