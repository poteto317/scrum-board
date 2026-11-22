import { Injectable, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { Api } from './api';
import { Column, Item } from './models';

type PrefetchKind = 'board' | 'backlog';

type BoardSnapshot = { items: Item[]; columns: Column[] };

const MAX_IN_FLIGHT = 2;

/**
 * In-memory snapshots per project for faster project switches and listbox status dots.
 * Board entries are `{ items, columns }` (warm when columns.length >= 1).
 * Soft prefetch uses put*IfAbsent (skip when warm); refreshOthers force-fetches via
 * boardWriteGen so late responses cannot clobber a fresher putBoard.
 * Prefetch/refresh must not touch boardLoadGeneration / display state.
 */
@Injectable({ providedIn: 'root' })
export class ProjectBoardCache {
  private readonly boardSnapshots = new Map<number, BoardSnapshot>();
  private readonly backlogItems = new Map<number, Item[]>();
  private readonly boardWriteGen = new Map<number, number>();
  private readonly inFlight = new Set<string>();
  private running = 0;
  private readonly queue: Array<() => void> = [];
  private readonly revisionSignal = signal(0);

  /** Bumps on successful board put so listbox dots can refresh while open. */
  readonly revision = this.revisionSignal.asReadonly();

  getBoard(projectId: number): Item[] | undefined {
    return cloneList(this.getWarmBoard(projectId)?.items);
  }

  getBoardSnapshot(projectId: number): BoardSnapshot | undefined {
    const snap = this.getWarmBoard(projectId);
    if (!snap) return undefined;
    return {
      items: snap.items.map((i) => ({ ...i })),
      columns: snap.columns.map((c) => ({ ...c })),
    };
  }

  /** Read-only warm snapshot without cloning (caller must not mutate). */
  peekBoardSnapshot(projectId: number): BoardSnapshot | undefined {
    return this.getWarmBoard(projectId);
  }

  getBacklog(projectId: number): Item[] | undefined {
    return cloneList(this.backlogItems.get(projectId));
  }

  putBoardIfAbsent(projectId: number, items: Item[], columns: Column[]): void {
    if (!this.isValidBoardPut(projectId, columns)) return;
    if (this.isBoardWarm(projectId)) return;
    this.writeBoardSnapshot(projectId, items, columns);
  }

  putBacklogIfAbsent(projectId: number, next: Item[]): void {
    putIfAbsent(this.backlogItems, projectId, next);
  }

  putBoard(projectId: number, items: Item[], columns: Column[]): void {
    if (!this.isValidBoardPut(projectId, columns)) return;
    this.bumpBoardWriteGen(projectId);
    this.writeBoardSnapshot(projectId, items, columns);
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

  /**
   * Force-refresh board snapshots for listbox status dots (even when warm).
   * Does not touch backlog. Skips activeId (active board is already live).
   */
  refreshOthers(api: Api, activeId: number, projectIds: number[]): void {
    for (const id of projectIds) {
      if (!Number.isFinite(id) || id <= 0 || id === activeId) continue;
      this.enqueueBoardRefresh(api, id);
    }
  }

  private enqueueBoardRefresh(api: Api, projectId: number): void {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    const key = `board:${projectId}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    const gen = this.bumpBoardWriteGen(projectId);
    const run = () => {
      this.running++;
      api
        .board(projectId)
        .pipe(
          finalize(() => {
            this.inFlight.delete(key);
            this.running = Math.max(0, this.running - 1);
            this.pump();
          }),
        )
        .subscribe({
          next: (res) => {
            if ((this.boardWriteGen.get(projectId) ?? 0) !== gen) return;
            const { items, columns } = extractBoard(res);
            this.writeBoardSnapshot(projectId, items, columns);
          },
          error: () => undefined,
        });
    };
    this.queue.push(run);
    this.pump();
  }

  private enqueue(api: Api, projectId: number, kind: PrefetchKind): void {
    if (!Number.isFinite(projectId) || projectId <= 0) return;
    if (kind === 'board') {
      if (this.isBoardWarm(projectId)) return;
    } else if (this.backlogItems.has(projectId)) {
      return;
    }
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
            if (kind === 'board') {
              const { items, columns } = extractBoard(res);
              this.putBoardIfAbsent(projectId, items, columns);
            } else {
              this.putBacklogIfAbsent(projectId, extractItems(res));
            }
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

  private getWarmBoard(projectId: number): BoardSnapshot | undefined {
    const snap = this.boardSnapshots.get(projectId);
    if (!snap || snap.columns.length < 1) return undefined;
    return snap;
  }

  private isBoardWarm(projectId: number): boolean {
    return this.getWarmBoard(projectId) != null;
  }

  private isValidBoardPut(projectId: number, columns: Column[]): boolean {
    return Number.isFinite(projectId) && projectId > 0 && columns.length >= 1;
  }

  private writeBoardSnapshot(projectId: number, items: Item[], columns: Column[]): void {
    if (!this.isValidBoardPut(projectId, columns)) return;
    this.boardSnapshots.set(projectId, cloneSnapshot(items, columns));
    this.bumpRevision();
  }

  private bumpBoardWriteGen(projectId: number): number {
    const next = (this.boardWriteGen.get(projectId) ?? 0) + 1;
    this.boardWriteGen.set(projectId, next);
    return next;
  }

  private bumpRevision(): void {
    this.revisionSignal.update((n) => n + 1);
  }
}

function extractItems(res: unknown): Item[] {
  if (Array.isArray(res)) return res as Item[];
  if (res && typeof res === 'object' && Array.isArray((res as { items?: Item[] }).items)) {
    return (res as { items: Item[] }).items;
  }
  return [];
}

function extractBoard(res: unknown): { items: Item[]; columns: Column[] } {
  const items = extractItems(res);
  if (!res || typeof res !== 'object' || Array.isArray(res)) {
    return { items, columns: [] };
  }
  const raw = (res as { columns?: Column[] }).columns;
  const columns = Array.isArray(raw) ? raw.filter((c) => c && Number.isFinite(c.id)) : [];
  return { items, columns };
}

function cloneList(list: Item[] | undefined): Item[] | undefined {
  return list ? list.map((i) => ({ ...i })) : undefined;
}

function cloneSnapshot(items: Item[], columns: Column[]): BoardSnapshot {
  return {
    items: items.map((i) => ({ ...i })),
    columns: columns.map((c) => ({ ...c })),
  };
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
