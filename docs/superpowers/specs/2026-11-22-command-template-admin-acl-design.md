# コマンドテンプレートの admin 限定変更（#93）— 設計

- カード: [#93 セキュリティ[中] コマンドテンプレートを誰でも書き換えられ、他の人が中身を見ずにコピーして実行する](https://scrum-board-jkcejsb6ka-an.a.run.app/items/93?project=1)
- 日付: 2026-11-22

## 背景

- カタログ CRUD（`POST` / `PATCH` / `DELETE /api/command-templates`）、既定セット置換（`PUT /api/command-template-defaults`）、全アイテム適用（`POST /api/command-templates/apply-to-all-items`）にロール検査が無い。ログイン済み member が本文を悪意あるコマンドに差し替えられる。
- カードにテンプレートが 1 件のとき、ボード／バックログ／詳細はメニューを開かず即コピーする。コピー本文は画面に出ない（名前だけのボタン）。
- 置換は `{{url}}` のみ。題名など利用者が書ける文字列はコマンドに入らない。制御文字はサーバーが拒否する（既存）。
- カード側の「このアイテムで出すコマンド」選択（`PUT .../items/by-number/{n}/command-templates`）は既に `requireEdit`。カタログ本文の改変ではない。

## 決めたこと

| 事項 | 採用（推奨） |
|------|------|
| 完了条件の解釈 | 票は「admin 限定 **または** コピー本文＋最終更新者の表示」。**admin 限定（API＋画面）を採用**。監査表示・コピー時の本文プレビューは本カードではやらない（OR の片方で足りる） |
| admin 必須の経路 | `POST /api/command-templates`、`PATCH /api/command-templates/{id}`、`DELETE /api/command-templates/{id}`、`PUT /api/command-template-defaults`、`POST /api/command-templates/apply-to-all-items` |
| 読み取り | `GET /api/command-templates` / `GET /api/command-template-defaults` は従来どおり（セッション必須ミドルウェア配下。コピーに本文が必要なため）。アイテム別 `GET .../items/by-number/{n}/command-templates` は従来どおり **`requireView`**（閲覧不可は 403。ログイン済みでもカード ACL で拒否されうる） |
| アイテム別の選択 | `PUT .../command-templates` は従来どおり `requireEdit`（カタログ本文は触れない） |
| 未ログイン | 既存の session 必須ミドルウェアに従う。admin 検査の前に `CurrentUser` が無ければ **401**（`msgLoginRequired`）。admin 以外は **403**（`msgForbidden`）。users / AI credits と同型 |
| 画面 | 詳細の「コマンドを管理」ダイアログで、追加フォーム・編集／削除ボタン・行の一括選択チェック・「全アイテムに適用」・「新規の初期にする」を **admin のみ表示**（一括選択は apply/defaults 専用のため member には出さない）。member は一覧（名前＋本文）の閲覧と、カード側「このアイテムで出すコマンド」チェックリストによる選択のみ。`Auth.isAdmin()` を使う（settings と同型）。未確定の auth では mutate コントロールを出さない（L-463） |
| OpenAPI | 上記 mutate 経路に 401/403 を契約として追記。ルート追加なし |
| 知見 | L-901（副経路の認可漏れ）、L-463（権限確定前の UI 露出）、L-061（危険な入口の一部だけ塞がない） |

### 検討したが採らなかった案

- **更新者記録＋コピー本文の画面表示だけ**: 改ざん自体は防げず、member が信頼できるテンプレートを差し替え続けられる。票の「または」でも満たせるが、本カードは改ざん防止を優先。
- **両方やる**: 範囲が広がる。コピー時プレビューは別カード候補。
- **アイテム別 PUT も admin 限定**: カード編集者がメニュー構成を変えられなくなり、既存 per-card 仕様と衝突。カタログ本文の脅威モデル外。

## 目的と受け入れ条件

1. member（セッション付き）がカタログの作成・更新・削除、既定セット置換、全アイテム適用を呼ぶと **403**（`msgForbidden`）で、DB は変わらない。
2. admin は従来どおりこれらに成功する。
3. member の画面にカタログ mutate 用のコントロールが出ない（閲覧とアイテム別選択は可）。
4. アイテム別のコマンド選択（編集可能なカード）は member でも従来どおり可能。
5. OpenAPI が上記 401/403 と一致する。

## 非目標

- コピー時に本文を画面へ出す／最終更新者カラムの追加
- テンプレート本文の実行・解釈の追加（従来どおりコピーのみ）
- 1 件時の即コピー UX の廃止（本文改ざんが止めば脅威は下がる）
- アイテム別選択 API のロール変更

## 実装概要

1. バックエンド: `requireAdmin` 相当（users / AI credits と同型の CurrentUser + RoleAdmin）を上記 5 経路の先頭で呼ぶ。`apply-to-all-items` は既存のログインチェックを admin 検査に置き換え／強化（member は 403。編集可能カードだけ適用する現行ループは admin 成功時は維持）。
2. テスト: member セッションで各 mutate が 403・副作用なし。admin は成功。既存 CRUD テストは `request`（admin）のまま通ることを確認。
3. フロント: `item-detail` の管理ダイアログで `auth.isAdmin()` により mutate UI を出し分け。セッション側の create/update/delete/apply/defaults は admin 以外から呼ばれない前提だが、403 時は既存 `errorMessage` で表示。
4. OpenAPI: 該当 path の responses に 401/403。`update-api-doc` スキルに従う。

## 関連知見

| ID | 扱い |
| --- | --- |
| L-901 | **守る**: CRUD 以外の defaults / apply-to-all も admin 必須 |
| L-463 | **守る**: auth 未確定時に mutate ボタンを出さない |
| L-061 | **守る**: カタログ改変の入口を API と UI の両方で塞ぐ |

## 第 2 周レビューで直せない／範囲外として記録したもの

（レビュー後に追記）
