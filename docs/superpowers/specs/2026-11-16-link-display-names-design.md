# リンク表示を URL ではなく名前にする（アイテム #29）

## 背景

アイテム詳細の GitHub PR は固定文言「GitHub PR」＋全文 URL 表示。関連の item 種はタイトル表示済みだが、url 種はラベルに加えて全文 URL を併記している。変更履歴の `prUrls` もリンクテキストが URL、`relatedItems` は JSON のまま。カード #29 は「PR ならタイトル、別アイテムならそのタイトル」で見せたい。

## 決めたこと

| 事項 | 採用 |
|------|------|
| PR タイトル取得 | **バックエンド**が GitHub API で取得し、読み取り応答に載せる（1A）。任意 `GITHUB_TOKEN`。失敗時は `owner/repo#N` フォールバック |
| 関連 url 種の副表示 | **主ラベルのみ**（2A）。URL は `title` 属性／`aria-label` に残し、画面上の `.pr-link-url` は出さない |
| 対象画面 | **アイテム詳細 + 変更履歴**（3B） |
| 書き込みモデル | `prUrls: string[]` と related の永続形は変えない（タイトルは読み取り enrichment） |
| 対象外 | ボード／バックログカードへのリンク一覧表示、手入力専用の PR 表示名フィールド、GitHub 以外の PR ホストのタイトル取得、Secret Manager 移行 |

## 目的と受け入れ条件

1. 詳細の各 PR リンクの主表示が **PR タイトル**（取得失敗時は `owner/repo#N`）。全文 URL を主テキストにしない。`href` は従来どおり URL。
2. 詳細の関連 **url** 種は `displayLabel`（または同等）のみ。URL 文字列の副表示をやめる。
3. 詳細の関連 **item** 種は現状どおり番号＋タイトル（または label）を維持。
4. 変更履歴の `prUrls` も主表示をタイトル／フォールバックにし、全文 URL を主テキストにしない。
5. 変更履歴の `relatedItems` は raw JSON ではなく、詳細に近いリスト表示（item: 番号＋名前、url: 名前。リンク可能ならリンク）。
6. GitHub API 失敗・レート制限・非公開でトークン無しでも、画面は壊れずフォールバック表示になる。
7. トークンや API 生エラーをログ／UI に出さない（L-017 / L-031）。
8. 既存の PR／関連の追加・削除・並べ替え・検証テストが通る。表示まわりのアサーションを更新する。

## データと API

### 読み取り enrichment

- **アイテム単体 GET** の JSON に、`prUrls` と同順の読み取り専用配列 `prTitles: string[]` を追加する（各要素は表示用。空文字は禁止し、常にタイトルかフォールバックを入れる）。
- **ボード GET では `prTitles` を付けない**（ボード UI は対象外のため GitHub 呼び出しを避ける）。
- PATCH/POST の入力は従来どおり `prUrls` のみ。クライアントが送った `prTitles` は無視する。
- 関連 item の `title` は既存の JOIN を継続。履歴 JSON には従来どおり `title` を書かない。

### GitHub タイトル解決

- 入力: 既に `validPrUrl` 相当を通った `https://github.com/{owner}/{repo}/pull/{n}`。
- 処理: `GET https://api.github.com/repos/{owner}/{repo}/pulls/{n}`。`GITHUB_TOKEN` があれば `Authorization: Bearer …`。User-Agent を付与。短いタイムアウト（例: 2s）。
- 成功: レスポンスの `title` を trim して使用。空ならフォールバック。
- 失敗（非 2xx・タイムアウト・JSON 不正）: フォールバック `owner/repo#n`（URL パースから生成。パース不能でも全文 URL を主表示にしない）。
- プロセス内キャッシュ（URL → 表示文字列、TTL 例: 10 分）。ユニーク URL 単位で解決し並列数に上限を付ける。
- 解決を使う読み取り: **アイテム単体 GET** と **バッチタイトル API**（下記）。書き込み時は呼ばない。

### 履歴

- 履歴 API の永続 JSON 形式は変えない。履歴 GET 自体では GitHub 解決しない。
- **採用（固定）:** フロントが履歴の `prUrls` をパースしたあと、`POST /api/pr-titles`（body `{ "urls": string[] }` → `{ "titles": { "<url>": "<label>" } }`）で表示ラベルを一括取得する。アイテム GET の enrichment も同じ解決ヘルパー／キャッシュを使う。履歴 GET enrichment は作らない（二重実装禁止）。
- バッチ API はサーバー側で各 URL を GitHub PR 形式に検証し、不正はマップに載せず／フォールバックのみ。任意 URL への SSRF を防ぐ。
- `relatedItems` 履歴: JSON を配列としてパースし、詳細と同じ `displayLabel` 規則で描画（`label` 優先 → item は `title` または番号 → url は host）。スナップショットに `title` が無いときは番号／host で足りる（追加 DB ルックアップはしない）。item 番号は `/items/{n}` へリンク。
- レガシー単数フィールド `prUrl` の履歴行: 値が有効な GitHub PR URL なら `prUrls` と同じリンクテキスト規則。それ以外は現状のテキスト表示のまま。

## UI

### 詳細（PR）

- リンクテキスト: `{{ prTitle(url) }}`（`prTitles[i]`）。装飾の「↗」は維持してよい。
- `.pr-link-url` の全文 URL は出さない。必要なら `title="{{ url }}"`。
- aria-label（ドラッグハンドル等）もタイトル／フォールバックを使う。

### 詳細（関連 url）

- `{{ relatedDisplayLabel(related) }} ↗` のみ。`<span class="pr-link-url">` を削除。

### 履歴

- `prUrls`: リストの各行はタイトル／フォールバックをリンクテキストに。`href` は URL。解決前はフォールバックを先に出してよい（ちらつき最小化のため、キャッシュ済みなら即タイトル）。
- `relatedItems`: `<pre>` JSON をやめ、`<ul>` で名前表示。

## エラー・セキュリティ

- GitHub エラー本文・トークンをログに出さない（L-017 / L-031）。
- クライアントから任意 URL をタイトル解決に渡す場合は、既存の GitHub PR URL 検証をサーバーでも行い、それ以外は 400 またはスキップしてフォールバックのみ（オープンリダイレクト／SSRF 防止。GitHub API ホストに固定）。

## 知見（実装時）

- L-037 / L-040: 非同期でタイトルが返ったあと、別アイテムへ遷移していれば適用しない（世代／number でガード。履歴の追加読み込みも同様にキャンセル）。
- L-017 / L-031: 秘密・生エラー非表示。失敗時のログ／API エラー JSON にトークンや GitHub 本文を含めないことをテストで固定する。
- L-002: タイトル取得失敗を空配列や null の `prUrls` と取り違えない。

## テスト

- バックエンド: URL → フォールバック文字列の単体。HTTP クライアントをモックしてタイトル成功／4xx／タイムアウト。バッチ API の不正 URL。失敗経路でレスポンス／ログに秘密が混ざらないこと。
- フロント詳細: `prTitles` があるとき全文 URL が主表示に出ない。関連 url で `.pr-link-url` が無い。
- フロント履歴: `prUrls` / `relatedItems` が名前ベースのリストになる（モックデータ）。
- 回帰: PR／関連の追加削除並べ替えの既存 spec。
