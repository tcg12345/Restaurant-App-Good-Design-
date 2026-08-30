import { supabase, supabaseConfigured } from './supabase';

/**
 * Thumbs up / thumbs down on an assistant answer (ai_chat_feedback,
 * migration 077).
 *
 * The assistant's recommendations are the product's central claim; this is
 * the only place a user gets to say the claim was wrong. One row per tap,
 * append-only — a user changing their mind writes a second row and the
 * newest one per `turnKey` is the standing verdict (the summary view does
 * that dedupe server-side).
 *
 * Fire-and-forget and silent on every failure, exactly like
 * onboarding-events: migrations are run by hand here, so the table may not
 * exist yet, and a missing analytics sink must never break the chat it is
 * measuring.
 *
 * Deliberately does NOT send the prompt or the assistant's prose. Those are
 * the user's own conversation; what goes over the wire is the verdict and
 * the place ids that were recommended — the thing actually being judged.
 */

/** Shared with lib/onboarding-events so one install is one identity across
 *  both sinks. Reading it never creates it — if onboarding never ran, a
 *  per-install id is minted here instead. */
const ANON_KEY = 'goodeats-onboarding-anon';

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

export type ChatVerdict = 'up' | 'down';

export interface ChatFeedbackInput {
  verdict: ChatVerdict;
  /** Stable pointer to the rated turn — chat id + turn index. Lets a
   *  re-rating supersede the first one without needing an UPDATE policy on
   *  a write-only table. */
  turnKey: string;
  /** Google place ids the assistant recommended in that turn. */
  restaurantIds?: string[];
  userId?: string | null;
}

export function logChatFeedback({ verdict, turnKey, restaurantIds, userId }: ChatFeedbackInput): void {
  if (!supabaseConfigured || !turnKey) return;
  void supabase
    .from('ai_chat_feedback')
    .insert({
      anon_id: anonId(),
      user_id: userId ?? null,
      verdict,
      // The column is bounded at 128 chars; a pathological chat id must
      // not turn a rating into a failed insert.
      turn_key: turnKey.slice(0, 128),
      // Bounded at 12 by the table's CHECK — recommend_restaurants caps
      // at 6, so this only ever trims something that has gone wrong.
      restaurant_ids: (restaurantIds ?? []).slice(0, 12),
    })
    .then(({ error }) => {
      // Missing table (077 not yet run) or offline — best-effort by design.
      if (error) console.debug('[ai-chat-feedback] insert skipped:', error.message);
    });
}
