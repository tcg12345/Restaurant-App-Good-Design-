import { instrumentedFetch as fetch } from './api-telemetry.ts';
// Shared pieces of the billing functions: the service-role client, the
// plan write, and the RevenueCat subscriber → plan mapping.
//
// The plan lives on user_profiles (migration 087) and is written ONLY from
// here, with the service role: the guard trigger reverts any client write.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

export interface PlanState {
  plan: 'free' | 'pro';
  /** ISO timestamp, or null for no expiry (lifetime) / not Pro. */
  proUntil: string | null;
  proSource: string | null;
  proWillRenew: boolean | null;
}

export async function writePlan(db: SupabaseClient, userId: string, state: PlanState, observedAtMs: number): Promise<PlanState> {
  const { data, error } = await db.rpc('apply_billing_snapshot', {
    p_user: userId, p_observed_at_ms: observedAtMs,
    p_state: { plan: state.plan, pro_until: state.proUntil, pro_source: state.proSource, pro_will_renew: state.proWillRenew },
  });
  if (error || !data) throw new Error('Plan write failed');
  return data as PlanState;
}

/** Reconcile from the current subscriber, never infer a transfer or expiry from
 * a delayed event. Provider failures leave the last verified plan untouched. */
export async function subscriberSnapshot(userId: string): Promise<{ state: PlanState; observedAtMs: number }> {
  const secret = Deno.env.get('REVENUECAT_SECRET_KEY');
  if (!secret) throw new Error('Billing is not configured');
  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Subscriber lookup failed: ${response.status}`);
  const sub = await response.json() as RcSubscriber;
  if (!sub?.subscriber || !sub.subscriber.entitlements || !Number.isSafeInteger(sub.request_date_ms) || sub.request_date_ms! <= 0) {
    throw new Error('Invalid subscriber response');
  }
  return { state: planFromSubscriber(sub), observedAtMs: sub.request_date_ms! };
}

/** Lower-cased store name with a sandbox marker, e.g. "app_store",
 *  "stripe", "app_store:sandbox", "promotional". */
export function sourceLabel(store: string | undefined, environment: string | undefined): string | null {
  if (!store) return null;
  const s = String(store).toLowerCase();
  return environment && String(environment).toUpperCase() === 'SANDBOX' ? `${s}:sandbox` : s;
}

/**
 * The shape RevenueCat's REST API returns for GET /v1/subscribers/{id}.
 * Only the fields we read.
 */
export interface RcSubscriber {
  request_date_ms?: number;
  subscriber?: {
    entitlements?: Record<string, { expires_date: string | null; grace_period_expires_date?: string | null; product_identifier?: string; purchase_date?: string }>;
    subscriptions?: Record<string, {
      expires_date?: string | null;
      store?: string;
      unsubscribe_detected_at?: string | null;
      billing_issues_detected_at?: string | null;
      is_sandbox?: boolean;
      period_type?: string;
    }>;
    non_subscriptions?: Record<string, Array<{ purchase_date?: string; store?: string; is_sandbox?: boolean }>>;
  };
}

export const ENTITLEMENT_ID = Deno.env.get('REVENUECAT_ENTITLEMENT') ?? 'pro';

/** Turn a subscriber record into what we store. */
export function planFromSubscriber(sub: RcSubscriber): PlanState {
  const ent = sub.subscriber?.entitlements?.[ENTITLEMENT_ID];
  if (!ent) return { plan: 'free', proUntil: null, proSource: null, proWillRenew: null };
  if (ent.expires_date !== null && (typeof ent.expires_date !== 'string' || !ent.expires_date)) throw new Error('Missing entitlement expiry');
  const dates = [ent.expires_date, ent.grace_period_expires_date].filter((v): v is string => !!v).map(v => new Date(v));
  if (dates.some(d => !Number.isFinite(d.getTime()))) throw new Error('Invalid entitlement expiry');
  const expires = ent.expires_date === null ? null : dates.length ? new Date(Math.max(...dates.map(d => d.getTime()))) : null;
  const active = !expires || expires.getTime() > Date.now();
  if (!active) return { plan: 'free', proUntil: expires ? expires.toISOString() : null, proSource: null, proWillRenew: false };
  const product = ent.product_identifier ?? '';
  const s = sub.subscriber?.subscriptions?.[product];
  const nonSub = sub.subscriber?.non_subscriptions?.[product]?.[0];
  const store = s?.store ?? nonSub?.store;
  const sandbox = (s?.is_sandbox ?? nonSub?.is_sandbox) ? 'SANDBOX' : undefined;
  return {
    plan: 'pro',
    proUntil: expires ? expires.toISOString() : null,
    proSource: sourceLabel(store, sandbox),
    // A subscription renews unless the person turned it off; a lifetime
    // purchase has nothing to renew.
    proWillRenew: s ? !s.unsubscribe_detected_at : false,
  };
}
