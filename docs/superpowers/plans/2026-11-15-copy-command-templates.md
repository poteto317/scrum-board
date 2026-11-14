# ワンクリックコマンド取得 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **`/feature` 実行中はコミットしない。**

**Goal:** グローバルなコマンドテンプレートを DB に UTF-8 文字列として安全に保存し、ボード／詳細から `{{url}}` 置換後の文字列をワンクリックでクリップボードへ入れる。

**Architecture:** MySQL `command_templates` ＋起動時マイグレーション。CRUD は `/api/command-templates`。正規化は Go のみ。URL 置換はフロントの純粋関数。コピーは既存 `copyText`。サーバーは実行・eval しない。

**Tech Stack:** Go / MySQL / Angular 21 / Vitest / Clipboard API

**Spec:** `docs/superpowers/specs/2026-11-15-copy-command-templates-design.md`

## Global Constraints

- テンプレートはグローバル一覧（カードごとではない）。全体最大 50 件。
- プレースホルダはリテラル `{{url}}` のみ。置換はフロントのみ。
- name: trim・1〜60 Unicode・制御文字禁止・不正 UTF-8 禁止。template: trim しない・1〜2000 Unicode・制御文字禁止（LF/TAB 含む）・不正 UTF-8 禁止。
- JSON は文字列のみ。`null`・数値・配列・オブジェクト・未知フィールドは 400（`decode` の `DisallowUnknownFields`＋型）。
- 永続化はプレースホルダ SQL のみ。ログに template 全文を出さない。
- バックログ対象外。履歴に載せない。
- 知見: L-001, L-017, L-018, L-057, L-060, L-083, L-108, L-203。
- `/feature` のため各タスク末尾で git commit しない。

## File Map

| ファイル | 責務 |
| --- | --- |
| `backend/internal/kanban/command_template.go` | 型・Normalize・件数上限定数 |
| `backend/internal/kanban/command_template_migrate.go` | `InitializeCommandTemplates` |
| `backend/internal/kanban/command_template_repo.go` | MySQL CRUD |
| `backend/internal/kanban/command_template_handler.go` | HTTP CRUD |
| `backend/internal/kanban/model.go` | `Repository` に CRUD 追加 |
| `backend/internal/kanban/handler.go` | ルート登録 |
| `backend/cmd/server/main.go` | 起動時 Initialize |
| `backend/internal/kanban/handler_test.go` | `memoryRepo` にテンプレート実装 |
| `backend/internal/kanban/command_template*_test.go` | 単体・handler・統合 |
| `frontend/src/app/command-template.ts` | 型・`resolveCommand`・文言定数 |
| `frontend/src/app/command-template.spec.ts` | `resolveCommand` テスト |
| `frontend/src/app/copy-command-feedback.ts` | コピー＋2s live（destroy-safe） |
| `frontend/src/app/api.ts` / `models` 必要なら | API メソッド |
| `frontend/src/app/board.*` / `card-detail.*` | メニュー・管理ダイアログ |
| `docs/api.md` / `README.md` / `docs/verification.md` | ドキュメント |

---

### Task 1: BE 正規化＋永続化＋マイグレーション

**Files:**
- Create: `backend/internal/kanban/command_template.go`
- Create: `backend/internal/kanban/command_template_migrate.go`
- Create: `backend/internal/kanban/command_template_repo.go`
- Create: `backend/internal/kanban/command_template_test.go`
- Create: `backend/internal/kanban/command_template_integration_test.go`（DSN 未設定は skip）
- Modify: `backend/internal/kanban/model.go`（Repository メソッド追加）
- Modify: `backend/cmd/server/main.go`（Initialize 連鎖）
- Modify: `backend/internal/kanban/handler_test.go`（memoryRepo 実装）

**Interfaces:**
- Consumes: 既存 `MySQLRepository`、`fail`/`ErrNotFound` パターン
- Produces:
  - `const MaxCommandTemplates = 50`
  - `type CommandTemplate struct { ID int64; Name string; Template string; Position int }`
  - `type CommandTemplateInput struct { Name string; Template string }`
  - `type CommandTemplatePatch struct { Name *string; Template *string }`
  - `NormalizeCommandTemplateName(raw string) (string, bool)`
  - `NormalizeCommandTemplateBody(raw string) (string, bool)`
  - `ErrCommandTemplateLimit`（件数超過）
  - Repository: `ListCommandTemplates`, `CreateCommandTemplate`, `UpdateCommandTemplate`, `DeleteCommandTemplate`
  - `InitializeCommandTemplates(ctx) error`

- [ ] **Step 1: 正規化の失敗テストを書く**

