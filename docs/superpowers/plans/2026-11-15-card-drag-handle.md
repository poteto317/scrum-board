# かんばんカードの左端中央ドラッグハンドルによる並び替え 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** かんばんボード（`/`）のカードをドラッグ＆ドロップで並び替える際、誤操作を防ぐためにドラッグ可能な領域をカード左端の上下中央に常時表示するドラッグハンドル（`⋮⋮` アイコン、`CdkDragHandle`）に限定し、ハンドル以外のカード本文クリックは詳細遷移・コピーボタンは URL コピーに専念させる。

**Architecture:**
- バックエンド（`cards.position`・`PUT /api/cards/order`）は一切変更しない。
- フロントエンドの `board.html` で `<article class="task-card" cdkDrag>` の先頭子要素として `<button type="button" class="card-drag-handle" cdkDragHandle>` を追加し、`.copy-card-link`（`<button>`）・`.task-card-body`（`<a>`）と兄弟関係で並べる（`L-494`, `L-761`, `L-785`）。
- `@angular/cdk/drag-drop` の `CdkDragHandle` により、ポインターイベントの `target` が `.card-drag-handle`（または内側の `<span>⋮⋮</span>`）のときのみドラッグを開始し、`.task-card`・`.task-card-body`・`.copy-card-link` からのドラッグ開始を抑止する。
- 上下矢印キー（`onCardKeydown`）・操作説明（`aria-describedby="card-drag-help"`）・移動後のフォーカス復元（`focusCardAfterRender`）を `.card-drag-handle` に集約する（`L-154`, `L-157`, `L-762`, `L-785`）。
- `angular.json` の `anyComponentStyle` 予算（warning 6kB / error 8kB）を守るため、ドラッグハンドルの共通スタイルと `.task-card`（`display: flex; align-items: stretch;`）・`.card-drag-handle`（`align-self: center; margin-left: 6px;`）を `frontend/src/styles.css` に配置し、カード左端の上下中央に常時配置する（`L-412`, `L-498`, `L-784`）。
- **注意:** `feature` スキル実行中は `git commit` を行わない（後続の `commit-ja` でまとめてコミットする）。

**Tech Stack:** Angular 21 (`@angular/cdk/drag-drop`), TypeScript 5.9, Vitest

**参照設計書:** `docs/superpowers/specs/2026-11-15-card-drag-handle-design.md`

---

### Task 1: テンプレート・コンポーネント・スタイルのドラッグハンドル対応

**Files:**
- Modify: `frontend/src/app/board.html`
- Modify: `frontend/src/app/board.ts`
- Modify: `frontend/src/styles.css`
- Modify: `frontend/src/app/board.css`

- [x] **Step 1: `frontend/src/app/board.html` に `.card-drag-handle` を追加し、キーボード操作と補助説明文を更新する**

`frontend/src/app/board.html` の `#card-drag-help`、`<article class="task-card" cdkDrag ...>` 内、および `.board-footer` を以下のように更新する。

1. `#card-drag-help`（30〜36 行目付近）:
```html
    <p id="card-drag-help" class="sr-only">
      @if (canReorderCards()) {
        左端のハンドルをドラッグして別の位置やステータスへ移動できます。ハンドルで上下矢印キーを押すと列内を移動できます。キーボードだけで別ステータスへ移す場合は、カードを開いてステータスを変更してください。
      } @else {
        保存中などのため、いまはカードを移動できません。
      }
    </p>
```

2. `<article class="task-card" cdkDrag ...>` 内（118〜183 行目付近）:
   - 先頭子要素として `<button type="button" class="card-drag-handle" cdkDragHandle ...>` を追加する。
   - `<a class="task-card-body">` から `aria-describedby="card-drag-help"` と `(keydown)="onCardKeydown($event, column.id, cardIndex)"` を外し、`.card-drag-handle` へ移す。
