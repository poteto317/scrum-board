import { Injectable, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { Api } from './api';
import { Label, LabelCatalogChange, applyLabelCatalogChangeToItems } from './label';
import { BoardSettings, Column, Item } from './models';

type PrefetchKind = 'board' | 'backlog';

type BoardSnapshot = { items: Item[]; columns: Column[]; settings?: BoardSettings };
type BacklogView = Omit<BoardSnapshot, 'settings'>;

const MAX_IN_FLIGHT = 2;

/**
 * In-memory snapshots per project for faster project switches and listbox status dots.
 * Board entries are `{ items, columns, settings? }` (warm when columns.length >= 1; shown at once on
 * return only with their settings). Backlog entries are items plus the columns they were loaded with.
 * Soft prefetch uses put*IfAbsent (skip when warm); refreshOthers force-fetches via
 * boardWriteGen so late responses cannot clobber a fresher putBoard.
 * Prefetch/refresh must not touch boardLoadGeneration / display state.
 */
@Injectable({ providedIn: 'root' })
export class ProjectBoardCache {
  private readonly boardSnapshots = new Map<number, BoardSnapshot>();
  private readonly backlogItems = new Map<number, Item[]>();
  /** Columns seen with the backlog, so the backlog can be shown at once (items alone are not enough). */
  private readonly backlogColumns = new Map<number, Column[]>();
  private readonly boardWriteGen = new Map<number, number>();
  private readonly inFlight = new Set<string>();
  private running = 0;
  private readonly queue: Array<() => void> = [];
  private readonly revisionSignal = signal(0);
  /** Bumps on clear(); in-flight handlers must match or drop writes (L-037). */
  private epoch = 0;

  /** Bumps on successful board put so listbox dots can refresh while open. */
  readonly revision = this.revisionSignal.asReadonly();

  /** Drop all snapshots and cancel queued prefetch; stale HTTP must not repopulate. */
  clear(): void {
    this.epoch++;
    this.boardSnapshots.clear();
    this.backlogItems.clear();
    this.backlogColumns.clear();
    this.boardWriteGen.clear();
    this.inFlight.clear();
    this.queue.length = 0;
    this.running = 0;
    this.bumpRevision();
  }

  /** Reflect a renamed/recolored label across every cached board/backlog snapshot. */
  syncUpdatedLabel(label: Label): void {
    this.applyCatalogLabelChange({ kind: 'updated', label });
  }

  /** Remove a deleted label across every cached board/backlog snapshot. */
  pruneDeletedLabel(labelId: number): void {
    this.applyCatalogLabelChange({ kind: 'deleted', id: labelId });
  }

  private applyCatalogLabelChange(change: LabelCatalogChange): void {
    let changed = false;
    for (const snap of this.boardSnapshots.values()) {
      const res = applyLabelCatalogChangeToItems(snap.items, change);
      if (res.changed) {
        snap.items = res.items;
        changed = true;
      }
    }
    for (const [projectId, items] of this.backlogItems.entries()) {
      const res = applyLabelCatalogChangeToItems(items, change);
      if (res.changed) {
        this.backlogItems.set(projectId, res.items);
        changed = true;
      }
    }
    if (changed) this.bumpRevision();
  }

  getBoard(projectId: number): Item[] | undefined {
    return cloneList(this.getWarmBoard(projectId)?.items);
  }

  getBoardSnapshot(projectId: number): BoardSnapshot | undefined {
    const snap = this.getWarmBoard(projectId);
    if (!snap) return undefined;
    return cloneSnapshot(snap.items, snap.columns, snap.settings);
  }

  /** Read-only warm snapshot without cloning (caller must not mutate). */
  peekBoardSnapshot(projectId: number): BoardSnapshot | undefined {
    return this.getWarmBoard(projectId);
  }

  /** Items only (project switch: the columns on screen stay). Use `getBacklogView` to show at once. */
  getBacklog(projectId: number): Item[] | undefined {
    return cloneList(this.backlogItems.get(projectId));
  }

  /** Items plus the columns they were loaded with (to show the backlog at once); undefined when either is missing. */
  getBacklogView(projectId: number): BacklogView | undefined {
    const items = this.backlogItems.get(projectId);
    const columns = this.backlogColumns.get(projectId);
    if (!items || !columns || columns.length < 1) return undefined;
    return { items: cloneList(items) ?? [], columns: columns.map((c) => ({ ...c })) };
  }

  putBoardIfAbsent(
    projectId: number,
    items: Item[],
    columns: Column[],
    settings?: BoardSettings,
  ): void {
    if (!this.isValidBoardPut(projectId, columns)) return;
    if (this.isBoardWarm(projectId)) return;
    this.writeBoardSnapshot(projectId, items, columns, settings);
  }

  putBacklogIfAbsent(projectId: number, next: Item[]): void {
    putIfAbsent(this.backlogItems, projectId, next);
  }

  putBoard(projectId: number, items: Item[], columns: Column[], settings?: BoardSettings): void {
    if (!this.isValidBoardPut(projectId, columns)) return;
    this.bumpBoardWriteGen(projectId);
    this.writeBoardSnapshot(projectId, items, columns, settings);
  }

  /** Items and columns are a pair: without (valid) columns, the earlier columns are dropped. */
  putBacklog(projectId: number, items: Item[], columns?: Column[]): void {
    put(this.backlogItems, projectId, items);
    if (columns && this.isValidBoardPut(projectId, columns)) {
      this.backlogColumns.set(
        projectId,
        columns.map((c) => ({ ...c })),
      );
    } else {
      this.backlogColumns.delete(projectId);
    }
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
      const epoch = this.epoch;
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
            if (epoch !== this.epoch) return;
            if ((this.boardWriteGen.get(projectId) ?? 0) !== gen) return;
            const { items, columns, settings } = extractBoard(res);
            this.writeBoardSnapshot(projectId, items, columns, settings);
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
      const epoch = this.epoch;
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
            if (epoch !== this.epoch) return;
            if (kind === 'board') {
              const { items, columns, settings } = extractBoard(res);
              this.putBoardIfAbsent(projectId, items, columns, settings);
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

  private writeBoardSnapshot(
    projectId: number,
    items: Item[],
    columns: Column[],
    settings?: BoardSettings,
  ): void {
    if (!this.isValidBoardPut(projectId, columns)) return;
    this.boardSnapshots.set(projectId, cloneSnapshot(items, columns, settings));
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

function extractBoard(res: unknown): {
  items: Item[];
  columns: Column[];
  settings?: BoardSettings;
} {
  const items = extractItems(res);
  if (!res || typeof res !== 'object' || Array.isArray(res)) {
    return { items, columns: [] };
  }
  const raw = (res as { columns?: Column[] }).columns;
  const columns = Array.isArray(raw) ? raw.filter((c) => c && Number.isFinite(c.id)) : [];
  const rawSettings = (res as { settings?: unknown }).settings;
  const settings =
    rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
      ? (rawSettings as BoardSettings)
      : undefined;
  return { items, columns, settings };
}

function cloneItem(i: Item): Item {
  return {
    ...i,
    ...(i.labels ? { labels: i.labels.map((l) => ({ ...l })) } : {}),
  };
}

function cloneList(list: Item[] | undefined): Item[] | undefined {
  return list ? list.map(cloneItem) : undefined;
}

function cloneSnapshot(items: Item[], columns: Column[], settings?: BoardSettings): BoardSnapshot {
  return {
    items: items.map(cloneItem),
    columns: columns.map((c) => ({ ...c })),
    ...(settings ? { settings: { ...settings } } : {}),
  };
}

function putIfAbsent(map: Map<number, Item[]>, projectId: number, next: Item[]): void {
  if (!Number.isFinite(projectId) || projectId <= 0) return;
  if (map.has(projectId)) return;
  map.set(projectId, next.map(cloneItem));
}

function put(map: Map<number, Item[]>, projectId: number, next: Item[]): void {
  if (!Number.isFinite(projectId) || projectId <= 0) return;
  map.set(projectId, next.map(cloneItem));
}
