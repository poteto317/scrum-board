import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { App } from './app';
import { HeaderMenu } from './header-menu.component';

const menuPrefs = {
  board: { hiddenIds: [] as string[] },
  backlog: { hiddenIds: [] as string[] },
  itemDetail: { hiddenIds: [] as string[] },
};

describe('HeaderMenu component', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  function setup() {
    const api = {
      listProjects: vi.fn(() => of({ projects: [{ id: 1, name: 'P', position: 0 }] })),
      board: vi.fn(() =>
        of({ columns: [], items: [], settings: { cardLayout: 'pack', activeProjectId: 1 } }),
      ),
      patchBoardSettings: vi.fn(),
      headerMenu: vi.fn(() => of(menuPrefs)),
    };
    TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([]), { provide: Api, useValue: api }],
    });
    const f = TestBed.createComponent(App);
    f.detectChanges();
    return { f, api };
  }

  function trigger(f: ReturnType<typeof setup>['f']) {
    return f.nativeElement.querySelector('#header-menu-trigger') as HTMLButtonElement;
  }

  it('places hamburger outside .header-end with margin-left auto', () => {
    const { f } = setup();
    const header = f.nativeElement.querySelector('.app-header') as HTMLElement;
    const end = header.querySelector('.header-end');
    const menu = header.querySelector('app-header-menu');
    expect(end).toBeTruthy();
    expect(menu).toBeTruthy();
    if (end && menu) {
      expect(end.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    const style = getComputedStyle(menu!.querySelector('.header-menu-root') as HTMLElement);
    expect(style.marginLeft).toBe('auto');
    expect(f.nativeElement.querySelector('#project-add')).toBeNull();
  });

  it('hides header-end in the mobile stylesheet while keeping the menu trigger', () => {
    const { f } = setup();
    const css = [...document.styleSheets]
      .flatMap((sheet) => {
        try {
          return [...sheet.cssRules].map((r) => r.cssText);
        } catch {
          return [];
        }
      })
      .join('\n');
    expect(css).toMatch(/@media \(max-width: 680px\)[\s\S]*\.header-end[^\{]*\{[^}]*display:\s*none/);
    expect(trigger(f)).toBeTruthy();
  });

  it('toggles menu with aria attributes and closes on Esc', () => {
    const { f } = setup();
    const btn = trigger(f);
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    f.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(f.nativeElement.querySelector('[role="menu"]')).toBeTruthy();
    btn.click();
    f.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    btn.click();
    f.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    f.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows settings group with checkboxes', () => {
    const { f } = setup();
    trigger(f).click();
    f.detectChanges();
    const settingsBtn = [...f.nativeElement.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === 'メニュー設定',
    ) as HTMLButtonElement;
    settingsBtn.click();
    f.detectChanges();
    const group = f.nativeElement.querySelector('[aria-label="メニュー設定"]');
    expect(group?.getAttribute('role')).toBe('group');
    expect(group?.querySelector('input[type="checkbox"]')).toBeTruthy();
  });
});