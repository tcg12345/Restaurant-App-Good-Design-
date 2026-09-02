/**
 * Taste insights — the taste profile, read out loud.
 *
 * lib/recommendations.ts computes a rich TasteProfile for the engine: how
 * you grade, where your money goes, which cuisine×price pairs you return
 * to. lib/assistant-taste.ts turns that into prose for the chat. This
 * module does the same job for the person the profile is ABOUT, and goes
 * further, because a page can say things a prompt can't afford to:
 *
 *  - It pairs fields the engine keeps apart. The cuisine you EAT most and
 *    the cuisine you RATE highest are two different lists; the gap between
 *    them ("you love Thai more than you eat it") is the most personal fact
 *    in the whole profile and nothing computed it before.
 *  - It reads the fields the engine ignores: wouldReturn, visit history,
 *    notes, photos, friends at the table, and the DAY of the visit.
 *  - It reads the clock. Ratings carry when they were made, so the profile
 *    has a past — score drift, cuisines discovered lately — without any
 *    stored snapshots.
 *  - It compares you to everyone else, when the server benchmarks are in
 *    (supabase-taste.ts). Every comparison degrades to a self-referential
 *    sentence when they aren't, so the page never shows a blank.
 *
 * Pure: no React, no storage, no network. The page and the profile card
 * both render from one `TasteInsights` so they can never disagree.
 */
import type { TasteProfile } from './recommendations';
import type { TasteQuizAnswers } from './taste-quiz';
import { cuisineTokens, cityToken, populationStdDev, monthKey } from './taste-tier';
import { parseVisitDate } from './utils';

export interface InsightRating {
  restaurantId: string;
  name?: string;
  score: number;
  cuisine?: string;
  price?: string;
  address?: string;
  notes?: string;
  tags?: string[];
  photos?: unknown[];
  friendIds?: string[];
  wouldReturn?: boolean;
  visitDate?: string;
  createdAt?: number;
  /** 'slider' scores are self-picked and never feed platform averages
   *  (countsForCommunity) — the platform comparison leaves them out too. */
  ratingMethod?: string | null;
}

/** Platform-wide numbers from get_taste_benchmarks (migration 083). All
 *  optional: the page works without the migration, just with fewer
 *  comparisons. Percentiles are "share of ranked users BELOW you" (0..1). */
export interface TasteBenchmarks {
  rankedUsers: number;
  myRank: number | null;
  myPoints: number | null;
  /** Mean of every user's mean score — the platform's grading baseline. */
  platformAvgScore: number | null;
  avgCuisineCount: number | null;
  avgCityCount: number | null;
  medianRatingCount: number | null;
  /** Share of users whose mean score is HIGHER than yours — i.e. the
   *  share you grade tougher than. */
  gradingPercentile: number | null;
  /** Share of users with FEWER distinct cuisines than you. */
  breadthPercentile: number | null;
  /** Share of users LESS distinctive (premium share + breadth) than you. */
  distinctivePercentile: number | null;
  /** Share of all platform ratings in each price tier ($ → $$$$). */
  platformPriceShare: [number, number, number, number] | null;
  /** Share of users with ≥ half their ratings in one price tier. */
  concentratedUserShare: number | null;
}

export interface CuisineRow {
  name: string;
  n: number;
  /** Share of the user's ratings that carry this cuisine. */
  share: number;
  avg: number;
  /** avg − anchor: positive means above their own bar. */
  rel: number;
}

export interface TrendPeriod {
  /** "Q2 '26" */
  label: string;
  /** Sort key, yyyy-q */
  key: string;
  n: number;
  avg: number;
  /** Cuisines seen up to and including this period. */
  cuisinesToDate: number;
  topCuisine: string | null;
}

export interface InsightSentence {
  id: string;
  /** One line, sentence case. The card and the hero use `headline`. */
  headline: string;
  /** The evidence, one short sentence. */
  detail: string;
  /** Ordering weight — higher first. Flattering, specific facts win. */
  weight: number;
}

