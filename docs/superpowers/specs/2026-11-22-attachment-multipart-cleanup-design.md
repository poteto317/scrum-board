# 設計: 添付 multipart 一時ファイルの後始末

- 日付: 2026-11-22
- 対象: scrum-board #91
- ステータス: 承認済み（/feature 自動承認）

## 背景と問題

`createAttachment` は `ParseMultipartForm(1 MiB)` を使い、超過分を OS 一時ファイルへ書く。成功・失敗のどちらの経路でも `MultipartForm.RemoveAll()` を呼んでいない。

本番は `http.TimeoutHandler` と認証 middleware が `r.WithContext(...)` でリクエストをコピーする。Go の `Server` が返す自動後始末は **元の Request** に対してだけ走るため、ハンドラ側でセットした `MultipartForm` は掃除されない。

影響: Cloud Run の `/tmp` はメモリ上（インスタンス 512 MiB）。1〜5 MiB のアップロードが溜まるとメモリ不足で落ちる。検証で 400 になった場合も残る。

場所: `backend/internal/kanban/attachment_handler.go`（`createAttachment`）

## 完了条件（受け入れ）

- アップロード処理の終了後、当該リクエストが作った multipart 一時ファイルが残らない。対象経路:
  1. 正常アップロード（201）
  2. パース成功後のバリデーション失敗（例: 不正 `field` → 400）
  3. multipart パース失敗: `http.MaxBytesReader` 上限（`attachmentMaxBytes + attachmentMultipartMaxMemory + 64*1024`）超のボディで `MaxBytesError` → 400。file part 本文は >1 MiB を含む
- 業務エラー（`CreateAttachment` 失敗など）も同じ `defer` で掃除される。自動テストでの固定は必須としない（defer がパース直後に掛かっていれば足りる）。
- 上記 1〜3 を自動テストで固定する（一時ディレクトリを差し替え、ハンドラ復帰後に残骸が無いこと）。**残骸を見るケースはいずれも** part 本文が `attachmentMultipartMaxMemory`（1 MiB）を超える multipart を POST する。
- `RemoveAll` の失敗は主処理の成否や既存の HTTP エラーを置き換えない（L-575）。失敗注入テストは非目標。

## 決めたこと（推奨案を採用）

| 事項 | 採用 | 却下 |
| --- | --- | --- |
| 直し方 | `commentParentItem` 成功かつ `r.Body = http.MaxBytesReader(...)` の**後**、`ParseMultipartForm` の直後（`err` 分岐の前）に、`MultipartForm != nil` なら `defer` で `RemoveAll()` | `MultipartReader` への全面書き換え |
| 失敗時 | パース失敗でも `MultipartForm` が非 nil なら同じ `defer` で掃除 | 成功時だけ掃除 |
| `RemoveAll` のエラー | 無視（戻り値を捨てる）。ログも必須にしない | 失敗を 500 にしたりレスポンスを差し替えたりする |
| 対象ハンドラ | `createAttachment` のみ | 全ハンドラへの汎用 middleware |
| Timeout/認証のコピー | 今回は触らない。ハンドラ内 `defer` で完結 | TimeoutHandler の差し替え |

## アプローチ比較（要約）

1. **`defer MultipartForm.RemoveAll()`（採用）** — 完了条件を最小差分で満たす。標準の推奨。
2. **`MultipartReader` ストリーム** — 一時ファイル自体を作らないが、FormFile / フィールド検証の書き換えが広い。
3. **カスタム TempDir の起動時掃除** — リークの根本を直さず、他プロセスのファイルを誤削除しうる。

## 振る舞い

差し込み位置の制約: `commentParentItem` が成功して return していないこと、および既存の `MaxBytesReader` 代入の**後**。パース前に置くと `MultipartForm` が常に nil で defer が掛からない。

実装はこの形のみ:

```go
r.Body = http.MaxBytesReader(w, r.Body, attachmentMaxBytes+attachmentMultipartMaxMemory+64*1024)
err := r.ParseMultipartForm(attachmentMultipartMaxMemory)
if r.MultipartForm != nil {
    defer func() { _ = r.MultipartForm.RemoveAll() }()
}
if err != nil {
    var maxBytes *http.MaxBytesError
    if errors.As(err, &maxBytes) {
        invalid(w, "画像は5MiB以下にしてください。")
        return
    }
    invalid(w, "multipart の形式を確認してください。")
    return
}
// ... 既存のフィールド検証・FormFile・CreateAttachment ...
```

`MultipartForm` の寿命:

- パース成功時は非 nil。
- パースエラー時は nil のことも、部分的に残って非 nil のこともある。
- どちらの場合も **非 nil なら必ず** 同じ `defer` で掃除する。

`FormFile` で開いたファイルは既存どおり `defer file.Close()`。`RemoveAll` の `defer` を先に登録し、その後に `Close` を登録する（LIFO で Close → RemoveAll）。

## テスト方針

- `t.Setenv("TMPDIR", t.TempDir())` で差し替え（復元は `testing.T` に任せる。手動 `os.Setenv` 復元は使わない）。
- **残骸アサート付きケースはすべて** part 本文 > 1 MiB の multipart を POST する。
- 大容量本文の作り方: 既存 `pngBytes()` の後ろに無害なパディングバイトを足して >1 MiB にする（`detectImageMIME` は先頭マジックのみ見る想定）。ケース 1・2 はこれで MIME / PNG 検証を通す。
- 必須ケース:
  1. 正常アップロード（201）→ TMPDIR に残骸なし
  2. バリデーション失敗（不正 `field` → 400）→ 同上（本文は >1 MiB PNG パディング）
  3. パース失敗: MaxBytesReader 上限超ボディ（file part >1 MiB を含む）→ 400 → 同上
- 既存の添付ハンドラテストは壊さない。

## 非目標

- GCS / Memory blob の寿命やゴミ箱 purge の変更
- TimeoutHandler / 認証 middleware の Request コピー挙動の変更
- OpenAPI の契約変更（レスポンス形状は不変）
- `RemoveAll` 失敗の注入テスト（L-575 は本番の `defer` 内で戻り値を無視するだけで満たす）
- 形式不正 multipart 専用の残骸テスト（ケース 3 は MaxBytes に一本化）

## 知見（手順 4）

- **L-575**: 後始末の失敗を主処理の結果に流さない → `RemoveAll` のエラーは握りつぶす。失敗注入テストは非目標。
- 一時ファイルの「自分の資源だけ消す」系知見は、今回は stdlib が作った multipart 一時を `RemoveAll` でまとめて消すだけなので直接適用しない。起動時の汎用掃除はしない。

## リスクと制約

- `httptest` 単体では TimeoutHandler を通さないが、ハンドラ内 `defer` なら本番のコピー経路でも有効。
- MaxBytes でボディ読取中に打ち切られた場合、一時ファイルが作られないこともある。その場合残骸アサートは「増えていない」ことで足りる。
