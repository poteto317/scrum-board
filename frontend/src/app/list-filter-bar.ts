import { Component, inject, input } from '@angular/core';
import { Column } from './models';
import { ListFilterView, appliedListFilter } from './list-filter';
import { ListFilterSession } from './list-filter-session';

@Component({
  selector: 'app-list-filter-bar',
  templateUrl: './list-filter-bar.html',
  styleUrl: './list-filter-bar.css',
})
export class ListFilterBar {
  readonly view = input.required<ListFilterView>();
  readonly columns = input<Column[]>([]);
  /** Optional trailing count label (e.g. backlog "3 / 10 件"). */
  readonly countLabel = input('');
  readonly session = inject(ListFilterSession);

  selectedStatusIds(): number[] {
    return appliedListFilter(
      this.session.filter(this.view()),
      this.columns().map((c) => c.id),
    ).statusIds;
  }

  statusChecked(columnId: number): boolean {
    return this.selectedStatusIds().includes(columnId);
  }

  onQueryInput(event: Event) {
    this.session.setQuery(this.view(), (event.target as HTMLInputElement).value);
  }

  onStatusToggle(columnId: number) {
    this.session.toggleStatus(this.view(), columnId);
  }

  clear() {
    this.session.clear(this.view());
  }

  retryLoad() {
    this.session.retryLoad();
  }

  queryValue(): string {
    return this.session.filter(this.view()).query;
  }
}
