# /?project=N が共有 activeProjectId を変えない（#101）

## 背景

#86 で `/?project=` は `switchTo`（PATCH settings）で永続化していた。ボード設定の `activeProjectId` は**全員共有**のため、リンクを開くだけで他利用者のアクティブが変わる。

## 決めたこと

| 事項 | 採用 |
|------|------|
| inbound `/?project=` | **`viewFromDeepLink`** — `activeId` をローカル表示のみ更新、**PATCH なし** |
| 永続化 | ヘッダー／既存 UI からの **`switchTo` のみ**（手動操作） |
| ephemeral フラグ | `ProjectSession.ephemeralActiveView` — poll / reload は `api.board(activeId)`、syncActiveFromBoard は no-op |
| 同じ id の再選択 | ephemeral 中は `switchTo` を許可（共有 settings へ PATCH） |
| BE | 変更なし（GET `?projectId=` は既存） |

## 受け入れ条件

1. `/?project=2` を開いても `patchBoardSettings` が呼ばれない。
2. ローカル `activeId` は 2、他ユーザーの共有 active は変わらない（契約: PATCH 無し）。
3. ヘッダーで確定すると従来どおり PATCH。

## 知見

- **L-044**: 不正・未知は従来どおりエラー。
- **L-860 / L-037**: ephemeral 中も board 側 GET 対象を viewed id に固定。