```html
                <article
                  class="task-card"
                  cdkDrag
                  [attr.data-card-id]="card.id"
                  [cdkDragData]="card"
                  [cdkDragDisabled]="!canReorderCards()"
                  (cdkDragStarted)="onCardDragStarted(card)"
                  (cdkDragMoved)="onCardDragMoved($event)"
                  (cdkDragReleased)="onCardDragReleased()"
                  (cdkDragEnded)="onCardDragEnded()"
                >
                  <button
                    type="button"
                    class="card-drag-handle"
                    cdkDragHandle
                    [cdkDragHandleDisabled]="!canReorderCards()"
                    [attr.aria-disabled]="!canReorderCards()"
                    [attr.aria-label]="
                      'TASK-' +
                      card.number.toString().padStart(3, '0') +
                      ' ' +
                      card.title +
                      'を移動（ドラッグまたは上下矢印キー）'
                    "
                    aria-describedby="card-drag-help"
                    (keydown)="onCardKeydown($event, column.id, cardIndex)"
                  >
                    <span aria-hidden="true">⋮⋮</span>
                  </button>
                  <button
                    type="button"
                    class="copy-card-link icon-button"
                    [attr.aria-label]="
                      'TASK-' + card.number.toString().padStart(3, '0') + ' のリンクをコピー'
                    "
                    (click)="copyCardLink(card.number)"
                  >
                    <svg
                      class="copy-link-icon"
                      aria-hidden="true"
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                    </svg>
                  </button>
                  <a
                    class="task-card-body"
                    [attr.href]="cardHref(card)"
                    (click)="onCardClick($event, card)"
                    ><span class="card-topline"
                      ><span class="card-id"
                        >TASK-{{ card.number.toString().padStart(3, '0') }}</span
                      ></span
                    >
                    <h3>{{ card.title }}</h3>
                    @if (card.description) {
                      <p class="card-description">{{ card.description }}</p>
                    }
                    <span class="card-footer"
                      ><span class="card-footer-meta"
                        ><span class="card-status">{{ column.name }}</span>
                        @if (card.assignee) {
                          <span
                            class="card-assignee"
                            [attr.data-assignee]="assigneeKind(card.assignee)"
                            >{{ card.assignee }}</span
                          >
                        }</span
                      ><span class="detail-hint"
                        >詳細を開く <span aria-hidden="true">→</span></span
                      ></span
                    ></a
                  >
                </article>
```

3. `.board-footer`（208〜213 行目付近）:
```html
    <footer class="board-footer">
      <span
        ><span class="tip-icon" aria-hidden="true">i</span>
        列の見出しはドラッグまたは左右矢印キー、カード左端のハンドルはドラッグまたは上下矢印キーで並び替えられます。</span
      ><span class="footer-note">少しずつ、よりよいチームへ。</span>
    </footer>
```

- [x] **Step 2: `frontend/src/app/board.ts` に `CdkDragHandle` をインポートし、`focusCardAfterRender` のフォーカス先を `.card-drag-handle` に変更する**

1. `frontend/src/app/board.ts` の import と `@Component.imports`（18 行目・46 行目付近）:
```ts
import {
  CDK_DRAG_CONFIG,
  CdkDrag,
  CdkDragDrop,
  CdkDragHandle,
  CdkDropList,
} from '@angular/cdk/drag-drop';
```
```ts
  imports: [ReactiveFormsModule, Modal, CdkDropList, CdkDrag, CdkDragHandle],
```

2. `onCardKeydown` の JSDoc コメント（335〜339 行目付近）と `focusCardAfterRender(cardId: number)`（420〜435 行目付近）:
```ts
  /**
   * Bound on the card's drag handle only (not the article, link, or copy button), so arrow keys pressed on the link
   * or copy button never move the card. Enter on the link is its native click; only the arrow keys are handled here.
   */
  onCardKeydown(event: KeyboardEvent, columnId: number, index: number) {
```
```ts
  private focusCardAfterRender(cardId: number) {
    if (this.destroyRef.destroyed || this.modal() !== null) return;
    afterNextRender(
      () => {
        if (this.destroyRef.destroyed || this.modal() !== null) return;
        const el = this.columnsContainer()?.nativeElement?.querySelector<HTMLElement>(
          `[data-card-id="${cardId}"] .card-drag-handle`,
        );
        if (!el) return;
        el.focus();
        el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      },
      { injector: this.injector },
    );
  }
```

- [x] **Step 3: `frontend/src/styles.css` と `frontend/src/app/board.css` で左端中央ハンドルのレイアウト・カーソルを設定する**

