# ハンバーガーメニューが副次ページで空になる（#142）設計

## 背景

チケット「ハンバーガーメニューの表示が少ない」: かんばんやバックログ以外では、メニュー設定しか表示されない。

調査（コード）:

- `HEADER_MENU_CATALOG` の `open_*`（プロジェクト／ゴミ箱／アーカイブ／ユーザー／繰り返し／設定）は `pageKinds: ['board','backlog','itemDetail']`（`header-menu.ts`）。
- `resolvePageKind` は `/trash` `/archive` `/users` `/projects` `/recurring` `/settings` `/login` を **明示的に `null`** にしている（当初設計: 未知ルートと同様、アクション空・「メニュー設定」のみ）。
- `HeaderMenuComponent.visibleIds()` は `pageKind === null` で `[]` を返す。HTML の「メニュー設定」はカタログ外の常時行。
- 結果: 副次ページではナビ項目が一切出ず、設定だけ見える（チケット症状と一致）。
- 初版仕様（`2026-11-19-header-hamburger-menu-design.md`）は `null` 時アクション空を意図していたが、その後 `open_*` ナビがカタログに載ったのに、副次ルート側の `pageKind` が追従していない。

## 目的と完了条件（チケット）

1. `/trash` `/archive` `/users` `/projects` `/recurring` `/settings` でハンバーガーを開くと、**ボードと同じ `open_*` カタログ**（hiddenIds 適用後）が表示される。
2. 「メニュー設定」は従来どおり常時表示。設定セレクトの初期値は現在の `pageKind`（副次ページでは `board`）。
3. `/login` および未知ルートは従来どおり `pageKind === null`（アクション空・設定のみ）。アイテム詳細の `item_*` は副次ページに出さない。
4. API／prefs スキーマ（`board` / `backlog` / `itemDetail` の 3 キー）は変更しない。
5. 回帰テストで上記ルートの `resolvePageKind` と、副次ルートでの可視メニュー ID を固定する。

## 決めたこと

### 1. 副次ルートを `board` にマップする（必須・推奨）

- `resolvePageKind` で次を `'board'` に返す:
  - `/trash` `/archive` `/users` `/projects` `/recurring` `/settings`
- `/login` は `null` のまま（認証前シェル。ナビを出さない）。
- 未知・不正パスは `null` のまま。
- **新 PageKind や prefs キーは追加しない**（API・Session・BE バリデーションを触らない）。副次ページはボードと同じカタログと `board.hiddenIds` を共有する。

採用理由: `open_*` は既に board カタログと同一集合。別 `shell` キーを増やすと PUT 契約・正規化・設定 UI が膨らむだけで、チケット要件を超える。

### 2. コンポーネント変更は最小

- `visibleIds` / 設定同期は既存の `pageKind` 信号に追従するだけなので、**`resolvePageKind` とテスト更新が主変更**。
- 現在ページ自身への `open_*`（例: `/trash` 上の「ゴミ箱」）を隠す特別扱いは **しない**（範囲外。クリックは no-op または同ページ再ナビで既存ルータ挙動に任せる）。

### 3. 回帰テスト

- `header-menu.spec.ts`: 上記 6 ルート → `'board'`、`/login` → `null`、未知 → `null`。
- `visibleMenuItemIds('board', …)` が副次ルートでも同じ ID 集合になることを、`resolvePageKind` 経由で断言（L-060）。
- `recurring.spec.ts` の `resolvePageKind('/recurring') is null` を **`'board'` 期待に更新**。
- **必須** `header-menu.component.spec.ts`: Router URL を `/trash` に同期（`pageKind.set` 直書き禁止）。`open_projects` 等の menuitem 可視テキスト（L-515: `#header-menu-item-*` / `textContent`）と、設定セレクト初期値 `#header-menu-page-kind` = `board`（完了条件 2）を 1 件で固定。
- BE・Session・API テストは変更不要（契約不変）。

### 4. 変異テスト（検知力・L-175）

1. 変異前に対象テストが green。
2. 副次ルートの `'board'` 戻りを `null` に戻す（または該当 `if` を削る）変異を当て、差分で狙った箇所だけ変わったことを確認。
3. 更新した `resolvePageKind` テストが期待どおり落ちる（KILLED）ことを失敗ログで確認。
4. 控えから復元し `cmp -s` で一致（`git checkout` / `git restore` は使わない）。

## 範囲外

- 新 PageKind / prefs キー追加、設定 UI の 4 種別化。
- 現在ページの `open_*` をメニューから除外するハイライト／disabled。
- `/login` でのナビ表示。
- メニュー項目の並び替え、カタログ ID の追加・削除。
- AI チャットの `AiChatPageKind`（別系統）の変更。

## 気をつける知見

- **L-060 / L-175**: ルート→pageKind と副次ページでのメニュー出現をテスト＋変異で固定。
- **L-515**: メニュー項目は `#header-menu-item-*` または `toHaveTextContent` で可視ラベルを見る（aria-label 依存だけにしない）。
- **L-925**: App ホスト配線は触らない想定。触る場合はホスト結合を残す。
- **L-015 / L-669**: prefs PUT 契約は不変（3 キー全体）。本変更では Session を触らない。
