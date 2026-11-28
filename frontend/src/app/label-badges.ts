import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Label, labelBadgeVars, normalizeLabels } from './label';

@Component({
  selector: 'app-label-badges',
  standalone: true,
  template: `
    @if (normalized().length > 0) {
      <ul class="label-badges" [class.compact]="compact()" aria-label="ラベル">
        @for (label of normalized(); track label.id) {
          <li class="label-badge" [style]="vars(label.color)">
            <span class="label-dot" aria-hidden="true"></span>
            <span class="label-name">{{ label.name }}</span>
          </li>
        }
      </ul>
    }
  `,
  styleUrl: './label-badges.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelBadges {
  readonly labels = input<readonly Label[] | undefined>([]);
  readonly compact = input(false);
  readonly normalized = computed(() => normalizeLabels(this.labels()));

  vars(color: string): Record<string, string> {
    return labelBadgeVars(color);
  }
}
