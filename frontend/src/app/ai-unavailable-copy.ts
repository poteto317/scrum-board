/**
 * AI パネル用の案内文（プレーンテキスト）。
 * settings のキー未設定案内は `<code>` 付きで同趣旨を直書き（#54 前は上限 UI 無し）。
 */
export const AI_UNCONFIGURED_MESSAGE =
  'AI は未設定です。サーバーに ANTHROPIC_API_KEY を設定するとチャットと整形が使えます。';

export const AI_EXHAUSTED_MESSAGE =
  'AI の利用上限に達しています。設定で上限を確認・変更できます。';

export const AI_LOW_REMAINING_MESSAGE = 'AI の残りトークンが少なくなっています（概算）。';
