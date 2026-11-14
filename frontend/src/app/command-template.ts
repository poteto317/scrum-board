export type CommandTemplate = {
  id: number;
  name: string;
  template: string;
  position: number;
};

export const COMMAND_MENU_EMPTY = 'コマンドが未登録です。詳細画面で追加できます。';
export const COPY_COMMAND_SUCCESS = 'コマンドをコピーしました';
export const COPY_COMMAND_FAILURE = 'コマンドをコピーできませんでした';

export const resolveCommand = (template: string, url: string): string =>
  template.split('{{url}}').join(url);
