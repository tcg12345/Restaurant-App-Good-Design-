/**
 * What the AI assistant knows about you.
 *
 * Two jobs, both previously done badly or not at all:
 *
 *  1. **Sampling your ratings honestly.** The prompt carried the top 50 by
 *     score and reported that truncated length as the total, so the model
 *     believed a 200-rating account had exactly 50 — and, because the list
 *     read as exhaustive, would confidently say "you've never rated anything
 *     in Boston" when the Boston rows sat at #51+. Sorting by score also
 *     dropped every LOW rating, which is the half that says where not to
 *     send you.
 *
 *  2. **Describing your taste.** The engine computes a rich profile
 *     (lib/recommendations.ts) that the chat never saw: how you grade, where
 *     your money actually goes, which cuisine×price pairs you return to,
 *     what you avoid. The chat was left to infer all of it from a list of
 *     names.
 *
 * Both halves are pure functions so they can be tested without a browser,
 * and both are shared by every surface that talks to the assistant — the
 * floating chat and the location page used to build this context separately
 * and had already drifted apart.
 */
import type { TasteProfile } from './recommendations';
import type { TasteQuizAnswers } from './taste-quiz';

export interface RatingLike {
  restaurantId: string;
  name?: string;
  score?: number;
  cuisine?: string;
  address?: string;
  createdAt?: number | string;
  updatedAt?: number | string;
}

export interface RatingSample<T> {
  /** The rows to send, de-duplicated, best-scored first. */
  rows: T[];
  /** How many ratings the user ACTUALLY has. */
  total: number;
  /** True when `rows` is a subset — the prompt must say so. */
  truncated: boolean;
}

const timeOf = (r: RatingLike): number => {
  const v = r.updatedAt ?? r.createdAt;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return Number.isNaN(t) ? 0 : t; }
  return 0;
};

/**
 * Choose the most USEFUL slice of a rating history, not merely the top.
 *
 * A highlight reel can't answer "where shouldn't I go back to?" and can't
 * stop the model recommending somewhere you disliked. So the sample is
 * three-part: your favourites, your worst (the negative signal the
 * recommendation engine weighs 1.5× harder than the positive one), and
 * your most recent (what you're into lately). Overlap is fine — they're
 * de-duplicated, and a small history simply returns whole.
 */
