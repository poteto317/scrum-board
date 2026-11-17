import { Injectable, inject, signal } from '@angular/core';
import { EMPTY, Observable, Subject, forkJoin, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs';
import { Api } from './api';
import { errorMessage } from './api-error';
import { normalizeBoardData } from './board-data';
import { Project } from './models';

export const PROJECT_NAME_REQUIRED = 'プロジェクト名を1〜80文字で入力してください。';

/**
 * Project list and the active project for the workspace.
 *
 * `switching` is the only busy flag for a project switch. Board layout and
 * mobile-column saves keep using `settingsSaving` on the board.
 *
 * switchTo (L-842, L-040):
 * 1. Set `switching` true before the optimistic `activeId` write.
 * 2. Optimistic `activeId` (header select).
 * 3. PATCH /api/board/settings `{ activeProjectId }` only.
 * 4. Success: adopt `activeProjectId` from the response, then notify
 *    `onSwitched` listeners. `switching` stays true until the visible board
 *    or backlog finishes reloading and calls `endSwitch()`. Live poll must
 *    not apply a GET from the previous project in that window.
 *    If nothing is listening (item detail), `switchTo` clears `switching`
 *    itself after the PATCH.
 * 5. Failure: restore the previous `activeId`, set `error`, clear `switching`.
 *    Do not treat the switch as saved (L-001). Listeners are not notified.
 *
 * Board and backlog register with `onSwitched` in ngOnInit and must call
 * `endSwitch()` when their reload settles (success or error).
 */
@Injectable({ providedIn: 'root' })
export class ProjectSession {
  private readonly api = inject(Api);
  readonly projects = signal<Project[]>([]);
  readonly activeId = signal<number | null>(null);
  /** True from the start of a project switch until board/backlog reload ends. */
  readonly switching = signal(false);
  /** True during create / rename / delete. Not the switch busy flag. */
  readonly mutating = signal(false);
  readonly error = signal('');

  private readonly switched$ = new Subject<number>();
  private switchListeners = 0;
  private loadGeneration = 0;

  load(): void {
    const generation = ++this.loadGeneration;
    forkJoin({
      projects: this.api.listProjects(),
      board: this.api.board(),
    }).subscribe({
      next: ({ projects, board }) => {
        if (generation !== this.loadGeneration) return;
        this.projects.set(sortProjects(projects.projects ?? []));
        const active = normalizeBoardData(board).settings.activeProjectId;
        this.activeId.set(typeof active === 'number' ? active : null);
        this.error.set('');
      },
      error: (e) => {
        if (generation !== this.loadGeneration) return;
        // Leave the previous list in place. A failed load is not an empty workspace (L-001).
        this.error.set(errorMessage(e));
      },
    });
  }

  create(name: string): void {
    const trimmed = name.trim();
    if (this.switching() || this.mutating()) return;
    if (!trimmed) {
      this.error.set(PROJECT_NAME_REQUIRED);
      return;
    }
    this.mutating.set(true);
    this.error.set('');
    this.api.createProject(trimmed).subscribe({
      next: (project) => {
        this.projects.update((list) => sortProjects([...list, project]));
        this.mutating.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.mutating.set(false);
      },
    });
  }

  rename(id: number, name: string): void {
    const trimmed = name.trim();
    if (this.switching() || this.mutating()) return;
    if (!trimmed) {
      this.error.set(PROJECT_NAME_REQUIRED);
      return;
    }
    this.mutating.set(true);
    this.error.set('');
    this.api.patchProject(id, trimmed).subscribe({
      next: (project) => {
        this.projects.update((list) =>
          sortProjects(list.map((p) => (p.id === project.id ? project : p))),
        );
        this.mutating.set(false);
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.mutating.set(false);
      },
    });
  }

  /**
   * Delete is allowed in the UI when at least two projects remain.
   * The server still rejects a project that has items (409). This method does
   * not remove the project from the list unless DELETE succeeds (L-001).
   */
  canDelete(): boolean {
    return this.projects().length >= 2 && !this.switching() && !this.mutating();
  }

  canRename(): boolean {
    const id = this.activeId();
    return (
      id != null &&
      !this.switching() &&
      !this.mutating() &&
      this.projects().some((p) => p.id === id)
    );
  }

  delete(id: number): void {
    if (!this.canDelete() || !this.projects().some((p) => p.id === id)) return;
    this.mutating.set(true);
    this.error.set('');
    const wasActive = this.activeId() === id;
    this.api.deleteProject(id).subscribe({
      next: () => {
        this.projects.update((list) => list.filter((p) => p.id !== id));
        if (!wasActive) {
          this.mutating.set(false);
          return;
        }
        // Busy before the select moves to the resolved project (L-842).
        this.switching.set(true);
        this.api.board().subscribe({
          next: (board) => {
            const active = normalizeBoardData(board).settings.activeProjectId;
            const next = typeof active === 'number' ? active : null;
            this.activeId.set(next);
            this.mutating.set(false);
            if (next == null || this.switchListeners === 0) {
              this.switching.set(false);
              return;
            }
            this.switched$.next(next);
          },
          error: (e) => {
            this.error.set(errorMessage(e));
            // DELETE already succeeded; clear stale activeId so the select is not orphaned (L-001).
            const fallback = this.projects()[0]?.id ?? null;
            this.activeId.set(fallback);
            this.switching.set(false);
            this.mutating.set(false);
          },
        });
      },
      error: (e) => {
        this.error.set(errorMessage(e));
        this.mutating.set(false);
      },
    });
  }

  /**
   * Board and backlog call this once on init. The handler reloads that view
   * and must call `endSwitch()` when the reload settles.
   * Returns an unsubscribe function.
   */
  onSwitched(handler: (activeId: number) => void): () => void {
    this.switchListeners++;
    const sub = this.switched$.subscribe(handler);
    return () => {
      sub.unsubscribe();
      this.switchListeners = Math.max(0, this.switchListeners - 1);
    };
  }

  /** Board/backlog call this after the post-switch reload settles. */
  endSwitch(): void {
    this.switching.set(false);
  }

  /**
   * PATCH activeProjectId and update `activeId` only. Does **not** set
   * `switching` or notify board/backlog (item-detail move alignment).
   */
  patchActive(id: number): Observable<number> {
    if (!Number.isFinite(id) || id <= 0) {
      return throwError(() => new Error('invalid project id'));
    }
    return this.api.patchBoardSettings({ activeProjectId: id }).pipe(
      map((res) => resolvedActiveFromSettings(res.settings?.activeProjectId, id)),
      tap((next) => this.activeId.set(next)),
    );
  }

  /**
   * Switch the active project. Completes after the settings PATCH (not after
   * the board/backlog reload). `switching` stays true on success until
   * `endSwitch()`, unless no view is listening.
   */
  switchTo(id: number): Observable<number> {
    if (!Number.isFinite(id) || id <= 0 || this.switching() || id === this.activeId()) {
      return EMPTY;
    }
    const previous = this.activeId();
    // L-842: busy before the optimistic select update.
    this.switching.set(true);
    this.activeId.set(id);
    this.error.set('');
    return this.api.patchBoardSettings({ activeProjectId: id }).pipe(
      map((res) => resolvedActiveFromSettings(res.settings?.activeProjectId, id)),
      tap((next) => {
        this.activeId.set(next);
        if (this.switchListeners === 0) {
          this.switching.set(false);
        } else {
          this.switched$.next(next);
        }
      }),
      catchError((err) => {
        this.activeId.set(previous);
        this.error.set(errorMessage(err));
        this.switching.set(false);
        return throwError(() => err);
      }),
    );
  }
}

function resolvedActiveFromSettings(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.trunc(raw) : fallback;
}

function sortProjects(list: Project[]): Project[] {
  return [...list].sort((a, b) => a.position - b.position || a.id - b.id);
}
