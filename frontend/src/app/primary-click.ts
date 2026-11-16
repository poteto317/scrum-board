/** True for unmodified primary-button clicks (browser modifier/new-tab gestures stay native). */
export function isUnmodifiedPrimaryClick(event: MouseEvent): boolean {
  return (
    event.button === 0 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.altKey
  );
}
