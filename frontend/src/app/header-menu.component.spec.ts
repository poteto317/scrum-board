import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { App } from './app';
import { HeaderMenu } from './header-menu.component';

@Component({ standalone: true, template: '' })
class BlankRoute {}

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
      me: vi.fn(() =>
        of({ id: 1, loginName: 'admin', displayName: 'admin', role: 'admin', disabled: false }),
      ),
      listProjects: vi.fn(() => of({ projects: [{ id: 1, name: 'P', position: 0 }] })),
      board: vi.fn(() =>
        of({ columns: [], items: [], settings: { cardLayout: 'pack', activeProjectId: 1 } }),
      ),
      patchBoardSettings: vi.fn(),
      headerMenu: vi.fn(() => of(menuPrefs)),
      listUsers: vi.fn(() => of([])),
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

  it('places the hamburger host last in .app-header with margin-left auto and flex-shrink 0', () => {
    const { f } = setup();
    const header = f.nativeElement.querySelector('.app-header') as HTMLElement;
    const end = header.querySelector('.header-end') as HTMLElement;
    const menu = header.querySelector('app-header-menu') as HTMLElement;
    expect(end).toBeTruthy();
    expect(menu).toBeTruthy();
    expect(end.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // margin-left:auto は flex の子（ホスト要素）に付けないと右端に寄らない
    expect(header.lastElementChild).toBe(menu);
    const style = getComputedStyle(menu);
    expect(style.marginLeft).toBe('auto');
    expect(style.flexShrink).toBe('0');
  });

  it('does not render a project add button in the header', () => {
    const { f } = setup();
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

  it('on /trash shows board open_* items and settings select defaults to board (card142)', async () => {
    const api = {
      headerMenu: vi.fn(() => of(menuPrefs)),
    };
    TestBed.configureTestingModule({
      imports: [HeaderMenu],
      providers: [
        provideRouter([{ path: 'trash', component: BlankRoute }]),
        { provide: Api, useValue: api },
      ],
    });
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/trash');
    const f = TestBed.createComponent(HeaderMenu);
    f.detectChanges();
    expect(f.componentInstance.pageKind()).toBe('board');

    const btn = f.nativeElement.querySelector('#header-menu-trigger') as HTMLButtonElement;
    btn.click();
    f.detectChanges();
    const projects = f.nativeElement.querySelector(
      '#header-menu-item-open_projects',
    ) as HTMLButtonElement;
    expect(projects).toBeTruthy();
    expect(projects.textContent?.trim()).toBe('プロジェクト');

    const settingsBtn = [...f.nativeElement.querySelectorAll('[role="menuitem"]')].find(
      (el) => el.textContent?.trim() === 'メニュー設定',
    ) as HTMLButtonElement;
    settingsBtn.click();
    f.detectChanges();
    const select = f.nativeElement.querySelector('#header-menu-page-kind') as HTMLSelectElement;
    expect(select?.value).toBe('board');
  });
});
