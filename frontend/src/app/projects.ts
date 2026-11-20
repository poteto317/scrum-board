import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { Component, computed, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { errorMessage } from './api-error';
import { textLimit } from './form-validation';
import { Modal } from './modal';
import { Project } from './models';
import { ProjectSession } from './project-session';

@Component({
  selector: 'app-projects',
  imports: [RouterLink, ReactiveFormsModule, Modal, CdkDropList, CdkDrag, CdkDragHandle],
  templateUrl: './projects.html',
  styleUrl: './projects.css',
})
export class ProjectsPage {
  readonly projectSession = inject(ProjectSession);

  readonly modalOpen = signal(false);
  readonly formError = signal('');
  readonly saving = signal(false);
  /** Local order for optimistic DnD; null means use session.projects(). */
  readonly draftOrder = signal<Project[] | null>(null);

  readonly projectForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [textLimit(80, true)] }),
  });

  readonly list = computed(() => this.draftOrder() ?? this.projectSession.projects());
  readonly pageBusy = computed(
    () => this.projectSession.switching() || this.projectSession.mutating() || this.saving(),
  );

  openAdd() {
    if (this.modalOpen() || this.pageBusy()) {
      return;
    }
    this.projectForm.reset({ name: '' });
    this.formError.set('');
    this.projectSession.error.set('');
    this.modalOpen.set(true);
  }

  closeModal() {
    if (this.saving()) return;
    this.modalOpen.set(false);
    this.projectForm.reset({ name: '' });
    this.formError.set('');
  }

  submitAdd() {
    if (this.pageBusy()) {
      return;
    }
    if (this.projectForm.invalid) {
      this.projectForm.markAllAsTouched();
      return;
    }
    const name = this.projectForm.controls.name.value.trim();
    this.saving.set(true);
    this.formError.set('');
    let gotNext = false;
    this.projectSession.create(name).subscribe({
      next: (project) => {
        gotNext = true;
        this.modalOpen.set(false);
        this.projectForm.reset({ name: '' });
        this.draftOrder.set(null);
        this.switchToCreatedProject(project.id);
      },
      error: (e) => {
        this.formError.set(e instanceof Error && e.message ? e.message : errorMessage(e));
        this.saving.set(false);
      },
      complete: () => {
        if (!gotNext) {
          this.formError.set('作成できませんでした');
          this.saving.set(false);
        }
      },
    });
  }

  private switchToCreatedProject(projectId: number) {
    let gotSwitched = false;
    this.projectSession.switchTo(projectId).subscribe({
      next: () => {
        gotSwitched = true;
        this.saving.set(false);
      },
      error: () => this.saving.set(false),
      complete: () => {
        if (!gotSwitched) {
          this.projectSession.error.set('切替できませんでした');
          this.saving.set(false);
        }
      },
    });
    this.projectSession.endMutating();
  }

  rename(project: Project) {
    if (this.pageBusy()) return;
    const name = window.prompt('新しいプロジェクト名', project.name);
    if (name == null) return;
    this.projectSession.rename(project.id, name);
  }

  canDelete(): boolean {
    return this.projectSession.canDelete();
  }

  onDestructiveKeydown(event: KeyboardEvent) {
    if ((event.key === 'Enter' || event.key === ' ') && event.repeat) {
      event.preventDefault();
    }
  }

  delete(project: Project) {
    if (!this.canDelete()) return;
    const ok = window.confirm(
      `「${project.name}」を削除しますか？アイテムが無いプロジェクトだけ削除できます。`,
    );
    if (!ok) return;
    this.draftOrder.set(null);
    this.projectSession.delete(project.id);
  }

  onDrop(event: CdkDragDrop<Project[]>) {
    if (event.previousIndex === event.currentIndex) return;
    if (this.pageBusy()) return;
    const before = this.list().slice();
    const next = before.slice();
    moveItemInArray(next, event.previousIndex, event.currentIndex);
    this.applyReorder(next);
  }

  move(index: number, delta: -1 | 1) {
    if (this.pageBusy()) return;
    const before = this.list().slice();
    const j = index + delta;
    if (j < 0 || j >= before.length) return;
    const next = before.slice();
    moveItemInArray(next, index, j);
    this.applyReorder(next);
  }

  onMoveKeydown(event: KeyboardEvent) {
    if ((event.key === 'Enter' || event.key === ' ') && event.repeat) {
      event.preventDefault();
    }
  }

  private applyReorder(next: Project[]) {
    // Failures surface via ProjectSession.error; drop draft so list() reads session again.
    this.draftOrder.set(next);
    const ids = next.map((p) => p.id);
    let gotNext = false;
    this.projectSession.reorder(ids).subscribe({
      next: () => {
        gotNext = true;
        this.draftOrder.set(null);
      },
      error: () => {
        this.draftOrder.set(null);
      },
      complete: () => {
        if (!gotNext) {
          this.draftOrder.set(null);
        }
      },
    });
  }
}
