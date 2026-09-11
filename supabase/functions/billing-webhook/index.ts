import { withRequestTelemetry } from '../_shared/api-telemetry.ts';
// billing-webhook — RevenueCat tells us a subscription changed.
//
// RevenueCat is the one source of purchase truth for every rail (App Store
// on iOS, Stripe on the web, promotional grants made in its dashboard), so
// this is the ONE webhook that writes the plan. Each delivery is logged in
// subscription_events atomically with its plan updates; only completed deliveries
// are treated as duplicates.
//
// Auth: RevenueCat sends the Authorization header value configured in its
// dashboard; we compare it to REVENUECAT_WEBHOOK_SECRET. No Supabase JWT is
// involved (`verify_jwt = false`).
//
// Deploy:  supabase functions deploy billing-webhook
// Secret:  supabase secrets set REVENUECAT_WEBHOOK_SECRET=...
//          (RevenueCat → Integrations → Webhooks → Authorization header)

import { serviceClient, subscriberSnapshot, UUID_RE } from '../_shared/billing.ts';

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

Deno.serve(withRequestTelemetry('billing-webhook', async (req) => {
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
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return new Response('Too large', { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }
  const ev = body?.event;
  if (!ev || typeof ev.id !== 'string' || !ev.id || typeof ev.type !== 'string' || !ev.type) return new Response('Missing event', { status: 400 });

  const db = serviceClient();
  if ([ev.aliases,ev.transferred_from,ev.transferred_to].some(v => v !== undefined && (!Array.isArray(v) || v.some(id => typeof id !== 'string')))) return new Response('Invalid identities', { status:400 });
  const userId = userIdFor(ev);
  const updates: Array<{ user_id: string; plan: string; pro_until: string | null; pro_source: string | null; pro_will_renew: boolean | null; observed_at_ms: number }> = [];
  let outcome: Record<string, unknown> = {};
  try {
    const ids = ev.type === 'TRANSFER'
      ? [...new Set([...(ev.transferred_from ?? []), ...(ev.transferred_to ?? [])].filter(id => typeof id === 'string' && UUID_RE.test(id)))].sort()
      : userId ? [userId] : [];
    if (ev.type === 'TEST') outcome = { ignored: 'test' };
    else if (!ids.length) outcome = { unmatched: true };
    else {
      if (ids.length > 20) throw new Error('Too many transfer accounts');
      // Fetch all snapshots before the one atomic transaction. A failed lookup
      // changes neither a receipt nor any account, so the delivery can retry.
      for (const id of ids) {
        const { state, observedAtMs } = await subscriberSnapshot(id);
        updates.push({ user_id:id, plan:state.plan, pro_until:state.proUntil,
          pro_source:state.proSource, pro_will_renew:state.proWillRenew, observed_at_ms:observedAtMs });
      }
      outcome = { applied: true };
    }
    const { data: applied, error } = await db.rpc('apply_billing_event', {
      event_record: {
        id: ev.id, user_id: userId, type: ev.type, store: ev.store ?? null,
        environment: ev.environment ?? null, product_id: ev.product_id ?? null,
        expires_at: typeof ev.expiration_at_ms === 'number' ? new Date(ev.expiration_at_ms).toISOString() : null,
        payload: body,
      },
      plan_updates: updates,
    });
    if (error) throw new Error(`Billing transaction failed: ${error.message}`);
    return new Response(JSON.stringify({ ok: true, ...(applied === false ? { duplicate: true } : outcome) }), { status: 200 });
  } catch (err) {
    console.error('[billing-webhook] apply failed:', err);
    return new Response('Apply failed', { status: 500 });
  }
}));
