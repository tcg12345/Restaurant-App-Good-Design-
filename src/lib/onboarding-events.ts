import { supabase, supabaseConfigured } from './supabase';

/**
 * Funnel events for the signup flow (onboarding_events, migration 075).
 *
 * The auth-last reorder rests on a conversion claim; these rows are how the
 * claim gets checked against real users. One event per completed step,
 * chained by a per-install anon id so the pre-auth stretch and the
 * post-signup stretch read as one journey.
 *
 * Fire-and-forget and silent on every failure — the table not existing yet
 * (migrations run manually here) must never affect the flow being measured.
 * Each event logs at most once per session: step components re-render and
 * re-mount freely, and a funnel with duplicates measures React, not users.
 */

const ANON_KEY = 'gourmad-onboarding-anon';

function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return 'no-storage';
  }
}

const loggedThisSession = new Set<string>();

export function logOnboardingEvent(event: string, userId?: string | null): void {
  if (!supabaseConfigured) return;
  if (loggedThisSession.has(event)) return;
  loggedThisSession.add(event);
  void supabase
    .from('onboarding_events')
    .insert({ anon_id: anonId(), user_id: userId ?? null, event })
    .then(({ error }) => {
      // Missing table (075 not yet run) or offline — the funnel is
      // best-effort by design.
      if (error) console.debug('[onboarding-events] insert skipped:', error.message);
    });
}
