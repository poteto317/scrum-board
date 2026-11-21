# プロジェクト追加モーダル Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking. **本フローではコミットしない**（`/feature`）。

**Goal:** ヘッダー「追加」の `window.prompt` を既存 `appModal` 同型のダイアログに置き換え、作成成功後に新プロジェクトへ切替する。

**Architecture:** `ProjectSession.create` を `Observable<Project>` にし成功観測を可能にする。App シェルに board 追加と同型の `<dialog appModal>` を置き、送信→create→閉じる→`switchTo`。`mutating` は成功 emit 時点で維持し、App の `saving` と合わせて二重送信／隙間操作を防ぐ。

**Tech Stack:** Angular signals / ReactiveForms / Vitest

**Spec:** `docs/superpowers/specs/2026-11-19-project-add-dialog-design.md`（設計レビュー2周済み）

## Global Constraints

- API / DB 変更なし
- rename／delete の prompt／confirm は触らない（5B）
- `/feature` のためコミットしない
- 関連知見: L-001, L-158, L-835, L-842

## ファイル対応

| ファイル | 責務 |
|---------|------|
| `frontend/src/app/project-session.ts` | `create(): Observable<Project>`。80字拒否。成功時 mutating 維持 |
| `frontend/src/app/project-session.spec.ts` | create Observable・超過・mutating 維持・失敗 |
| `frontend/src/app/app.ts` | モーダル状態・form・送信／閉じる・create→switchTo |
| `frontend/src/app/app.html` | dialog UI（×／Esc、backdrop 非クローズ） |
| `frontend/src/app/app.spec.ts` | prompt 非使用・開閉・成功切替・エラー表示 |

---

### Task 1: ProjectSession.create を Observable 化

**Files:**
- Modify: `frontend/src/app/project-session.ts`
- Modify: `frontend/src/app/project-session.spec.ts`

**Interfaces:**
- `create(name: string): Observable<Project>`
  - busy → `EMPTY`
  - 空 or `[...trim].length > 80` → `error.set(PROJECT_NAME_REQUIRED)` + `throwError(() => new Error(PROJECT_NAME_REQUIRED))`
  - 成功 → 一覧追加、**`mutating` は true のまま**、`of(project)`（`switchTo` しない）
  - POST 失敗 → `error` セット、`mutating=false`、error Observable
- 呼び出し側が `mutating` を下ろすため、`clearMutating(): void` を追加するか、成功後に App が `mutating.set(false)` できるよう **package-visible ではなく** `endMutating(): void { this.mutating.set(false); }` を公開する。

- [x] **Step 1: 失敗するテストを追加／更新**

```ts
it('emits the project on create success and keeps mutating true', () => {
  session.projects.set([main]);
  session.activeId.set(1);
  let emitted: Project | undefined;
  session.create('次').subscribe((p) => (emitted = p));
  http.expectOne('/api/projects').flush({ id: 2, name: '次', position: 1 });
  expect(emitted).toEqual(next);
  expect(session.projects()).toEqual([main, next]);
  expect(session.activeId()).toBe(1); // 切替しない
  expect(session.mutating()).toBe(true);
  session.endMutating();
  expect(session.mutating()).toBe(false);
});

it('rejects names over 80 code points without POST', () => {
  session.projects.set([main]);
  let failed = false;
  session.create('a'.repeat(81)).subscribe({ error: () => (failed = true) });
  http.expectNone('/api/projects');
  expect(failed).toBe(true);
  expect(session.error()).toBe(PROJECT_NAME_REQUIRED);
});
```

既存「appends a project only after create succeeds」は emit／mutating 期待に合わせて更新。失敗テストは一覧不変を維持。

- [x] **Step 2: `create` と `endMutating` を実装**

```ts
create(name: string): Observable<Project> {
  const trimmed = name.trim();
  if (this.switching() || this.mutating()) return EMPTY;
  if (!trimmed || [...trimmed].length > 80) {
    this.error.set(PROJECT_NAME_REQUIRED);
    return throwError(() => new Error(PROJECT_NAME_REQUIRED));
  }
  this.mutating.set(true);
  this.error.set('');
  return this.api.createProject(trimmed).pipe(
    tap((project) => {
      this.projects.update((list) => sortProjects([...list, project]));
    }),
    catchError((e) => {
      this.error.set(errorMessage(e));
      this.mutating.set(false);
      return throwError(() => e);
    }),
  );
}

endMutating(): void {
  this.mutating.set(false);
}
```

