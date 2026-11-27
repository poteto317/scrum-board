import { Component, WritableSignal, inject, input, output } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import {
  ITEM_TEMPLATE_MANAGE_LABEL,
  ITEM_TEMPLATE_NONE_LABEL,
} from './item-template';
import { ItemTemplatesCreateSession } from './item-templates-create-session';

/** Template select + optional admin manage UI for item-create dialogs. */
@Component({
  selector: 'app-item-template-create-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './item-template-create-panel.html',
})
export class ItemTemplateCreatePanel {
  readonly selectId = input.required<string>();
  readonly isAdmin = input(false);
  readonly busy = input(false);
  readonly saving = input.required<WritableSignal<boolean>>();
  readonly projectId = input<number | null>(null);
  readonly confirmFn = input<(msg: string) => boolean>((m) => confirm(m));
  readonly applied = output<{ title: string; description: string }>();

  readonly noneLabel = ITEM_TEMPLATE_NONE_LABEL;
  readonly manageLabel = ITEM_TEMPLATE_MANAGE_LABEL;
  readonly session = inject(ItemTemplatesCreateSession);

  onSelect(raw: string) {
    this.session.onSelect(raw);
    this.applied.emit(this.session.appliedFields());
  }

  create() {
    const projectId = this.projectId();
    if (projectId == null || projectId <= 0) return;
    this.session.create(projectId, this.saving());
  }

  update(id: number) {
    const projectId = this.projectId();
    if (projectId == null || projectId <= 0) return;
    this.session.update(projectId, id, this.saving());
  }

  remove(id: number) {
    const projectId = this.projectId();
    if (projectId == null || projectId <= 0) return;
    this.session.remove(projectId, id, this.saving(), this.confirmFn());
  }
}
