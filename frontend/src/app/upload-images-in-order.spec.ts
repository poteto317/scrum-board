import { EMPTY, of, Subject, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { uploadImagesInOrder } from './upload-images-in-order';

const file = (name: string) => new File([new Uint8Array([1])], name, { type: 'image/png' });

describe('uploadImagesInOrder', () => {
  it('sends the next file only after the previous one finished', () => {
    const a = new Subject<number>();
    const b = new Subject<number>();
    const upload = vi.fn().mockReturnValueOnce(a).mockReturnValueOnce(b);
    const seen: number[] = [];
    const onDone = vi.fn();
    uploadImagesInOrder<number>({
      files: [file('a'), file('b')],
      upload,
      onUploaded: (id) => {
        seen.push(id);
        return 'continue';
      },
      onDone,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    a.next(1);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
    b.next(2);
    expect(seen).toEqual([1, 2]);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ added: 2, total: 2, failed: false });
  });

  it('stops without sending the rest when the caller says stop', () => {
    const upload = vi.fn(() => of(1));
    const onDone = vi.fn();
    uploadImagesInOrder({
      files: [file('a'), file('b')],
      upload,
      onUploaded: () => 'stop',
      onDone,
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ added: 0, total: 2, failed: false });
  });

  it('reports a failure with the number already added', () => {
    const upload = vi
      .fn()
      .mockReturnValueOnce(of(1))
      .mockReturnValueOnce(throwError(() => new Error('x')));
    const onDone = vi.fn();
    uploadImagesInOrder({
      files: [file('a'), file('b'), file('c')],
      upload,
      onUploaded: () => 'continue',
      onDone,
    });
    expect(upload).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(
      expect.objectContaining({ added: 1, total: 3, failed: true, error: expect.any(Error) }),
    );
  });

  it('ends as a failure when an upload completes without a value', () => {
    const onDone = vi.fn();
    uploadImagesInOrder({
      files: [file('a'), file('b')],
      upload: () => EMPTY,
      onUploaded: vi.fn(),
      onDone,
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith({ added: 0, total: 2, failed: true });
  });

  it('uses only the first value of an upload', () => {
    const a = new Subject<number>();
    const onUploaded = vi.fn(() => 'continue' as const);
    const onDone = vi.fn();
    uploadImagesInOrder({ files: [file('a')], upload: () => a, onUploaded, onDone });
    a.next(1);
    a.next(2);
    a.error(new Error('late'));
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('finishes at once with no files', () => {
    const onDone = vi.fn();
    uploadImagesInOrder({ files: [], upload: vi.fn(), onUploaded: vi.fn(), onDone });
    expect(onDone).toHaveBeenCalledWith({ added: 0, total: 0, failed: false });
  });
});