`command_template_test.go`:

```go
package kanban

import (
	"strings"
	"testing"
)

func TestNormalizeCommandTemplateName(t *testing.T) {
	ok, _ := NormalizeCommandTemplateName("  hello  ")
	if v, good := NormalizeCommandTemplateName("  hello  "); !good || v != "hello" {
		t.Fatalf("trim: %q %v", v, good)
	}
	_ = ok
	if _, good := NormalizeCommandTemplateName(""); good {
		t.Fatal("empty should fail")
	}
	if _, good := NormalizeCommandTemplateName(strings.Repeat("あ", 61)); good {
		t.Fatal("61 runes should fail")
	}
	if _, good := NormalizeCommandTemplateName("a\nb"); good {
		t.Fatal("control should fail")
	}
	if _, good := NormalizeCommandTemplateName(string([]byte{0xff, 0xfe})); good {
		t.Fatal("invalid utf8 name should fail")
	}
}

func TestNormalizeCommandTemplateBody(t *testing.T) {
	if v, good := NormalizeCommandTemplateBody("  keep spaces  "); !good || v != "  keep spaces  " {
		t.Fatalf("no trim: %q %v", v, good)
	}
	if _, good := NormalizeCommandTemplateBody(""); good {
		t.Fatal("empty should fail")
	}
	if _, good := NormalizeCommandTemplateBody(strings.Repeat("x", 2001)); good {
		t.Fatal("2001 should fail")
	}
	if _, good := NormalizeCommandTemplateBody("line\nbreak"); good {
		t.Fatal("LF should fail")
	}
	if _, good := NormalizeCommandTemplateBody(string([]byte{0xff, 0xfe})); good {
		t.Fatal("invalid utf8 body should fail")
	}
}
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd backend && go test ./internal/kanban -run 'TestNormalizeCommandTemplate' -count=1`  
Expected: FAIL（未定義）

- [ ] **Step 3: 正規化＋型＋エラーを実装**

`command_template.go`:

```go
package kanban

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"
)

const (
	MaxCommandTemplates     = 50
	maxCommandTemplateName  = 60
	maxCommandTemplateBody  = 2000
)

var ErrCommandTemplateLimit = errors.New("command template limit")

type CommandTemplate struct {
	ID       int64  `json:"id"`
	Name     string `json:"name"`
	Template string `json:"template"`
	Position int    `json:"position"`
}

type CommandTemplateInput struct {
	Name     string `json:"name"`
	Template string `json:"template"`
}

type CommandTemplatePatch struct {
	Name     *string `json:"name"`
	Template *string `json:"template"`
}

func NormalizeCommandTemplateName(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	value := strings.TrimSpace(raw)
	if value == "" || utf8.RuneCountInString(value) > maxCommandTemplateName {
		return "", false
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return value, true
}

func NormalizeCommandTemplateBody(raw string) (string, bool) {
	if !utf8.ValidString(raw) {
		return "", false
	}
	if raw == "" || utf8.RuneCountInString(raw) > maxCommandTemplateBody {
		return "", false
	}
	for _, r := range raw {
		if unicode.IsControl(r) {
			return "", false
		}
	}
	return raw, true
}
```

正規化テストに不正 UTF-8（例: `string([]byte{0xff, 0xfe})`）で `good == false` のケースを name / body 両方に追加する。

- [ ] **Step 4: Repository インターフェースと memory / MySQL / migrate**

`model.go` の `Repository` に追加:

```go
ListCommandTemplates(context.Context) ([]CommandTemplate, error)
CreateCommandTemplate(context.Context, CommandTemplateInput) (CommandTemplate, error)
UpdateCommandTemplate(context.Context, int64, CommandTemplatePatch) (CommandTemplate, error)
DeleteCommandTemplate(context.Context, int64) error
```

`command_template_migrate.go`: `CREATE TABLE IF NOT EXISTS command_templates (...)`（設計書の DDL）。

`command_template_repo.go`:
- List: `ORDER BY position ASC, id ASC`
- Create: 件数 `COUNT(*)` が `MaxCommandTemplates` 以上なら `ErrCommandTemplateLimit`。`position = COALESCE(MAX(position),-1)+1`。プレースホルダのみ。
- Update: 存在する行を部分更新。無い id → `ErrNotFound`
- Delete: RowsAffected 0 → `ErrNotFound`

`handler_test.go` の `memoryRepo` に同等のインメモリ実装（`templates []CommandTemplate` + `nextTemplateID`）。

`main.go`: `InitializeAssignee` / `InitializeHistory` の後に `InitializeCommandTemplates`。

