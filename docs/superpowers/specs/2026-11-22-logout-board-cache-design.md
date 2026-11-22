# ログアウト後もボードキャッシュが残る（アイテム #100）

## 背景

ログアウトは SPA で `/login` へ遷移するだけでフルリロードしない。別ユーザーが同じタブでログインすると、`ProjectBoardCache` に前ユーザーのスナップショットが残り、取得完了まで旧データが見える。

## 決めたこと

| 事項 | 採用 |
|------|------|
| クリア契機 | `AuthSession.clearSubject()`（ログイン成功直前・ログアウト成功/失敗） |
| キャッシュ | `ProjectBoardCache.clear()` で Map・キュー・inFlight を捨てる。進行中 HTTP は **epoch** で無効化し、応答が戻っても書き戻さない |
| プロジェクト一覧 | `ProjectSession.clearSubjectState()` で projects / activeId / bootstrapped 等を初期化（`loadGeneration++` で遅延 load も無視） |
| 範囲 | FE のみ。API 変更なし |

## 受け入れ条件

1. `clear()` 後は `getBoard` / `getBacklog` が undefined。
2. prefetch 応答が `clear()` より後に届いてもキャッシュが復活しない。
3. `clearSubject()` がキャッシュと `ProjectSession` をリセットする（テストで固定）。

## 関連知見

- **L-037**: 遅延応答が古い主体のデータを載せない（epoch 照合）。
- **L-001**: 失敗で一覧を空に扱わない（本件は主体切替の意図的クリア）。

## レビュー

- 第1周（記述）: プレースホルダなし。epoch で in-flight 対応を明記済み。
- 第2周（範囲）: Board/Backlog コンポーネント内の表示 state は既存 load 経路に任せる。本 PR はキャッシュ層と session のみ。