import { Injectable, signal } from '@angular/core';
import {
  DESCRIPTION_LINK_MAX_LEN,
  insertDescriptionLink,
  normalizeDescriptionLinkLabel,
  normalizeDescriptionLinkUrl,
} from './description-link';

/** Description view/edit session and link-insert dialog (included in detail busy / L-037). */
@Injectable()
export class DescriptionEditor {
  readonly editing = signal(false);
  readonly open = signal(false);
  readonly label = signal('');
  readonly url = signal('');
  readonly error = signal('');
  readonly selectionStart = signal(0);
  readonly selectionEnd = signal(0);

  startEdit(): void {
    this.editing.set(true);
  }

  /** End edit unless the link dialog still owns focus (blur while open). */
  endEditIfIdle(): void {
    if (this.open()) return;
    this.editing.set(false);
  }

  begin(selection: { start: number; end: number; selectedText: string }): void {
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

  /** On success returns new text + caret; on failure sets error and returns null (L-001). */
  apply(currentDescription: string): { text: string; caret: number } | null {
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
    const inserted = insertDescriptionLink(
      currentDescription,
      this.selectionStart(),
      this.selectionEnd(),
      label,
      url,
      DESCRIPTION_LINK_MAX_LEN,
    );
    if (!inserted) {
      this.error.set(`説明が${DESCRIPTION_LINK_MAX_LEN}文字を超えるため挿入できません。`);
      return null;
    }
    this.cancel();
    return inserted;
  }

  cancel(): void {
    this.open.set(false);
    this.label.set('');
    this.url.set('');
    this.error.set('');
    this.selectionStart.set(0);
    this.selectionEnd.set(0);
  }

  /** Card switch / reload: drop dialog and leave view mode. */
  reset(): void {
    this.cancel();
    this.editing.set(false);
  }
}
