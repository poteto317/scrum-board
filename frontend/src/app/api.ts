import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommandTemplate } from './command-template';
import { ItemOrderColumn } from './item-order';
import { ListFilter } from './list-filter';
import {
  BoardData,
  BoardSettings,
  CardLayout,
  Item,
  ItemInput,
  ItemPatch,
  Column,
  HistoryPage,
  Project,
} from './models';

export type { ItemOrderColumn };

export type BoardSettingsPatchResponse = {
  settings: BoardSettings;
  items?: Item[];
};

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  publicConfig() {
    return this.http.get<{ publicOrigin: string }>('/api/public-config');
  }
  board() {
    return this.http.get<BoardData>('/api/board');
  }
  patchBoardSettings(body: {
    cardLayout?: CardLayout;
    mobileBoardColumnId?: number;
    activeProjectId?: number;
  }) {
    const payload: {
      cardLayout?: CardLayout;
      mobileBoardColumnId?: number;
      activeProjectId?: number;
    } = {};
    if (body.cardLayout !== undefined) payload.cardLayout = body.cardLayout;
    if (body.mobileBoardColumnId !== undefined) {
      payload.mobileBoardColumnId = body.mobileBoardColumnId;
    }
    if (body.activeProjectId !== undefined) payload.activeProjectId = body.activeProjectId;
    return this.http.patch<BoardSettingsPatchResponse>('/api/board/settings', payload);
  }
  listProjects() {
    return this.http.get<{ projects: Project[] }>('/api/projects');
  }
  createProject(name: string) {
    return this.http.post<Project>('/api/projects', { name });
  }
  patchProject(id: number, name: string) {
    return this.http.patch<Project>(`/api/projects/${id}`, { name });
  }
  deleteProject(id: number) {
    return this.http.delete<void>(`/api/projects/${id}`);
  }
  itemByNumber(number: number) {
    return this.http.get<Item>(`/api/items/by-number/${number}`);
  }
  history(number: number, before = 0) {
    return this.http.get<HistoryPage>(`/api/items/by-number/${number}/history`, {
      params: before ? { before: String(before) } : {},
    });
  }
  prTitles(urls: string[]) {
    return this.http.post<{ titles: Record<string, string> }>('/api/pr-titles', { urls });
  }
  createColumn(name: string) {
    return this.http.post<Column>('/api/columns', { name });
  }
  reorderColumns(columnIds: number[]) {
    return this.http.put<{ columns: Column[] }>('/api/columns/order', { columnIds });
  }
  reorderItems(columns: ItemOrderColumn[]) {
    return this.http.put<{ items: Item[] }>('/api/items/order', { columns });
  }
  backlog() {
    return this.http.get<{ items: Item[] }>('/api/backlog');
  }
  reorderBacklog(itemIds: number[]) {
    return this.http.put<{ items: Item[] }>('/api/backlog/order', { itemIds });
  }
  createItem(input: ItemInput) {
    return this.http.post<Item>('/api/items', input);
  }
  updateItem(id: number, input: ItemPatch) {
    return this.http.patch<Item>(`/api/items/${id}`, input);
  }
  updateAssigneeByNumber(number: number, assignee: string) {
    return this.http.patch<Item>(`/api/items/by-number/${number}/assignee`, { assignee });
  }
  deleteItem(id: number) {
    return this.http.delete<void>(`/api/items/${id}`);
  }
  listCommandTemplates() {
    return this.http.get<{ templates: CommandTemplate[] }>('/api/command-templates');
  }
  createCommandTemplate(input: { name: string; template: string }) {
    return this.http.post<CommandTemplate>('/api/command-templates', input);
  }
  updateCommandTemplate(id: number, input: { name?: string; template?: string }) {
    return this.http.patch<CommandTemplate>(`/api/command-templates/${id}`, input);
  }
  deleteCommandTemplate(id: number) {
    return this.http.delete<void>(`/api/command-templates/${id}`);
  }
  listItemCommandTemplatesByNumber(number: number) {
    return this.http.get<{ templates: CommandTemplate[] }>(
      `/api/items/by-number/${number}/command-templates`,
    );
  }
  replaceItemCommandTemplatesByNumber(number: number, templateIds: number[]) {
    return this.http.put<{ templates: CommandTemplate[] }>(
      `/api/items/by-number/${number}/command-templates`,
      { templateIds },
    );
  }
  listCommandTemplateDefaults() {
    return this.http.get<{ templateIds: number[] }>('/api/command-template-defaults');
  }
  replaceCommandTemplateDefaults(templateIds: number[]) {
    return this.http.put<{ templateIds: number[] }>('/api/command-template-defaults', {
      templateIds,
    });
  }
  applyCommandTemplatesToAllItems(templateIds: number[]) {
    return this.http.post<void>('/api/command-templates/apply-to-all-items', { templateIds });
  }
  listFilter() {
    return this.http.get<ListFilter>('/api/list-filter');
  }
  putListFilter(filter: ListFilter) {
    return this.http.put<ListFilter>('/api/list-filter', filter);
  }
}
