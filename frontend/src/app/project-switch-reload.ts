import { DestroyRef } from '@angular/core';
import { ProjectSession } from './project-session';

/**
 * Wire ProjectSession.onSwitched to a view reload that keeps `switching`
 * until the reload settles (L-040). Unsubscribes on DestroyRef.
 */
export function bindProjectSwitchReload(
  session: ProjectSession,
  destroyRef: DestroyRef,
  reload: () => void,
): void {
  const stop = session.onSwitched(() => {
    reload();
  });
  destroyRef.onDestroy(stop);
}
