// Plan-aware quota for the AI Edge Functions (migration 087_billing.sql).
//
// Replaces the fixed hourly limiter in limits.ts: the allowance now comes
// from plan_limits for the caller's EFFECTIVE plan (everyone is Pro while
// the billing gates are off), across hour/day/week/month windows, and a
// max of 0 means "Pro only". The RPC runs as the caller (their bearer
// token is forwarded) so auth.uid() scopes the counters to them.
//
// Three self-contained functions (location-chat, import-recipe,
// import-restaurants) inline a copy of enforceQuota for the Dashboard
// editor; keep those in sync with this file.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { CORS_HEADERS } from './auth.ts';

export interface QuotaOk {
  plan: 'free' | 'pro';
  /** Headroom left in the tightest window after this request; null when
   *  the endpoint has no configured limit. */
  remaining: number | null;
  resetsAt: string | null;
}

interface QuotaRow {
  allowed: boolean;
  plan: string;
  pro_only: boolean;
  remaining: number | null;
  resets_at: string | null;
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

/** "Resets in 3 hours" / "Resets Monday" / "Resets 1 Oct". */
export function resetPhrase(resetsAt: string | null): string {
  if (!resetsAt) return '';
  const at = new Date(resetsAt);
  const ms = at.getTime() - Date.now();
  if (!Number.isFinite(ms)) return '';
  if (ms <= 60 * 60 * 1000) return `Resets in ${Math.max(1, Math.round(ms / 60000))} min.`;
  if (ms <= 36 * 60 * 60 * 1000) return `Resets in ${Math.round(ms / 3600000)} hours.`;
  if (ms <= 8 * 24 * 60 * 60 * 1000) return `Resets ${at.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })}.`;
  return `Resets ${at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}.`;
}

/**
 * Count this request against the caller's plan allowance for `endpoint`.
 * Returns { response } to send straight back (402 for a Pro-only feature,
 * 429 when the allowance is used up), or { plan, remaining, resetsAt }.
 *
 * Failure policy: if the RPC itself is missing (migration 087 not applied
 * yet) the request is allowed as Pro, so a deploy that precedes the
 * migration doesn't take AI down. Any other infrastructure error also
 * allows — for free-tier allowances that is the right call (the caller
 * already passed auth), and the gates are what protect paid features:
 * while they're off nothing is gated, and once they're on an outage of
 * this RPC is an outage for everyone, not a way in.
 */
export async function enforceQuota(
  req: Request,
  endpoint: string,
  /** Shown on 429. `%reset%` is replaced with the reset phrase. */
  message = "You've used your AI allowance for now. %reset%",
): Promise<{ response: Response } | QuotaOk> {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    },
  );
  const { data, error } = await supabase.rpc('consume_ai_quota', { p_endpoint: endpoint });
  if (error) {
    console.error(`[${endpoint}] quota check failed (allowing request):`, error.message);
    return { plan: 'pro', remaining: null, resetsAt: null };
  }
  const row = (data ?? {}) as Partial<QuotaRow>;
  if (row.allowed === false) {
    if (row.pro_only) {
      return { response: jsonResponse(402, { error: 'This is a GoodEats Pro feature.', code: 'pro_required', plan: row.plan ?? 'free' }) };
    }
    return {
      response: jsonResponse(429, {
        error: message.replace('%reset%', resetPhrase(row.resets_at ?? null)).trim(),
        code: 'quota',
        plan: row.plan ?? 'free',
        remaining: 0,
        resetsAt: row.resets_at ?? null,
      }),
    };
  }
  return {
    plan: row.plan === 'free' ? 'free' : 'pro',
    remaining: typeof row.remaining === 'number' ? row.remaining : null,
    resetsAt: row.resets_at ?? null,
  };
}
