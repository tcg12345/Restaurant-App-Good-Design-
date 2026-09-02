/**
 * Taste benchmarks and the leaderboard — the two RPCs from migration 083.
 *
 * Both are aggregates computed server-side (SECURITY DEFINER) because the
 * client can neither see nor afford to pull every user's ratings. Both
 * degrade to `null` / `[]` when the migration isn't applied, and the page
 * is written so every platform comparison has a self-referential fallback.
 */
import { supabase, supabaseConfigured } from './supabase';
import type { TasteBenchmarks } from './taste-insights';
import type { TasteStats } from './taste-tier';

export interface TasteBenchmarkResult {
  benchmarks: TasteBenchmarks;
  /** The caller's own server-side stats — the numbers the rank was built
   *  from. Null when the caller has nothing published yet. */
  myStats: TasteStats | null;
}

const num = (v: unknown): number | null => {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function getTasteBenchmarks(): Promise<TasteBenchmarkResult | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('get_taste_benchmarks');
    if (error) {
      console.warn('[Taste] get_taste_benchmarks RPC failed (migration 083 applied?):', error.message);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) return null;
    const share = Array.isArray(row.platform_price_share) && row.platform_price_share.length === 4
      ? (row.platform_price_share.map((x) => num(x) ?? 0) as [number, number, number, number])
      : null;
    const benchmarks: TasteBenchmarks = {
      rankedUsers: num(row.ranked_users) ?? 0,
      myRank: num(row.my_rank),
      myPoints: num(row.my_points),
      platformAvgScore: num(row.platform_avg_score),
      avgCuisineCount: num(row.avg_cuisine_count),
      avgCityCount: num(row.avg_city_count),
      medianRatingCount: num(row.median_rating_count),
      gradingPercentile: num(row.grading_percentile),
      breadthPercentile: num(row.breadth_percentile),
      distinctivePercentile: num(row.distinctive_percentile),
      platformPriceShare: share,
      concentratedUserShare: num(row.concentrated_user_share),
    };
    const ratingCount = num(row.my_rating_count);
    const myStats: TasteStats | null = ratingCount == null ? null : {
      ratingCount,
      cuisineCount: num(row.my_cuisine_count) ?? 0,
      cityCount: num(row.my_city_count) ?? 0,
      noteCount: num(row.my_note_count) ?? 0,
      photoCount: num(row.my_photo_count) ?? 0,
      tagCount: num(row.my_tag_count) ?? 0,
      scoreSpread: num(row.my_score_spread) ?? 0,
      monthCount: num(row.my_month_count) ?? 0,
    };
    return { benchmarks, myStats };
  } catch (err) {
    console.warn('[Taste] get_taste_benchmarks failed:', err);
    return null;
  }
}

export interface LeaderboardRow {
  userId: string;
  points: number;
  rank: number;
  ratingCount: number;
  cuisineCount: number;
  cityCount: number;
  /** Taste-twin rows only (migration 086): cosine match 0..1, the
   *  cuisines the pair share, and co-rated places / agreements. */
  similarity?: number;
  sharedCuisines?: string[];
  coRated?: number;
  coAgree?: number;
}

/** The boards. Each is a strict ladder over the same ranked users
 *  (migration 084); 'points' is 083's original. */
export type LeaderboardSort = 'points' | 'places' | 'cuisines' | 'cities';

/** Rows of a board, or null when the RPC itself failed (missing
 *  migration, timeout) — distinct from an empty board, which is a
 *  legitimate answer with its own copy. */
export async function getTasteLeaderboard(limit = 25, sort: LeaderboardSort = 'points'): Promise<LeaderboardRow[] | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('get_taste_leaderboard', { p_limit: limit, p_sort: sort });
    if (error) {
      console.warn('[Taste] get_taste_leaderboard RPC failed (migration 083 applied?):', error.message);
      return null;
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      userId: String(r.user_id),
      points: num(r.points) ?? 0,
      rank: num(r.rank) ?? 0,
      ratingCount: num(r.rating_count) ?? 0,
      cuisineCount: num(r.cuisine_count) ?? 0,
      cityCount: num(r.city_count) ?? 0,
    })).filter((r) => r.userId && r.userId !== 'null');
  } catch (err) {
    console.warn('[Taste] get_taste_leaderboard failed:', err);
    return null;
  }
}