export interface TasteInsights {
  n: number;
  scored: number;
  avg: number;
  median: number;
  anchor: number;
  p90: number | null;
  spread: number;
  /** Count of scores whose floor is each band 0..10 (index = band). */
  histogram: number[];
  grading: {
    label: 'tough' | 'balanced' | 'generous';
    /** Your mean minus the platform mean (null without benchmarks). */
    vsPlatform: number | null;
    /** Share of users you grade tougher than (null without benchmarks). */
    tougherThan: number | null;
  };
  price: {
    share: [number, number, number, number];
    counts: [number, number, number, number];
    dominantTier: number | null;
    dominantShare: number;
    tiersUsed: number;
    concentration: number;
    platformShare: [number, number, number, number] | null;
  };
  cuisines: CuisineRow[];
  /** Rated well above your bar, but rarely eaten. */
  loveMoreThanEat: CuisineRow | null;
  /** Eaten a lot, rated under your bar. */
  eatMoreThanLove: CuisineRow | null;
  breadth: { count: number; platformAvg: number | null; percentile: number | null };
  trend: {
    periods: TrendPeriod[];
    recentN: number;
    priorN: number;
    recentAvg: number | null;
    priorAvg: number | null;
    /** recent − prior, null when either side is too thin. */
    drift: number | null;
    newCuisines: string[];
    recentTopCuisine: string | null;
    priorTopCuisine: string | null;
  };
  habits: {
    returnRate: number | null;
    /** Share of rated places with more than one logged visit. */
    repeatShare: number | null;
    socialShare: number;
    notesShare: number;
    photosShare: number;
    weekendShare: number | null;
    favoriteDay: string | null;
    /** Null when the dataset isn't loaded OR nothing matched — a taste
     *  profile with no Guide restaurants has no Michelin section. */
    michelin: {
      /** Guide-recognized places rated (starred + Bib + Selected). */
      count: number;
      /** Of those, how many hold at least one star. */
      starCount: number;
      /** Stars added up across them: two 3-stars is six. */
      totalStars: number;
      bibCount: number;
      share: number;
    } | null;
    cities: Array<{ name: string; n: number }>;
    activeMonths: number;
    perMonth: number | null;
    firstAt: number | null;
  };
  tags: Array<{ name: string; weight: number }>;
  quiz: {
    completed: boolean;
    influence: number;
    cuisines: string[];
    avoid: string[];
    dietary: string[];
    atmosphere: string | null;
  };
  distinctive: { score: number; percentile: number | null };
  /** The palate as an identity, apart from the points ladder: a named
   *  archetype, one line on it, and the cuisines that define it. */
  palate: {
    archetype: string | null;
    tagline: string | null;
    petals: Petal[];
  };
  sentences: InsightSentence[];
  /** ≤ 3 two-or-three-word labels for the profile card. */
  chips: string[];
}

export const PRICE_SYMBOLS = ['$', '$$', '$$$', '$$$$'] as const;

/** One cuisine on the palate fingerprint. `affinity` blends how much of
 *  it you eat with how far above your bar you score it, 0..1. */
export interface Petal {
  name: string;
  n: number;
  avg: number;
  /** Blend of eat and love, 0..1 — orders the petals. */
  affinity: number;
  /** How often you eat it: share of ratings against your most-eaten, 0..1. */
  eat: number;
  /** How far above your bar you score it, 0..1 (0.5 = on the bar). */
  love: number;
}

/**
 * The palate as a fingerprint: up to eight cuisines, each scored on how
 * much you EAT it (share of ratings, against your most-eaten) and how
 * much you LOVE it (average against your own bar). Love leads — a
 * cuisine you rate 9s twice says more about taste than one you eat
 * weekly at a 7 — but eating counts, so a single lucky meal can't
 * define you.
 */
function buildPetals(cuisines: CuisineRow[], scored: number): Petal[] {
  if (scored < 3 || cuisines.length === 0) return [];
  const eligible = cuisines.filter((c) => c.n >= 2);
  const pool = eligible.length >= 3 ? eligible : cuisines;
  const maxShare = Math.max(0.01, ...pool.map((c) => c.share));
  return pool
    .map((c) => {
      const love = Math.max(0, Math.min(1, (c.rel + 1.5) / 3));
      const eat = c.share / maxShare;
      return { name: c.name, n: c.n, avg: c.avg, affinity: 0.6 * love + 0.4 * eat, eat, love };
    })
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, 8);
}

/**
 * A name for the palate — "The Fine-Dining Explorer", "The Thai Devotee"
 * — from two axes the ratings settle: where you eat (price / the Guide)
 * and how you eat (one cuisine, many, the same places, many cities).
 * Rule-based on purpose: a name a user can reverse-engineer from their
 * own numbers is one they will believe.
 */
