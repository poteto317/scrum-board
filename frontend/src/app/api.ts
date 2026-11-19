import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommandTemplate } from './command-template';
import { ItemOrderColumn } from './item-order';
import { WorkspaceListFilters } from './list-filter';
import { WorkspaceHeaderMenu } from './header-menu';
import {
  BoardData,
  BoardSettings,
  CardLayout,
  Item,
  ItemComment,
  ItemInput,
  ItemPatch,
  Column,
  HistoryPage,
  Project,
  normalizeComment,
} from './models';
import { map } from 'rxjs';

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
  itemByNumber(number: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<Item>(`/api/items/by-number/${number}`, params ? { params } : {});
  }
  history(number: number, before = 0, projectId?: number) {
    const params: Record<string, string> = {};
    if (before) params['before'] = String(before);
    if (projectId && projectId > 0) params['projectId'] = String(projectId);
    return this.http.get<HistoryPage>(`/api/items/by-number/${number}/history`, {
      params: Object.keys(params).length ? params : {},
    });
  }
  listComments(number: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http
      .get<{ comments: ItemComment[] }>(
        `/api/items/by-number/${number}/comments`,
        params ? { params } : {},
      )
      .pipe(map((res) => (res.comments ?? []).map((c) => normalizeComment(c))));
  }
  createComment(
    number: number,
    input: { author?: string; body: string },
    projectId?: number,
  ) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http
      .post<ItemComment>(`/api/items/by-number/${number}/comments`, input, params ? { params } : {})
      .pipe(map((c) => normalizeComment(c)));
  }
  updateComment(
    number: number,
    id: number,
    patch: { author?: string; body?: string },
    projectId?: number,
  ) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    const body: Record<string, string> = {};
    if (patch.author !== undefined) body['author'] = patch.author;
    if (patch.body !== undefined) body['body'] = patch.body;
    return this.http
      .patch<ItemComment>(
        `/api/items/by-number/${number}/comments/${id}`,
        body,
        params ? { params } : {},
      )
      .pipe(map((c) => normalizeComment(c)));
  }
  deleteComment(number: number, id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.delete<void>(
      `/api/items/by-number/${number}/comments/${id}`,
      params ? { params } : {},
    );
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
  updateAssigneeByNumber(number: number, assignee: string, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.patch<Item>(
      `/api/items/by-number/${number}/assignee`,
      { assignee },
      params ? { params } : {},
    );
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
  listItemCommandTemplatesByNumber(number: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<{ templates: CommandTemplate[] }>(
      `/api/items/by-number/${number}/command-templates`,
      params ? { params } : {},
    );
  }
  replaceItemCommandTemplatesByNumber(number: number, templateIds: number[], projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.put<{ templates: CommandTemplate[] }>(
      `/api/items/by-number/${number}/command-templates`,
      { templateIds },
      params ? { params } : {},
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
    return this.http.get<WorkspaceListFilters>('/api/list-filter');
  }
  putListFilter(filter: WorkspaceListFilters) {
    return this.http.put<WorkspaceListFilters>('/api/list-filter', filter);
  }
  headerMenu() {
    return this.http.get<WorkspaceHeaderMenu>('/api/header-menu');
  }
  putHeaderMenu(menu: WorkspaceHeaderMenu) {
    return this.http.put<WorkspaceHeaderMenu>('/api/header-menu', menu);
  }
}
