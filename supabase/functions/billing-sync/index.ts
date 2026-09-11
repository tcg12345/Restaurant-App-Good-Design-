import { withRequestTelemetry } from '../_shared/api-telemetry.ts';
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
import { serviceClient, writePlan, subscriberSnapshot } from '../_shared/billing.ts';

const RC_SECRET = Deno.env.get('REVENUECAT_SECRET_KEY');

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(withRequestTelemetry('billing-sync', async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  if (!RC_SECRET) return json(503, { error: 'Billing is not configured yet.' });

  let state;
  try {
    const snapshot = await subscriberSnapshot(auth.userId);
    state = await writePlan(serviceClient(), auth.userId, snapshot.state, snapshot.observedAtMs);
  } catch {
    console.error('[billing-sync] reconciliation unavailable');
    return json(502, { error: "Couldn't verify your plan. Please try again shortly." });
  }
  return json(200, { plan: state.plan, proUntil: state.proUntil, proSource: state.proSource, proWillRenew: state.proWillRenew });
}));
