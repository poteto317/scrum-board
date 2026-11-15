# コマンド1件時ワンクリックコピー実装プラン（カード #44）

> **For agentic workers:** **Spec:** `docs/superpowers/specs/2026-11-15-one-command-click-copy-design.md`  
> **コミットしない**（`/feature`）。知見: L-001、generation ガード、ClipboardItem で user activation 維持

**Goal:** 紐付け1件ならボード／詳細のコマンドボタンで即コピー。0件・失敗・2件以上は既存メニュー／エラー。

**Architecture:** ボードはクリック時 `ClipboardItem` 優先（一覧1件のみ本文解決）。非対応・0件・複数・失敗はメニュー経路（`openCommandMenuAfterList`）。詳細は preload 済みテンプレで1件即コピー。

## ファイルマップ

| パス | 責務 |
|------|------|
| `frontend/src/app/board.ts` | ClipboardItem 即コピー／メニューフォールバック |
| `frontend/src/app/board.spec.ts` | 1件／複数／0／失敗／generation キャンセル |
| `frontend/src/app/card-detail.ts` | 1件即コピー、0・複数・loading・error はメニュー |
| `frontend/src/app/card-detail.spec.ts` | 同上 |
| `frontend/src/app/copy-command-feedback.ts` | `announce(ok)`（ClipboardItem 成功時） |

API・DB・管理 UI は触らない。

---

### Task 1: board — ClipboardItem + フォールバック

1. テスト: 1件即コピーでメニューが残らない／複数はメニュー／閉じた後は自動コピーしない
2. `toggleCommandMenu`: `ClipboardItem`+`clipboard.write` で1件本文を Promise 解決。それ以外は `openCommandMenuAfterList`
3. フォールバックで1件なら `closeMenuAndCopyCommand`、失敗は `commandMenuError`
4. コールバックは `NgZone.run`

**Done when:** board 関連テスト緑。

---

### Task 2: card-detail — 1件時即コピー

1. テスト: 1件はメニューを開かずコピー、複数はメニュー
2. `toggleCommandMenu`: loading/error はトグル、1件は `copyCommand`、他はトグル

**Done when:** detail 関連テスト緑。

---

### Task 3: 検証

```sh
cd frontend && npm test -- --watch=false
```

**Done when:** FE テスト一式が通る。

## サブエージェントレビュー済み

- 実装に合わせて ClipboardItem／announce／命名を反映済み。
