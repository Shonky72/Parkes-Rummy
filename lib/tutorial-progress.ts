/** Tutorial discovery is per browser. Completion never changes scores or room records. */
export const TUTORIAL_COMPLETED_KEY = 'parkes-rummy:tutorial-completed-v1';
export const TUTORIAL_COMPLETED_EVENT = 'parkes-rummy:tutorial-completed';

export function hasCompletedTutorial(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.localStorage.getItem(TUTORIAL_COMPLETED_KEY) === 'yes'; }
  catch { return false; }
}

export function markTutorialCompleted(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(TUTORIAL_COMPLETED_KEY, 'yes'); }
  catch { /* Disabled storage leaves the shortcut visible on future visits. */ }
  window.dispatchEvent(new Event(TUTORIAL_COMPLETED_EVENT));
}
