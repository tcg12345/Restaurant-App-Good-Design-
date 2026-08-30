/**
 * Local state for the post-onboarding feature tour (the coachmark walk
 * through the app's main surfaces — see components/FeatureTour.tsx).
 *
 * Armed when a NEW account finishes the signup wizard. The handoff out of
 * ProfileSetup is state-driven — refreshProfile() flips profileComplete and
 * App simply stops rendering the wizard — so there is no navigation event
 * to hook; a durable flag is what survives that transition (and a relaunch
 * that interrupts the tour). Same pattern as lib/preauth.ts.
 */

const PENDING_KEY = 'goodeats-tour-pending';
const DONE_KEY = 'goodeats-tour-done';

/** Queue the tour for the next time a tab root is on screen. A no-op for
 *  anyone who has already seen it — re-onboarding (username lost, second
 *  device forcing the wizard) must not replay the tour. */
export function armFeatureTour(): void {
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;
    localStorage.setItem(PENDING_KEY, '1');
  } catch { /* storage off */ }
}

export function isFeatureTourPending(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) === '1' && localStorage.getItem(DONE_KEY) !== '1';
  } catch { return false; }
}

/** Finishing, skipping, or walking out of the tour all burn it — it is a
 *  first-session hand-hold, never something to climb past twice. */
export function markFeatureTourDone(): void {
  try {
    localStorage.setItem(DONE_KEY, '1');
    localStorage.removeItem(PENDING_KEY);
  } catch { /* storage off */ }
}
