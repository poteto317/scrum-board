import { Component, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ProjectSession } from './project-session';

@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit {
  readonly projectSession = inject(ProjectSession);

  ngOnInit() {
    this.projectSession.load();
  }

  onProjectChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    const id = Number(select.value);
    if (!Number.isFinite(id) || id <= 0) return;
    this.projectSession.switchTo(id).subscribe({
      error: () => {
        // A same-turn failure never renders the optimistic id, so write the restored value.
        const current = this.projectSession.activeId();
        select.value = current == null ? '' : String(current);
      },
    });
  }

  addProject() {
    if (this.projectSession.switching() || this.projectSession.mutating()) return;
    const name = window.prompt('プロジェクト名');
    if (name == null) return;
    this.projectSession.create(name);
  }

  renameProject() {
    if (!this.projectSession.canRename()) return;
    const current = this.projectSession.projects().find((p) => p.id === this.projectSession.activeId());
    if (!current) return;
    const name = window.prompt('新しいプロジェクト名', current.name);
    if (name == null) return;
    this.projectSession.rename(current.id, name);
  }

  deleteProject() {
    if (!this.projectSession.canDelete()) return;
    const current = this.projectSession.projects().find((p) => p.id === this.projectSession.activeId());
    if (!current) return;
    const ok = window.confirm(
      `「${current.name}」を削除しますか？アイテムが無いプロジェクトだけ削除できます。`,
    );
    if (!ok) return;
    this.projectSession.delete(current.id);
  }
}