- [ ] **Step 5: 正規化テスト＋統合（任意）を通す**

Run: `cd backend && go test ./internal/kanban -run 'TestNormalizeCommandTemplate' -count=1`  
Expected: PASS

統合: `KANBAN_TEST_DSN` があるときだけ `Initialize` → Create/List/Update/Delete → 51 件目で limit。無ければ `t.Skip`。

- [ ] **Step 6: コミットしない**（`/feature`）

---

### Task 2: BE HTTP CRUD

**Files:**
- Create: `backend/internal/kanban/command_template_handler.go`
- Create: `backend/internal/kanban/command_template_handler_test.go`
- Modify: `backend/internal/kanban/handler.go`（ルート）
- Modify: `backend/internal/kanban/http_transport.go`（`fail` に `ErrCommandTemplateLimit` → 400）

**Interfaces:**
- Consumes: Task 1 の Normalize / Repository / `decode` / `reply` / `fail` / `invalid`
- Produces: ルート
  - `GET /api/command-templates` → `{ "templates": [...] }`
  - `POST /api/command-templates` → 201
  - `PATCH /api/command-templates/{id}` → 200
  - `DELETE /api/command-templates/{id}` → 204

- [ ] **Step 1: handler テストを書く（先にルート未登録で失敗）**

```go
func TestCommandTemplatesCRUD(t *testing.T) {
	r := fresh()
	h := NewHandler(r)

	w := request(h, "GET", "/api/command-templates", "")
	if w.Code != 200 {
		t.Fatalf("list empty: %d %s", w.Code, w.Body.String())
	}

	w = request(h, "POST", "/api/command-templates", `{"name":"gh","template":"gh pr view {{url}}"}`)
	if w.Code != 201 {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var created CommandTemplate
	if err := json.Unmarshal(w.Body.Bytes(), &created); err != nil || created.ID == 0 || created.Name != "gh" {
		t.Fatalf("created: %+v err=%v", created, err)
	}

	w = request(h, "PATCH", "/api/command-templates/"+itoa(created.ID), `{"name":"gh2"}`)
	if w.Code != 200 {
		t.Fatalf("patch: %d", w.Code)
	}

	w = request(h, "DELETE", "/api/command-templates/"+itoa(created.ID), "")
	if w.Code != 204 {
		t.Fatalf("delete: %d", w.Code)
	}
}

func TestCommandTemplatesValidation(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	cases := []struct{ body string; code int }{
		{`{}`, 400},
		{`{"name":"","template":"x"}`, 400},
		{`{"name":"a","template":""}`, 400},
		{`{"name":1,"template":"x"}`, 400},
		{`{"name":"a","template":"x","extra":1}`, 400},
		{`{"name":null,"template":"x"}`, 400},
	}
	for _, tc := range cases {
		w := request(h, "POST", "/api/command-templates", tc.body)
		if w.Code != tc.code {
			t.Fatalf("%s -> %d want %d (%s)", tc.body, w.Code, tc.code, w.Body.String())
		}
	}
	control, _ := json.Marshal(map[string]string{"name": "ok", "template": "a\tb"})
	w := request(h, "POST", "/api/command-templates", string(control))
	if w.Code != 400 {
		t.Fatalf("control: %d", w.Code)
	}
	w = request(h, "PATCH", "/api/command-templates/1", `{}`)
	if w.Code != 400 {
		t.Fatalf("empty patch: %d", w.Code)
	}
	w = request(h, "DELETE", "/api/command-templates/999", "")
	if w.Code != 404 {
		t.Fatalf("missing: %d", w.Code)
	}
}

func TestCommandTemplatesLimit(t *testing.T) {
	r := fresh()
	h := NewHandler(r)
	for i := 0; i < MaxCommandTemplates; i++ {
		body := fmt.Sprintf(`{"name":"n%d","template":"t%d"}`, i, i)
		w := request(h, "POST", "/api/command-templates", body)
		if w.Code != 201 {
			t.Fatalf("seed %d: %d %s", i, w.Code, w.Body.String())
		}
	}
	w := request(h, "POST", "/api/command-templates", `{"name":"overflow","template":"x"}`)
	if w.Code != 400 {
		t.Fatalf("limit: %d %s", w.Code, w.Body.String())
	}
}
```

（`itoa` は `strconv.FormatInt`。既存 `request` ヘルパーを使う。）

- [ ] **Step 2: 失敗確認**

Run: `cd backend && go test ./internal/kanban -run 'TestCommandTemplates' -count=1`  
Expected: FAIL（404 / 未登録）

- [ ] **Step 3: handler 実装**