export function sampleRatings<T extends RatingLike>(ratings: T[], cap = 60): RatingSample<T> {
  const scored = ratings.filter((r) => typeof r.score === 'number');
  const total = ratings.length;
  if (total <= cap) {
    return {
      rows: [...ratings].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
      total,
      truncated: false,
    };
  }

  const byScoreDesc = [...scored].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const byRecent = [...ratings].sort((a, b) => timeOf(b) - timeOf(a));

  // Halves of the budget: loved, disliked, lately. Weighted toward the
  // top — it's what most questions are about — but never all of it.
  const topN = Math.round(cap * 0.5);
  const lowN = Math.round(cap * 0.2);
  const recentN = cap - topN - lowN;

  const picked = new Map<string, T>();
  const take = (list: T[], n: number) => {
    for (const r of list) {
      if (picked.size >= cap) return;
      if (n <= 0) return;
      if (picked.has(r.restaurantId)) continue;
      picked.set(r.restaurantId, r);
      n--;
    }
  };
  take(byScoreDesc, topN);
  take([...byScoreDesc].reverse(), lowN);
  take(byRecent, recentN);
  // Any budget left over (heavy overlap between the three) goes back to
  // the top of the list rather than being wasted.
  take(byScoreDesc, cap - picked.size);

  return {
    rows: [...picked.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    total,
    truncated: true,
  };
}

/** A plain-language reading of the computed taste profile. */
export interface TasteSummary {
  ratingCount: number;
  /** Their own average, and the shrunk anchor the engine scores against. */
  avgScore?: number;
  anchor?: number;
  /** 90th percentile — their realistic ceiling. */
  p90?: number;
  /** "generous"/"tough"/"balanced", relative to the 7-point neutral. */
  gradingStyle?: string;
  topCuisines?: string[];
  /** "Japanese $$$$" — the pairs, which are the engine's heaviest term. */
  topPairs?: string[];
  /** Cuisines their own ratings score BELOW their anchor. */
  dislikedCuisines?: string[];
  priceLabel?: string;
  priceConcentration?: number;
  topTags?: string[];
  topCities?: string[];
  /** 0..1 — how much they chase distinctive places over popular ones. */
  distinctive?: number;
  michelinLean?: string;
  /** How much of the picture is still coming from the quiz (1 → 0). */
  quizInfluence?: number;
  quiz?: {
    completed: boolean;
    cuisines?: string[];
    avoidCuisines?: string[];
    dietary?: string[];
    atmosphere?: string;
    pricePrimary?: number;
    priceSecondary?: number;
    city?: string;
  };
}

const PRICE_SYMBOL = ['', '$', '$$', '$$$', '$$$$'];

export function buildTasteSummary(
  profile: TasteProfile,
  quiz: TasteQuizAnswers | null,
): TasteSummary {
  const out: TasteSummary = { ratingCount: profile.scoreN };

  if (profile.avgScore > 0) out.avgScore = Math.round(profile.avgScore * 10) / 10;
  if (typeof profile.anchor === 'number') out.anchor = Math.round(profile.anchor * 10) / 10;
  if (typeof profile.scoreP90 === 'number') out.p90 = Math.round(profile.scoreP90 * 10) / 10;

  // Relative to the 7 the engine treats as neutral. Worth stating plainly:
  // it's why an 8.2 from this user may mean less than a 7.4 from another.
  if (profile.scoreN >= 5 && profile.avgScore > 0) {
    out.gradingStyle = profile.avgScore >= 8
      ? 'generous — most of their scores sit high, so a 7 from them is a real complaint'
      : profile.avgScore <= 6.5
        ? 'tough — they score low across the board, so an 8 from them is high praise'
        : 'balanced';
  }

  if (profile.topCuisines.length > 0) out.topCuisines = profile.topCuisines.slice(0, 8);
  if (profile.topPairs.length > 0) {
    out.topPairs = profile.topPairs
      .slice(0, 5)
      .map((p) => `${p.cuisine} ${PRICE_SYMBOL[p.price] || ''}`.trim());
  }

  // Learned negatives: cuisines whose affinity came out below zero (the
  // builder centres affinities on the anchor, so negative = below their bar).
  const disliked = Object.entries(profile.cuisineScore)
    .filter(([, v]) => v < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 5)
    .map(([k]) => k);
  if (disliked.length > 0) out.dislikedCuisines = disliked;

  const dist = profile.priceDist;
  if (dist && dist.n > 0) {
    const centre = Math.round(dist.center);
    const sym = PRICE_SYMBOL[Math.max(1, Math.min(4, centre))];
    out.priceConcentration = Math.round(dist.concentration * 100) / 100;
    out.priceLabel = dist.concentration >= 0.5
      ? `${sym} almost exclusively`
      : dist.concentration >= 0.35
        ? `mostly ${sym}`
        : `spread across tiers, centred on ${sym}`;
  }

  if (profile.topTags.length > 0) out.topTags = profile.topTags.slice(0, 8);
  if (profile.topCities.length > 0) out.topCities = profile.topCities.slice(0, 5);
  if (typeof profile.distinctiveTaste === 'number') {
    out.distinctive = Math.round(profile.distinctiveTaste * 100) / 100;
  }

  const m = profile.michelinTaste;
  if (m && (m.starShare > 0.05 || m.bibShare > 0.05)) {
    out.michelinLean = m.starShare >= m.bibShare
      ? `chases starred restaurants (${Math.round(m.starShare * 100)}% of their positive ratings)`
      : `leans Bib Gourmand / value-end of the Guide (${Math.round(m.bibShare * 100)}%)`;
  }

  out.quizInfluence = Math.round(profile.quizMass * 100) / 100;
  out.quiz = {
    completed: !!quiz?.completedAt,
    cuisines: quiz?.cuisines?.length ? quiz.cuisines : undefined,
    avoidCuisines: quiz?.avoidCuisines?.length ? quiz.avoidCuisines : undefined,
    dietary: quiz?.dietary?.length ? quiz.dietary : undefined,
    atmosphere: quiz?.atmosphere,
    pricePrimary: quiz?.pricePrimary,
    priceSecondary: quiz?.priceSecondary,
    city: quiz?.city,
  };

  return out;
}

/** Free-text search over the user's own ratings — the tool that lets the
 *  model check rather than guess. Matches name, cuisine, or address. */
export function searchRatings<T extends RatingLike>(
  ratings: T[],
  opts: { query?: string; cuisine?: string; minScore?: number; maxScore?: number; sort?: 'score' | 'recent'; limit?: number },
): { rows: T[]; matched: number } {
  const q = (opts.query || '').trim().toLowerCase();
  const cuisine = (opts.cuisine || '').trim().toLowerCase();
  const hits = ratings.filter((r) => {
    if (typeof opts.minScore === 'number' && (r.score ?? -1) < opts.minScore) return false;
    if (typeof opts.maxScore === 'number' && (r.score ?? 101) > opts.maxScore) return false;
    if (cuisine && !(r.cuisine || '').toLowerCase().includes(cuisine)) return false;
    if (!q) return true;
    const hay = `${r.name || ''} ${r.cuisine || ''} ${r.address || ''}`.toLowerCase();
    // Every word must appear somewhere — "boston italian" should match a
    // place whose city and cuisine each supply one of the two.
    return q.split(/\s+/).every((w) => hay.includes(w));
  });
  const sorted = opts.sort === 'recent'
    ? [...hits].sort((a, b) => timeOf(b) - timeOf(a))
    : [...hits].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { rows: sorted.slice(0, Math.min(opts.limit ?? 25, 60)), matched: hits.length };
}
