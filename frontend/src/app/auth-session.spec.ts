import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Column, Item } from './models';
import { AuthSession } from './auth-session';
import { ProjectBoardCache } from './project-board-cache';
import { ProjectSession } from './project-session';

const cols: Column[] = [{ id: 1, name: 'Todo', position: 0 }];

function item(id: number): Item {
  return {
    id,
    number: id,
    projectId: 1,
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
    favorite: false,
    dueAt: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('AuthSession', () => {
  let auth: AuthSession;
  let cache: ProjectBoardCache;
  let projectSession: ProjectSession;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    auth = TestBed.inject(AuthSession);
    cache = TestBed.inject(ProjectBoardCache);
    projectSession = TestBed.inject(ProjectSession);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('clearSubject clears board cache and project session', () => {
    cache.putBoard(1, [item(1)], cols, { cardLayout: 'pack' });
    cache.putBacklog(1, [item(1)], cols);
    projectSession.projects.set([{ id: 1, name: 'A', position: 0 }]);
    projectSession.activeId.set(1);
    projectSession.bootstrapped.set(true);
    auth.clearSubject();
    expect(cache.getBoard(1)).toBeUndefined();
    expect(cache.getBoardSnapshot(1)).toBeUndefined();
    expect(cache.getBacklogView(1)).toBeUndefined();
    expect(projectSession.projects()).toEqual([]);
    expect(projectSession.activeId()).toBeNull();
    expect(projectSession.bootstrapped()).toBe(false);
    expect(auth.user()).toBeNull();
    expect(auth.status()).toBe('anonymous');
  });
});