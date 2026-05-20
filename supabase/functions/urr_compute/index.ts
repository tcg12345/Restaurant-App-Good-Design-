// URR nightly compute Edge Function.
//
// Reads urr_matches, derives a per-user experience scalar, runs modified Elo
// updates per slice, rescales internal Elo to user-facing 0-10 per-slice,
// and upserts the resulting blob into urr_ratings_cache. Also writes
// per-user experience rows to urr_user_reliability and an observability row
// to urr_compute_runs.
//
// Triggered nightly by pg_cron (see migration 032) or manually via
//   supabase functions invoke urr_compute --body '{"trigger":"manual"}'

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createAdminClient, authorize } from '../_shared/supabase-admin.ts';
import {
  ELO_BASE,
  EXPERIENCE_TARGET,
  EXPERIENCED_THRESHOLD,
  applyMatch,
  empiricalCdf,
  newStats,
  rescaleScore,
  type MatchInput,
  type RestaurantStats,
} from './elo.ts';
import { enumerateSlices, matchSatisfies, parseSliceKey } from './slices.ts';

const ALGO_VERSION = 'elo-v1';
const MATCH_PAGE_SIZE = 1000;

interface CachedEntry {
  score: number;
  rating: number;
  mu: number;
  sigma: number | null;
  ci_low: number;
  ci_high: number;
  n_matches: number;
  n_raters: number;
  experienced_n: number;
}

async function loadAllMatches(admin: ReturnType<typeof createAdminClient>): Promise<MatchInput[]> {
  const all: MatchInput[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from('urr_matches')
      .select('user_id, winner_restaurant_id, loser_restaurant_id, margin, context_tags, source, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + MATCH_PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as MatchInput[]));
    if (data.length < MATCH_PAGE_SIZE) break;
    from += MATCH_PAGE_SIZE;
  }
  return all;
}

function computeExperience(matches: MatchInput[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const m of matches) counts.set(m.user_id, (counts.get(m.user_id) ?? 0) + 1);
  const exp = new Map<string, number>();
  for (const [u, n] of counts) exp.set(u, Math.min(n / EXPERIENCE_TARGET, 1.0));
  // TODO Phase 2: replace experience heuristic with EM-computed reliability
  // (agreement with consensus among other reliable raters).
  return exp;
}

function computeSlice(
  matches: MatchInput[],
  sliceKey: string,
  experience: Map<string, number>,
): { entries: Record<string, CachedEntry>; n_matches: number } {
  const filters = parseSliceKey(sliceKey);
  const stats = new Map<string, RestaurantStats>();
  let nMatches = 0;
  for (const m of matches) {
    if (!matchSatisfies(m, filters)) continue;
    applyMatch(stats, m, experience);
    nMatches += 1;
  }
  if (stats.size === 0) return { entries: {}, n_matches: 0 };

  const sortedElos = [...stats.values()].map((s) => s.rating).sort((a, b) => a - b);
  const entries: Record<string, CachedEntry> = {};
  for (const [restaurantId, s] of stats) {
    const p = empiricalCdf(s.rating, sortedElos);
    const score = rescaleScore(p);
    const ciWindow = s.n_matches > 0 ? 1.96 / Math.sqrt(s.n_matches) : 1;
    const pLow = Math.max(0, p - ciWindow);
    const pHigh = Math.min(1, p + ciWindow);
    entries[restaurantId] = {
      score: round2(score),
      rating: round2(s.rating),
      mu: round2(s.rating),
      sigma: null,
      ci_low: round2(rescaleScore(pLow)),
      ci_high: round2(rescaleScore(pHigh)),
      n_matches: s.n_matches,
      n_raters: s.raters.size,
      experienced_n: s.experienced_raters.size,
    };
  }
  return { entries, n_matches: nMatches };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function openRun(admin: ReturnType<typeof createAdminClient>): Promise<string> {
  const { data, error } = await admin
    .from('urr_compute_runs')
    .insert({ algo_version: ALGO_VERSION, status: 'running' })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('failed to open run');
  return data.id as string;
}

async function closeRun(
  admin: ReturnType<typeof createAdminClient>,
  runId: string,
  status: 'success' | 'failed',
  stats: Record<string, unknown>,
  error?: string,
): Promise<void> {
  await admin
    .from('urr_compute_runs')
    .update({
      status,
      finished_at: new Date().toISOString(),
      error_message: error ?? null,
      match_count_processed: (stats.matchCount as number) ?? 0,
      restaurant_count: (stats.restaurantCount as number) ?? 0,
      slice_count: (stats.sliceCount as number) ?? 0,
      stats,
    })
    .eq('id', runId);
}

async function runCompute(): Promise<{ slices: number; matches: number; restaurants: number }> {
  const admin = createAdminClient();
  const runId = await openRun(admin);
  try {
    const matches = await loadAllMatches(admin);

    const experience = computeExperience(matches);
    const sliceKeys = enumerateSlices(matches);

    const allRestaurants = new Set<string>();
    let totalSliceMatches = 0;

    for (const sk of sliceKeys) {
      const { entries, n_matches } = computeSlice(matches, sk, experience);
      totalSliceMatches += n_matches;
      for (const r of Object.keys(entries)) allRestaurants.add(r);
      const sliceMeta = {
        n_restaurants: Object.keys(entries).length,
        n_matches,
        updated_at_iso: new Date().toISOString(),
      };
      await admin
        .from('urr_ratings_cache')
        .upsert(
          {
            filter_key: sk,
            algo_version: ALGO_VERSION,
            ratings_data: entries,
            slice_meta: sliceMeta,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'filter_key,algo_version' },
        );
    }

    // Reliability table (writes the `experience` column).
    const reliabilityRows: Array<{ user_id: string; experience: number; match_count: number; computed_at: string }> = [];
    const counts = new Map<string, number>();
    for (const m of matches) counts.set(m.user_id, (counts.get(m.user_id) ?? 0) + 1);
    const nowIso = new Date().toISOString();
    for (const [user_id, match_count] of counts) {
      reliabilityRows.push({
        user_id,
        experience: experience.get(user_id) ?? 0,
        match_count,
        computed_at: nowIso,
      });
    }
    if (reliabilityRows.length > 0) {
      await admin.from('urr_user_reliability').upsert(reliabilityRows, { onConflict: 'user_id' });
    }

    await closeRun(admin, runId, 'success', {
      matchCount: matches.length,
      restaurantCount: allRestaurants.size,
      sliceCount: sliceKeys.length,
      totalSliceMatches,
      experienceThreshold: EXPERIENCED_THRESHOLD,
      eloBase: ELO_BASE,
    });
    return { slices: sliceKeys.length, matches: matches.length, restaurants: allRestaurants.size };
  } catch (err) {
    await closeRun(admin, runId, 'failed', {}, String(err));
    throw err;
  }
}

serve(async (req: Request) => {
  if (!authorize(req)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const result = await runCompute();
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
