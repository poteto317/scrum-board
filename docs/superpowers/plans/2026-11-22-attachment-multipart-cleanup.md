# 添付 multipart 一時ファイル後始末 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添付アップロード後に multipart 一時ファイルが残らないようにし、Cloud Run のメモリ枯渇を防ぐ。

**Architecture:** `createAttachment` で `ParseMultipartForm` 直後に `MultipartForm.RemoveAll()` を `defer`。TimeoutHandler 経由でもハンドラ内掃除で完結。

**Tech Stack:** Go, net/http, testing

**Spec:** `docs/superpowers/specs/2026-11-22-attachment-multipart-cleanup-design.md`

## Global Constraints

- L-575: `RemoveAll` のエラーを主結果に流さない（`_` で握りつぶす）
- **RemoveAll 失敗の注入テストは書かない**（設計の非目標。L-575 は本番 defer の戻り値無視だけで満たす）
- `/feature` 中はコミットしない
- OpenAPI / TimeoutHandler / blob 寿命は触らない

## ファイル対応

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/attachment_handler.go` | Parse 直後の defer RemoveAll |
| `backend/internal/kanban/attachment_handler_test.go` | TMPDIR 残骸テスト（201 / field400 / MaxBytes400） |

---

## Task 1: 失敗するテストを先に書く

**Files:** Modify `backend/internal/kanban/attachment_handler_test.go`

- [x] **Step 1:** ヘルパ `paddedPNG(minBytes int) []byte` — `pngBytes()` + ゼロパディングで長さが `minBytes` 以上。
- [x] **Step 2:** ヘルパ `countFiles(dir string) int` — ディレクトリ配下の通常ファイル数（再帰）。
- [x] **Step 3:** `TestCreateAttachmentRemovesMultipartTempFiles` を追加。
  - `tmpdir := t.TempDir()` のあと `t.Setenv("TMPDIR", tmpdir)`（`tmpdir` 変数を束縛して使う）
  - サブケース（各ケースで `before := countFiles(tmpdir)` を取り、復帰後 `after == before`）:
    1. `postPNG(..., paddedPNG(attachmentMultipartMaxMemory+1), nil)` → 201
    2. field=`title`（不正）+ `paddedPNG(attachmentMultipartMaxMemory+1)` → 400
    3. **Parse 時 MaxBytesError 経路**（`header.Size` チェックではない）:
       - ボディ全体が `attachmentMaxMultipartRequestBytes+1` 以上になるよう、`paddedPNG` にそのサイズを渡して file part を組み立てる（>1 MiB かつ MaxBytesReader 上限超）
       - 上限未満で 5 MiB 超のファイルだけだと `header.Size` 経路に落ちるので **使わない**
       - 期待: 400 かつ本文「画像は5MiB以下にしてください。」＋残骸なし
       - 注: 文言は Size 経路と同じだが、ペイロード設計で Parse 打ち切り経路に固定する
  - 既存 `postPNG` / 必要なら専用 multipart 組み立てを使う
- [x] **Step 4:** `cd backend && go test ./internal/kanban/ -run TestCreateAttachmentRemovesMultipartTempFiles -count=1` → **失敗**（RemoveAll 未実装のため残骸あり）を確認。

---

## Task 2: defer RemoveAll を入れる

**Files:** Modify `backend/internal/kanban/attachment_handler.go`

- [x] **Step 1:** `createAttachment` で **`commentParentItem` 成功後**、既存の MaxBytesReader 行を含めて次のように置き換える（`ParseMultipartForm` 直後・`if err != nil` の前。パース失敗で部分構築された `MultipartForm` も掃除）:

```go
r.Body = http.MaxBytesReader(w, r.Body, attachmentMaxMultipartRequestBytes)
err := r.ParseMultipartForm(attachmentMultipartMaxMemory)
if r.MultipartForm != nil {
	mf := r.MultipartForm
	defer func() { _ = mf.RemoveAll() }()
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
```

定数: `attachmentMultipartOverhead`（境界余白）と `attachmentMaxMultipartRequestBytes` を handler 側で定義し、テストも参照する。

**defer 登録順:** `RemoveAll` の defer を先に登録し、その後の既存 `defer file.Close()` より前に置く（LIFO で Close → RemoveAll）。他のロジックは変えない。

- [x] **Step 2:** 同テストを再実行 → 成功。
- [x] **Step 3:** `cd backend && go test ./internal/kanban/ -count=1` で添付関連を含むパッケージが通ることを確認。

---

## Task 3: 検証まとめ

- [x] **Step 1:** `cd backend && go test ./...`（またはプロジェクト慣例の検証）を実行し、失敗があれば直す。
- [x] **Step 2:** OpenAPI は変更なし（契約不変）。`update-api-doc` は不要。

## レビューで直せなかった指摘

なし（設計書・プランレビュー反映済み）。