- [x] **Step 3: `cd frontend && npm test -- --watch=false --include=src/app/project-session.spec.ts` PASS**

  注: Task1 だけだと App が `create` を subscribe しなくなるため **app.spec の作成系は赤のまま**。Task2 まで続けて完了する。

- [x] **Step 4: コミットしない**

---

### Task 2: App モーダル UI と create→switchTo

**Files:**
- Modify: `frontend/src/app/app.ts`
- Modify: `frontend/src/app/app.html`
- Modify: `frontend/src/app/app.spec.ts`（dialog polyfill は board.spec と同様）

**Interfaces:**
- App 状態: `projectModalOpen` signal、`projectForm`（`name: textLimit(80, true)`）、`formError`、`saving`
- `addProject()`: busy なら return。`formError=''`、session.error クリア、form reset、`projectModalOpen=true`
- `closeProjectModal()`: `saving` 中は return。open=false、form reset、formError クリア（ユーザー閉じ専用）
- `submitProject()`: invalid なら touched＋formError=`PROJECT_NAME_REQUIRED`。`saving=true` → `create(name)`:
  - **create EMPTY**（busy）: next も error も来ない → no-op。`saving=false`（subscribe の complete で next が一度も来ていなければ）。実装は `let gotNext=false` フラグで区別
  - **create error**: formError へ写す、`session.error.set('')`、`saving=false`（create 内で既に `mutating=false`）
  - **create next**: `gotNext=true` → **`projectModalOpen.set(false)` を直書き**（`closeProjectModal` は呼ぶな — saving 中ガードで閉じられない）。form reset。続けて `switchTo(id)`:
    - subscribe 開始直後に `endMutating()`
    - `let gotSwitched=false`
    - switch **next**: `gotSwitched=true`、`saving=false`
    - switch **error**: session.error 表示、`saving=false`（一覧は残す・L-001）
    - switch **complete** かつ `!gotSwitched`: EMPTY → `session.error` に「切替できませんでした」、`saving=false`（成功 next→complete では gotSwitched 済みなので触らない）
- HTML: board.html と同型。見出し「プロジェクトを追加」。`autofocus` 付き name。field-note「80文字以内」。送信ラベル `saving ? '作成中…' : '作成'`。キャンセルボタンなし。`(cancel)` preventDefault＋close。backdrop click で閉じない。× は `[disabled]="saving()"`。

- [x] **Step 1: 失敗する App テスト（既存 prompt 前提 it も書き換え）**

既存 `does not add a project when create fails`（prompt→`.project-error`）を削除／置換:

```ts
it('opens a project add dialog instead of window.prompt', () => { ... });

it('creates then switches to the new project and closes the dialog', () => { ... });

it('keeps the dialog open and shows formError when create fails', () => {
  // createProject throwError → form-error に「作成失敗」、.project-error は null／空
});

it('keeps the new project when switchTo fails after create', () => {
  // create OK、patchBoardSettings throw → projects に新規あり、activeId 復元、.project-error
});

it('does not close on backdrop click; Esc closes when not saving', () => { ... });

it('does not close via Esc or × while saving', () => { ... });
```

空名で create 非呼び出し、も追加。

- [x] **Step 2: app.ts / app.html 実装（Modal import、ReactiveFormsModule）**

- [x] **Step 3: `cd frontend && npm test -- --watch=false --include=src/app/app.spec.ts --include=src/app/project-session.spec.ts` PASS**

- [x] **Step 4: コミットしない**

---

## 手動確認（実装後）

1. 追加 → 作成 → セレクトが新プロジェクト、ボードが切替
2. 空／81 文字で POST なし
3. Esc／× で閉じる。backdrop では閉じない
4. API 失敗でモーダル内エラーのみ
5. 名称変更・削除が従来どおり

## 完了条件

- 上記テスト PASS
- spec 受け入れ 1–10 を満たす
- コミットは `/feature` の commit フェーズまでしない
