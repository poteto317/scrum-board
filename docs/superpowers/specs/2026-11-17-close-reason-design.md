# Close 理由（アイテム #48）

## 背景

ボードに `Close` 列があるが、Close した理由を残す場所がない。カード要件は (1) Close するときに理由を入れられること、(2) すでに Close のアイテムでも理由を編集できること。

## 決めたこと

| 事項 | 採用 |
|------|------|
| 保存場所 | アイテムに **`closeReason`（string）** を永続化。ボード／詳細／by-number の JSON に含める（1A） |
| 必須 | **任意**。空文字でも Close 可。前後空白は trim（2B） |
| 詳細 UI | Close へ変えたとき **理由入力モーダル**（空確定可）。既に Close なら詳細に理由テキストエリアを常時表示し **自動保存**（3A） |
| 他列へ戻す | 理由は **保持**。表示は Close 中のみ（4A） |
| DnD／列移動 | ボード・バックログのドラッグ等では **理由なしで Close 可**。理由の入力・編集は詳細のみ（5B） |
| 履歴 | `closeReason` の新規／変更を履歴 `changes` に残す（6A） |
| Close 列の判定 | 列名が **`Close`（完全一致）** のとき理由 UI を出す。列の改名・削除は本機能の対象外 |

## 目的と受け入れ条件

1. アイテム JSON に `closeReason: string` がある（未設定相当は `""`）。
2. `PATCH /api/items/{id}` で `closeReason` を部分更新できる。省略／null は変更しない。文字列を送ると **trim 後**に保存。最大長は **trim 後の Unicode 文字数 2000**（description と同じ数え方。超過は 400）。未知キーは既存どおり 400。
3. 詳細でステータスを非 Close → Close に変えると、理由モーダルが出る。初期値は **現在保存済みの `closeReason`**（他列滞在中に保持していた値）。確定で `columnId`（Close）とモーダル内容（空可＝`""` で上書き）を保存する。キャンセルでステータス選択を元に戻し、保存しない（保持していた理由も変えない）。
4. モーダル確定の保存が失敗したら、成功扱いしない（L-001）。ステータス select を変更前に戻し、`closeReason` も確定前の値のままにする。エラーを表示する。
5. 詳細で既に Close のとき、理由テキストエリアが表示され、**title／description と同じ autosave フォーム欄**としてデバウンス自動保存する（side フィールドにはしない。L-453 シールド対象外）。
6. Close 以外のステータスでは理由欄を出さない（値は DB に残る）。
7. ボード／バックログの DnD や `PATCH .../status` で Close へ移しても理由は求めない（空のまま可）。詳細で後から編集できる。
8. （決めたこと 6A）`closeReason` が変わったとき履歴に `updated`（field: `closeReason`）が付く。未変更なら履歴を増やさない。カード本文に無いが設計で採用。
9. ライブ再取得中に理由を編集中なら、未保存の下書きを古い GET で上書きしない（既存 autosave／世代の扱いと同じ。L-037 / L-040）。
10. 初期スキーマと既存 DB の両方で列が追加され、既存行は `""`。

## 永続化

- DB: `items.close_reason TEXT NOT NULL`（DEFAULT `''`）。description と同様 TEXT。起動時マイグレーション（`assignee` と同様の `InitializeCloseReason`）で不足時に `ADD COLUMN close_reason TEXT NOT NULL DEFAULT ''`。
- `001_schema.sql` にも同列を追加する。
- API フィールド名は camelCase `closeReason`。旧キーや別表記は未知として 400。
- `PATCH .../status` は現状どおり `status` のみ。理由は付けない（5B）。

## クライアント挙動

- モデル `Item` と autosave の **form フィールド**に `closeReason` を載せる（`fields` に含める）。
- ステータス select の change:
  - 次が Close で現在が非 Close → モーダル（初期値＝現在の `closeReason`）。確定は autosave flush ではなく **専用 PATCH**（`columnId` + `closeReason`）。並走中の form flush は `dropInFlight` で破棄し、応答でローカルを更新する。失敗時は columnId を変更前に戻し closeReason も確定前のまま（受け入れ 4）。キャンセルで form の columnId を戻し、closeReason は触らない。
  - 既に Close 同士／Close 以外への変更 → 既存どおり columnId のみ autosave（理由欄の表示だけ出し分け）。
- Close 中の理由欄: form の `closeReason` を編集し、title と同じデバウンスで保存。
- ボード／バックログ UI は変更しない（理由表示・入力なし）。カードに理由を出さない（初版）。

## 対象外

- Close 以外の列での理由
- 理由の必須化
- DnD 時の理由モーダル
- Close 列の改名・複数 Close 列
- ボード上への理由プレビュー／ツールチップ（初版）

## 知見（実装時）

- L-001: 保存成否を見てから成功扱い。失敗時にステータス／理由を勝手に確定しない。
- L-037 / L-040: 詳細のライブ再取得と理由編集の世代ガード。
- L-453 / L-790: 理由は form 内のため side シールドは不要。並走する PR／related の side 保存とは既存ルールのまま。
- L-002: 未設定と空文字を区別して破壊しない（本機能は空文字で統一）。