`command_template_handler.go`:
- list → `reply(200, map[string][]CommandTemplate{"templates": list})`
- create: decode `CommandTemplateInput`；Normalize name/body；失敗時は短い固定 message（本文をログに出さない）
- patch: decode `CommandTemplatePatch`；両方 nil なら 400「name か template を指定してください。」；指定分だけ Normalize
- delete: 204 / 404
- path id: 既存 `id()` を流用（メッセージが「カードID」でも可。専用にするなら `commandTemplateID` ヘルパーで「テンプレートIDが不正です。」）

`fail`: `errors.Is(err, ErrCommandTemplateLimit)` → 400 `{"message":"コマンドテンプレートは50件までです。"}`

`handler.go` に 4 ルート登録。

- [ ] **Step 4: テスト PASS**

Run: `cd backend && go test ./internal/kanban -run 'TestCommandTemplates|TestNormalizeCommandTemplate' -count=1`  
Expected: PASS

- [ ] **Step 5: コミットしない**

---

### Task 3: FE `resolveCommand` ＋ API ＋ コピーフィードバック

**Files:**
- Create: `frontend/src/app/command-template.ts`
- Create: `frontend/src/app/command-template.spec.ts`
- Create: `frontend/src/app/copy-command-feedback.ts`
- Create: `frontend/src/app/copy-command-feedback.spec.ts`
- Modify: `frontend/src/app/api.ts`

**Interfaces:**
- Consumes: `copyText`（`card-link.ts`）、`DestroyRef` パターン（`CopyLinkFeedback`）
- Produces:
  - `export type CommandTemplate = { id: number; name: string; template: string; position: number }`
  - `resolveCommand(template: string, url: string): string` — 全ての `{{url}}` を置換。他の `{{x}}` は残す
  - `COPY_COMMAND_SUCCESS` / `COPY_COMMAND_FAILURE` / 空メニュー案内文言
  - `class CopyCommandFeedback` — `copyResolved(template, number, origin?)`、`message`、destroy 時 `clearTimeout`
  - `Api.listCommandTemplates()` / `createCommandTemplate` / `updateCommandTemplate` / `deleteCommandTemplate`

- [ ] **Step 1: resolveCommand テスト**

```ts
import { describe, it, expect } from 'vitest';
import { resolveCommand } from './command-template';

describe('resolveCommand', () => {
  it('replaces every {{url}} and leaves other placeholders', () => {
    expect(resolveCommand('open {{url}} then {{url}}', 'http://x/cards/1')).toBe(
      'open http://x/cards/1 then http://x/cards/1',
    );
    expect(resolveCommand('keep {{x}} and {{URL}}', 'http://u')).toBe('keep {{x}} and {{URL}}');
    expect(resolveCommand('no placeholder', 'http://u')).toBe('no placeholder');
  });
});
```

- [ ] **Step 2: 失敗確認**

Run: `cd frontend && npx ng test --watch=false --include=src/app/command-template.spec.ts`  
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// command-template.ts
export type CommandTemplate = {
  id: number;
  name: string;
  template: string;
  position: number;
};

export const COMMAND_MENU_EMPTY =
  'コマンドが未登録です。詳細画面で追加できます。';
export const COPY_COMMAND_SUCCESS = 'コマンドをコピーしました';
export const COPY_COMMAND_FAILURE = 'コマンドをコピーできませんでした';

export const resolveCommand = (template: string, url: string): string =>
  template.split('{{url}}').join(url);
