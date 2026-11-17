import { Injectable, signal } from '@angular/core';
import {
  DESCRIPTION_LINK_MAX_LEN,
  normalizeDescriptionLinkLabel,
  normalizeDescriptionLinkUrl,
} from './description-link';
import {
  insertLinkInDescriptionBlocks,
  serializeDescriptionBlocks,
} from './description-blocks';

/** Link-insert dialog for description blocks (included in detail busy / L-037). */
@Injectable()
export class DescriptionEditor {
  readonly open = signal(false);
  readonly label = signal('');
  readonly url = signal('');
  readonly error = signal('');
  readonly blockIndex = signal(0);
  readonly selectionStart = signal(0);
  readonly selectionEnd = signal(0);

  begin(selection: {
    blockIndex: number;
    start: number;
    end: number;
    selectedText: string;
  }): void {
    this.blockIndex.set(selection.blockIndex);
    this.selectionStart.set(selection.start);
    this.selectionEnd.set(selection.end);
    this.label.set(selection.selectedText);
    this.url.set('');
    this.error.set('');
    this.open.set(true);
  }

  setLabel(v: string): void {
    this.label.set(v);
  }

  setUrl(v: string): void {
    this.url.set(v);
  }

  /** On success returns serialized text + focus target; on failure sets error and returns null (L-001). */
  apply(blocks: string[]): { text: string; blockIndex: number; caret: number } | null {
    const label = normalizeDescriptionLinkLabel(this.label());
    const url = normalizeDescriptionLinkUrl(this.url());
    if (!label) {
      this.error.set('表示名を入力してください（] は使えません）。');
      return null;
    }
    if (!url) {
      this.error.set('https:// で始まるURLを入力してください。');
      return null;
    }
    const inserted = insertLinkInDescriptionBlocks(
      blocks,
      this.blockIndex(),
      this.selectionStart(),
      this.selectionEnd(),
      label,
      url,
    );
    if (!inserted) {
      this.error.set(`説明が${DESCRIPTION_LINK_MAX_LEN}文字を超えるため挿入できません。`);
      return null;
    }
    this.cancel();
    return {
      text: serializeDescriptionBlocks(inserted.blocks),
      blockIndex: inserted.blockIndex,
      caret: inserted.caret,
    };
  }

  cancel(): void {
    this.open.set(false);
    this.label.set('');
    this.url.set('');
    this.error.set('');
    this.blockIndex.set(0);
    this.selectionStart.set(0);
    this.selectionEnd.set(0);
  }

  /** Card switch / reload: drop dialog. */
  reset(): void {
    this.cancel();
  }
}