function buildArchetype(args: {
  scored: number;
  cuisines: CuisineRow[];
  petals: Petal[];
  dominantTier: number | null;
  dominantShare: number;
  premiumShare: number;
  michelinShare: number;
  repeatShare: number | null;
  cityCount: number;
  weekendShare: number | null;
}): { archetype: string | null; tagline: string | null } {
  const { scored, cuisines, petals } = args;
  if (scored < 5 || cuisines.length < 2) return { archetype: null, tagline: null };

  const style = args.michelinShare >= 0.25 || args.premiumShare >= 0.6
    ? 'Fine-Dining'
    : args.dominantTier != null && args.dominantTier <= 2 && args.dominantShare >= 0.6
      ? 'Value'
      : 'Any-Table';

  const top = cuisines[0];
  const topShare = top ? top.share : 0;
  let role: string;
  if (top && topShare >= 0.4 && top.rel >= 0) role = `${top.name} Devotee`;
  else if (cuisines.length >= 12 && topShare < 0.3) role = 'Explorer';
  else if (args.repeatShare != null && args.repeatShare >= 0.3) role = 'Regular';
  else if (args.cityCount >= 8) role = 'Wanderer';
  else if (cuisines.length >= 6) role = 'Generalist';
  else role = 'Specialist';

  const loved = petals.slice(0, 3).map((p) => p.name);
  const lovedText = loved.length === 0 ? ''
    : loved.length === 1 ? `Loves ${loved[0]}`
      : `Loves ${loved.slice(0, -1).join(', ')} and ${loved[loved.length - 1]}`;
  const where = style === 'Fine-Dining'
    ? (args.michelinShare >= 0.25 ? 'follows the Guide' : 'eats at the top of the menu')
    : style === 'Value' ? 'spends carefully' : 'spends where the food is';
  const when = args.weekendShare != null
    ? (args.weekendShare >= 0.6 ? ', mostly on weekends' : args.weekendShare <= 0.25 ? ', mostly on weeknights' : '')
    : '';
  const tagline = `${lovedText ? `${lovedText}, ` : ''}${where}${when}.`;
  return { archetype: `The ${style} ${role}`, tagline: tagline[0].toUpperCase() + tagline.slice(1) };
}

