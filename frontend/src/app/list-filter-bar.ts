import { Component, inject, input } from '@angular/core';
import { Column } from './models';
import { appliedListFilter } from './list-filter';
import { ListFilterSession } from './list-filter-session';

@Component({
  selector: 'app-list-filter-bar',
  templateUrl: './list-filter-bar.html',
  styleUrl: './list-filter-bar.css',
})
export class ListFilterBar {
  readonly columns = input<Column[]>([]);
  /** Optional trailing count label (e.g. backlog "3 / 10 件"). */
  readonly countLabel = input('');
  readonly session = inject(ListFilterSession);

  selectedStatusIds(): number[] {
    return appliedListFilter(
      this.session.filter(),
      this.columns().map((c) => c.id),
    ).statusIds;
  }

  statusChecked(columnId: number): boolean {
    return this.selectedStatusIds().includes(columnId);
  }

  onQueryInput(event: Event) {
    this.session.setQuery((event.target as HTMLInputElement).value);
  }

  onStatusToggle(columnId: number) {
    this.session.toggleStatus(columnId);
  }

  clear() {
    this.session.clear();
  }

  retryLoad() {
    this.session.retryLoad();
  }
}
