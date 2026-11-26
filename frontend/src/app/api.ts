import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommandTemplate } from './command-template';
import { ConditionalGetResult, getJSONConditional } from './conditional-get';
import { ItemOrderColumn } from './item-order';
import { WorkspaceListFilters } from './list-filter';
import { WorkspaceHeaderMenu } from './header-menu';
import { UserPublic } from './auth';
import {
  BoardData,
  BoardMeta,
  BoardSettings,
  CardLayout,
  Item,
  ItemComment,
  ItemInput,
  ItemPatch,
  Column,
  HistoryPage,
  Project,
  Sprint,
  SprintPatch,
  SprintSummary,
  normalizeComment,
} from './models';
import { map, Observable } from 'rxjs';

export type { ConditionalGetResult };

export type { ItemOrderColumn };

export type BoardSettingsPatchResponse = {
  settings: BoardSettings;
  items?: Item[];
};

export type TrashItem = {
  id: number;
  number: number;
  title: string;
  projectId: number;
  deletedAt: string;
};

export type ItemAttachment = {
  id: number;
  itemId: number;
  commentId?: number;
  field: string;
  contentType: string;
  byteSize: number;
  originalName: string;
  createdAt: string;
};

export type RecurringRule = {
  id: number;
  projectId: number;
  name: string;
  title: string;
  description: string;
  cron: string;
  timezone: string;
  columnId: number;
  enabled: boolean;
  lastFiredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecurringRuleInput = {
  name: string;
  title: string;
  description?: string;
  cron: string;
  timezone?: string;
  columnId: number;
  enabled?: boolean;
};

export type RecurringRulePatch = {
  name?: string;
  title?: string;
  description?: string;
  cron?: string;
  timezone?: string;
  columnId?: number;
  enabled?: boolean;
};

export type ProjectAIMessage = {
  id: number;
  projectId: number;
  role: 'user' | 'assistant';
  body: string;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
};

export type ProjectAIChatPostResponse = {
  assistant: ProjectAIMessage;
  messages: ProjectAIMessage[];
};

export type AIUsage = {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  configured: boolean;
};

export type AICredits = {
  limitTokens: number | null;
  usedTokens: number;
  remainingTokens: number | null;
  unlimited: boolean;
  approximate: boolean;
  period: string;
  configured: boolean;
};

@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  publicConfig() {
    return this.http.get<{ publicOrigin: string }>('/api/public-config');
  }
  me() {
    return this.http.get<UserPublic>('/api/auth/me');
  }
  login(loginName: string, password: string) {
    return this.http.post<UserPublic>('/api/auth/login', { loginName, password });
  }
  logout() {
    return this.http.post('/api/auth/logout', {}, { responseType: 'text' });
  }
  listUsers() {
    return this.http.get<UserPublic[]>('/api/users');
  }
  createUser(input: {
    loginName: string;
    password: string;
    displayName: string;
    role?: string;
  }) {
    return this.http.post<UserPublic>('/api/users', input);
  }
  patchUser(
    id: number,
    patch: { displayName?: string; role?: string; disabled?: boolean; password?: string },
  ) {
    return this.http.patch<UserPublic>(`/api/users/${id}`, patch);
  }
  board(projectId?: number) {
    const params =
      projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<BoardData>('/api/board', params ? { params } : {});
  }
  boardConditional(
    projectId?: number,
    etag?: string | null,
  ): Observable<ConditionalGetResult<BoardData>> {
    return getJSONConditional<BoardData>(this.http, '/api/board', { projectId, etag });
  }
  /** Columns and settings only (no items). Use this when a screen does not need the items. */
  boardMeta() {
    return this.http.get<BoardMeta>('/api/board/meta');
  }
  /** boardMeta() with If-None-Match: a 304 is mapped to notModified (backlog polling). */
  boardMetaConditional(etag?: string | null): Observable<ConditionalGetResult<BoardMeta>> {
    return getJSONConditional<BoardMeta>(this.http, '/api/board/meta', { etag });
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
  reorderProjects(projectIds: number[]) {
    return this.http.put<{ projects: Project[] }>('/api/projects/order', { projectIds });
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
    input: { body: string },
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
    patch: { body: string },
    projectId?: number,
  ) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    const body = { body: patch.body };
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
  /** 呼び出したユーザー自身の、そのプロジェクトでの履歴（古い順） */
  listProjectAIChat(projectId: number) {
    return this.http
      .get<{ messages: ProjectAIMessage[] }>(`/api/projects/${projectId}/ai-chat`)
      .pipe(map((res) => res.messages ?? []));
  }
  /** focusItemNumber はアイテム詳細から送るときだけ付ける */
  postProjectAIChat(projectId: number, message: string, focusItemNumber?: number) {
    const body =
      focusItemNumber != null && focusItemNumber > 0 ? { message, focusItemNumber } : { message };
    return this.http.post<ProjectAIChatPostResponse>(`/api/projects/${projectId}/ai-chat`, body);
  }
  clearProjectAIChat(projectId: number) {
    return this.http.delete<void>(`/api/projects/${projectId}/ai-chat`);
  }
  getAIUsage() {
    return this.http.get<AIUsage>('/api/ai/usage');
  }
  getAICredits() {
    return this.http.get<AICredits>('/api/ai/credits');
  }
  putAICredits(body: { limitTokens: number | null }) {
    return this.http.put<AICredits>('/api/ai/credits', body);
  }
  listAttachments(number: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http
      .get<{ attachments: ItemAttachment[] }>(
        `/api/items/by-number/${number}/attachments`,
        params ? { params } : {},
      )
      .pipe(map((res) => res.attachments ?? []));
  }
  uploadAttachment(
    number: number,
    file: File,
    field: 'description' | 'solution' | 'comment',
    projectId?: number,
    commentId?: number,
  ) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    const body = new FormData();
    body.append('file', file, file.name);
    body.append('field', field);
    if (commentId != null && commentId > 0) {
      body.append('commentId', String(commentId));
    }
    return this.http.post<ItemAttachment>(
      `/api/items/by-number/${number}/attachments`,
      body,
      params ? { params } : {},
    );
  }
  deleteAttachment(number: number, id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.delete<void>(
      `/api/items/by-number/${number}/attachments/${id}`,
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
  backlog(projectId?: number) {
    const params =
      projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<{ items: Item[] }>('/api/backlog', params ? { params } : {});
  }
  backlogConditional(
    projectId?: number,
    etag?: string | null,
  ): Observable<ConditionalGetResult<{ items: Item[] }>> {
    return getJSONConditional<{ items: Item[] }>(this.http, '/api/backlog', {
      projectId,
      etag,
    });
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
  patchItemAcl(
    id: number,
    body: {
      viewAccess: 'public' | 'open' | 'restricted';
      editAccess: 'open' | 'restricted';
      viewUserIds: number[];
      editUserIds: number[];
    },
  ) {
    return this.http.patch<Item>(`/api/items/${id}/acl`, body);
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
  listSprints(projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<{ sprints: SprintSummary[] }>('/api/sprints', params ? { params } : {});
  }
  createSprint(input: {
    name: string;
    goal?: string;
    startDate: string;
    endDate: string;
    projectId?: number;
  }) {
    const body: {
      name: string;
      goal?: string;
      startDate: string;
      endDate: string;
      projectId?: number;
    } = {
      name: input.name,
      startDate: input.startDate,
      endDate: input.endDate,
    };
    if (input.goal !== undefined) body.goal = input.goal;
    if (input.projectId !== undefined && input.projectId > 0) body.projectId = input.projectId;
    return this.http.post<Sprint>('/api/sprints', body);
  }
  getSprint(id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<Sprint>(`/api/sprints/${id}`, params ? { params } : {});
  }
  patchSprint(id: number, patch: SprintPatch, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body['name'] = patch.name;
    if (patch.goal !== undefined) body['goal'] = patch.goal;
    if (patch.startDate !== undefined) body['startDate'] = patch.startDate;
    if (patch.endDate !== undefined) body['endDate'] = patch.endDate;
    if (patch.velocity !== undefined) body['velocity'] = patch.velocity;
    return this.http.patch<Sprint>(`/api/sprints/${id}`, body, params ? { params } : {});
  }
  deleteSprint(id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.delete<void>(`/api/sprints/${id}`, params ? { params } : {});
  }
  replaceSprintItems(id: number, itemIds: number[], projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.put<Sprint>(
      `/api/sprints/${id}/items`,
      { itemIds },
      params ? { params } : {},
    );
  }
  activateSprint(id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.post<Sprint>(
      `/api/sprints/${id}/activate`,
      {},
      params ? { params } : {},
    );
  }
  completeSprint(id: number, velocity?: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    const body = velocity !== undefined ? { velocity } : {};
    return this.http.post<Sprint>(
      `/api/sprints/${id}/complete`,
      body,
      params ? { params } : {},
    );
  }
  listTrash(projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<{ items: TrashItem[] }>('/api/trash', params ? { params } : {});
  }
  listArchivedItems(projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.get<{ items: Item[] }>('/api/archive', params ? { params } : {});
  }
  restoreArchivedItem(id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.post<Item>(
      `/api/items/${id}/unarchive`,
      {},
      params ? { params } : {},
    );
  }
  restoreItem(id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.post<Item>(
      `/api/items/${id}/restore`,
      {},
      params ? { params } : {},
    );
  }
  hardDeleteTrashItem(id: number, projectId?: number) {
    const params = projectId && projectId > 0 ? { projectId: String(projectId) } : undefined;
    return this.http.delete<void>(`/api/trash/${id}`, params ? { params } : {});
  }
  purgeTrash() {
    return this.http.post<{ purged: number }>('/api/trash/purge', {});
  }
  listRecurringRules() {
    return this.http.get<{ rules: RecurringRule[] }>('/api/recurring-rules');
  }
  createRecurringRule(input: RecurringRuleInput) {
    return this.http.post<RecurringRule>('/api/recurring-rules', input);
  }
  patchRecurringRule(id: number, patch: RecurringRulePatch) {
    return this.http.patch<RecurringRule>(`/api/recurring-rules/${id}`, patch);
  }
  deleteRecurringRule(id: number) {
    return this.http.delete<void>(`/api/recurring-rules/${id}`);
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
