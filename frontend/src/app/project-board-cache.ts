import { Injectable } from '@angular/core';
import { finalize } from 'rxjs';
import { Api } from './api';
import { Item } from './models';

type PrefetchKind = 'board' | 'backlog';

const MAX_IN_FLIGHT = 2;

/**
 * In-memory Item[] snapshots per project for faster project switches.
 * Board and backlog keep separate maps (order differs). Prefetch must not
 * touch boardLoadGeneration / display state.
 */
@Injectable({ providedIn: 'root' })
export class ProjectBoardCache {
  private readonly boardItems = new Map<number, Item[]>();
  private readonly backlogItems = new Map<number, Item[]>();
  private readonly inFlight = new Set<string>();
  private running = 0;
  private readonly queue: Array<() => void> = [];

  getBoard(projectId: number): Item[] | undefined {
    return cloneList(this.boardItems.get(projectId));
  }

  getBacklog(projectId: number): Item[] | undefined {
    return cloneList(this.backlogItems.get(projectId));
  }

  putBoardIfAbsent(projectId: number, next: Item[]): void {
    putIfAbsent(this.boardItems, projectId, next);
  }

  putBacklogIfAbsent(projectId: number, next: Item[]): void {
    putIfAbsent(this.backlogItems, projectId, next);
  }

  putBoard(projectId: number, next: Item[]): void {
    put(this.boardItems, projectId, next);
  }

  putBacklog(projectId: number, next: Item[]): void {
    put(this.backlogItems, projectId, next);
  }

  prefetchBoard(api: Api, projectId: number): void {
    this.enqueue(api, projectId, 'board');
  }

  prefetchBacklog(api: Api, projectId: number): void {
    this.enqueue(api, projectId, 'backlog');
  }

  prefetchOthers(
    api: Api,
    activeId: number,
    projectIds: number[],
    includeBacklog: boolean,
  ): void {
    for (const id of projectIds) {
      if (!Number.isFinite(id) || id <= 0 || id === activeId) continue;
      this.prefetchBoard(api, id);
      if (includeBacklog) this.prefetchBacklog(api, id);
    }
  }

  private enqueue(api: Api, projectId: number, kind: PrefetchKind): void {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    const map = kind === 'board' ? this.boardItems : this.backlogItems;
    if (map.has(projectId)) return;
    const key = `${kind}:${projectId}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    const run = () => {
      this.running++;
      const req = kind === 'board' ? api.board(projectId) : api.backlog(projectId);
      req
        .pipe(
          finalize(() => {
            this.inFlight.delete(key);
            this.running = Math.max(0, this.running - 1);
            this.pump();
          }),
        )
        .subscribe({
          next: (res) => {
            const list = extractItems(res);
            if (kind === 'board') this.putBoardIfAbsent(projectId, list);
            else this.putBacklogIfAbsent(projectId, list);
          },
          error: () => undefined,
        });
    };
    this.queue.push(run);
    this.pump();
  }

  private pump(): void {
    while (this.running < MAX_IN_FLIGHT && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

function extractItems(res: unknown): Item[] {
  if (Array.isArray(res)) return res as Item[];
  if (res && typeof res === 'object' && Array.isArray((res as { items?: Item[] }).items)) {
    return (res as { items: Item[] }).items;
  }
  return [];
}

function cloneList(list: Item[] | undefined): Item[] | undefined {
  return list ? list.map((i) => ({ ...i })) : undefined;
}

function putIfAbsent(map: Map<number, Item[]>, projectId: number, next: Item[]): void {
  if (!Number.isFinite(projectId) || projectId <= 0) return;
  if (map.has(projectId)) return;
  map.set(projectId, next.map((i) => ({ ...i })));
}

function put(map: Map<number, Item[]>, projectId: number, next: Item[]): void {
  if (!Number.isFinite(projectId) || projectId <= 0) return;
  map.set(projectId, next.map((i) => ({ ...i })));
}
