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

/* ── Abandon ────────────────────────────────────────────────────────────
 *
 * `_done` events alone can only say how many people finished a step. They
 * cannot say which step lost the rest — the difference between two
 * consecutive counts tells you somebody left, not where they were standing
 * when they did. So each screen registers itself, and leaving the app with
 * one registered logs where.
 *
 * Best-effort by construction: a backgrounded tab may not finish the
 * request. `visibilitychange` is used rather than `pagehide` because iOS
 * frequently skips the latter, and it is the one that actually fires when
 * someone swipes away mid-signup — the exact case being measured.
 */

let currentStep: string | null = null;
let armed = false;
/** One abandon per hide, so a background/foreground cycle isn't a funnel
 *  event. Reset when the app comes back. */
let sentForThisHide = false;

function sendAbandon(): void {
  if (!currentStep || sentForThisHide || !supabaseConfigured) return;
  sentForThisHide = true;
  const event = `abandon_${currentStep}`;
  // Deliberately NOT via logOnboardingEvent: its once-per-session dedupe is
  // right for step completions and wrong here, where a later abandon at a
  // different step is the more informative row.
  void supabase
    .from('onboarding_events')
    .insert({ anon_id: anonId(), user_id: currentUserId, event })
    .then(({ error }) => {
      if (error) console.debug('[onboarding-events] abandon skipped:', error.message);
    });
}

function arm(): void {
  if (armed || typeof document === 'undefined') return;
  armed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') sendAbandon();
    else sentForThisHide = false;
  });
}

let currentUserId: string | null = null;

/**
 * Register the screen the user is on. Call with null the moment the flow
 * completes (or the user leaves it deliberately) — an abandon logged for
 * someone who finished would be worse than no data.
 */
export function markOnboardingStep(step: string | null, userId?: string | null): void {
  currentStep = step;
  currentUserId = userId ?? currentUserId;
  if (step) arm();
}
