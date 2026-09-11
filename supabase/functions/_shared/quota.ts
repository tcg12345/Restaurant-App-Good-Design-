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
 * If quota storage is unavailable, stop before any paid provider call and
 * return a retryable 503. Authentication alone does not authorize unlimited AI.
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
  const unavailable = () => ({ response: new Response(JSON.stringify({
    error: "We couldn't check your allowance. Please try again shortly.", code: 'quota_unavailable',
  }), { status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '5', ...CORS_HEADERS } }) });
  let result;
  try { result = await supabase.rpc('consume_ai_quota', { p_endpoint: endpoint }); }
  catch { return unavailable(); }
  const { data, error } = result;
  if (error || !data || typeof data.allowed !== 'boolean' || !['free', 'pro'].includes(data.plan)) {
    console.error(`[${endpoint}] quota check unavailable`);
    return unavailable();
  }
  const row = data as { allowed: boolean; plan: string; pro_only?: boolean; remaining?: number | null; resets_at?: string | null };
  const json = (status: number, payload: Record<string, unknown>) =>
    new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
  if (row.allowed === false) {
    if (row.pro_only) {
      return { response: json(402, { error: 'This is a GoodEats Pro feature.', code: 'pro_required', plan: row.plan ?? 'free' }) };
    }
    return {
      response: json(429, {
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
