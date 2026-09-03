/**
 * Billing analytics — what the paywall did (migration 088).
 *
 * Fire-and-forget rows the client writes as itself: paywall_shown,
 * plan_selected, purchase_started, purchased, restored, purchase_failed,
 * paywall_dismissed. Nothing here blocks the UI, and a failed insert is
 * silently dropped — the purchase itself is the record that matters.
 */
import { supabase, supabaseConfigured } from './supabase';
import { isNativeRuntime } from './native-oauth';

export type BillingEvent =
  | 'paywall_shown'
  | 'paywall_dismissed'
  | 'plan_selected'
  | 'purchase_started'
  | 'purchased'
  | 'restored'
  | 'purchase_failed';

export function logBillingEvent(
  event: BillingEvent,
  userId: string | null,
  fields: { source?: string | null; feature?: string | null; plan?: string | null; meta?: Record<string, unknown> } = {},
): void {
  if (!supabaseConfigured || !userId) return;
  void supabase
    .from('billing_events')
    .insert({
      user_id: userId,
      event,
      source: fields.source ?? null,
      feature: fields.feature ?? null,
      plan: fields.plan ?? null,
      platform: isNativeRuntime() ? 'ios' : 'web',
      meta: fields.meta ?? {},
    })
    .then(({ error }) => { if (error) console.warn('[billing-events]', error.message); });
}
