import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';

function cssText(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules)
          .map((rule) => rule.cssText)
          .join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');
}

describe('mobile board overflow CSS', () => {
  it('keeps the selected column inside the mobile board and lifts only for fine pointers', async () => {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        {
          provide: Api,
          useValue: {
            board: () =>
              of({
                columns: [{ id: 1, name: 'Todo', position: 0 }],
                items: [],
                settings: { cardLayout: 'pack', activeProjectId: 1 },
              }),
            reorderItems: vi.fn(),
            listCommandTemplates: () => of({ templates: [] }),
            listLabels: () => of({ labels: [] }),
            listFilter: () =>
              of({ board: { query: '', statusIds: [] }, backlog: { query: '', statusIds: [] } }),
            putListFilter: (f: {
              board: { query: string; statusIds: number[] };
              backlog: { query: string; statusIds: number[] };
            }) => of(f),
          },
        },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const css = cssText();
    const narrow = css.slice(css.indexOf('@media (max-width: 700px)'));
    const columnRule = narrow.slice(narrow.indexOf('flex: 1 1 auto') - 80);
    expect(columnRule.slice(0, 200)).toContain('flex: 1 1 auto');
    expect(columnRule.slice(0, 200)).toContain('min-width: 0px');
    expect(css).toContain('min-width: max-content');
    expect(narrow).toContain('white-space: normal');
    const hover = css.slice(css.indexOf('@media (hover: hover)'));
    expect(hover.slice(0, 280)).toContain('translateY(-2px)');
    expect(css).toContain('min-width: 200px');
    f.destroy();
  });
});
