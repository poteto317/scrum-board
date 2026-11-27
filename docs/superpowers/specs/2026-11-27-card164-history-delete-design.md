# カード164: 会話の削除を履歴から行えるようにする

## 背景

会話の削除 API・確認ダイアログ・履歴行の「削除」は既にある。一方で「AIに聞く」画面（FAB dock / ページのやりとりヘッダ）にも「この会話を削除」があり、チャット操作面に破壊操作が並ぶ。カード要件は **履歴から削除できること** と **「AIに聞く」画面には削除を出さなくてよい** こと。

## 決めたこと

1. **削除の入口は会話履歴の各行の「削除」だけにする。** 既存の `deleteConversation` → confirm → `DELETE …/ai-conversations/{id}` をそのまま使う。
2. **ヘッダの「この会話を削除」（`.ai-chat-delete-shown`）は全 layout で出さない。** dock（「AIに聞く」）でも page でも非表示。履歴（`showList`）の行削除で足りる。
3. **バックエンド・API 契約は変更しない。** 既存の削除経路を再利用する。
4. **L-001:** confirm キャンセル・API 失敗時は会話・一覧を維持する（既存挙動を崩さない）。
5. **L-408:** 履歴行の削除ボタンは `event.detail > 1` の click を無視する（ダブルクリックの続きで誤削除しない）。必須。ヘッダ削除を消すのでヘッダ側のガードは不要。

## 非目標

- 新しい削除 API や一括削除
- 履歴以外の画面への削除 UI 追加
- 「AIに聞く」での削除ショートカットの代替実装

## 受け入れ条件

1. 履歴一覧を開いたとき（page の pinned、または dock/page で「履歴」表示中）、各会話行に「削除」があり、確認後にその会話が消える。
2. 「AIに聞く」のやりとり表示（履歴を閉じた dock / 非 pinned page の thread）に「この会話を削除」が出ない。
3. page の pinned（一覧＋やりとり同時）でもヘッダに「この会話を削除」は出ず、一覧行の「削除」だけで消せる。
4. confirm キャンセル・削除 API 失敗では一覧と表示中の会話が変わらない（L-001）。
5. 履歴行の削除ボタンのダブルクリック 2 回目で confirm が二重に開かない（L-408）。

## 影響範囲

- `frontend/src/app/project-ai-chat.html` — ヘッダ削除ボタン除去。行削除の click に `$event` を渡し `detail > 1` を無視
- `frontend/src/app/project-ai-chat.ts` — `canDeleteShown` と `deleteShownConversation` を削除。行からは既存の `deleteConversation(id, event?)` のみ
- `frontend/src/app/project-ai-chat.spec.ts` — ヘッダ削除前提のテストを履歴行削除へ寄せる / ヘッダ非表示を固定 / `detail > 1` を固定

## 知見

- L-001（成否・失敗時の状態維持）
- L-408（リピート・ダブルクリックの誤操作）
