# AIチャット送信ボタンのUI改善（#161）設計

## 背景

カード #161「AIチャットの送信ボタンのUIをおしゃれにする」:

> AIチャット画面の送信ボタンのデザインを改善し、見た目をおしゃれにする。
>
> - 現在の送信ボタンのデザインを確認し、改善案を検討する
> - 配色・形・アイコン・ホバーやクリック時の動きなどを整える
> - 既存のチャット画面のデザインと統一感を保つ

現状:

- `project-ai-chat.html` の送信は素の `<button type="submit">送信</button>`。
- `.primary` / `.secondary` を付けていないため、アプリ共通の強調ボタン見た目になっていない。
- compose は textarea の下にフル幅の素ボタンが並ぶだけ。

## 決めたこと（本設計で確定）

| 論点 | 採用 | 捨てた案 |
| --- | --- | --- |
| 見た目の基準 | 既存 `.primary`（`--accent` 緑）を土台にし、compose 専用クラスで配置・アイコンを足す | 紫グラデ／丸ピル／グロー（既存 UI と乖離） |
| レイアウト | textarea の下に **右寄せ** のアクション行。送信は主アクション | 入力欄右に縦置きの丸アイコンのみ（文言が消える） |
| アイコン | 送信を示す小さな SVG（紙飛行機風）をボタン内に置き、`aria-hidden`。可視テキストは「送信」のまま | アイコンのみ（スクリーンリーダー以外に意味が弱い） |
| 動き | hover で既存 `.primary:hover` 相当、`active` でわずかに沈む（`transform: translateY(1px)`）。`transition` は背景・色・transform。送信中は既存 `disabled`（opacity / wait） | 長いアニメ・パーティクル |
| 範囲 | **フロントの見た目のみ**。送信ロジック・disabled 条件（`composeInactive`）は変えない | API・文言「調べています…」の変更 |
| CSS 置き場 | `project-ai-chat.css` に `.ai-chat-compose` 配下のみ（L-792）。グローバルに無修飾 `button` を足さない | `styles.css` にチャット専用クラスを追加 |

### マークアップ（方針）

```html
<button type="submit" class="primary ai-chat-send" [attr.disabled]="…">
  <svg class="ai-chat-send-icon" aria-hidden="true" …>…</svg>
  送信
</button>
```

- `class="primary ai-chat-send"` で共通 primary ＋ compose 固有の余白・アイコン間隔。
- フォーカスは既存 `button:focus-visible`（accent outline）を維持（L-157）。
- 押下直後の二重送信は既存 `composeInactive` / `sending` に任せる（L-408）。見た目側で追加のクリック猶予は入れない。

### レイアウト詳細

- `.ai-chat-compose` はこれまでどおり grid。送信行は `.ai-chat-compose-actions { display: flex; justify-content: flex-end; }`。
- 狭いドック幅でもボタンが縮みすぎないよう `flex-shrink: 0`。
- 送信中（disabled）もラベルは「送信」のまま（状態は `.ai-chat-sending` の status 行が伝える）。

## 受け入れ条件

1. AIチャット（ドック／専用画面）の送信ボタンが、素のブラウザボタンではなくアプリの primary 強調に見える。
2. 送信ラベルに加え、装飾用アイコンがある（テキストは残る）。
3. hover / active の反応があり、disabled 時は押せない見た目のまま。
4. 送信の成否・二重送信防止・クレジットブロックなどの既存挙動が退行しない。
5. `project-ai-chat` 系の既存テストが通り、送信ボタンのクラス／disabled を固定するテストがある。

## 範囲外

- ストリーミング表示、ショートカットの変更、マイク入力。
- チャット全体のテーマ刷新。

## 今回パック（知見）

`L-001`, `L-058`, `L-157`, `L-408`, `L-522`, `L-605`, `L-792`

## 実装で触る主なファイル（予定）

- `frontend/src/app/project-ai-chat.html`
- `frontend/src/app/project-ai-chat.css`
- `frontend/src/app/project-ai-chat.spec.ts`
