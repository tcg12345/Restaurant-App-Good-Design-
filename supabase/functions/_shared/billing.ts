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

export async function writePlan(db: SupabaseClient, userId: string, state: PlanState): Promise<void> {
  const { error } = await db
    .from('user_profiles')
    .update({
      plan: state.plan,
      pro_until: state.proUntil,
      pro_source: state.proSource,
      pro_will_renew: state.proWillRenew,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (error) throw new Error(`plan write failed: ${error.message}`);
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
  subscriber?: {
    entitlements?: Record<string, { expires_date: string | null; product_identifier?: string; purchase_date?: string }>;
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
  const expires = ent.expires_date ? new Date(ent.expires_date) : null;
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
