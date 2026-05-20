// One-shot URR backfill. Synthesizes pairwise matches from each user's
// existing ranked list in user_app_data.ratings using a sliding window of 7.
//
// Idempotent: deterministic source_ref (sha1 of winner|loser|backfill_v1)
// combined with the partial unique index on (user_id, source, source_ref)
// makes re-running a no-op via ON CONFLICT DO NOTHING.
//
// Trigger:
//   supabase functions invoke urr_backfill --body '{"trigger":"manual"}'
// Optional body: { user_ids: ["uuid", ...] } to scope to specific users.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createAdminClient, authorize } from '../_shared/supabase-admin.ts';

const WINDOW = 7;
const BACKFILL_VERSION = 'backfill_v1';
const CHUNK = 1000;

interface RatingRow {
  restaurantId: string;
  score: number;
  cuisine?: string;
  price?: string;
  address?: string;
  createdAt?: number;
}

interface MetaRow {
  neighborhood?: string;
  lat?: number;
  lng?: number;
}

function slugifyBase(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[,\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
function slugifyCuisine(s: string): string {
  return slugifyBase(s);
}
function slugifyCity(s: string): string {
  return slugifyBase(s).replace(/-[a-z]{2}$/, '');
}

// Lightweight last-comma-segment city extractor. Mirrors places.ts behavior
// for the common shapes ("123 Main St, New York, NY 10003" -> "new-york").
function cityFromAddress(addr: string): string {
  if (!addr) return '';
  const parts = addr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';
  // Try second-to-last (typical "city, state zip" tail).
  if (parts.length >= 2) {
    const candidate = parts[parts.length - 2];
    if (candidate && !/^\d/.test(candidate)) return candidate;
  }
  return parts[parts.length - 1];
}

async function sha1Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function marginForDistance(distance: number): number {
  return clamp(0.5 + 0.4 * Math.tanh(distance / 5), 0.5, 0.95);
}

interface MatchRow {
  user_id: string;
  winner_restaurant_id: string;
  loser_restaurant_id: string;
  margin: number;
  context_tags: Record<string, unknown>;
  source: 'backfill';
  source_ref: string;
}

async function backfillUser(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ user: string; matches: number }> {
  const { data, error } = await admin
    .from('user_app_data')
    .select('ratings, restaurant_meta')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !data) return { user: userId, matches: 0 };

  const ratings = ((data.ratings ?? []) as RatingRow[])
    .filter((r) => r && r.restaurantId && typeof r.score === 'number' && r.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.createdAt ?? 0) - (a.createdAt ?? 0);
    });
  const meta = (data.restaurant_meta ?? {}) as Record<string, MetaRow>;
  if (ratings.length < 2) return { user: userId, matches: 0 };

  const rows: MatchRow[] = [];
  for (let i = 0; i < ratings.length; i++) {
    const winner = ratings[i];
    const maxJ = Math.min(i + WINDOW, ratings.length - 1);
    for (let j = i + 1; j <= maxJ; j++) {
      const loser = ratings[j];
      if (winner.restaurantId === loser.restaurantId) continue;
      const distance = j - i;
      const margin = marginForDistance(distance);
      const wMeta = meta[winner.restaurantId] ?? {};
      const lMeta = meta[loser.restaurantId] ?? {};
      const ctx = {
        winner: {
          cuisine: slugifyCuisine(winner.cuisine ?? ''),
          price: winner.price ?? '',
          city: slugifyCity(cityFromAddress(winner.address ?? '')),
          neighborhood: slugifyBase(wMeta.neighborhood ?? ''),
          lat: wMeta.lat,
          lng: wMeta.lng,
        },
        loser: {
          cuisine: slugifyCuisine(loser.cuisine ?? ''),
          price: loser.price ?? '',
          city: slugifyCity(cityFromAddress(loser.address ?? '')),
          neighborhood: slugifyBase(lMeta.neighborhood ?? ''),
          lat: lMeta.lat,
          lng: lMeta.lng,
        },
      };
      const sourceRef = await sha1Hex(`${winner.restaurantId}|${loser.restaurantId}|${BACKFILL_VERSION}`);
      rows.push({
        user_id: userId,
        winner_restaurant_id: winner.restaurantId,
        loser_restaurant_id: loser.restaurantId,
        margin,
        context_tags: ctx,
        source: 'backfill',
        source_ref: sourceRef,
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const { error: insertErr } = await admin
      .from('urr_matches')
      .upsert(slice, { onConflict: 'user_id,source,source_ref', ignoreDuplicates: true });
    if (insertErr) {
      console.error('[urr_backfill] insert error:', insertErr);
      continue;
    }
    inserted += slice.length;
  }
  return { user: userId, matches: inserted };
}

async function runBackfill(scopeUserIds?: string[]): Promise<{ users: number; matches: number }> {
  const admin = createAdminClient();
  let userIds: string[] = scopeUserIds ?? [];
  if (userIds.length === 0) {
    const { data } = await admin.from('user_app_data').select('user_id');
    userIds = ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  }
  let totalMatches = 0;
  for (const u of userIds) {
    const r = await backfillUser(admin, u);
    totalMatches += r.matches;
  }
  // Kick the compute job so the cache reflects the new matches immediately.
  try {
    await admin.functions.invoke('urr_compute', { body: { trigger: 'backfill' } });
  } catch (err) {
    console.warn('[urr_backfill] urr_compute invoke failed:', err);
  }
  return { users: userIds.length, matches: totalMatches };
}

serve(async (req: Request) => {
  if (!authorize(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: { user_ids?: string[] } = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    // empty body is fine
  }
  try {
    const result = await runBackfill(body.user_ids);
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