1. `frontend/src/styles.css`（324〜348 行目付近）の `.column-drag-handle` 定義を `.card-drag-handle` と共通化する:
```css
.column-drag-handle,
.card-drag-handle {
  cursor: grab;
  border: 0;
  border-radius: 4px;
  background: none;
  color: #9ba698;
  padding: 2px 3px;
  margin-left: -4px;
  font-size: 10px;
  line-height: 1;
  letter-spacing: -1px;
  flex-shrink: 0;
  min-width: 24px;
  min-height: 24px;
  display: inline-grid;
  place-items: center;
}
.card-drag-handle {
  align-self: center;
  margin-left: 6px;
}
.column-drag-handle:hover,
.card-drag-handle:hover {
  background: #e6e9e1;
  color: var(--ink);
}
.column-drag-handle:active:not([aria-disabled='true']),
.card-drag-handle:active:not([aria-disabled='true']) {
  cursor: grabbing;
}
.column-drag-handle[aria-disabled='true'],
.card-drag-handle[aria-disabled='true'] {
  cursor: default;
  opacity: 0.45;
}
```

2. `frontend/src/app/board.css`（172〜218 行目付近）の `.task-card`・`.task-card-body`・`.task-card .copy-card-link` と CDK ドラッグ関連スタイルを `frontend/src/styles.css` に移し、カード本体・リンクから `cursor: grab` を外し、カードを横並び Flex にして左端中央ハンドルと本文リンクを並べる（`board.css` の 6kB 予算超過を防ぎつつ、詳細画面の `.copy-card-link` に影響しないよう `.task-card .copy-card-link` に限定する）:
```css
.task-card {
  position: relative;
  display: flex;
  align-items: stretch;
  background: var(--paper);
  border: 1px solid #e1e5dc;
  border-radius: 8px;
  box-shadow: 0 2px 3px #25332104;
  transition:
    transform 0.15s,
    border-color 0.15s,
    box-shadow 0.15s;
  overflow-wrap: anywhere;
}
.task-card:has(.task-card-body:focus-visible) {
  outline: 2px solid #5b7c5b;
  outline-offset: 2px;
}
.task-card-body:focus-visible {
  outline: none;
}
.task-card.cdk-drag-preview {
  box-shadow: 0 8px 20px #25332122;
  /* The preview is a copy in <body> that CDK moves with an inline transform on every pointer event; the card's
     own 0.15s transform transition would make it lag behind the pointer. */
  transition: none;
}
.task-card.cdk-drag-placeholder {
  opacity: 0.4;
}
.task-card.cdk-drag-animating {
  transition: transform 200ms ease;
}
.task-card:hover {
  transform: translateY(-2px);
  border-color: #a2b5a2;
  box-shadow: 0 5px 12px #2533210a;
}
.task-card-body {
  flex: 1;
  min-width: 0;
  display: block;
  text-decoration: none;
  color: inherit;
  padding: 17px 44px 13px 8px;
}
```

---

### Task 2: フロントエンド単体テスト・結合テストの更新と拡充

**Files:**
- Modify: `frontend/src/app/board-card-structure.spec.ts`
- Modify: `frontend/src/app/board-cdk-wiring.spec.ts`
- Modify: `frontend/src/app/board-touch-drag.spec.ts`
- Modify: `frontend/src/app/board-card-drag-live-refresh.spec.ts`
- Modify: `frontend/src/app/board-card-reorder-state.spec.ts`
- Modify: `frontend/src/app/board.spec.ts`

- [x] **Step 1: `frontend/src/app/board-card-structure.spec.ts` を更新し、ハンドル・コピーボタン・本文リンクの兄弟構造と操作責務を検証する**

`frontend/src/app/board-card-structure.spec.ts` を以下の内容に更新する:
- `<article class="task-card" cdkDrag>` の直下に `.card-drag-handle`（`<button type="button" cdkDragHandle>`）、`.copy-card-link`（`<button>`）、`.task-card-body`（`<a>`）が兄弟として並び、互いに入れ子になっていないこと。
- `.card-drag-handle` に `⋮⋮` アイコン、`aria-label`、`aria-describedby="card-drag-help"` が設定されていること。
- `ArrowDown` / `ArrowUp` キー操作は `.card-drag-handle` からのみ発火し、`.task-card-body` や `.copy-card-link` からは発火しないこと。
- `.card-drag-handle` のクリックではカード詳細へ遷移せず、`.task-card-body` の通常クリックでは遷移し、Ctrl クリックはブラウザー既定動作に任せること。