export interface MyRanks {
  rankedUsers: number;
  /** Rank per board, null when the caller isn't ranked yet. */
  ranks: Record<LeaderboardSort, number | null>;
}

/** Where the caller sits on every board (migration 084). Null when the
 *  migration isn't applied — the page then only knows the points rank. */
export async function getTasteMyRanks(): Promise<MyRanks | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('get_taste_my_ranks');
    if (error) {
      console.warn('[Taste] get_taste_my_ranks RPC failed (migration 084 applied?):', error.message);
      return null;
    }
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      rankedUsers: num(row.ranked_users) ?? 0,
      ranks: {
        points: num(row.points_rank),
        places: num(row.places_rank),
        cuisines: num(row.cuisines_rank),
        cities: num(row.cities_rank),
      },
    };
  } catch (err) {
    console.warn('[Taste] get_taste_my_ranks failed:', err);
    return null;
  }
}

/**
 * The people whose cuisine profile lines up with the caller's, closest
 * first (migration 086). Empty when the caller has nothing published,
 * nobody visible overlaps, or the migration isn't applied.
 */
export async function getTasteTwins(limit = 25): Promise<LeaderboardRow[] | null> {
  if (!supabaseConfigured) return null;
  try {
    const { data, error } = await supabase.rpc('get_taste_twins', { p_limit: limit });
    if (error) {
      console.warn('[Taste] get_taste_twins RPC failed (migration 083 applied?):', error.message);
      return null;
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((r, i) => ({
      userId: String(r.user_id),
      points: num(r.points) ?? 0,
      rank: i + 1,
      ratingCount: num(r.rating_count) ?? 0,
      cuisineCount: num(r.cuisine_count) ?? 0,
      cityCount: 0,
      similarity: num(r.similarity) ?? 0,
      sharedCuisines: Array.isArray(r.shared_cuisines)
        ? r.shared_cuisines.filter((c): c is string => typeof c === 'string').map((c) => c.replace(/\b\w/g, (ch) => ch.toUpperCase()))
        : [],
      coRated: num(r.co_rated) ?? 0,
      coAgree: num(r.co_agree) ?? 0,
    })).filter((r) => r.userId && r.userId !== 'null');
  } catch (err) {
    console.warn('[Taste] get_taste_twins failed:', err);
    return null;
  }
}

/* ── Benchmark cache ──────────────────────────────────────────────────── */

const BENCH_TTL_MS = 2 * 60_000;
let benchCache: { userId: string; at: number; value: TasteBenchmarkResult | null } | null = null;
// Keyed by user so a sign-out/sign-in mid-flight can never hand one
// account the other's rank; a forced load never reuses an in-flight one.
let benchInflight: { userId: string; promise: Promise<TasteBenchmarkResult | null> } | null = null;

/** The benchmarks for `userId`, cached for two minutes. `force` skips
 *  the cache (and any in-flight request) — for a page that must be fresh. */
export function getTasteBenchmarksCached(userId: string, force = false): Promise<TasteBenchmarkResult | null> {
  if (!force && benchCache && benchCache.userId === userId && Date.now() - benchCache.at < BENCH_TTL_MS) {
    return Promise.resolve(benchCache.value);
  }
  if (!force && benchInflight && benchInflight.userId === userId) return benchInflight.promise;
  const promise = getTasteBenchmarks().then((value) => {
    benchCache = { userId, at: Date.now(), value };
    if (benchInflight?.promise === promise) benchInflight = null;
    return value;
  });
  benchInflight = { userId, promise };
  return promise;
}

/** Peek at the cache without fetching (initial render of a hook). */
export function peekTasteBenchmarks(userId: string): TasteBenchmarkResult | null {
  return benchCache && benchCache.userId === userId ? benchCache.value : null;
}

/** Drop the cache — ListsContext calls this after a rating is published
 *  to community_ratings, since that is what can move a rank. */
export function invalidateTasteBenchmarks(): void {
  benchCache = null;
  benchInflight = null;
}
