import { describe, expect, it } from 'vitest';
import {
  buildAttachmentMarkup,
  buildFileAttachmentMarkup,
  parseDescriptionLinks,
} from './description-link';
import { buildDescriptionView } from './description-view';

describe('buildDescriptionView', () => {
  it('keeps the whole text as one paragraph when block syntax is off', () => {
    const text = '# a\n\n[l](https://e.com)\n';
    expect(buildDescriptionView(text, 7, false)).toEqual([
      { kind: 'paragraph', segments: parseDescriptionLinks(text, 7) },
    ]);
    expect(buildDescriptionView('', 7, false)).toEqual([
      { kind: 'paragraph', segments: [{ kind: 'text', text: '' }] },
    ]);
  });

  it('parses links and images inside blocks', () => {
    const img = buildAttachmentMarkup(7, 3, 'pic');
    const view = buildDescriptionView(
      `# [h](https://e.com)\n- ${img}\n- [x] [t](https://e.com)\n> q\npara`,
      7,
      true,
    );
    expect(view).toEqual([
      { kind: 'heading', level: 1, segments: [{ kind: 'link', label: 'h', url: 'https://e.com' }] },
      { kind: 'bullet-list', items: [parseDescriptionLinks(img, 7)] },
      {
        kind: 'task-list',
        items: [
          {
            checked: true,
            label: 't',
            segments: [{ kind: 'link', label: 't', url: 'https://e.com' }],
          },
        ],
      },
      { kind: 'quote', segments: [{ kind: 'text', text: 'q' }] },
      { kind: 'paragraph', segments: [{ kind: 'text', text: 'para' }] },
    ]);
    expect((view[1] as { items: { kind: string }[][] }).items[0]![0]!.kind).toBe('image');
  });

  it('keeps image and link markup inside code as plain text', () => {
    const img = buildAttachmentMarkup(7, 3, 'pic');
    expect(buildDescriptionView(`\`\`\`\n${img}\n[l](https://e.com)\n\`\`\``, 7, true)).toEqual([
      { kind: 'code', text: `${img}\n[l](https://e.com)` },
    ]);
  });

  it('labels task checkboxes with the item text or a fallback', () => {
    expect(buildDescriptionView('- [x] 買う\n- [ ]', 7, true)).toEqual([
      {
        kind: 'task-list',
        items: [
          { checked: true, label: '買う', segments: [{ kind: 'text', text: '買う' }] },
          { checked: false, label: 'チェック項目', segments: [{ kind: 'text', text: '' }] },
        ],
      },
    ]);
  });

  it('names task checkboxes by image alt text instead of markup', () => {
    const view = buildDescriptionView('- [ ] ' + buildAttachmentMarkup(7, 3, 'pic'), 7, true);
    expect(view[0]).toMatchObject({ kind: 'task-list', items: [{ checked: false, label: 'pic' }] });
  });

  it('names task checkboxes by file attachment labels', () => {
    const view = buildDescriptionView(
      '- [ ] ' + buildFileAttachmentMarkup(7, 3, 'doc.pdf'),
      7,
      true,
    );
    expect(view[0]).toMatchObject({
      kind: 'task-list',
      items: [{ checked: false, label: 'doc.pdf' }],
    });
  });
});