```ts
import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { BoardData, Card } from './models';

// The card is `<article cdkDrag>` holding the drag handle button, the copy button, and the `<a>` link as siblings.
function card(id: number, position: number): Card {
  return {
    id,
    number: id,
    columnId: 1,
    title: `card ${id}`,
    description: '',
    position,
    backlogPosition: position,
    prUrls: [],
    assignee: '',
    createdAt: '',
    updatedAt: '',
  };
}

const board = (): BoardData => ({
  columns: [{ id: 1, name: 'Todo', position: 0 }],
  cards: [card(1, 0), card(2, 1)],
});

async function setup() {
  const reorderCards = vi.fn(() => of({ cards: board().cards }));
  TestBed.configureTestingModule({
    imports: [Board],
    providers: [
      provideRouter([]),
      { provide: Api, useValue: { board: () => of(board()), reorderCards } },
    ],
  });
  const f = TestBed.createComponent(Board);
  f.detectChanges();
  await f.whenStable();
  const root: HTMLElement = f.nativeElement;
  const article = root.querySelector('.task-card') as HTMLElement;
  const handle = article.querySelector('.card-drag-handle') as HTMLButtonElement;
  const link = article.querySelector('.task-card-body') as HTMLAnchorElement;
  const copy = article.querySelector('.copy-card-link') as HTMLButtonElement;
  return { f, root, article, handle, link, copy, reorderCards };
}

describe('Board card structure', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('places the drag handle, copy button, and body link as siblings inside the draggable article', async () => {
    const { f, root, article, handle, link, copy } = await setup();
    const drags = f.debugElement.queryAll(By.directive(CdkDrag));
    const handles = f.debugElement.queryAll(By.directive(CdkDragHandle));
    expect(drags.length).toBe(2);
    expect(handles.length).toBe(2);
    expect(drags[0].nativeElement).toBe(article);
    expect(handles[0].nativeElement).toBe(handle);
    expect(article.tagName).toBe('ARTICLE');
    expect(article.getAttribute('data-card-id')).toBe('1');
    expect(handle.tagName).toBe('BUTTON');
    expect(handle.getAttribute('type')).toBe('button');
    expect(handle.textContent?.trim()).toBe('⋮⋮');
    expect(handle.getAttribute('aria-label')).toBe(
      'TASK-001 card 1を移動（ドラッグまたは上下矢印キー）',
    );
    expect(handle.getAttribute('aria-describedby')).toBe('card-drag-help');
    expect(link.tagName).toBe('A');
    expect(link.hasAttribute('data-card-id')).toBe(false);
    expect(link.hasAttribute('aria-describedby')).toBe(false);
    expect(link.getAttribute('href')).toBe('/cards/1');
    // The drag handle, copy button, and link are siblings: no button sits inside the anchor.
    expect(handle.parentElement).toBe(article);
    expect(copy.parentElement).toBe(article);
    expect(link.parentElement).toBe(article);
    expect(link.contains(handle)).toBe(false);
    expect(link.contains(copy)).toBe(false);
    expect(root.querySelectorAll('.task-card-body [data-card-id]').length).toBe(0);
  });

  it('handles arrow keys from the drag handle only, never from the link or copy button', async () => {
    const { handle, copy, link, reorderCards } = await setup();
    const press = (el: HTMLElement) => {
      const ev = new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        bubbles: true,
        cancelable: true,
      });
      el.dispatchEvent(ev);
      return ev;
    };
    const onCopy = press(copy);
    expect(onCopy.defaultPrevented).toBe(false);
    expect(reorderCards).not.toHaveBeenCalled();

    const onLink = press(link);
    expect(onLink.defaultPrevented).toBe(false);
    expect(reorderCards).not.toHaveBeenCalled();

    const onHandle = press(handle);
    expect(onHandle.defaultPrevented).toBe(true);
    expect(reorderCards).toHaveBeenCalledTimes(1);
  });

  it('navigates on a plain click of the link, leaves Ctrl-click to the browser, and does not navigate on handle click', async () => {
    const { handle, link } = await setup();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    const handleClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    handle.dispatchEvent(handleClick);
    expect(navigate).not.toHaveBeenCalled();

    const ctrl = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
    link.dispatchEvent(ctrl);
    expect(ctrl.defaultPrevented).toBe(false);
    expect(navigate).not.toHaveBeenCalled();

    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(true);
    expect(navigate).toHaveBeenCalledWith(['/cards', 1]);
  });

  it('copying a link neither navigates nor reorders', async () => {
    const original = navigator.clipboard;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    try {
      const { f, copy, reorderCards } = await setup();
      const router = TestBed.inject(Router);
      const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
      const navigateByUrl = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
      const ev = new MouseEvent('click', { bubbles: true, cancelable: true });
      copy.dispatchEvent(ev);
      await vi.waitUntil(() => f.componentInstance.copyLinkAnnouncement() !== '');
      expect(ev.defaultPrevented).toBe(false);
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateByUrl).not.toHaveBeenCalled();
      expect(reorderCards).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: original });
    }
  });
});
```

