# カード165: AIに聞く画面で履歴一覧をデフォルトにしない

## 背景

専用画面（`layout: 'page'`）かつ幅が広い（`min-width: 768px`）とき、`conversationListView` が `pinned=true` になり、履歴一覧が左に常時表示される。カードは「履歴一覧をデフォルトにしない」ことが主眼で、開いた直後はやりとり面（入力欄のあるスレッド）を見せ、履歴は利用者がトグルで開いたときだけ出す。

## 決めたこと

1. **pin をやめる。** `conversationListView` から `pinned` フィールドを削除する。`showList === historyOpen`、`showThread === !historyOpen`。layout / 幅に依存しない。
2. **初期の面はスレッド。** `historyOpen` 初期値は既存どおり `false`。開いた直後は履歴一覧が出ず、スレッド（入力欄）が見える。
3. **初期に載せる会話の中身は変えない。** `initialConversationId` 未指定時の `getLatestProjectAIChat` による直近復元は現状維持。本カードは「一覧パネルの既定表示」を直し、「必ず空の新規会話にする」ことまではやらない（非目標）。
4. **履歴トグルを常に出す。** pin 時のトグル非表示特例と `--split` レイアウト用 CSS を削除する。選択・新規開始で一覧を閉じる既存挙動は維持する。
5. **wide / メディアクエリを削除する。** `wide` signal・`bindWideMedia`・`CONVERSATION_LIST_PINNED_QUERY` は pin 専用だったため削除する。`conversationListView` の引数から `layout` / `wide` も外す。
6. **API / バックエンドは変えない。**

## 非目標

- 直近会話の自動復元をやめて、常に空の新規会話にする
- fab / dock の開閉 UX の再設計（挙動は揃えつつ退行させない）
- 履歴の並び・削除・編集機能の変更

## 影響範囲

| 領域 | 内容 |
| --- | --- |
| `project-ai-conversations.ts` | `conversationListView` 簡略化、`CONVERSATION_LIST_PINNED_QUERY` 削除 |
| `project-ai-chat.ts` | `wide` / `bindWideMedia` 削除、`listView` 呼び出し更新 |
| HTML / CSS | `--split` は pin 時のみだったため通常出ない。トグルは常に非 pin で表示 |
| テスト | page+wide の「常時一覧・トグル無し」「広がると pin」を廃止し、初期スレッド＋トグル／広がっても一覧自動表示なしへ更新。dock / 狭 page は退行なし |

## 受け入れ条件

1. AIに聞く専用画面を幅 768px 以上で開いたとき、履歴一覧は出ておらず、スレッド面（入力欄）が見える（載っている会話が直近復元か空かは既存の初期読込に従う）。
2. 同画面で履歴トグルを押すと一覧が出て、再度押すか会話を選ぶ／新規開始するとスレッドに戻る。
3. dock および狭い page の履歴トグル挙動は退行しない。
4. 幅や layout に関わらず、履歴一覧はトグルを開くまで出ない（旧 pin / 常時分割は残らない）。

## 知見

- L-1268: page / dock / 狭広の組み合わせで AC とテストを揃える
- L-408: 履歴トグルが page+wide で新たに出るが、既存トグルと同型。追加ガードは必須としない
