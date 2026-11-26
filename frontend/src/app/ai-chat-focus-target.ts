/** Esc などで閉じる操作を抑止すべき、編集中のフォーカス先か（L-522） */
export function isEditableFocusTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    return true;
  }
  const flag = el.getAttribute('contenteditable');
  return el.isContentEditable === true || flag === '' || flag === 'true';
}