- [x] **Step 2: `frontend/src/app/board-cdk-wiring.spec.ts` を更新し、`CdkDragHandle` の無効化配線とハンドルからのドラッグスクロールを検証する**

`frontend/src/app/board-cdk-wiring.spec.ts` を更新する:
- `CdkDragHandle` をインポートし、各カードの `.card-drag-handle` に配線されていること、通常時は `!h.disabled`、保存中（`reordering() === true`）は `h.disabled === true` かつ `aria-disabled="true"` になることを検証する。
- 2 つ目のテスト（`scrolls the board while a real mouse drag is held at its edge`）でドラッグ開始要素を `.card-drag-handle` に変更する。

```ts
import { CdkDrag, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
```
1 つ目のテスト内に以下を追加:
```ts
    const handles = () =>
      f.debugElement.queryAll(By.directive(CdkDragHandle)).map((d) => d.injector.get(CdkDragHandle));
```
保存前の検証:
```ts
    expect(handles().length).toBe(3);
    expect(handles().every((h) => !h.disabled)).toBe(true);
```
保存中の検証:
```ts
    expect(handles().every((h) => h.disabled)).toBe(true);
    const handleEls = Array.from(
      f.nativeElement.querySelectorAll('.card-drag-handle'),
    ) as HTMLElement[];
    expect(handleEls.every((el) => el.getAttribute('aria-disabled') === 'true')).toBe(true);
```
2 つ目のテストのドラッグ開始対象:
```ts
    const handle = f.nativeElement.querySelector('.card-drag-handle') as HTMLElement;
    handle.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 300,
        clientY: 300,
      }),
    );
```

- [x] **Step 3: `frontend/src/app/board-touch-drag.spec.ts` を更新し、ハンドルのみドラッグ開始可能・ハンドル以外はマウスでもタッチでもドラッグ不可であることを検証する**

`frontend/src/app/board-touch-drag.spec.ts` を以下の内容に更新する:
- ハンドル対象（`.card-drag-handle`, `.card-drag-handle span`）では:
  - 素早いタッチスワイプ（50ms）ではドラッグが始まらずスクロールできること
  - タッチ長押し（`CARD_TOUCH_DRAG_DELAY_MS + 50`）後の移動でドラッグが始まること
  - マウスドラッグ（8px 以上の移動）で即座にドラッグが始まること
  - 8px 未満のわずかなマウス揺れではドラッグが始まらないこと
- ハンドル以外の対象（`.task-card`, `.task-card-body`, `.copy-card-link`）では:
  - マウスで 8px 以上ドラッグしても `started` が発火しないこと
  - タッチで 200ms 以上長押ししてから動かしても `started` が発火しないこと

