# AIチャット返答時の自動スクロール（#162）設計

## 背景

カード #162:

> 返答が追加されたとき、会話欄が自動で最下部までスクロールするようにする。入力欄が下にずれる原因（スクロール範囲の計算や高さの変化）も合わせて確認し、入力欄がデフォルトの画面下部に保たれるように直す。ユーザーが上にスクロールして過去の会話を読んでいるときは、勝手に下へ戻さない。

現状:

- `project-ai-chat` に `scrollTop` / `scrollIntoView` 等の JS 自動スクロールは無い。
- メッセージは `.ai-chat-list`（`overflow: auto`）。compose は同じ `.ai-chat-thread` 内の**兄弟**（リストの外）。
- 製品の FAB パネル（`ai-chat-fab`）は `[layout]="'dock'"` を渡す。テンプレート上の `layout='fab'` は従来の高さ制限モード用で、現行の入口では使っていない。
- dock/page では list に `flex: 1; min-height: 0` があるが、スクロール容器の明示と compose の `flex-shrink: 0` が弱く、高さ変化で入力欄が視線からずれやすい。

## 決めたこと（推奨採用）

| 論点 | 採用 | 捨てた案 |
| --- | --- | --- |
| スクロール対象 | **`.ai-chat-list` だけ**をスクロールする。compose / status / error は thread 内で list の外に固定 | thread 全体や `window` をスクロール |
| 追従条件 | 「最下部付近にいる」ときだけ自動で下へ（stick-to-bottom）。閾値 **48px** | 常に最下部へ強制 |
| 利用者の上スクロール | list の `scroll` で最下部から離れたら stick off。以後 **messages が増えても**飛ばない | IntersectionObserver のみ |
| 自分の送信 | `send()` 開始時に stick on。その後ユーザーが上へ離れたら stick off が勝ち、到着した返答では飛ばない | 送信後は常に強制追従 |
| 会話切替・新規 | **別会話へ移るとき** stick on し、描画後に最下部へ。同一会話の送信完了では stick を触らない（上スクロール維持） | 前会話の scrollTop を持ち越し。毎回 showConversation で stick on |
| レイアウト修正 | **dock / page**（＝製品の FAB パネルと専用ページ）で list に `overflow: auto` を明示、compose に `flex-shrink: 0`。thread は縦 flex のまま。`layout='fab'` 経路があれば従来の `max-height: 28rem` を維持するが、受け入れの主対象は dock/page | compose を `position: sticky` に頼る |
| 追従トリガー | **`messages` の内容変化**（件数・末尾 id）と会話切替／新規／送信開始の stick on。sending 表示は list の外なので list 高さ追従のトリガーにしない。提案カードの高さ変化専用の ResizeObserver は範囲外（stick 中の次の messages 更新でのみ追従） | sending 変化や提案「展開」をトリガーにする |
| 実装の置き場 | 純関数 `isNearBottom(el, threshold)` と `scrollElementToBottom(el)` を小さなヘルパーに置き、コンポーネントは DOM 参照とイベント配線のみ。適用は **list 要素が存在する成功表示後だけ** `afterNextRender` で行う（L-824）。`loading` / `loadError` 中は list が未マウントなのでスケジュールしない。ref が無ければ no-op | テンプレートに直接 scroll ロジック。loading 中に登録 |

### 挙動の詳細

1. `.ai-chat-list` に template ref（例: `#messageList`）を付ける。
2. `stickToBottom` はコンポーネント内の private フラグ（初期 `true`）。
3. `(scroll)` on list: `stickToBottom = isNearBottom(el, 48)`。
4. `messages` が変わったあと（かつ list が表示中）: stick なら `afterNextRender` で最下部へ。loading / loadError 表示中は登録しない。
5. `send()` の送信開始時: `stickToBottom = true` のうえ、次の描画で最下部へ（ユーザー吹き出しが見える）。返答到着前に利用者が上へスクロールすれば stick off。
6. `showConversation` / `startNew` / 初回 load 成功（list が出たあと）: stick on + 描画後スクロール。

### 入力欄が下に保たれること

- compose はスクロール容器の外。
- dock/page: thread が `flex` 列、list が `flex:1; min-height:0; overflow:auto`、compose が `flex-shrink:0`。
- 製品面: FAB パネル＝dock、専用画面＝page。

## 受け入れ条件

1. 最下部付近で返答（assistant メッセージ）が増えると、list が最下部までスクロールする。
2. 上にスクロールして過去を読んでいる間に返答が増えても、勝手に最下部へ戻らない。
3. 送信操作の直後は最下部へ追従する。送信後〜返答前に利用者が上へスクロールした場合は受け入れ 2 が勝ち、到着した返答では飛ばない。
4. dock（FAB パネル含む）と page で、入力欄が list スクロールに巻き込まれず thread 下部に留まる。
5. テスト:
   - 必須: `isNearBottom` の純関数（境界・閾値内外）。
   - 必須: stick on/off と messages 更新時に `scrollElementToBottom` が呼ばれる／呼ばれないことを、list 要素をモックしてコンポーネントまたは薄い配線関数で固定。
   - CSS の flex 固定は目視／レイアウト回帰は必須としない（セレクタと `flex-shrink: 0` の存在を CSS 文字列テストしてもよいが任意）。

## 範囲外

- ストリーミング途中のトークン単位スクロール最適化。
- 会話一覧（`.ai-chat-conversations`）の自動スクロール。
- ResizeObserver による list 内コンテンツ高さ変化専用の追従。

## 今回パック（知見）

`L-824`, `L-157`, `L-408`, `L-001`, `L-058`, `L-605`, `L-792`

## 実装で触る主なファイル（予定）

- `frontend/src/app/project-ai-chat.ts` / `.html` / `.css`
- 純関数ヘルパー（新規）と `*.spec.ts`
