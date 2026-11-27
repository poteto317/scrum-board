export type ItemTemplate = {
  id: number;
  projectId: number;
  name: string;
  titleTemplate: string;
  descriptionTemplate: string;
  position: number;
};

export const ITEM_TEMPLATE_NONE_LABEL = '（テンプレートなし）';
export const ITEM_TEMPLATE_LIST_LOAD_FAILURE = 'テンプレート一覧を読み込めませんでした';
export const ITEM_TEMPLATE_CREATE_SUCCESS = 'テンプレートを追加しました';
export const ITEM_TEMPLATE_UPDATE_SUCCESS = 'テンプレートを更新しました';
export const ITEM_TEMPLATE_DELETE_SUCCESS = 'テンプレートを削除しました';
export const ITEM_TEMPLATE_DELETE_CONFIRM = 'このテンプレートを削除しますか？';
export const ITEM_TEMPLATE_MANAGE_LABEL = 'テンプレート管理';

/** null = 「テンプレートなし」→ 空文字。それ以外は雛形フィールドを返す。 */
export function applyItemTemplate(
  t: Pick<ItemTemplate, 'titleTemplate' | 'descriptionTemplate'> | null,
): { title: string; description: string } {
  if (!t) return { title: '', description: '' };
  return { title: t.titleTemplate, description: t.descriptionTemplate };
}
