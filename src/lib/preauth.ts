/**
 * Local state for the PRE-AUTH onboarding flow (taste questions before the
 * account gate).
 *
 * Everything here is deliberately device-local: there is no user yet. The
 * taste answers themselves ride the existing lib/taste-quiz local mirror
 * (which was built to work signed-out); this module adds the two pieces
 * that mirror doesn't cover — the city picked for the preview, and the
 * "this device already went through the flow" flag that keeps returning
 * users (sign-outs, declines) from being re-quizzed on every launch.
 */

import type { HomeLocation } from '../components/HomeLocationBar';

const CITY_KEY = 'gourmad-preauth-city';
const DONE_KEY = 'gourmad-preauth-done';

export function savePreauthCity(loc: HomeLocation): void {
  try { localStorage.setItem(CITY_KEY, JSON.stringify(loc)); } catch { /* storage off */ }
}

export function getPreauthCity(): HomeLocation | null {
  try {
    const raw = localStorage.getItem(CITY_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<HomeLocation>;
    if (typeof o.label === 'string' && typeof o.lat === 'number' && typeof o.lng === 'number') {
      return { label: o.label, lat: o.lat, lng: o.lng };
    }
    return null;
  } catch { return null; }
}

/** Leaving the flow in ANY direction (to signup, to sign-in, to guest mode)
 *  marks it done — the flow is a first-launch experience, never a wall a
 *  returning user has to climb again. */
export function markPreauthDone(): void {
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* storage off */ }
}

export function isPreauthDone(): boolean {
  try { return localStorage.getItem(DONE_KEY) === '1'; } catch { return false; }
}

/* ── Which way they left, and the one follow-up ask ───────────────────── */

const OUTCOME_KEY = 'gourmad-preauth-outcome';
const GUEST_ASKED_KEY = 'gourmad-preauth-guest-asked';
const TASTE_KEY = 'gourmad-taste-quiz';

export type PreauthOutcome = 'signup' | 'signin' | 'guest';

/** Remember which way the flow was left. `preauthExited` in App is React
 *  state, so a relaunch used to forget: someone who tapped "Save my taste
 *  profile", got the gate, and relaunched came back to the generic
 *  "Welcome to Gourmet Canvas" sign-in copy instead of the ask they were
 *  in the middle of. */
export function savePreauthOutcome(mode: PreauthOutcome): void {
  try { localStorage.setItem(OUTCOME_KEY, mode); } catch { /* storage off */ }
}

export function getPreauthOutcome(): PreauthOutcome | null {
  try {
    const v = localStorage.getItem(OUTCOME_KEY);
    return v === 'signup' || v === 'signin' || v === 'guest' ? v : null;
  } catch { return null; }
}

/**
 * Whether to put the account gate in front of a returning GUEST once more.
 *
 * Tapping "Browse without an account" used to be permanent: the flag lives
 * in localStorage, App renders the whole app whenever it is set, and
 * nothing ever asked again — so someone could answer every onboarding
 * question, build a taste profile, and never once be offered an account.
 * The profile they just built is device-local and one uninstall from gone,
 * which is exactly the thing worth telling them.
 *
 * Deliberately at most ONCE, on a LATER launch (never the one where they
 * just declined), and only when there are real answers to save. The escape
 * stays on the screen — this is an ask, not a wall (5.1.1(v)).
 */
export function shouldAskGuestToSave(): boolean {
  try {
    if (localStorage.getItem(DONE_KEY) !== '1') return false;
    if (localStorage.getItem(GUEST_ASKED_KEY) === '1') return false;
    return !!localStorage.getItem(TASTE_KEY);
  } catch { return false; }
}

/** Burn the single follow-up ask. Called when it is SHOWN, so declining it
 *  (or backgrounding the app on it) never re-arms the prompt. */
export function noteGuestAsked(): void {
  try { localStorage.setItem(GUEST_ASKED_KEY, '1'); } catch { /* storage off */ }
}
