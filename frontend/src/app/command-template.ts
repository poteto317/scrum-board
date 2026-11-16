export type CommandTemplate = {
  id: number;
  name: string;
  template: string;
  position: number;
};

export const COMMAND_ITEM_MENU_EMPTY =
  'このアイテムにコマンドがありません。詳細画面で選べます。';
export const COPY_COMMAND_SUCCESS = 'コマンドをコピーしました';
export const COPY_COMMAND_FAILURE = 'コマンドをコピーできませんでした';

export const resolveCommand = (template: string, url: string): string =>
  template.split('{{url}}').join(url);
