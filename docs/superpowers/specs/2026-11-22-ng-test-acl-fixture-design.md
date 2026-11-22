# ng test 失敗修正（#137）

## 決めたこと

| 事項 | 採用 |
|------|------|
| 原因 | ACL 追加後、`normalizeItem` / `normalizeBoardData` が `viewAccess`/`editAccess` 等を付与するが、fixture の `card()` が旧形のまま `toEqual` で不一致 |
| 修正方針 | 本番コード変更なし。spec の `card()` を `normalizeItem(...)` 経由にする |
| `initialBoard` | `normalizeBoardData` でラップ（load 経路と同形） |
| ACL 契約テスト | `models.spec.ts` の `normalizeItem` に1本（挙動 spec には置かない） |
| 対象 | `board-card-reorder-state.spec.ts`、`board-layout-switch.spec.ts`、`models.spec.ts` |
| 受入 | `cd frontend && npx ng test --watch=false` が 0 failed |

## 知見

- 正規化後の形と生 fixture の比較は壊れやすい。テスト用カードは正規化関数経由にする。
