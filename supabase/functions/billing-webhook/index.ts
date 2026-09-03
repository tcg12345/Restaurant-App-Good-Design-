// billing-webhook — RevenueCat tells us a subscription changed.
//
// RevenueCat is the one source of purchase truth for every rail (App Store
// on iOS, Stripe on the web, promotional grants made in its dashboard), so
// this is the ONE webhook that writes the plan. Each delivery is logged in
// subscription_events by its event id; a redelivery is a no-op.
//
// Auth: RevenueCat sends the Authorization header value configured in its
// dashboard; we compare it to REVENUECAT_WEBHOOK_SECRET. No Supabase JWT is
// involved (`verify_jwt = false`).
//
// Deploy:  supabase functions deploy billing-webhook
// Secret:  supabase secrets set REVENUECAT_WEBHOOK_SECRET=...
//          (RevenueCat → Integrations → Webhooks → Authorization header)

import { serviceClient, writePlan, sourceLabel, UUID_RE, type PlanState } from '../_shared/billing.ts';

const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
const MAX_BODY_BYTES = 256 * 1024;

interface RcEvent {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  product_id?: string;
  entitlement_ids?: string[];
  expiration_at_ms?: number | null;
  store?: string;
  environment?: string;
  period_type?: string;
  transferred_from?: string[];
  transferred_to?: string[];
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The Supabase user id a RevenueCat event is about: the app user id when
 *  it is one of ours, else the first alias that is. Anonymous RevenueCat
 *  ids ($RCAnonymousID:…) never match — they resolve once the app logs in. */
function userIdFor(ev: RcEvent): string | null {
  const candidates = [ev.app_user_id, ev.original_app_user_id, ...(ev.aliases ?? [])];
  for (const c of candidates) if (c && UUID_RE.test(c)) return c;
  return null;
}

function stateFor(ev: RcEvent, prev: PlanState | null): PlanState | null {
  const expires = typeof ev.expiration_at_ms === 'number' ? new Date(ev.expiration_at_ms).toISOString() : null;
  const source = sourceLabel(ev.store, ev.environment);
  switch (ev.type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'SUBSCRIPTION_EXTENDED':
      return { plan: 'pro', proUntil: expires, proSource: source, proWillRenew: true };
    case 'NON_RENEWING_PURCHASE':
      // A lifetime buy has no expiry; a consumable pass has one.
      return { plan: 'pro', proUntil: expires, proSource: source, proWillRenew: false };
    case 'CANCELLATION':
      // Auto-renew turned off (or a refund). Pro until the paid period ends;
      // a refund carries an expiration in the past and reads as free.
      return { plan: expires && new Date(expires).getTime() <= Date.now() ? 'free' : 'pro', proUntil: expires, proSource: source, proWillRenew: false };
    case 'BILLING_ISSUE':
      // Grace period: RevenueCat keeps expiration in the future while the
      // store retries the charge.
      return { plan: 'pro', proUntil: expires, proSource: source, proWillRenew: prev?.proWillRenew ?? true };
    case 'EXPIRATION':
      return { plan: 'free', proUntil: expires ?? new Date().toISOString(), proSource: source, proWillRenew: false };
    case 'SUBSCRIPTION_PAUSED':
      return { plan: 'free', proUntil: new Date().toISOString(), proSource: source, proWillRenew: false };
    default:
      return null; // TEST, TRANSFER (handled separately), unknown
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!WEBHOOK_SECRET) {
    console.error('[billing-webhook] REVENUECAT_WEBHOOK_SECRET is not set');
    return new Response('Not configured', { status: 503 });
  }
  const auth = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!auth || !timingSafeEqual(auth, WEBHOOK_SECRET)) return new Response('Unauthorized', { status: 401 });

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return new Response('Too large', { status: 413 });
  let body: { event?: RcEvent };
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const ev = body.event;
  if (!ev || !ev.id || !ev.type) return new Response('Missing event', { status: 400 });

  const db = serviceClient();
  const userId = userIdFor(ev);

  // Log first; a duplicate id means we've already applied this event.
  const { error: logErr } = await db.from('subscription_events').insert({
    id: ev.id,
    user_id: userId,
    type: ev.type,
    store: ev.store ?? null,
    environment: ev.environment ?? null,
    product_id: ev.product_id ?? null,
    expires_at: typeof ev.expiration_at_ms === 'number' ? new Date(ev.expiration_at_ms).toISOString() : null,
    payload: body,
  });
  if (logErr) {
    if (logErr.code === '23505') return new Response(JSON.stringify({ ok: true, duplicate: true }), { status: 200 });
    console.error('[billing-webhook] log failed:', logErr.message);
    return new Response('Log failed', { status: 500 });
  }

  try {
    if (ev.type === 'TRANSFER') {
      // The purchase moved between accounts: the old ones lose it, the new
      // ones gain it. Only ids that are ours matter.
      for (const from of ev.transferred_from ?? []) {
        if (UUID_RE.test(from)) await writePlan(db, from, { plan: 'free', proUntil: new Date().toISOString(), proSource: sourceLabel(ev.store, ev.environment), proWillRenew: false });
      }
      for (const to of ev.transferred_to ?? []) {
        if (UUID_RE.test(to)) await writePlan(db, to, { plan: 'pro', proUntil: typeof ev.expiration_at_ms === 'number' ? new Date(ev.expiration_at_ms).toISOString() : null, proSource: sourceLabel(ev.store, ev.environment), proWillRenew: true });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (!userId) {
      // Anonymous RevenueCat id with no alias of ours yet: nothing to write.
      return new Response(JSON.stringify({ ok: true, unmatched: true }), { status: 200 });
    }
    // Only the `pro` entitlement moves the plan; other entitlements (none
    // today) are logged and ignored.
    const ents = ev.entitlement_ids ?? [];
    const entitlement = Deno.env.get('REVENUECAT_ENTITLEMENT') ?? 'pro';
    if (ents.length > 0 && !ents.includes(entitlement)) {
      return new Response(JSON.stringify({ ok: true, ignored: 'entitlement' }), { status: 200 });
    }
    const { data: prevRow } = await db.from('user_profiles').select('plan, pro_until, pro_source, pro_will_renew').eq('user_id', userId).maybeSingle();
    const prev: PlanState | null = prevRow
      ? { plan: prevRow.plan === 'pro' ? 'pro' : 'free', proUntil: prevRow.pro_until ?? null, proSource: prevRow.pro_source ?? null, proWillRenew: prevRow.pro_will_renew ?? null }
      : null;
    const next = stateFor(ev, prev);
    if (next) await writePlan(db, userId, next);
    return new Response(JSON.stringify({ ok: true, applied: !!next }), { status: 200 });
  } catch (err) {
    console.error('[billing-webhook] apply failed:', err);
    return new Response('Apply failed', { status: 500 });
  }
});
