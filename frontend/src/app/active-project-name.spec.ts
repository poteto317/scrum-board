import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Api } from './api';
import { ActiveProjectName } from './active-project-name';
import { ProjectSession } from './project-session';

@Component({
  imports: [ActiveProjectName],
  template: `<app-active-project-name [projectId]="id()" />`,
})
class Host {
  readonly id = signal<number | null | undefined>(undefined);
}

function setup() {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [{ provide: Api, useValue: {} }],
  });
  const session = TestBed.inject(ProjectSession);
  session.projects.set([
    { id: 1, name: 'メイン', position: 0 },
    { id: 2, name: '次', position: 1 },
  ]);
  session.activeId.set(1);
  const f = TestBed.createComponent(Host);
  f.detectChanges();
  const text = () =>
    (
      f.nativeElement.querySelector('.active-project-name') as HTMLElement | null
    )?.textContent?.trim() ?? null;
  const set = (v: number | null | undefined) => {
    f.componentInstance.id.set(v);
    f.detectChanges();
  };
  return { text, set, session, f };
}

describe('ActiveProjectName', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('shows the active project name when projectId is undefined', () => {
    const { text, session, f } = setup();
    expect(text()).toBe('プロジェクト: メイン');
    session.activeId.set(2);
    f.detectChanges();
    expect(text()).toBe('プロジェクト: 次');
  });

  it('shows the name of the given numeric projectId', () => {
    const { text, set } = setup();
    set(2);
    expect(text()).toBe('プロジェクト: 次');
  });

  it('shows nothing when projectId is null', () => {
    const { text, set } = setup();
    set(null);
    expect(text()).toBeNull();
  });

  it('shows nothing when the id is not in projects', () => {
    const { text, set } = setup();
    set(999);
    expect(text()).toBeNull();
  });

  it('shows ProjectSession.error as an alert and hides it when cleared', () => {
    const { session, f } = setup();
    const alert = () => f.nativeElement.querySelector('[role="alert"]') as HTMLElement | null;
    expect(alert()).toBeNull();
    session.error.set('読み込みに失敗しました');
    f.detectChanges();
    expect(alert()?.textContent?.trim()).toBe('読み込みに失敗しました');
    session.error.set('');
    f.detectChanges();
    expect(alert()).toBeNull();
  });
});