```ts
import { CDK_DRAG_CONFIG, CdkDrag, DragRefConfig } from '@angular/cdk/drag-drop';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { Api } from './api';
import { Board } from './board';
import { CARD_TOUCH_DRAG_DELAY_MS } from './card-order';

// Dragging is restricted to the left-center handle (.card-drag-handle) so clicking or selecting the card body
// never starts an accidental drag, while swiping quickly on the handle still lets the page/list scroll.
describe('Board card drag start', () => {
  // CDK reads the pointer from touches[0].pageX/pageY and listens for touchmove on the document.
  function touch(type: string, x: number, y: number) {
    const e = new Event(type, { bubbles: true, cancelable: true });
    const point = { identifier: 0, pageX: x, pageY: y, clientX: x, clientY: y };
    for (const key of ['touches', 'targetTouches']) {
      Object.defineProperty(e, key, { value: type === 'touchend' ? [] : [point] });
    }
    Object.defineProperty(e, 'changedTouches', { value: [point] });
    return e;
  }

  async function renderCard() {
    const board = {
      columns: [{ id: 1, name: 'Todo', position: 0 }],
      cards: [
        {
          id: 1,
          number: 1,
          columnId: 1,
          title: 'A',
          description: '',
          position: 0,
          backlogPosition: 0,
          prUrls: [],
          assignee: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    };
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(board), reorderCards: vi.fn() } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const target = (selector: string): HTMLElement => f.nativeElement.querySelector(selector);
    const started = vi.fn();
    const drag = f.debugElement.query(By.directive(CdkDrag));
    drag.injector.get(CdkDrag).started.subscribe(started);
    const config = drag.injector.get(CDK_DRAG_CONFIG) as DragRefConfig;
    return { target, started, config };
  }

  const handleTargets = ['.card-drag-handle', '.card-drag-handle span'];
  const nonHandleTargets = ['.task-card', '.task-card-body', '.copy-card-link'];

  it.each([...handleTargets, ...nonHandleTargets])(
    'does not start a drag when a quick swipe begins on %s, so the page and lists can scroll',
    async (selector) => {
      vi.useFakeTimers();
      try {
        const { target, started } = await renderCard();
        const el = target(selector);
        el.dispatchEvent(touch('touchstart', 100, 100));
        vi.advanceTimersByTime(50); // well inside the hold time
        const move = touch('touchmove', 100, 130); // far past the 8px threshold
        document.dispatchEvent(move);
        expect(started).not.toHaveBeenCalled();
        expect(move.defaultPrevented).toBe(false); // the browser keeps the scroll
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(handleTargets)(
    'starts a touch drag after the finger has rested on the handle (%s)',
    async (selector) => {
      vi.useFakeTimers();
      try {
        const { target, started } = await renderCard();
        const el = target(selector);
        el.dispatchEvent(touch('touchstart', 100, 100));
        vi.advanceTimersByTime(CARD_TOUCH_DRAG_DELAY_MS + 50);
        const move = touch('touchmove', 100, 130);
        document.dispatchEvent(move);
        expect(started).toHaveBeenCalledTimes(1);
        expect(move.defaultPrevented).toBe(true);
        document.dispatchEvent(touch('touchend', 100, 130));
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it.each(handleTargets)('starts a mouse drag at once from the handle (%s)', async (selector) => {
    const { target, started } = await renderCard();
    const el = target(selector);
    el.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    document.dispatchEvent(
      new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 100, clientY: 130 }),
    );
    expect(started).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 130 }),
    );
  });

  it.each(nonHandleTargets)(
    'never starts a mouse drag from outside the handle (%s)',
    async (selector) => {
      const { target, started } = await renderCard();
      const el = target(selector);
      el.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          buttons: 1,
          detail: 1,
          clientX: 100,
          clientY: 100,
        }),
      );
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 130,
        }),
      );
      expect(started).not.toHaveBeenCalled();
      document.dispatchEvent(
        new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 130 }),
      );
    },
  );

  it.each(nonHandleTargets)(
    'never starts a touch drag even after holding outside the handle (%s)',
    async (selector) => {
      vi.useFakeTimers();
      try {
        const { target, started } = await renderCard();
        const el = target(selector);
        el.dispatchEvent(touch('touchstart', 100, 100));
        vi.advanceTimersByTime(CARD_TOUCH_DRAG_DELAY_MS + 50);
        const move = touch('touchmove', 100, 130);
        document.dispatchEvent(move);
        expect(started).not.toHaveBeenCalled();
        expect(move.defaultPrevented).toBe(false);
        document.dispatchEvent(touch('touchend', 100, 130));
      } finally {
        vi.useRealTimers();
      }
    },
  );

  // A click on the handle that wobbles a little must not start a drag until the pointer has travelled 8px.
  it('starts a mouse drag from the handle only once the pointer has travelled the 8px threshold', async () => {
    const { target, started, config } = await renderCard();
    expect(config.dragStartThreshold).toBe(8);
    const el = target('.card-drag-handle');
    el.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: 1,
        detail: 1,
        clientX: 100,
        clientY: 100,
      }),
    );
    const moveTo = (x: number, y: number) =>
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y }),
      );
    moveTo(107, 100);
    expect(started).not.toHaveBeenCalled();
    moveTo(100, 107);
    expect(started).not.toHaveBeenCalled();
    moveTo(108, 100);
    expect(started).toHaveBeenCalledTimes(1);
    document.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 108, clientY: 100 }),
    );
  });
});
```

