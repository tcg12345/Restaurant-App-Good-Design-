// billing-checkout — start a Stripe Checkout for the web app.
//
// iOS buys through StoreKit (RevenueCat SDK); the web app buys through
// Stripe. This mints a Checkout Session for the plan the person picked and
// returns its URL; the client opens it with openExternalUrl. Stripe is
// connected inside RevenueCat, so the purchase lands as a RevenueCat event
// on billing-webhook like any other — the session carries the Supabase user
// id as client_reference_id and as subscription/customer metadata, which
// is what RevenueCat's Stripe integration keys on.
//
// The Stripe customer is created (once) with the user id in its metadata
// and remembered on user_profiles.stripe_customer_id so billing-portal can
// find it later. Never call this from iOS: Apple's rules forbid steering
// to outside checkout from the app.
//
// Deploy:  supabase functions deploy billing-checkout
// Secrets: STRIPE_SECRET_KEY=sk_live_...
//          STRIPE_PRICE_MONTHLY=price_...   STRIPE_PRICE_ANNUAL=price_...
//          STRIPE_PRICE_LIFETIME=price_...  (optional)
//          PUBLIC_WEB_ORIGIN=https://goodeats.app  (return URLs must be here)
//          STRIPE_TRIAL_DAYS_ANNUAL=7  (optional; default 7, 0 disables)

import { requireUser, CORS_HEADERS } from '../_shared/auth.ts';
import { serviceClient } from '../_shared/billing.ts';

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const PRICES: Record<string, string | undefined> = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY'),
  annual: Deno.env.get('STRIPE_PRICE_ANNUAL'),
  lifetime: Deno.env.get('STRIPE_PRICE_LIFETIME'),
};
const WEB_ORIGIN = (Deno.env.get('PUBLIC_WEB_ORIGIN') ?? '').replace(/\/$/, '');
const TRIAL_DAYS_ANNUAL = Number(Deno.env.get('STRIPE_TRIAL_DAYS_ANNUAL') ?? '7');
const MAX_BODY_BYTES = 8 * 1024;

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

async function stripe(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data.error as { message?: string } | undefined)?.message ?? `Stripe ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

/** Only paths on our own web origin may be return URLs. */
function safeReturnUrl(raw: unknown, fallbackPath: string): string {
  const fallback = `${WEB_ORIGIN}${fallbackPath}`;
  if (typeof raw !== 'string' || !WEB_ORIGIN) return fallback;
  try {
    const u = new URL(raw);
    if (`${u.protocol}//${u.host}` !== WEB_ORIGIN) return fallback;
    return u.toString();
  } catch {
    return fallback;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  if (!STRIPE_KEY || !WEB_ORIGIN) return json(503, { error: 'Web checkout is not configured yet.' });

  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { error: 'Request body is too large.' });
  let body: { plan?: string; successUrl?: string; cancelUrl?: string };
  try { body = JSON.parse(await req.text()); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const plan = String(body.plan ?? '');
  const price = PRICES[plan];
  if (!price) return json(400, { error: 'Unknown plan.' });

  const db = serviceClient();
  const { data: profile } = await db.from('user_profiles').select('stripe_customer_id').eq('user_id', auth.userId).maybeSingle();
  const { data: userRes } = await db.auth.admin.getUserById(auth.userId);
  const email = userRes?.user?.email ?? undefined;

  try {
    let customerId = profile?.stripe_customer_id as string | null | undefined;
    if (!customerId) {
      const customer = await stripe('customers', {
        ...(email ? { email } : {}),
        'metadata[user_id]': auth.userId,
        'metadata[app_user_id]': auth.userId,
      });
      customerId = String(customer.id);
      await db.from('user_profiles').update({ stripe_customer_id: customerId }).eq('user_id', auth.userId);
    }

    const params: Record<string, string> = {
      mode: plan === 'lifetime' ? 'payment' : 'subscription',
      customer: customerId,
      client_reference_id: auth.userId,
      'line_items[0][price]': price,
      'line_items[0][quantity]': '1',
      success_url: safeReturnUrl(body.successUrl, '/pro/welcome?session_id={CHECKOUT_SESSION_ID}'),
      cancel_url: safeReturnUrl(body.cancelUrl, '/pro'),
      'metadata[user_id]': auth.userId,
      'metadata[app_user_id]': auth.userId,
      allow_promotion_codes: 'true',
    };
    if (plan !== 'lifetime') {
      params['subscription_data[metadata][user_id]'] = auth.userId;
      params['subscription_data[metadata][app_user_id]'] = auth.userId;
      if (plan === 'annual' && TRIAL_DAYS_ANNUAL > 0) params['subscription_data[trial_period_days]'] = String(TRIAL_DAYS_ANNUAL);
    }
    const session = await stripe('checkout/sessions', params);
    return json(200, { url: session.url, id: session.id });
  } catch (err) {
    console.error('[billing-checkout] failed:', err);
    return json(502, { error: "Couldn't start checkout. Please try again." });
  }
});
