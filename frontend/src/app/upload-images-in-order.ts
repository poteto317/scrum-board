import { Observable } from 'rxjs';

export type ImageUploadStep = 'continue' | 'stop';

/**
 * 画像を 1 件ずつ順にアップロードする。前の 1 件が終わるまで次を送らない。
 * 本文への挿入や「まだ同じアイテムか」の判断は `onUploaded` が行い、`stop` を返すと残りを送らない。
 * `onDone` は、最後まで送った・`stop` で止めた・失敗した、のどれでも 1 回だけ呼ばれる。
 */
export function uploadImagesInOrder<T>(opts: {
  files: readonly File[];
  upload: (file: File) => Observable<T>;
  onUploaded: (result: T, file: File) => ImageUploadStep;
  onDone: (outcome: { added: number; total: number; failed: boolean; error?: unknown }) => void;
}): void {
  const total = opts.files.length;
  const step = (i: number) => {
    const file = opts.files[i];
    if (!file) {
      opts.onDone({ added: i, total, failed: false });
      return;
    }
    let settled = false;
    opts.upload(file).subscribe({
      next: (result) => {
        if (settled) return;
        settled = true;
        if (opts.onUploaded(result, file) === 'stop') {
          opts.onDone({ added: i, total, failed: false });
          return;
        }
        step(i + 1);
      },
      error: (error: unknown) => {
        if (settled) return;
        settled = true;
        opts.onDone({ added: i, total, failed: true, error });
      },
      complete: () => {
        // 値を出さずに終わった送信も、失敗として必ず終わらせる。
        if (settled) return;
        settled = true;
        opts.onDone({ added: i, total, failed: true });
      },
    });
  };
  step(0);
}