- [x] **Step 4: `frontend/src/app/board-card-drag-live-refresh.spec.ts`・`frontend/src/app/board-card-reorder-state.spec.ts`・`frontend/src/app/board.spec.ts` のセレクターを `.card-drag-handle` に更新する**

1. `frontend/src/app/board-card-drag-live-refresh.spec.ts`（79〜86 行目付近）の `grab` ヘルパーで `.card-drag-handle` を掴むように変更する:
```ts
function grab(f: { nativeElement: HTMLElement }, cardId: number) {
  const handle = f.nativeElement.querySelector(
    `[data-card-id="${cardId}"] .card-drag-handle`,
  ) as HTMLElement;
  mouse('mousedown', 300, 300, handle);
  mouse('mousemove', 320, 320);
  mouse('mousemove', 330, 340);
}
```

2. `frontend/src/app/board-card-reorder-state.spec.ts`（129〜134 行目および 186〜189 行目付近）のフォーカス検証で `.card-drag-handle` を確認するように更新する:
```ts
    // The card's reorder tab stop is its drag handle; data-card-id sits on the article around it.
    const focused = () => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.classList.contains('card-drag-handle')).toBe(true);
      return active?.closest('[data-card-id]')?.getAttribute('data-card-id');
    };
```
および 186〜189 行目:
```ts
      const active = document.activeElement as HTMLElement;
      expect(active.classList.contains('card-drag-handle')).toBe(true);
      expect(active.closest('[data-card-id]')?.getAttribute('data-card-id')).toBe('1');
```

3. `frontend/src/app/board.spec.ts`:
   - 90〜117 行目（`describe('Board task numbers')`）で `link` には `aria-describedby` が無く、`.card-drag-handle` が `TASK-002` の `aria-label` と `aria-describedby="card-drag-help"` を持つことを検証するように更新する:
```ts
    // The accessible name of the link stays the card's own text; the drag handle carries the move label and help.
    expect(link.getAttribute('aria-label')).toBeNull();
    expect(link.getAttribute('aria-describedby')).toBeNull();
    const handle = card.querySelector('.card-drag-handle') as HTMLButtonElement;
    expect(handle.getAttribute('aria-label')).toBe(
      'TASK-002 Taskを移動（ドラッグまたは上下矢印キー）',
    );
    const helpId = handle.getAttribute('aria-describedby') as string;
    expect(f.nativeElement.querySelector(`#${helpId}`)?.textContent).toContain('ドラッグ');
    expect(f.nativeElement.querySelector(`#${helpId}`)?.textContent).toContain('ステータス');
```
   - 1072〜1103 行目（`describes card dragging differently while reordering is unavailable`）で `aria-describedby` の参照元を `.card-drag-handle` に更新する:
```ts
    const help = () =>
      f.nativeElement.querySelector(
        '#' + f.nativeElement.querySelector('.card-drag-handle').getAttribute('aria-describedby'),
      )?.textContent as string;
```
   - 1128〜1192 行目（`Board card identity`）で `render` ヘルパーに `handles` を追加して `{ f, links, handles }` を返し、`puts focus back on the moved card by its row id, not by its public number` で `.card-drag-handle` から `ArrowDown` を発火し、フォーカスが移動したカードの `.card-drag-handle`（`aria-label` に `TASK-002` を含む）に戻ることを検証する:
```ts
  async function render(reorderCards: ReturnType<typeof vi.fn> = vi.fn()) {
    TestBed.configureTestingModule({
      imports: [Board],
      providers: [
        provideRouter([]),
        { provide: Api, useValue: { board: () => of(crossed()), reorderCards } },
      ],
    });
    const f = TestBed.createComponent(Board);
    f.detectChanges();
    await f.whenStable();
    const links = (): HTMLAnchorElement[] =>
      Array.from(f.nativeElement.querySelectorAll('.task-card-body'));
    const handles = (): HTMLButtonElement[] =>
      Array.from(f.nativeElement.querySelectorAll('.card-drag-handle'));
    return { f, links, handles };
  }