```

`copy-command-feedback.ts`: `CopyLinkFeedback` と同型。`copyResolved(templateBody, number, origin?)` で `resolveCommand(templateBody, cardDetailUrl(...))` → `copyText` → 文言セット＋2s clear＋destroy で clearTimeout。

`api.ts`:

```ts
listCommandTemplates() {
  return this.http.get<{ templates: CommandTemplate[] }>('/api/command-templates');
}
createCommandTemplate(input: { name: string; template: string }) {
  return this.http.post<CommandTemplate>('/api/command-templates', input);
}
updateCommandTemplate(id: number, input: { name?: string; template?: string }) {
  return this.http.patch<CommandTemplate>(`/api/command-templates/${id}`, input);
}
deleteCommandTemplate(id: number) {
  return this.http.delete<void>(`/api/command-templates/${id}`);
}
```

（`CommandTemplate` は `command-template.ts` から import。）

- [ ] **Step 4: テスト PASS**（resolve + CopyCommandFeedback の timer destroy）

Run: `cd frontend && npx ng test --watch=false --include=src/app/command-template.spec.ts --include=src/app/copy-command-feedback.spec.ts`  
Expected: PASS

- [ ] **Step 5: コミットしない**

---

### Task 4: ボード／詳細 UI（メニュー＋管理）

**Files:**
- Modify: `frontend/src/app/board.ts` / `.html` / `.css` / `.spec.ts`
- Modify: `frontend/src/app/card-detail.ts` / `.html` / `.css` / `.spec.ts`

**Interfaces:**
- Consumes: Task 3 の API / resolve / CopyCommandFeedback / 文言
- Produces: コピーメニュー（ボード・詳細）、管理ダイアログ（詳細のみ）

- [ ] **Step 1: 配線が外れると落ちるテストを先に書く（L-060）**

ボード:
- テンプレート一覧を `Api.listCommandTemplates` モック（1 件）で読み込み
- `.copy-command-menu`（または同等クラス）ボタンがあり、開くとテンプレート名が見える
- クリックで `writeText` が置換後文字列（`resolveCommand` 結果）を受け取り、遷移しない
- 0 件時は空案内文言（コピー不可）
- 共有 `aria-live` に成功／失敗が出る

詳細:
- テンプレート一覧を `Api.listCommandTemplates` モックで読み込み
- `.copy-command-button` でメニューを開き、テンプレート名が見える
- クリックで `writeText` が置換後文字列を受け取り、ルート遷移しない
- 0 件時は空案内文言（コピー不可）
- 可視 feedback / `aria-live` に成功／失敗が出る
- 「コマンドを管理」で `<dialog appModal>`（`.command-templates-dialog`）が開き、追加フォームがある
- create 成功で一覧更新＋成功フィードバック；create 400 で API message；create 500/ネットワークで失敗文（L-001/L-057）
- 編集・削除も成否を伝える

（セレクタ名は実装で固定し、テストと HTML で一致させる。推奨クラス: `.copy-command-button` / `.copy-command-menu` / `.manage-commands` / `.command-templates-dialog`）

- [ ] **Step 2: 失敗確認**

Run: 関連 `board.spec` / `card-detail.spec` の新 describe  
Expected: FAIL

- [ ] **Step 3: UI 実装**

共通方針:
- リンクコピーボタンの隣に「コマンド」ボタン `aria-haspopup="menu"` / `aria-expanded`
- メニューはシンプルな絶対配置リスト（CDK Menu は使わない）。外側クリックまたは Escape で閉じる
- ボード: 既存 `.copy-link-live` にコマンド用 `CopyCommandFeedback.message` も載せるか、同じ live 領域をコマンド成功時にも更新（どちらか一方の message を優先表示でよい）
- 詳細: 可視 feedback をリンク／コマンドで共有してよい（直近のメッセージ）
- 詳細のみ: 「コマンドを管理」→ dialog。一覧・追加（name/template）・行ごと編集／削除。ヘルプ「`{{url}}` はこのカードのリンクに置き換わります。」
- 初回・表示時に `listCommandTemplates`。CRUD 後は再取得または局所更新
- テンプレート本文を `innerHTML` に載せない（テキストバインディング）

- [ ] **Step 4: テスト PASS**

Run: `cd frontend && npx ng test --watch=false --include=src/app/board.spec.ts --include=src/app/card-detail.spec.ts`  
Expected: PASS（既存＋新規）

- [ ] **Step 5: コミットしない**

---

### Task 5: ドキュメント＋全体検証

**Files:**
- Modify: `docs/api.md`（「コマンドテンプレート」節を追加。curl 例・制約・非実行を明記）
- Modify: `README.md`（API 表に 4 行）
- Modify: `docs/verification.md`（機能要約セクション追加）

- [ ] **Step 1: docs を更新**

api.md に含めること:
- GET/POST/PATCH/DELETE
- name/template 制約（制御文字・長さ・件数 50）
- サーバーは文字列保存のみで実行しない。`{{url}}` 置換はクライアント

verification.md:
- CRUD・正規化・件数上限・フロント置換・メニュー配線・管理ダイアログの成否伝達

- [ ] **Step 2: 全体テスト**

```sh
cd backend && go test -race ./... && go vet ./...
cd frontend && npm test -- --watch=false && npm run build
```

Expected: PASS

- [ ] **Step 3: コミットしない**（feature 完了後の `/commit-ja` でまとめる）

---

## Self-Review

1. Spec coverage: DB・セキュリティ・CRUD・UI・L-001/057/108/203/060 → Tasks 1–5 に対応。並び替え UI・バックログ・サーバー置換は非要件のまま。
2. Placeholders: なし。
3. Types: `CommandTemplate` / Normalize / Repository / Api メソッド名は Tasks 間で一致。
