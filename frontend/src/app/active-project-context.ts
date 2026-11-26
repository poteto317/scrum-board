import { Component, computed, inject, input } from '@angular/core';
import { ProjectSession } from './project-session';

/**
 * いま見ているプロジェクトの文脈（名前と、プロジェクトの読み込みなどの失敗）を文字だけで出す。切り替えはできない。
 * ヘッダーに切り替えが無いページで、どのプロジェクトを見ているかと ProjectSession.error を伝える。
 * `projectId` を渡さなければ選択中のプロジェクト、`null` なら名前を出さない（不正な ID の画面に別の名前を出さない）。
 */
@Component({
  selector: 'app-active-project-context',
  template: `@if (name(); as n) {
      <p class="active-project-name">
        プロジェクト: <strong>{{ n }}</strong>
      </p>
    }
    @if (projectSession.error(); as message) {
      <p class="project-error" role="alert">{{ message }}</p>
    }`,
  styles: `
    .active-project-name {
      margin: 8px 0 0;
      font-size: 12px;
      color: var(--muted);
      overflow-wrap: anywhere;
    }
    .project-error {
      margin: 8px 0 0;
    }
    .active-project-name strong {
      font-weight: 600;
      color: var(--ink);
    }
  `,
})
export class ActiveProjectContext {
  readonly projectSession = inject(ProjectSession);
  readonly projectId = input<number | null | undefined>(undefined);

  readonly name = computed(() => {
    const given = this.projectId();
    const id = given === undefined ? this.projectSession.activeId() : given;
    if (id == null) return null;
    return this.projectSession.projects().find((p) => p.id === id)?.name ?? null;
  });
}
