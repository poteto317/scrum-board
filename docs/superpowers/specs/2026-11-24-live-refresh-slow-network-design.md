# 回線が遅いとき、ボードの自動反映が反映されない問題（#123）設計

## 背景

自動反映（`frontend/src/app/live-refresh.ts` の `startLiveRefresh`）は 5 秒ごとに動き、そのたびに、前回の未完了のリクエストをキャンセルして、新しく投げ直す。失敗したときに間隔を空ける仕組みもない。応答に 5 秒以上かかる回線では、毎回キャンセルされ、転送だけを消費して、一度も画面に反映されない。ボード・バックログ・アイテム詳細・解決策の 4 画面が同じ関数を使う。

## 決めたこと

`startLiveRefresh` の中だけを変える（呼び出し側と API は変えない）。

- **前回のリクエストが終わっていない間は、次を投げない。** tick は、リクエストが飛行中なら何もしない。応答が返った時点で、値を出さずに完了した場合（呼び出し側が 304 Not Modified を捨てて `EMPTY` になるボード・バックログ）も、リクエストの終了として扱い、飛行中の印を外す（失敗にも成功にも数えない）。成功した応答は、世代（`generation`）が最新なら従来どおり `apply` に渡す。次の tick から再び投げるのは、成功・値なしの完了の場合で、失敗の場合は下の間引きに従う。飛行中の印は `pendingSince`（リクエストを投げた時刻。応答・失敗・完了で null に戻る）で、購読（`subscription`）とは別に持つ。
- **止まったリクエストは諦める。** 飛行中が `maxPendingMs`（既定 30 秒）を超えたら、キャンセルして投げ直し、失敗 1 回として数える（返事の無い回線ではさらに間隔を伸ばす）。応答が永久に返らない場合に、自動反映が永久に止まらないようにするため。経過時間は単調増加の `performance.now()` で測る（壁時計が巻き戻っても止まらない）。
- **失敗が続いたら間隔を伸ばす。** 連続失敗 n 回目の後、`min(2^(n-1), maxBackoffTicks)` 回の tick を飛ばす（1, 2, 4, …。`maxBackoffTicks` の既定は 12 で、5 秒間隔なら最大 1 分）。成功したら 0 に戻す。
- **タブに戻ったときは、待たずに投げる。** `visibilitychange` で表示に戻ったら、間引きと飛行中の印を解除して即座に tick する。隠れている間に残った古い・絞られたリクエストは、キャンセルして投げ直す。
- 応答後に `enabled()` が false で捨てた場合も、飛行中の印は外す（次の tick を塞がない）。

## 気をつける知見

- L-108・L-109・L-217: 停止時にタイマーと visibility のリスナーを必ず解除する（`stop` は世代の更新・購読の解除・印の解除も行う）。
- L-040: 古い非同期の結果を、世代で捨てる（キャンセルしても残る応答を `apply` しない）。
- L-1105: 回数を数えるテストは、実装前のコードで失敗することを先に確かめる。

## 受け入れ条件

各条件に、固定するテスト（`live-refresh.spec.ts`）を添える。

1. 応答が間隔（5 秒）を超えても、完了した応答が `apply` され、その間、追加のリクエストは出ない（`applies a response that takes longer than the interval, ...`）。
2. 飛行中が `maxPendingMs` を超えたら、キャンセルして投げ直し、古い応答は世代で捨てられる（`gives up on a request that has been in flight ...`、`does not apply stale responses (generation)`）。
3. 止まったリクエストを諦めたことも失敗に数え、返事の無い回線では間引きが増える（`counts a request given up on as a failure, ...`）。
4. 連続失敗で間引きが 1, 2, 4, … と増え、`maxBackoffTicks` で頭打ちになり、成功で解除される（`backs off after consecutive failures ...`、`caps the back-off ...`、`a success ends the back-off`、`backoffTicks`）。
5. タブに戻ったときは、間引き中でも、飛行中のリクエストがあっても、即座に取得し直す（`returning to the tab fetches at once, ...`、`returning to the tab replaces a request that was in flight`）。
6. 値を出さずに完了するリクエスト（`EMPTY`）で、次の tick が塞がれない（`frees the next tick when a request completes without emitting ...`）。
7. `enabled()` が false で応答を捨てても、次の tick が塞がれない（`frees the next tick when a response is discarded ...`）。
8. 壁時計が巻き戻っても、止まったリクエストを諦められる（`still gives up on a stalled request when the wall clock moves backwards`）。
9. 停止後に届いた応答は `apply` されない（`does not apply a response that arrives after stop`）。
10. 既存の `live-refresh.spec.ts` と、4 画面の自動反映のテストが通る（`ng test` 全体）。

## 範囲外

- サーバー側の変更、ポーリングの間隔そのものの変更。
- 失敗の画面表示（「オフライン」の表示など）。

## 実装プラン

変更が小さい（1 ファイルとそのテスト）ため、実装プランは作らず、設計書のサブエージェントレビューも省く。
