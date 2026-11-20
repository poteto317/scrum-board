# プロジェクトセレクトの UI 改善（#80）

## 背景

カード: https://scrum-board-jkcejsb6ka-an.a.run.app/items/80?project=1

ヘッダーのプロジェクト切替はネイティブ `<select>` である。選択中がリストの下の方だと、ブラウザがポップアップを上方向に開いたり選択行を中央寄せしたりして、**画面上端で選択肢が見切れる**。利用者は「選択肢は下に出したい」「**現在のプロジェクトは選択肢の先頭**にしたい」。

関連:

- `docs/superpowers/specs/2026-11-20-project-switch-perf-design.md` — 先読みは focus／pointerdown。当時はカスタム UI を非目標とした。本カードでカスタム化する。
- `ProjectSession` / `switchTo` / L-842 / L-040 — 切替契約は維持する。
- `HeaderMenu` — 外側クリック・Escape・popover 配置の既存パターンを参考にする（見た目のコピーはしない）。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 開く方向 | **常にトリガーの下**。上方向へフリップしない。下側の余白が少ないときは `max-height` を残りビューポートに合わせ、リスト内スクロールする |
| 実装手段 | ネイティブ `<select>` をやめて **カスタム listbox**（トリガーボタン + 絶対配置のオプション一覧） |
| 現在プロジェクトの位置 | **表示順のみ**先頭。API の `position` / 並び替え API は変えない |
| 他プロジェクトの順 | 先頭の現在以外は既存どおり `position` 昇順（同値は `id`） |
| 切替・先読み | 既存の `switchTo` を維持。先読みは **トリガーの focus と pointerdown のみ**（listbox を「開く」操作そのものでは追加呼び出ししない。開く直前に pointerdown／focus が既に走っているため） |
| 識別子 | 選択・切替は常に **project.id**（表示位置の index は使わない。L-035） |
| 対象画面 | ヘッダーのプロジェクト切替のみ。item-detail の所属プロジェクト UI は対象外 |
| キーボード（閉） | Enter／Space／ArrowDown で開く。ArrowUp は開かない（無視） |
| キーボード（開） | ArrowDown／Up はハイライト移動のみ。Enter で決定して閉じる。Space は決定せず閉じるだけ。Escape で閉じる（決定しない） |
| 開中の欠落 | 開いている間に `activeId == null` または projects が空になったら **即座に閉じてプレースホルダ（disabled）へ戻す**。listbox は継続しない |

### 検討したが採らなかった案

- **ネイティブ `<select>` のまま option 順だけ現在を先頭にする**: 一部ブラウザでは改善するが、開く方向を制御できない。受け入れ「下に表示」を満たせない。
- **`size` 付き native select を常時展開**: ヘッダーを壊す。却下。
- **下に足りなければ上へフリップ**: カード文言と逆。却下。
- **API で現在プロジェクトの position を 0 に更新**: 利用者の並び替え意図と衝突する。表示専用で足りる。

## 目的と受け入れ条件

1. ヘッダーでプロジェクト一覧を開くと、オプションは **トリガー直下** に現れ、ビューポート上端で見切れない（長い一覧はリスト内スクロール）。
2. 開いた一覧の **先頭オプションは現在のアクティブプロジェクト**。それ以外は `position` 順。
3. オプション選択で既存どおり `ProjectSession.switchTo(id)` が走り、失敗時は表示上の選択が activeId に戻る（L-001）。
4. トリガーの focus または pointerdown で、現行と同等の他プロジェクト先読みが走る（「開く」専用の第3トリガは足さない）。
5. `switching` / モーダル開閉 / `saving` 中はトリガーが disabled（または同等に操作不可）で、現行 select と同じ拒否。
6. キーボードは「決めたこと」表のとおり。外側クリックでも閉じる（決定しない）。閉じたあとフォーカスはトリガーへ戻す（外側クリックで閉じた場合はフォーカス移動しないでもよい）。
7. スクリーンリーダー向けにトリガーは `aria-haspopup="listbox"`、`aria-expanded`、一覧は `role="listbox"`、各案は `role="option"`、`aria-selected`。ラベルは既存の「プロジェクト」。
8. bootstrap 前／projects 空／activeId 欠落時のプレースホルダ（`…` disabled）は現行と同じ意味を保つ。開中に欠落したら閉じてプレースホルダへ戻す。
9. FE テストで少なくとも次を固定する: (a) アクティブが末尾でも一覧先頭がアクティブ名、(b) 開いた直後、パネルの上辺がトリガーの下辺以上（`getBoundingClientRect` で `panel.top >= trigger.bottom`）、(c) option クリックで `switchTo` 相当の API が呼ばれる、(d) Escape／外側で閉じる。

## 非目標

- プロジェクトの永続並び替え・DnD
- item-detail 内のプロジェクト移動 UI の見た目変更
- バックエンド API・DB 変更
- ヘッダーメニュー全体の再設計
- モバイル専用の別 UI（狭い画面でも同じ「下開き + 先頭が現在」でよい）

## UI 構造（概要）

```
.project-switcher
  label.sr-only[for=project-select-trigger]
  button#project-select-trigger[aria-controls=project-select-list]
  @if open
    ul#project-select-list[role=listbox]  // position:absolute; top:100%; left:0;
      li[role=option] × N   // [0]=active, then others by position
```

- トリガー幅・フォントは現行 `.project-switcher select` に近い見た目を維持する。
- パネルの `z-index` は sticky ヘッダー（`z-index: 5`）より前面に出る値にする。
- 開いている間に `activeId` が正のまま projects が更新されたら、表示順を再計算する。ハイライトは **id + 位置の組**（L-035）: 並び替え後も同じ id が候補にあればその行を選び直し、消えていれば表示リスト末尾へ clamp（空なら閉じる）。`activeId` が null になるか projects が空なら閉じる（上表）。

## 表示順の純関数

```ts
function projectsForSelectDisplay(projects: Project[], activeId: number | null): Project[] {
  const sorted = sortProjects(projects); // 既存: position, id
  if (activeId == null) return sorted;
  const current = sorted.find((p) => p.id === activeId);
  if (!current) return sorted;
  return [current, ...sorted.filter((p) => p.id !== activeId)];
}
```

`ProjectSession.projects()` の保存順は従来どおり `sortProjects` のまま。表示用にだけ並べ替える（セッション信号を書き換えない）。

## 知見（手順 4）

- **L-001**: 切替失敗時にトリガー表示を activeId に戻す／成功時だけ後続。
- **L-035**: ハイライト・決定は project.id。表示 index を状態にしない。
- **L-040 / L-842**: 先読みと `switchTo` の世代・busy 順は既存実装を触らない（UI 差し替えのみ）。
- **L-002**: bootstrap 前の空を「プロジェクト 0 件」と誤らない（現行プレースホルダ維持）。

## テスト方針

- `app.spec.ts` の `#project-select` 前提を、トリガー + listbox に更新。
- 新規または同ファイルに「active が position 末尾でも list 先頭が active」「panel が trigger の下」「外側クリックで閉じる」を追加。
- 可能なら表示順ヘルパを単体テスト（純関数）。

## リスク

- カスタム listbox は a11y を自前で揃える必要がある。ヘッダーメニューの外側クリック／Escape パターンを流用し、過剰な共通化はしない。
- sticky ヘッダー直下のため「下開き」でもボード内容に被るのは意図どおり（ネイティブも同様）。
