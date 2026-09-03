// billing-portal — a Stripe Customer Portal session for the web app.
//
// Manage / cancel / update card for a subscription bought on the web. iOS
// subscriptions are managed in the App Store (the app deep-links there);
// this is only for people with a Stripe customer, which billing-checkout
// records on user_profiles.stripe_customer_id.
//
// Deploy:  supabase functions deploy billing-portal
// Secrets: STRIPE_SECRET_KEY, PUBLIC_WEB_ORIGIN (see billing-checkout)

import { requireUser, CORS_HEADERS } from '../_shared/auth.ts';
import { serviceClient } from '../_shared/billing.ts';

const STRIPE_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const WEB_ORIGIN = (Deno.env.get('PUBLIC_WEB_ORIGIN') ?? '').replace(/\/$/, '');

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireUser(req);
  if ('response' in auth) return auth.response;
  if (!STRIPE_KEY || !WEB_ORIGIN) return json(503, { error: 'Web billing is not configured yet.' });

  const db = serviceClient();
  const { data: profile } = await db.from('user_profiles').select('stripe_customer_id').eq('user_id', auth.userId).maybeSingle();
  const customerId = profile?.stripe_customer_id as string | null | undefined;
  if (!customerId) return json(404, { error: 'No web subscription on this account.', code: 'no_customer' });

  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ customer: customerId, return_url: `${WEB_ORIGIN}/pro` }).toString(),
  });
  const data = (await res.json()) as { url?: string; error?: { message?: string } };
  if (!res.ok || !data.url) {
    console.error('[billing-portal] failed:', data.error?.message ?? res.status);
    return json(502, { error: "Couldn't open billing right now." });
  }
  return json(200, { url: data.url });
});
