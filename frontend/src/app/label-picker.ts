import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Label, MAX_ITEM_LABELS, labelBadgeVars } from './label';

@Component({
  selector: 'app-label-picker',
  standalone: true,
  templateUrl: './label-picker.html',
  styleUrl: './label-picker.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelPicker {
  readonly availableLabels = input<readonly Label[]>([]);
  readonly selectedIds = input<readonly number[]>([]);
  readonly disabled = input(false);
  readonly loaded = input(true);
  readonly loading = input(false);
  readonly loadError = input('');
  readonly canManageCatalog = input(false);
  /** When true, unknown/deleted selectedIds are dropped on toggle instead of failing 400 on save. */
  readonly catalogLoaded = input(false);

  readonly selectedIdsChange = output<number[]>();
  readonly retryLoad = output<void>();
  readonly manageClick = output<void>();

  readonly maxLabels = MAX_ITEM_LABELS;

  readonly selectedSet = computed(() => new Set(this.selectedIds()));
  readonly atLimit = computed(() => this.selectedSet().size >= MAX_ITEM_LABELS);

  isSelected(id: number): boolean {
    return this.selectedSet().has(id);
  }

  isOptionDisabled(id: number): boolean {
    if (this.disabled()) return true;
    return !this.isSelected(id) && this.atLimit();
  }

  toggle(id: number): void {
    if (this.isOptionDisabled(id)) return;
    const current = this.selectedSet();
    const next = new Set(current);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    const ordered = this.availableLabels()
      .map((l) => l.id)
      .filter((knownId) => next.has(knownId));
    if (!this.catalogLoaded()) {
      for (const extra of next) {
        if (!ordered.includes(extra)) ordered.push(extra);
      }
    }
    this.selectedIdsChange.emit(ordered);
  }

  vars(color: string): Record<string, string> {
    return labelBadgeVars(color);
  }
}
