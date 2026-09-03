// billing-sync — pull the caller's subscription from RevenueCat and write
// the plan now, instead of waiting for the webhook.
//
// The app calls this right after a native purchase succeeds and on
// "Restore purchases", so the person never waits on webhook latency to see
// Pro turn on. The webhook remains the record; this is the fast path.
//
// Auth: the caller's Supabase JWT (requireUser). The RevenueCat app user id
// IS the Supabase user id, so the caller can only ever sync themselves.
//
// Deploy:  supabase functions deploy billing-sync
// Secret:  supabase secrets set REVENUECAT_SECRET_KEY=sk_...
//          (a RevenueCat *secret* API v1 key; never the public SDK key)

import { requireUser, CORS_HEADERS } from '../_shared/auth.ts';
import { serviceClient, writePlan, planFromSubscriber, type RcSubscriber } from '../_shared/billing.ts';

const RC_SECRET = Deno.env.get('REVENUECAT_SECRET_KEY');

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  if (!RC_SECRET) return json(503, { error: 'Billing is not configured yet.' });

  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(auth.userId)}`, {
    headers: { Authorization: `Bearer ${RC_SECRET}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    console.error('[billing-sync] RevenueCat lookup failed:', res.status);
    return json(502, { error: "Couldn't reach the store right now." });
  }
  const sub = (await res.json()) as RcSubscriber;
  const state = planFromSubscriber(sub);
  try {
    await writePlan(serviceClient(), auth.userId, state);
  } catch (err) {
    console.error('[billing-sync] write failed:', err);
    return json(500, { error: "Couldn't save your plan." });
  }
  return json(200, { plan: state.plan, proUntil: state.proUntil, proSource: state.proSource, proWillRenew: state.proWillRenew });
});
