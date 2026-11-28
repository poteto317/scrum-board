import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { labelBadgeVars } from './label';
import { LabelManagerDialog } from './label-manager-dialog';
import { LabelsSession } from './labels-session';
import { ListFilterView, appliedListFilter, listFilterActive } from './list-filter';
import { ListFilterSession } from './list-filter-session';
import { Column } from './models';

@Component({
  selector: 'app-list-filter-bar',
  standalone: true,
  imports: [CommonModule, LabelManagerDialog],
  templateUrl: './list-filter-bar.html',
  styleUrl: './list-filter-bar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListFilterBar {
  readonly view = input.required<ListFilterView>();
  readonly columns = input<Column[]>([]);
  readonly countLabel = input('');
  readonly managingLabelsChange = output<boolean>();

  readonly session = inject(ListFilterSession);
  readonly labelsSession = inject(LabelsSession);
  readonly managingLabels = signal(false);

  selectedStatusIds(): number[] {
    return appliedListFilter(
      this.session.filter(this.view()),
      this.columns().map((c) => c.id),
      this.labelsSession.knownLabelIds(),
    ).statusIds;
  }

  selectedLabelIds(): number[] {
    return appliedListFilter(
      this.session.filter(this.view()),
      this.columns().map((c) => c.id),
      this.labelsSession.knownLabelIds(),
    ).labelIds;
  }

  isActive(): boolean {
    return listFilterActive(
      this.session.filter(this.view()),
      this.columns().map((c) => c.id),
      this.labelsSession.knownLabelIds(),
    );
  }

  labelVars(color: string): Record<string, string> {
    return labelBadgeVars(color);
  }

  clear(): void {
    this.session.clear(this.view());
  }

  setManagingLabels(open: boolean): void {
    this.managingLabels.set(open);
    this.managingLabelsChange.emit(open);
  }
}