/** "32 Guide restaurants rated, 19 of them starred — 41 stars in all." */
function michelinDetail(m: NonNullable<TasteInsights['habits']['michelin']>): string {
  const starred = m.starCount
    ? `, ${m.starCount} of them starred — ${m.totalStars} star${m.totalStars === 1 ? '' : 's'} in all`
    : m.bibCount ? `, ${m.bibCount} Bib Gourmand` : '';
  return `${m.count} Guide restaurant${m.count === 1 ? '' : 's'} rated${starred}.`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function titleCase(token: string): string {
  return token.replace(/\b\w/g, (ch) => ch.toUpperCase());
}

const parseVisitDay = (s: string | undefined): Date | null => parseVisitDate(s);

/** The moment a rating "happened": the dining date when it was logged,
 *  else when the rating was created. Same preference the profile's recent
 *  list uses. */
function ratingTime(r: InsightRating): number {
  const v = parseVisitDay(r.visitDate);
  if (v) return v.getTime();
  return typeof r.createdAt === 'number' && r.createdAt > 0 ? r.createdAt : 0;
}

function quarterKey(ts: number): { key: string; label: string } {
  const d = new Date(ts);
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  const y = d.getUTCFullYear();
  return { key: `${y}-${q}`, label: `Q${q} ’${String(y).slice(2)}` };
}

export const pct = (x: number): string => `${Math.round(x * 100)}%`;
export const fmt1 = (x: number): string => (Math.round(x * 10) / 10).toFixed(1);

export interface MichelinHit {
  /** 0 for Bib Gourmand / Selected. */
  stars: number;
  bibGourmand: boolean;
}

export interface InsightOptions {
  /** Whose profile this is. Absent = the reader's own ("You love…");
   *  set = someone else's, and every sentence is written in the third
   *  person with this name ("Jamie loves…"). */
  voice?: { name: string };
  quiz?: TasteQuizAnswers | null;
  benchmarks?: TasteBenchmarks | null;
  /** restaurantId → number of logged visits BEYOND the current rating. */
  extraVisits?: Record<string, number>;
  /** Michelin lookups, when the dataset is in memory: id → what the Guide says. */
  michelinById?: Map<string, MichelinHit>;
  now?: number;
}

export function buildTasteInsights(
  ratings: InsightRating[],
  profile: TasteProfile,
  opts: InsightOptions = {},
): TasteInsights {
  const now = opts.now ?? Date.now();
  const bench = opts.benchmarks ?? null;
  const scoredRows = ratings.filter((r) => typeof r.score === 'number' && r.score > 0);
  const scores = scoredRows.map((r) => r.score);
  const n = ratings.length;
  const scored = scoredRows.length;
  const avg = scored > 0 ? scores.reduce((a, b) => a + b, 0) / scored : 0;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = scored > 0
    ? (scored % 2 ? sorted[(scored - 1) / 2] : (sorted[scored / 2 - 1] + sorted[scored / 2]) / 2)
    : 0;
  const anchor = profile.anchor ?? 7;
  const p90 = profile.scoreP90 ?? null;
  const spread = populationStdDev(scores);

  const histogram = Array.from({ length: 11 }, () => 0);
  for (const s of scores) histogram[Math.min(10, Math.max(0, Math.floor(s)))]++;

  // ── Grading ──
  const gradingLabel: TasteInsights['grading']['label'] =
    scored >= 5 && avg >= 8 ? 'generous' : scored >= 5 && avg <= 6.5 ? 'tough' : 'balanced';
  // The platform mean excludes self-picked slider scores (they never feed
  // community numbers), so the comparison must leave them out on this
  // side too or a slider-heavy account reads as generous by construction.
  const h2h = scoredRows.filter((r) => r.ratingMethod !== 'slider').map((r) => r.score);
  const avgForPlatform = h2h.length >= 5 ? h2h.reduce((a, b) => a + b, 0) / h2h.length : null;
  const grading = {
    label: gradingLabel,
    vsPlatform: bench?.platformAvgScore != null && avgForPlatform != null ? avgForPlatform - bench.platformAvgScore : null,
    tougherThan: bench?.gradingPercentile != null && avgForPlatform != null ? bench.gradingPercentile : null,
  };

  // ── Price ──
  const counts: [number, number, number, number] = [0, 0, 0, 0];
  for (const r of ratings) {
    const t = (r.price ?? '').length;
    if (t >= 1 && t <= 4) counts[t - 1]++;
  }
  const priced = counts[0] + counts[1] + counts[2] + counts[3];
  const share = counts.map((c) => (priced > 0 ? c / priced : 0)) as [number, number, number, number];
  let dominantTier: number | null = null;
  let dominantShare = 0;
  share.forEach((s, i) => { if (s > dominantShare) { dominantShare = s; dominantTier = i + 1; } });
  const price = {
    share,
    counts,
    dominantTier: priced > 0 ? dominantTier : null,
    dominantShare,
    tiersUsed: counts.filter((c) => c > 0).length,
    concentration: profile.priceDist?.concentration ?? 0,
    platformShare: bench?.platformPriceShare ?? null,
  };

  // ── Cuisines: how much you eat vs how you rate ──
  const cMap = new Map<string, { n: number; sum: number }>();
  for (const r of scoredRows) {
    for (const t of cuisineTokens(r.cuisine)) {
      const slot = cMap.get(t) ?? { n: 0, sum: 0 };
      slot.n++;
      slot.sum += r.score;
      cMap.set(t, slot);
    }
  }
  const cuisines: CuisineRow[] = Array.from(cMap.entries())
    .map(([name, { n: cn, sum }]) => ({
      name: titleCase(name), n: cn, share: scored > 0 ? cn / scored : 0, avg: sum / cn, rel: sum / cn - anchor,
    }))
    .sort((a, b) => b.n - a.n || b.avg - a.avg);
  const eligible = cuisines.filter((c) => c.n >= 2);
  const medianShare = eligible.length
    ? [...eligible].sort((a, b) => a.share - b.share)[Math.floor(eligible.length / 2)].share
    : 0;
  const loveMoreThanEat = eligible
    .filter((c) => c.rel >= 0.5 && c.share <= medianShare && cuisines.indexOf(c) >= 2)
    .sort((a, b) => b.rel - a.rel)[0] ?? null;
  const eatMoreThanLove = eligible
    .filter((c) => c.rel <= -0.4 && cuisines.indexOf(c) < 3)
    .sort((a, b) => a.rel - b.rel)[0] ?? null;

  const breadth = {
    count: cMap.size,
    platformAvg: bench?.avgCuisineCount ?? null,
    percentile: bench?.breadthPercentile ?? null,
  };

  // ── Trend ──
  const timed = ratings
    .map((r) => ({ r, t: ratingTime(r) }))
    .filter((x) => x.t > 0 && x.r.score > 0)
    .sort((a, b) => a.t - b.t);
  const periodMap = new Map<string, { label: string; n: number; sum: number; seen: Set<string>; cuisineN: Map<string, number> }>();
  const cumulative = new Set<string>();
  for (const { r, t } of timed) {
    const { key, label } = quarterKey(t);
    const slot = periodMap.get(key) ?? { label, n: 0, sum: 0, seen: new Set<string>(), cuisineN: new Map<string, number>() };
    slot.n++;
    slot.sum += r.score;
    for (const c of cuisineTokens(r.cuisine)) {
      cumulative.add(c);
      slot.cuisineN.set(c, (slot.cuisineN.get(c) ?? 0) + 1);
    }
    for (const c of cumulative) slot.seen.add(c);
    periodMap.set(key, slot);
  }
  const periods: TrendPeriod[] = Array.from(periodMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, p]) => ({
      key,
      label: p.label,
      n: p.n,
      avg: p.sum / p.n,
      cuisinesToDate: p.seen.size,
      topCuisine: Array.from(p.cuisineN.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .map((p) => ({ ...p, topCuisine: p.topCuisine ? titleCase(p.topCuisine) : null }));
  const cutoff = now - 90 * 86_400_000;
  const recent = timed.filter((x) => x.t >= cutoff);
  const prior = timed.filter((x) => x.t < cutoff);
  const meanOf = (xs: typeof timed) => (xs.length ? xs.reduce((s, x) => s + x.r.score, 0) / xs.length : null);
  const topCuisineOf = (xs: typeof timed): string | null => {
    const m = new Map<string, number>();
    for (const x of xs) for (const c of cuisineTokens(x.r.cuisine)) m.set(c, (m.get(c) ?? 0) + 1);
    const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0];
    return top ? titleCase(top[0]) : null;
  };
  const priorCuisines = new Set<string>();
  for (const x of prior) for (const c of cuisineTokens(x.r.cuisine)) priorCuisines.add(c);
  const newCuisines = Array.from(new Set(
    recent.flatMap((x) => cuisineTokens(x.r.cuisine)).filter((c) => !priorCuisines.has(c)),
  )).map(titleCase);
  const recentAvg = meanOf(recent);
  const priorAvg = meanOf(prior);
  const trend = {
    periods,
    recentN: recent.length,
    priorN: prior.length,
    recentAvg,
    priorAvg,
    drift: recent.length >= 3 && prior.length >= 3 && recentAvg != null && priorAvg != null ? recentAvg - priorAvg : null,
    newCuisines: prior.length >= 3 ? newCuisines : [],
    recentTopCuisine: recent.length >= 3 ? topCuisineOf(recent) : null,
    priorTopCuisine: prior.length >= 3 ? topCuisineOf(prior) : null,
  };

  // ── Habits ──
  const withReturn = ratings.filter((r) => typeof r.wouldReturn === 'boolean');
  const returnRate = withReturn.length >= 3
    ? withReturn.filter((r) => r.wouldReturn).length / withReturn.length
    : null;
  const extra = opts.extraVisits ?? {};
  const repeatShare = n >= 5
    ? ratings.filter((r) => (extra[r.restaurantId] ?? 0) > 0).length / n
    : null;
  const socialShare = n > 0 ? ratings.filter((r) => (r.friendIds?.length ?? 0) > 0).length / n : 0;
  const notesShare = n > 0 ? ratings.filter((r) => (r.notes ?? '').trim()).length / n : 0;
  const photosShare = n > 0 ? ratings.filter((r) => (r.photos?.length ?? 0) > 0).length / n : 0;
  const dayCounts = Array.from({ length: 7 }, () => 0);
  let dated = 0;
  for (const r of ratings) {
    const d = parseVisitDay(r.visitDate);
    if (!d) continue;
    dayCounts[d.getDay()]++;
    dated++;
  }
  const weekendShare = dated >= 8 ? (dayCounts[0] + dayCounts[6]) / dated : null;
  let favoriteDay: string | null = null;
  if (dated >= 8) {
    const best = dayCounts.reduce((bi, c, i, arr) => (c > arr[bi] ? i : bi), 0);
    // Only a real preference — at least a third of visits on one day.
    if (dayCounts[best] / dated >= 0.34) favoriteDay = DAY_NAMES[best];
  }
  let michelin: TasteInsights['habits']['michelin'] = null;
  if (opts.michelinById && n > 0) {
    let count = 0;
    let starCount = 0;
    let totalStars = 0;
    let bibCount = 0;
    for (const r of ratings) {
      const hit = opts.michelinById.get(r.restaurantId);
      if (!hit) continue;
      count++;
      if (hit.stars > 0) { starCount++; totalStars += hit.stars; }
      else if (hit.bibGourmand) bibCount++;
    }
    if (count > 0) michelin = { count, starCount, totalStars, bibCount, share: count / n };
  }
  const cityMap = new Map<string, number>();
  for (const r of ratings) {
    const c = cityToken(r.address);
    if (c) cityMap.set(c, (cityMap.get(c) ?? 0) + 1);
  }
  const cities = Array.from(cityMap.entries())
    .map(([name, cn]) => ({ name: titleCase(name), n: cn }))
    .sort((a, b) => b.n - a.n);
  const months = new Set<string>();
  let firstAt: number | null = null;
  for (const { t } of timed) {
    const m = monthKey(t);
    if (m) months.add(m);
    if (firstAt == null || t < firstAt) firstAt = t;
  }
  const spanMonths = firstAt != null ? Math.max(1, (now - firstAt) / (30.44 * 86_400_000)) : null;
  const habits = {
    returnRate, repeatShare, socialShare, notesShare, photosShare, weekendShare, favoriteDay,
    michelin, cities, activeMonths: months.size,
    perMonth: spanMonths != null && scored >= 3 ? scored / spanMonths : null,
    firstAt,
  };

  // ── Tags ──
  const tagMax = Math.max(1, ...Object.values(profile.tagScore).filter((v) => v > 0));
  const tags = Object.entries(profile.tagScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, v]) => ({ name, weight: v / tagMax }));

  // ── Quiz ──
  const q = opts.quiz ?? null;
  const quiz = {
    completed: !!q?.completedAt,
    influence: profile.quizMass,
    cuisines: q?.cuisines ?? [],
    avoid: q?.avoidCuisines ?? [],
    dietary: q?.dietary ?? [],
    atmosphere: q?.atmosphere ?? null,
  };

  const distinctive = {
    score: profile.distinctiveTaste ?? 0,
    percentile: bench?.distinctivePercentile ?? null,
  };

  // ── Palate identity ──
  const petals = buildPetals(cuisines, scored);
  const palate = {
    ...buildArchetype({
      scored, cuisines, petals,
      dominantTier: price.dominantTier, dominantShare: price.dominantShare,
      premiumShare: priced > 0 ? (counts[2] + counts[3]) / priced : 0,
      michelinShare: michelin?.share ?? 0,
      repeatShare, cityCount: cityMap.size, weekendShare,
    }),
    petals,
  };

  // ── Sentences ──
  // Second person by default; someone else's profile gets the same facts
  // in the third person. `t(second, third)` picks per sentence — a name
  // needs different verbs, not just a swapped pronoun.
  const N = opts.voice?.name?.trim() || '';
  const third = N.length > 0;
  const Ns = `${N}'s`;
  const t = (second: string, thirdPerson: string) => (third ? thirdPerson : second);
  const sentences: InsightSentence[] = [];
  const say = (id: string, headline: string, detail: string, weight: number) =>
    sentences.push({ id, headline, detail, weight });

  if (bench?.rankedUsers && bench.rankedUsers >= 5 && distinctive.percentile != null && distinctive.percentile >= 0.75 && scored >= 10) {
    say('distinctive',
      `A palate in the top ${Math.max(1, Math.round((1 - distinctive.percentile) * 100))}% for distinctiveness`,
      t('Premium tiers plus cuisine breadth — you go further than most raters do.',
        `Premium tiers plus cuisine breadth — ${N} goes further than most raters do.`), 100);
  }

  if (scored >= 5 && grading.vsPlatform != null && bench?.platformAvgScore) {
    const diff = grading.vsPlatform;
    const relPct = Math.abs(diff) / bench.platformAvgScore;
    const mean = fmt1(avgForPlatform ?? avg);
    if (relPct >= 0.04) {
      const tougher = diff < 0;
      const cmp = grading.tougherThan != null && bench.rankedUsers >= 5
        ? ` — ${tougher ? 'stricter' : 'kinder'} than ${pct(tougher ? grading.tougherThan : 1 - grading.tougherThan)} of raters`
        : '';
      say('grading',
        t(`You grade ${Math.round(relPct * 100)}% ${tougher ? 'tougher' : 'more generously'} than the average rater`,
          `${N} grades ${Math.round(relPct * 100)}% ${tougher ? 'tougher' : 'more generously'} than the average rater`),
        t(`Your mean is ${mean} against a GoodEats mean of ${fmt1(bench.platformAvgScore)}${cmp}.`,
          `${Ns} mean is ${mean} against a GoodEats mean of ${fmt1(bench.platformAvgScore)}${cmp}.`),
        tougher ? 90 : 80);
    } else {
      say('grading', t('You grade right on the GoodEats average', `${N} grades right on the GoodEats average`),
        t(`Your mean is ${mean}; the platform's is ${fmt1(bench.platformAvgScore)}.`,
          `${Ns} mean is ${mean}; the platform's is ${fmt1(bench.platformAvgScore)}.`), 40);
    }
  } else if (scored >= 5) {
    if (gradingLabel === 'tough') say('grading', 'A tough grader', t(`Your mean is ${fmt1(avg)} — an 8 from you is real praise.`, `${Ns} mean is ${fmt1(avg)} — an 8 from ${N} is real praise.`), 70);
    else if (gradingLabel === 'generous') say('grading', 'A generous grader', t(`Your mean is ${fmt1(avg)} — a 7 from you is a complaint.`, `${Ns} mean is ${fmt1(avg)} — a 7 from ${N} is a complaint.`), 60);
    else say('grading', 'A balanced grader', t(`Your mean is ${fmt1(avg)}, with scores landing on both sides of it.`, `${Ns} mean is ${fmt1(avg)}, with scores landing on both sides of it.`), 40);
  }

  if (priced >= 5 && price.dominantTier != null) {
    const sym = PRICE_SYMBOLS[price.dominantTier - 1];
    if (price.dominantShare >= 0.6) {
      const only = bench?.concentratedUserShare != null && bench.rankedUsers >= 5 ? `; only ${pct(bench.concentratedUserShare)} of raters are that concentrated` : '';
      say('price', t(`You live in ${sym}`, `${N} lives in ${sym}`),
        t(`${pct(price.dominantShare)} of your ratings sit in one price tier${only}.`,
          `${pct(price.dominantShare)} of ${Ns} ratings sit in one price tier${only}.`), 75);
    } else if (price.tiersUsed >= 3 && price.dominantShare < 0.45) {
      say('price', t(`You eat across ${price.tiersUsed} price tiers`, `${N} eats across ${price.tiersUsed} price tiers`),
        t(`No tier holds more than ${pct(price.dominantShare)} of your ratings — spend follows the food, not a budget.`,
          `No tier holds more than ${pct(price.dominantShare)} of ${Ns} ratings — spend follows the food, not a budget.`), 55);
    } else {
      say('price', `Mostly ${sym}`,
        t(`${pct(price.dominantShare)} of your ratings — with room for the occasional splurge.`,
          `${pct(price.dominantShare)} of ${Ns} ratings — with room for the occasional splurge.`), 45);
    }
  }

  if (michelin && michelin.count >= 2 && scored >= 8) {
    const top = [...scoredRows].sort((a, b) => b.score - a.score).slice(0, 10);
    const inTop = top.filter((r) => opts.michelinById?.has(r.restaurantId)).length;
    if (inTop >= 2) {
      say('michelin', t(`${inTop} of your top ${top.length} are Michelin-recognized`, `${inTop} of ${Ns} top ${top.length} are Michelin-recognized`), michelinDetail(michelin), 85);
    } else {
      say('michelin', `${michelin.count} Michelin-recognized places rated`,
        `${michelinDetail(michelin)} ${t('Your top 10 is mostly your own finds.', `${Ns} top 10 is mostly their own finds.`)}`, 50);
    }
  }

  if (loveMoreThanEat) {
    say('love-more', t(`You love ${loveMoreThanEat.name} more than you eat it`, `${N} loves ${loveMoreThanEat.name} more than they eat it`),
      t(`Only ${loveMoreThanEat.n} ratings, but an average of ${fmt1(loveMoreThanEat.avg)} — ${fmt1(loveMoreThanEat.rel)} above your bar.`,
        `Only ${loveMoreThanEat.n} ratings, but an average of ${fmt1(loveMoreThanEat.avg)} — ${fmt1(loveMoreThanEat.rel)} above ${Ns} bar.`), 88);
  }
  if (eatMoreThanLove) {
    say('eat-more', t(`You eat ${eatMoreThanLove.name} more than you love it`, `${N} eats ${eatMoreThanLove.name} more than they love it`),
      t(`${eatMoreThanLove.n} ratings averaging ${fmt1(eatMoreThanLove.avg)}, under your ${fmt1(anchor)} bar.`,
        `${eatMoreThanLove.n} ratings averaging ${fmt1(eatMoreThanLove.avg)}, under ${Ns} ${fmt1(anchor)} bar.`), 72);
  }

  if (cMap.size >= 3) {
    if (breadth.platformAvg != null && bench?.rankedUsers && bench.rankedUsers >= 5 && breadth.count >= breadth.platformAvg + 3) {
      say('breadth', `${breadth.count} cuisines — ${Math.round(breadth.count - breadth.platformAvg)} more than the average rater`,
        breadth.percentile != null ? `Broader than ${pct(breadth.percentile)} of GoodEats.` : 'A wide palate.', 78);
    } else if (cuisines[0]) {
      say('breadth', `${cuisines[0].name} first, ${cMap.size} cuisines deep`,
        `${cuisines[0].n} of ${scored} ratings are ${cuisines[0].name}${cuisines[1] ? `; ${cuisines[1].name} is next` : ''}.`, 50);
    }
  }

  if (repeatShare != null && n >= 8) {
    if (repeatShare <= 0.1) say('loyalty', 'An explorer, not a regular', t(`${pct(1 - repeatShare)} of your rated places have a single logged visit.`, `${pct(1 - repeatShare)} of ${Ns} rated places have a single logged visit.`), 58);
    else if (repeatShare >= 0.3) say('loyalty', t('A regular — you go back', `A regular — ${N} goes back`), t(`${pct(repeatShare)} of your rated places have more than one visit logged.`, `${pct(repeatShare)} of ${Ns} rated places have more than one visit logged.`), 62);
  }
  if (returnRate != null && withReturn.length >= 8 && returnRate <= 0.6) {
    say('return', 'Hard to win a second visit', t(`You'd go back to only ${pct(returnRate)} of the places you've rated.`, `${N} would go back to only ${pct(returnRate)} of the places they've rated.`), 56);
  }

  if (weekendShare != null) {
    if (weekendShare >= 0.6) say('weekend', 'A weekend diner', t(`${pct(weekendShare)} of your visits fall on a Saturday or Sunday.`, `${pct(weekendShare)} of ${Ns} visits fall on a Saturday or Sunday.`), 52);
    else if (weekendShare <= 0.25) say('weekend', 'A weeknight diner', t(`Only ${pct(weekendShare)} of your visits fall on a weekend.`, `Only ${pct(weekendShare)} of ${Ns} visits fall on a weekend.`), 52);
    else if (favoriteDay) say('weekend', t(`${favoriteDay}s are your night`, `${favoriteDay}s are ${Ns} night`), t(`${pct(dayCounts[DAY_NAMES.indexOf(favoriteDay)] / dated)} of your visits land on a ${favoriteDay}.`, `${pct(dayCounts[DAY_NAMES.indexOf(favoriteDay)] / dated)} of ${Ns} visits land on a ${favoriteDay}.`), 48);
  }

  if (trend.drift != null && Math.abs(trend.drift) >= 0.3) {
    say('drift', t(`Your scores have drifted ${trend.drift > 0 ? 'up' : 'down'} ${fmt1(Math.abs(trend.drift))} lately`, `${Ns} scores have drifted ${trend.drift > 0 ? 'up' : 'down'} ${fmt1(Math.abs(trend.drift))} lately`),
      `Last 90 days average ${fmt1(recentAvg!)} against ${fmt1(priorAvg!)} before.`, 66);
  }
  // Two-to-ten new cuisines is a discovery streak; thirty is an import
  // that landed inside the window, and no sentence should brag about it.
  if (trend.newCuisines.length >= 2 && trend.newCuisines.length <= 10) {
    say('new-cuisines', `${trend.newCuisines.length} new cuisines in the last 90 days`,
      `${trend.newCuisines.slice(0, 3).join(', ')}${trend.newCuisines.length > 3 ? '…' : ''} — all first-timers.`, 64);
  }
  if (socialShare >= 0.5 && n >= 6) {
    say('social', t('You mostly eat with company', `${N} mostly eats with company`), t(`${pct(socialShare)} of your ratings tag a friend at the table.`, `${pct(socialShare)} of ${Ns} ratings tag a friend at the table.`), 46);
  }
  if (notesShare >= 0.5 && n >= 6) {
    say('notes', 'A note-taker', t(`${pct(notesShare)} of your ratings come with written notes.`, `${pct(notesShare)} of ${Ns} ratings come with written notes.`), 44);
  }

  sentences.sort((a, b) => b.weight - a.weight);

  // ── Chips for the card ──
  const chips: string[] = [];
  if (distinctive.percentile != null && bench?.rankedUsers && bench.rankedUsers >= 5 && distinctive.percentile >= 0.75 && scored >= 10) {
    chips.push(`Top ${Math.max(1, Math.round((1 - distinctive.percentile) * 100))}% distinctive`);
  }
  if (scored >= 5) chips.push(gradingLabel === 'tough' ? 'Tough grader' : gradingLabel === 'generous' ? 'Generous grader' : 'Balanced grader');
  if (priced >= 5 && price.dominantTier != null && price.dominantShare >= 0.5) chips.push(`Lives in ${PRICE_SYMBOLS[price.dominantTier - 1]}`);
  if (cuisines[0] && scored >= 3) chips.push(`${cuisines[0].name} first`);
  if (chips.length < 3 && michelin && michelin.count >= 2) chips.push(`${michelin.count} Michelin`);
  if (chips.length < 3 && cMap.size >= 6) chips.push(`${cMap.size} cuisines`);

  return {
    n, scored, avg, median, anchor, p90, spread, histogram,
    grading, price, cuisines, loveMoreThanEat, eatMoreThanLove, breadth, trend, habits, tags, quiz,
    distinctive, palate, sentences, chips: chips.slice(0, 3),
  };
}
