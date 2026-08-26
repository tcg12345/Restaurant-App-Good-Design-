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
