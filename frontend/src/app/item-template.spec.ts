import { describe, expect, it } from 'vitest';
import { applyItemTemplate } from './item-template';

describe('applyItemTemplate', () => {
  it('clears fields when none is selected', () => {
    expect(applyItemTemplate(null)).toEqual({ title: '', description: '' });
  });

  it('copies title and description templates', () => {
    expect(
      applyItemTemplate({
        titleTemplate: '[バグ] ',
        descriptionTemplate: '## 再現手順\n',
      }),
    ).toEqual({ title: '[バグ] ', description: '## 再現手順\n' });
  });
});