```
```ts
  it('puts focus back on the moved card by its row id, not by its public number', async () => {
    const answer = [
      { ...crossed().cards[0], position: 1 },
      { ...crossed().cards[1], position: 0 },
      crossed().cards[2],
    ];
    const { f, handles } = await render(vi.fn(() => of({ cards: answer })));

    // Card A (id 1, TASK-002) moves down. Number 2 is card B's id, so a lookup by number lands on B.
    handles()[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );
    f.detectChanges();
    await f.whenStable();
    const active = document.activeElement as HTMLElement;
    expect(active.classList.contains('card-drag-handle')).toBe(true);
    expect(active.closest('[data-card-id]')?.getAttribute('data-card-id')).toBe('1');
    expect(active.getAttribute('aria-label')).toContain('TASK-002');
    f.destroy();
  });
```

---

### Task 3: ドキュメント更新と全体検証

**Files:**
- Modify: `README.md`
- Modify: `docs/verification.md`

- [x] **Step 1: `README.md` と `docs/verification.md` を更新する**

1. `README.md`（11 行目付近）の「できること」を更新する:
```markdown
- ボード上でカード左端中央のハンドル（`⋮⋮`）をドラッグ＆ドロップ（または上下矢印キー）し、列内の並べ替えと別ステータスへの移動（カード本文のクリックは詳細へ遷移、右上のボタンでリンクをコピー）
```

2. `docs/verification.md`（「カードの並び替え・列間移動」セクション 71〜85 行目のうち、73〜74・76・79〜85 行目は維持し、**75・77・78 行目**を左端中央ドラッグハンドル仕様に置き換える）:
   - 75 行目の置き換え:
```markdown
- カードのドラッグ開始領域の限定（左端中央ハンドル `.card-drag-handle`）: `<article class="task-card" cdkDrag>` の直下にドラッグハンドル `<button type="button" class="card-drag-handle" cdkDragHandle>`（`⋮⋮` アイコン、カード左端の上下中央に常時表示）、コピーボタン `<button class="copy-card-link">`、本文リンク `<a class="task-card-body" href>` を兄弟として配置。マウスドラッグ（8px 閾値）およびタッチ長押しドラッグ（200ms 遅延）は `.card-drag-handle` からのみ開始でき、`.task-card`・`.task-card-body`・`.copy-card-link` からはドラッグが開始されないこと。`.task-card-body` の通常クリックと Enter は詳細へ遷移し、Ctrl/Cmd 付きのクリックはブラウザー既定に任せ、`.card-drag-handle` の単なるクリックやドラッグ後は遷移が起きないこと
```
   - 77・78 行目の置き換え:
```markdown
- コピーボタン（カードリンクのコピー機能との両立）: 単なるクリックは URL のコピーだけで、遷移も並べ替えも起きない。コピーボタンや本文リンク上からドラッグしてもカードは移動しない。上下矢印キー（↑/↓）による列内移動は `.card-drag-handle` にフォーカスがあるときのみ動作し、移動完了・失敗後も `.card-drag-handle` にフォーカスが残ること（コピーボタンや本文リンク上の ↑/↓ ではカードは動かない）
- タッチ: ハンドル（`.card-drag-handle`）を 200ms 押し続けてから動かしたときだけドラッグが始まり（マウスはハンドル上で 8px 移動時に即時開始）、押し続けずにスワイプしたときやハンドル以外（`.task-card`・`.task-card-body`・`.copy-card-link`）を触ったときはドラッグが始まらず、`touchmove` が `preventDefault` されないこと
```

- [x] **Step 2: フロントエンドとバックエンドのテスト・ビルドを実行して全件パスすることを確認する**

Run:
```bash
cd frontend && npm test -- --watch=false && npm run build
cd backend && go test -race ./... && go vet ./...
```
Expected:
- `npm test -- --watch=false`: 全テストファイル・全テストケースが PASS
- `npm run build`: エラーおよび CSS 予算警告なしでビルド成功
- `go test -race ./...` & `go vet ./...`: 全パッケージ PASS
