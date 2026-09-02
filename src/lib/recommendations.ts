import type { PlaceResult } from './places';
import { extractCityState, CUISINE_TYPES, searchPlacesByText, searchPlacesByTextPaged, isFoodPlace, isLodgingPlace, isVenuePlace, TEXT_EXACT_SUFFICIENT_POOL } from './places';
import type { CommunityRating } from './supabase-community';
import {
  getExpertRatings,
  getAllFriendRatings,
  getExpertProfiles,
  getTagSimilarRestaurants,
  getFollowedExpertIds,
  getCommunityPricesForPlaces,
  getCommunityRatingStats,
  countsForCommunity,
} from './supabase-community';
import { locationKey, recPrefsHash, getHomeRecsCache, saveHomeRecsCache } from './supabase-rec-cache';
import type { RestaurantRating, WishlistItem, CustomList } from '../contexts/ListsContext';
import {
  ensureMichelinIndex,
  findMichelinMatchSync,
  michelinNearbySync,
  michelinToPlaceResult,
  isMichelinSyntheticId,
  isMichelinIndexReady,
  normalize as normalizeName,
  type MichelinInfo,
} from './michelin';
import { haversineDistanceMi } from './distance';
import { getRestaurantGeoBatch } from './restaurant-geo';

/**
 * How many rated restaurants it takes to unlock personalized recommendations.
 *
 * Below this the ranking is not really "yours": the cuisine/price/pair terms
 * are running on a handful of observations, one lucky 9.0 at a single
 * Peruvian place outweighs everything else, and `priceDist`'s hard band
 * (which needs n ≥ 8) hasn't switched on at all — so the list degrades into
 * top-rated-nearby wearing a personalized label. Ten is where the profile's
 * own confidence machinery is fully armed: quizMass has decayed to 0 (the
 * stated-preference priors are gone), `scoreP90` exists to cap predictions,
 * and the price band has enough mass to exclude tiers rather than merely
 * demote them. Gating on it is the honest version of the promise the
 * surface makes.
 */
export const RECS_MIN_RATINGS = 10;

export function recsUnlocked(ratingCount: number): boolean {
  return ratingCount >= RECS_MIN_RATINGS;
}

export interface TasteProfile {
  cuisineScore: Record<string, number>;
  /** How much EVIDENCE backs each cuisine's score — real ratings count 1,
   *  wishlist intent 0.5, a stated quiz cuisine `2 × quizMass`. Drives the
   *  confidence shrinkage in scoreCandidates so a cuisine seen once doesn't
   *  speak as loudly as one seen a dozen times. */
  cuisineCounts: Record<string, number>;
  priceScore: Record<number, number>;
  priceCounts: Record<number, number>;       // legacy alias for priceScore (Map.tsx consumers)
  pairScore: Record<string, number>;         // "cuisine|price"
  /** Evidence behind each cuisine|price pair, same scale as cuisineCounts. */
  pairCounts: Record<string, number>;
  tagScore: Record<string, number>;
  cityScore: Record<string, number>;
  topCuisines: string[];
  topPrices: number[];
  topPairs: { cuisine: string; price: number }[];
  topTags: string[];
  topCities: string[];
  topCity: string | null;                    // first element of topCities, or null
  highRatedCount: number;
  /** Total ratings with a real score — every rating is taste evidence,
   *  good or bad. Drives the scorer's `ramp`. */
  scoreN: number;
  /** How much the stated quiz answers still count, 1 → 0 as real ratings
   *  accumulate. Exposed so the scorer can weigh stated taste without
   *  recomputing it. */
  quizMass: number;
  ratedIds: Set<string>;
  wishlistedIds: Set<string>;
  recentlyViewedIds: Set<string>;
  /** The user's mean rating (0 when they haven't rated anything). Affinity
   *  weights center on this (shrunk toward 7) so a tough grader's 6.5 and an
   *  easy grader's 8.5 both read as "above their bar". */
  avgScore: number;
  /** Own score per rated restaurant — powers friend taste-similarity, which
   *  weighs a friend's opinion by how often you two have agreed. */
  myScoreById: Map<string, number>;
  /** Where the user's money actually goes: positive-weight share per price
   *  tier, its center of mass, and how concentrated it is. Drives the price
   *  fit term and the price-restricted candidate queries. */
  priceDist?: {
    share: [number, number, number, number]; // index 0 = tier 1 ($)
    center: number;        // μ = Σ tier·share
    sigma: number;         // spread of the distribution
    concentration: number; // 0..1 — high = spends in a narrow band, trusted with volume
    n: number;             // positively-weighted priced ratings behind it
  };
  /** 0..1 — how much this palate skews distinctive (premium tiers + breadth
   *  of cuisines). Scales the Michelin/boutique boost and dampens raw
   *  popularity for users who clearly don't chase crowds. */
  distinctiveTaste?: number;
  /** The shrunk personal mean the affinity weights center on — exposed so the
   *  predicted score speaks the user's own scale. */
  anchor?: number;
  /** 90th percentile of the user's own scores (undefined under 8 ratings) —
   *  caps predictions so we never promise above their realistic ceiling. */
  scoreP90?: number;
  /** normalize()d names of every rated restaurant — suppresses Michelin
   *  synthetic candidates that duplicate an already-rated place under a
   *  different id. */
  ratedNames?: Set<string>;
  /** Share of the user's positively-weighted ratings that match each Michelin
   *  distinction bucket. Only computed once the dataset has loaded (the
   *  builder is sync); a heavy star-chaser gets starred candidates boosted,
   *  a Bib hunter gets Bibs. */
  michelinTaste?: { starShare: number; bibShare: number; selectedShare: number };
}

export interface RecTargetLocation {
  label: string;        // "Los Angeles, CA" (may be empty for "Current Location")
  lat: number;
  lng: number;
}

export interface RecOptions {
  userId: string | null;
  profile: TasteProfile;
  target: RecTargetLocation;
  radiusMeters: number;           // scopes Google queries and post-filters all pools
  signal?: AbortSignal;
  /** Ranked results to return. Default 12; the full recs browser asks for ~60. */
  limit?: number;
  /** Google text queries per fresh fetch. Default 5; more = wider pool. */
  maxQueries?: number;
  /** Keep wishlisted places in the ranking (they get an "On your wishlist"
   *  reason chip instead of being hidden — a wishlisted spot IS a good rec). */
  keepWishlisted?: boolean;
  /** Hard-drop price tiers the user demonstrably never spends in (see
   *  ScoreCandidatesOptions.enforcePriceBand). Default true here — this is
   *  the recommendation entry point, not a browse surface. */
  enforcePriceBand?: boolean;
  /** Tonight's stated price tiers — reaches the Google queries themselves
   *  (see buildCandidateQueries), because a pool gathered for a premium
   *  band contains nothing for a "not too expensive" ask to rank. Also
   *  varies the cache fingerprint so a stale premium pool isn't treated
   *  as a full hit for a budget request. */
  priceTiersOverride?: number[];
  /** Tonight's mood words for the text search itself (see
   *  buildCandidateQueries tier 0). Also part of the cache fingerprint. */
  moodTerms?: string[];
}

/** A candidate entering the scorer. Michelin info and the in-app community
 *  rating count (when the pool stage found them) ride along so scoring stays
 *  synchronous and dataset-free. */
export interface RecCandidate extends PlaceResult {
  michelin?: { stars: 0 | 1 | 2 | 3; bibGourmand: boolean; selected: boolean };
  /** Distinct app users who have rated this place — the platform-popularity
   *  signal. Near-zero today; grows with the community. */
  appRatingCount?: number;
  /** Mean community score (0–10). As raters accumulate, the quality term
   *  hands over from the Google star rating to THIS — recs eventually run on
   *  what users of the app actually think, not Google. */
  appAvgScore?: number;
}

export interface ScoredPlace extends RecCandidate {
  recScore: number;
  sources: Array<'google' | 'tagSimilar' | 'expert' | 'friend' | 'expertRec' | 'michelin' | 'mood'>;
  /** Human-readable "why this" chips, strongest factor first (≤3). Absent on
   *  legacy call sites that fabricate ScoredPlace literals. */
  reasons?: string[];
  /** The subset of `reasons` derived from the user's OWN stated or rated
   *  taste, strongest first — as opposed to Google's crowd, Michelin, or
   *  the community. A surface claiming "built from your answers" should
   *  lead with one of these; when it's empty, it has no such claim to
   *  make. Also the `rec_chip_rate` honesty metric. */
  tasteReasons?: string[];
  /** Beli-style prediction of the score THIS user would give the place, on
   *  their own 0–10 scale (one decimal, floor 5.0). Replaces the old match %. */
  predicted?: number;
}

/**
 * Every factor below is normalized to [-1, 1] before its weight is applied
 * (see scoreCandidates), so these are directly comparable: taste-pair match
 * and a like-minded friend's rave are the loudest signals, quality/cuisine
 * next, popularity is a mild tiebreaker.
 */
export const DEFAULT_WEIGHTS = {
  cuisine: 1.6,
  price: 0.9,              // base — grows up to 2.0 with price concentration
  pair: 1.8,
  tagOverlap: 1.1,
  popularity: 0.5,         // Google crowds — dampened as distinctiveTaste rises
  appPopularity: 0.8,      // in-app raters; saturates at ~20 (dormant until the community grows)
  quality: 1.5,
  distinctive: 1.4,        // Michelin / boutique boost, scaled by the palate
  michelinTaste: 1.0,      // extra lift when the user demonstrably chases that distinction
  expert: 1.0,
  friend: 1.6,
  wishlist: 0.6,
  distance: 1.2,           // max penalty for landing well past the radius edge
  negativeMult: 1.5,       // disliked cuisines/pairs push down harder than likes lift
  moodMatch: 2.2,          // tonight's stated words — see CandidateSignals.moodMatchIds
} as const;

/**
 * Whether a Google-sourced place belongs in a RECOMMENDATION pool at all:
 * it must be a food place, and must be neither lodging nor a venue that
 * merely contains food.
 *
 * Hotels (Airelles, Cheval Blanc, …) rank high on "fine dining <city>" text
 * queries and often carry their restaurants' cuisine types on the property
 * POI itself, so a food-type check alone lets them through — and
 * recommending the hotel instead of its restaurant is always wrong. Cinemas,
 * malls and stadiums fail the same way via their concessions and food
 * courts. In every case the actual restaurant is a separate place with its
 * own id. Exported for tests.
 */
export function recPoolEligible(p: { types: string[]; primaryType?: string }): boolean {
  return isFoodPlace(p.types) && !isLodgingPlace(p.types) && !isVenuePlace(p);
}

/** "Korean, Contemporary" / "Sushi / Japanese" → ["Korean","Contemporary"] … */
function splitCuisines(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/[,/]|\s&\s/).map((s) => s.trim()).filter(Boolean);
}

/** The slice of the onboarding palette test recommendations can act on.
 *  Structurally matches lib/taste-quiz's TasteQuizAnswers — declared here so
 *  this pure module never imports the storage layer. */
export interface TasteQuizSignals {
  cuisines?: string[];
  /** Legacy flat shape — stated spending comfort, tiers 1–4, in selection
   *  order. Still read (see quizPriceTiers) so rows written before the
   *  primary/secondary split keep working. */
  prices?: number[];
  /** "A normal night out" — the dominant tier. A single dominant tier is
   *  what crosses priceDist's concentration threshold; a flat multi-select
   *  does not. */
  pricePrimary?: number;
  /** "…and when I'm celebrating" — optional, half the weight. */
  priceSecondary?: number;
  /** Cuisines the user would rather skip → negative priors. */
  avoidCuisines?: string[];
  /** Stated home city label → city affinity seed. */
  city?: string;
  /** Dietary preference keys → positive tag priors (DIETARY_TAG_PRIORS). */
  dietary?: string[];
  /** Atmosphere option id from the quiz ('intimate' | 'vibrant' |
   *  'minimalist' | 'rustic') — mapped onto rating-tag priors below. */
  atmosphere?: string;
}

/**
 * The stated price tiers as [primary, secondary?].
 *
 * Reads the primary/secondary fields when present and falls back to the
 * legacy flat `prices` array — taking prices[0] as primary and prices[1]
 * as secondary — so existing taste_profile rows need no migration.
 */
export function quizPriceTiers(quiz?: TasteQuizSignals | null): number[] {
  if (!quiz) return [];
  if (typeof quiz.pricePrimary === 'number') {
    return typeof quiz.priceSecondary === 'number'
      ? [quiz.pricePrimary, quiz.priceSecondary]
      : [quiz.pricePrimary];
  }
  return quiz.prices ?? [];
}

/** Dietary answer → the ALL_TAGS tokens it implies. Same invariant as
 *  ATMOSPHERE_TAG_PRIORS: exact tokens only, or the prior matches nothing. */
const DIETARY_TAG_PRIORS: Record<string, string[]> = {
  vegetarian: ['Good Vegetarian Options'],
  vegan: ['Good Vegetarian Options', 'Healthy Options'],
  healthy: ['Healthy Options', 'Fresh Ingredients'],
};

/** Quiz atmosphere answers → the rating tags they imply. Values MUST be
 *  tokens from RatingShared.ALL_TAGS — tagScore is keyed by exactly what
 *  raters pick, and topTags feeds getTagSimilarRestaurants, so an invented
 *  label here would be a prior on a tag nobody has ever applied. */
const ATMOSPHERE_TAG_PRIORS: Record<string, string[]> = {
  intimate: ['Intimate', 'Romantic', 'Cozy Atmosphere'],
  vibrant: ['Lively Energy', 'Hip & Trendy'],
  minimalist: ['Quiet & Peaceful', 'Charming Decor'],
  rustic: ['Cozy Atmosphere', 'Charming Decor'],
};

export function buildTasteProfile(
  ratings: RestaurantRating[],
  wishlist: WishlistItem[],
  lists: CustomList[],
  recentViews: Array<{ id: string }>,
  quiz?: TasteQuizSignals | null,
): TasteProfile {
  const cuisineScore: Record<string, number> = {};
  const cuisineCounts: Record<string, number> = {};
  const priceScore: Record<number, number> = {};
  const pairScore: Record<string, number> = {};
  const pairCounts: Record<string, number> = {};
  const tagScore: Record<string, number> = {};
  const cityScore: Record<string, number> = {};
  const myScoreById = new Map<string, number>();
  let highRatedCount = 0;

  // Personal anchor: the user's own mean, shrunk toward 7 so tiny samples
  // don't overreact. A tough grader's 6.5 counts as praise; a generous
  // grader's 7.5 doesn't.
  let scoreSum = 0;
  let scoreN = 0;
  for (const r of ratings) {
    if (r.score <= 0) continue;
    scoreSum += r.score;
    scoreN++;
  }
  const avgScore = scoreN > 0 ? scoreSum / scoreN : 0;
  const anchor = scoreN > 0 ? (scoreSum + 7 * 5) / (scoreN + 5) : 7;
  const now = Date.now();

  // Accumulators for the price distribution / distinctive-taste stats —
  // positive-weight side only, so they describe where the user's enthusiasm
  // actually goes rather than every place they've merely been.
  const priceMass: [number, number, number, number] = [0, 0, 0, 0];
  let pricedPositiveN = 0;
  const positiveCuisines = new Set<string>();
  const positiveScores: number[] = [];
  const ratedNames = new Set<string>();

  for (const r of ratings) {
    if (r.score <= 0) continue;
    myScoreById.set(r.restaurantId, r.score);
    if (r.name) ratedNames.add(normalizeName(r.name));
    const centered = r.score - anchor;
    let weight = centered >= 0 ? centered + 1 : centered * 1.25;

    // Recency: 18-month half-life on when the rating was logged, floored so
    // old favorites fade but never vanish — tastes drift, they don't reset.
    const ageDays = r.createdAt > 0 ? Math.max(0, (now - r.createdAt) / 86_400_000) : 0;
    const recency = Math.max(0.35, Math.pow(0.5, ageDays / 540));
    weight *= recency;

    const price = r.price.length;

    // Ratings often carry compound labels ("Korean, Contemporary"); credit
    // every token so they match candidates' single inferred cuisine labels.
    for (const token of splitCuisines(r.cuisine)) {
      cuisineScore[token] = (cuisineScore[token] || 0) + weight;
      // A rating is one full observation of this cuisine regardless of how
      // enthusiastic it was — `weight` says how MUCH the user liked it,
      // `counts` says how much we've actually seen. A single strong opinion
      // and a dozen consistent ones must not carry equal authority.
      cuisineCounts[token] = (cuisineCounts[token] || 0) + 1;
      if (price > 0) {
        const key = `${token}|${price}`;
        pairScore[key] = (pairScore[key] || 0) + weight * 1.5;
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }

    for (const tag of r.tags) {
      tagScore[tag] = (tagScore[tag] || 0) + weight * 0.75;
    }

    if (price > 0) {
      priceScore[price] = (priceScore[price] || 0) + weight;
    }
    if (weight > 0) {
      positiveScores.push(r.score);
      for (const token of splitCuisines(r.cuisine)) positiveCuisines.add(token);
      if (price >= 1 && price <= 4) {
        priceMass[price - 1] += weight;
        pricedPositiveN++;
      }
    }

    const city = extractCityState(r.address, r.address);
    if (city) {
      cityScore[city] = (cityScore[city] || 0) + Math.max(weight, 0);
    }

    if (r.score >= 8) highRatedCount++;
  }

  // Wishlisting is declared intent — a mild positive on the cuisine even when
  // the price is unknown (the old `cuisine && price` guard silently dropped
  // every priceless wishlist row).
  for (const w of wishlist) {
    const price = w.price.length;
    for (const token of splitCuisines(w.cuisine)) {
      cuisineScore[token] = (cuisineScore[token] || 0) + 0.5;
      // Intent is half an observation: enough that a wishlist-only cuisine
      // still registers, not enough to speak like a visit you scored.
      cuisineCounts[token] = (cuisineCounts[token] || 0) + 0.5;
      if (price > 0) {
        const key = `${token}|${price}`;
        pairScore[key] = (pairScore[key] || 0) + 0.375;
        pairCounts[key] = (pairCounts[key] || 0) + 0.5;
      }
    }
    if (price > 0) {
      priceScore[price] = (priceScore[price] || 0) + 0.25;
    }
  }

  // Onboarding palette-test priors: the quiz cuisines seed the profile so a
  // brand-new account's first Discover isn't taste-blind — the promise the
  // quiz makes ("helps us curate") only holds if the answers count. The
  // prior fades as real ratings accumulate (gone by 8): a stated preference
  // is a hint; an actual scored visit is evidence.
  // Zero unless the quiz was actually answered. This value used to be read
  // only inside `quiz?.field` guards, so a phantom mass on an unanswered
  // quiz was harmless; now that `ramp` weighs it, an unanswered quiz must
  // contribute nothing rather than 0.875 of imaginary stated taste.
  const quizAnswered = !!quiz && (
    (quiz.cuisines?.length ?? 0) > 0
    || quizPriceTiers(quiz).length > 0
    || !!quiz.atmosphere
    || (quiz.avoidCuisines?.length ?? 0) > 0
    || (quiz.dietary?.length ?? 0) > 0
  );
  const quizMass = quizAnswered ? Math.max(0, 1 - scoreN / 8) : 0;
  if (quizMass > 0 && quiz?.cuisines) {
    for (const label of quiz.cuisines) {
      for (const token of splitCuisines(label)) {
        // 2.0 at zero ratings: stronger than a wishlist hint (0.5), weaker
        // than an enthusiastic real rating (~3).
        cuisineScore[token] = (cuisineScore[token] || 0) + 2 * quizMass;
        // Matching pseudo-count, so the confidence shrinkage treats a stated
        // cuisine as exactly as much evidence as it is treating it as score.
        // Without this the prior would be shrunk to near-nothing on a
        // brand-new account — the one place it is the ONLY signal there is.
        cuisineCounts[token] = (cuisineCounts[token] || 0) + 2 * quizMass;
      }
    }
  }
  /**
   * Stated price comfort, seeded as a PRIMARY tier plus an optional
   * secondary ("a normal night out", "and when I'm celebrating").
   *
   * It feeds three structures: priceScore (drives topPrices and the
   * cuisine×price queries), priceMass (drives priceDist's shape), and
   * pricedPositiveN (drives priceDist's CONFIDENCE). Without the
   * pseudo-count the confidence factor is 0/(0+6) and a stated "$$$$"
   * changes nothing.
   *
   * The pseudo-count is per NAMED TIER, not a flat constant, and that is
   * load-bearing arithmetic. concentration = (1 − sigma/1.5) × n/(n+6)
   * must clear 0.35 to switch on the price-restricted Places query:
   *   one tier   → sigma 0,     n=4 → 1.000 × 0.400 = 0.400  ✓
   *   two tiers  → sigma 0.471, n=8 → 0.686 × 0.571 = 0.392  ✓
   * A flat seed of 4 (or 6) leaves the two-tier case at 0.267 (0.343) —
   * under the bar for the most natural human answer. More stated
   * information earning more confidence is also the principled reading.
   * Both cases are pinned by tests; do not tune this by hand.
   */
  const statedTiers = quizPriceTiers(quiz).filter((t) => t >= 1 && t <= 4);
  // Two or fewer tiers is a dominant answer (2× primary, 1× secondary).
  // A legacy row naming three or four is the user saying "anywhere" — give
  // those equal weight so the distribution stays wide and honest.
  const dominant = statedTiers.length <= 2;
  const primaryTier = dominant ? statedTiers[0] : undefined;
  const secondaryTier = dominant ? statedTiers[1] : undefined;
  if (quizMass > 0) {
    for (let i = 0; i < statedTiers.length; i++) {
      const tier = statedTiers[i];
      const weight = dominant ? (i === 0 ? 2 : 1) : 1;
      priceScore[tier] = (priceScore[tier] || 0) + weight * quizMass;
      priceMass[tier - 1] += weight * quizMass;
      pricedPositiveN += 4 * quizMass;
    }
  }
  /**
   * Cuisine × price PAIRS — the heaviest term in DEFAULT_WEIGHTS (1.8) and
   * the driver of buildCandidateQueries' first and highest-priority tier.
   *
   * Nothing used to write a pair key from the quiz: cuisines and prices
   * were collected as two independent bags, so topPairs was empty for
   * every quiz-only profile and Tier 1 emitted no queries at all. Asking
   * both on one screen is what makes this signal exist.
   */
  if (quizMass > 0 && quiz?.cuisines && primaryTier !== undefined) {
    for (const label of quiz.cuisines) {
      for (const token of splitCuisines(label)) {
        for (const [tier, weight] of [[primaryTier, 2], [secondaryTier, 1]] as const) {
          if (tier === undefined || tier < 1 || tier > 4) continue;
          const key = `${token}|${tier}`;
          pairScore[key] = (pairScore[key] || 0) + weight * quizMass;
        }
      }
    }
  }
  /**
   * "Anything you'd rather skip?" — negative cuisine priors, symmetrical
   * to the positive seed above. This is what makes DEFAULT_WEIGHTS'
   * negativeMult (1.5) reachable at cold start; before this, a negative
   * cuisineScore could only come from an actual low-scored rating.
   */
  if (quizMass > 0 && quiz?.avoidCuisines) {
    for (const label of quiz.avoidCuisines) {
      for (const token of splitCuisines(label)) {
        cuisineScore[token] = (cuisineScore[token] || 0) - 2 * quizMass;
      }
    }
  }
  // Dietary answers ride in as positive tag priors. Same invariant as
  // ATMOSPHERE_TAG_PRIORS: exact ALL_TAGS tokens only.
  if (quizMass > 0 && quiz?.dietary) {
    for (const key of quiz.dietary) {
      for (const tag of DIETARY_TAG_PRIORS[key] ?? []) {
        tagScore[tag] = (tagScore[tag] || 0) + 1.2 * quizMass;
      }
    }
  }
  // The stated home city seeds city affinity, which is otherwise only ever
  // derived from the addresses of places the user already rated — i.e.
  // empty for exactly the cold-start profile that needs it most.
  if (quizMass > 0 && quiz?.city) {
    const token = extractCityState(quiz.city, quiz.city);
    if (token) cityScore[token] = (cityScore[token] || 0) + 3;
  }
  // Atmosphere lands as tag priors, so a fresh account's topTags aren't
  // empty and getTagSimilarRestaurants has something to match on. 1.5 per
  // tag ≈ what two positively-weighted tagged ratings would contribute.
  if (quizMass > 0 && quiz?.atmosphere) {
    for (const tag of ATMOSPHERE_TAG_PRIORS[quiz.atmosphere] ?? []) {
      tagScore[tag] = (tagScore[tag] || 0) + 1.5 * quizMass;
    }
  }

  /**
   * Built-in list name → the rating tag it implies.
   *
   * Values MUST be tokens from RatingShared.ALL_TAGS, the same invariant
   * ATMOSPHERE_TAG_PRIORS states above — tagScore is keyed by exactly what
   * raters pick, and topTags becomes the query for
   * getTagSimilarRestaurants. Three of these used to be invented labels
   * ('Date Night', 'Cocktails', 'Hidden Gem'); none exists in ALL_TAGS, so
   * no rating could carry them and no community row could match. They
   * occupied topTags slots, sent tag-similarity looking for nothing, and
   * inflated tagMax — diluting every legitimate tag affinity.
   *
   * 'Hidden Gems' has no entry because ALL_TAGS has no hidden-gem token.
   * Inventing one here would just recreate the bug.
   */
  const LIST_TAG_MAP: Record<string, string> = {
    'Date Nights': 'Special Occasion',
    'Best Cocktails': 'Great Cocktails',
    'Quick Bites': 'Quick Bite',
  };
  for (const list of lists) {
    const tag = LIST_TAG_MAP[list.name];
    if (tag && list.restaurantIds.length >= 1) {
      tagScore[tag] = (tagScore[tag] || 0) + 0.5;
    }
  }

  const topCuisines = Object.entries(cuisineScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const topPrices = Object.entries(priceScore)
    .map(([k, v]) => [Number(k), v] as [number, number])
    .filter(([k, v]) => v > 0 && k >= 1 && k <= 4)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k);

  const topPairs = Object.entries(pairScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => {
      const [cuisine, priceStr] = k.split('|');
      return { cuisine, price: Number(priceStr) };
    });

  const topTags = Object.entries(tagScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([k]) => k);

  const topCities = Object.entries(cityScore)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k]) => k);

  const ratedIds = new Set(ratings.map((r) => r.restaurantId));
  const wishlistedIds = new Set(wishlist.map((w) => w.restaurantId));
  const recentlyViewedIds = new Set(recentViews.map((v) => v.id));

  // ── Price distribution ──
  // Wishlist mass is deliberately excluded: declared intent isn't proven
  // spend, and it's exactly what would water a premium profile back down.
  const totalMass = priceMass[0] + priceMass[1] + priceMass[2] + priceMass[3];
  let priceDist: TasteProfile['priceDist'];
  if (totalMass > 0) {
    const share = priceMass.map((m) => m / totalMass) as [number, number, number, number];
    const center = share.reduce((sum, s, i) => sum + s * (i + 1), 0);
    const sigma = Math.sqrt(share.reduce((sum, s, i) => sum + s * (i + 1 - center) ** 2, 0));
    const confidence = pricedPositiveN / (pricedPositiveN + 6);
    const concentration = Math.max(0, Math.min(1, 1 - sigma / 1.5)) * confidence;
    priceDist = { share, center, sigma, concentration, n: pricedPositiveN };
  }

  // ── Distinctive taste ──
  // Premium share carries most of it; cuisine breadth adds the "explores
  // beyond the obvious" dash. Confidence-scaled like concentration.
  const premiumShare = totalMass > 0 ? (priceMass[2] + priceMass[3]) / totalMass : 0;
  const breadth = Math.max(0, Math.min(1, (positiveCuisines.size - 3) / 9));
  const distinctiveTaste =
    Math.max(0, Math.min(1, 0.75 * premiumShare + 0.25 * breadth)) *
    (pricedPositiveN / (pricedPositiveN + 6));

  const scoreP90 = positiveScores.length >= 8
    ? [...positiveScores].sort((a, b) => a - b)[Math.floor((positiveScores.length - 1) * 0.9)]
    : undefined;

  // ── Michelin taste ──
  // How much of the user's (positive) history is Guide-recognized, split by
  // distinction. Sync-gated on the dataset being loaded: the recs browser
  // loads it during the pool gather and rebuilds the profile when it lands;
  // other callers simply skip the boost until then. Name+city matching (the
  // rating rows carry no coords).
  let michelinTaste: TasteProfile['michelinTaste'];
  if (isMichelinIndexReady() && scoreN > 0) {
    let starHits = 0;
    let bibHits = 0;
    let selectedHits = 0;
    let positiveN = 0;
    for (const r of ratings) {
      if (r.score <= 0) continue;
      if (r.score < anchor) continue; // only places they'd actually vouch for
      positiveN++;
      const info = findMichelinMatchSync(r.name, undefined, undefined, r.address);
      if (!info) continue;
      if (info.stars > 0) starHits++;
      else if (info.bibGourmand) bibHits++;
      else if (info.selected) selectedHits++;
    }
    if (positiveN > 0) {
      michelinTaste = {
        starShare: starHits / positiveN,
        bibShare: bibHits / positiveN,
        selectedShare: selectedHits / positiveN,
      };
    }
  }

  return {
    cuisineScore,
    cuisineCounts,
    priceScore,
    priceCounts: priceScore,
    pairScore,
    pairCounts,
    tagScore,
    cityScore,
    topCuisines,
    topPrices,
    topPairs,
    topTags,
    topCities,
    topCity: topCities[0] ?? null,
    highRatedCount,
    scoreN,
    quizMass,
    ratedIds,
    wishlistedIds,
    recentlyViewedIds,
    avgScore,
    myScoreById,
    priceDist,
    distinctiveTaste,
    anchor,
    scoreP90,
    ratedNames,
    michelinTaste,
  };
}

export interface RecQuery {
  text: string;
  /** Google price-level tiers (1–4) to restrict the search to server-side.
   *  Omitted = unrestricted. NOTE: a price filter also excludes places whose
   *  price Google doesn't know, so the builder always leaves some queries
   *  unrestricted to keep unpriced hidden gems in the pool. */
  priceLevels?: number[];
  /** True for the tier-0 queries built from tonight's stated mood. The
   *  gather records which places these returned so the scorer can reward
   *  them — see CandidateSignals.moodMatchIds. */
  mood?: boolean;
}

/** Price tiers the user demonstrably favors: every tier holding ≥ 15% of the
 *  positive price mass. Falls back to the rounded distribution center. */
/** Canonical home_rec_cache fingerprint for a taste profile + radius.
 *  EVERY surface sharing the (user_id, location_key) cache row must use
 *  this — mismatched hash formats made the home rail and the browser
 *  endlessly invalidate each other's writes. */
export function recPrefsHashForProfile(profile: TasteProfile, radiusMeters: number): string {
  return recPrefsHash(
    profile.topCuisines,
    profile.topPrices,
    radiusMeters,
    preferredPriceTiers(profile).join(''),
  );
}

export function preferredPriceTiers(profile: TasteProfile): number[] {
  const dist = profile.priceDist;
  if (!dist) return [];
  const tiers = [1, 2, 3, 4].filter((t) => dist.share[t - 1] >= 0.15);
  if (tiers.length > 0) return tiers;
  return [Math.max(1, Math.min(4, Math.round(dist.center)))];
}

export function buildCandidateQueries(
  profile: TasteProfile,
  target: RecTargetLocation,
  /** Tonight's stated price tiers (a mood's "not too expensive", a preset).
   *  They REPLACE the band the profile learned: the pool must contain what
   *  was asked for, or every stage after this one is filtering nothing —
   *  a premium palate's pool holds no $ places for "cheap eats" to find. */
  opts?: { priceTiers?: number[]; moodTerms?: string[] },
): RecQuery[] {
  const { topCuisines, topPrices, topPairs, priceDist } = profile;
  const stated = (opts?.priceTiers ?? []).filter((t) => t >= 1 && t <= 4);
  // At most three, or the phrase stops being a search and starts being a
  // sentence Google matches nothing against.
  const moodTerms = (opts?.moodTerms ?? []).slice(0, 3);
  const label = target.label.trim();
  const isCurrent = !label || label === 'Current Location';
  const city = isCurrent
    ? ''
    : label
        .split(',')
        .slice(0, 2)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');

  // Server-side price restriction kicks in once the user's spending is
  // demonstrably concentrated — that's what actually keeps a premium
  // palate's pool from filling with cheap crowd-pleasers ("best $$$$
  // French" text alone barely biases Google).
  const restrict = stated.length > 0 || (priceDist?.concentration ?? 0) >= 0.35;
  const allowedTiers = stated.length > 0 ? stated : preferredPriceTiers(profile);
  const share = priceDist?.share ?? [0, 0, 0, 0];
  const lowShare = share[0] + share[1];
  const premiumShare = share[2] + share[3];

  const PRICE_SYMBOLS = ['', '$', '$$', '$$$', '$$$$'];
  const seen = new Set<string>();
  const out: RecQuery[] = [];
  const push = (raw: string, priceLevels?: number[]) => {
    const q = raw.trim().replace(/\s+/g, ' ');
    if (!q) return;
    const key = q.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(priceLevels && priceLevels.length > 0 ? { text: q, priceLevels } : { text: q });
  };

  // Tier 0: tonight's words. Pushed ahead of every habit-derived query
  // because a mood is an instruction about THIS meal, and callers with a
  // small query budget take the first N. Google's text search is what
  // actually knows which rooms are romantic or have a view — the tag
  // signal only covers places somebody here has already rated.
  if (moodTerms.length > 0) {
    const phrase = moodTerms.join(' ');
    const moodQ = (text: string) => {
      push(text, restrict ? allowedTiers : undefined);
      const q = out.find((x) => x.text === text);
      if (q) q.mood = true;
    };
    moodQ(`${phrase} restaurants${city ? ' in ' + city : ''}`);
    // Crossed with what the user likes to eat, so the mood doesn't wash
    // the palate out entirely.
    for (const cuisine of topCuisines.slice(0, 2)) {
      moodQ(`${phrase} ${cuisine} restaurants${city ? ' in ' + city : ''}`);
    }
  }

  // Tier 1: pairs — restricted to the pair's own tier when restricting.
  // Under a STATED price the pair's tier is replaced outright: the cuisines
  // still say what the user likes, but tonight's budget says where.
  for (const pair of topPairs) {
    const tier = stated.length > 0 ? undefined : pair.price;
    const sym = tier !== undefined ? (PRICE_SYMBOLS[tier] ?? '') : (PRICE_SYMBOLS[stated[0]] ?? '');
    push(
      `best ${sym} ${pair.cuisine} restaurants${city ? ' in ' + city : ''}`,
      restrict ? (tier !== undefined && tier >= 1 ? [tier] : allowedTiers) : undefined,
    );
  }

  // Tier 2: cuisine × price cross (only for cuisines not in a top pair)
  const pairedCuisines = new Set(topPairs.map((p) => p.cuisine));
  const tierWalk = stated.length > 0 ? stated : topPrices;
  for (const cuisine of topCuisines) {
    if (pairedCuisines.has(cuisine)) continue;
    for (const price of tierWalk) {
      const sym = PRICE_SYMBOLS[price] ?? '';
      push(
        `best ${sym} ${cuisine} restaurants${city ? ' in ' + city : ''}`,
        restrict && price >= 1 ? [price] : undefined,
      );
    }
  }

  // Tier 3: price anchors. "cheap X" only when the LOW tiers genuinely hold
  // real mass (≥ 35%) — a premium rater's couple of good $$ spots used to be
  // enough to inject cheap queries into their pool.
  //
  // Cuisine-bearing anchors are emitted HERE; the city-wide ones ("fine
  // dining Manhattan", "tasting menu Manhattan") are deferred to the tail.
  // They name no cuisine, and callers with a small query budget take the
  // first N — so a stated Japanese/$$$$ palate was spending two of its three
  // cold-start searches on generic city fine dining and coming back with a
  // wine bar and a brasserie, while "Japanese fine dining" sat below the
  // cut. A query that knows what you like must outrank one that only knows
  // where you are.
  const deferred: Array<() => void> = [];
  if (priceDist) {
    if (premiumShare >= 0.5) {
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`${cuisine} fine dining${city ? ' ' + city : ''}`, restrict ? allowedTiers : undefined);
      }
      deferred.push(() => {
        // Restricted like every other band-aware query: an unfiltered "fine
        // dining" is how $$$ rooms reach someone who said $$$$.
        push(`fine dining${city ? ' ' + city : ' restaurants'}`, restrict ? allowedTiers : undefined);
        push(`tasting menu${city ? ' ' + city : ' restaurants'}`, restrict ? allowedTiers : undefined);
        // Left unrestricted on purpose — starred rooms are often unpriced in
        // Google, and a price filter drops exactly those.
        push(`michelin star restaurants${city ? ' in ' + city : ''}`);
      });
    } else if (Math.max(...(topPrices.length ? topPrices : [0])) >= 3) {
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`${cuisine} fine dining${city ? ' ' + city : ''}`, restrict ? allowedTiers : undefined);
      }
      deferred.push(() => {
        push(`fine dining${city ? ' ' + city : ' restaurants'}`, restrict ? allowedTiers : undefined);
      });
    }
    if (lowShare >= 0.35) {
      for (const cuisine of topCuisines.slice(0, 3)) {
        push(`cheap ${cuisine}${city ? ' ' + city : ' restaurants'}`);
      }
    }
  }
  if (stated.length > 0 && Math.min(...stated) <= 2) {
    // Tonight is a budget night whatever the history says.
    for (const cuisine of topCuisines.slice(0, 3)) {
      push(`cheap ${cuisine}${city ? ' ' + city : ' restaurants'}`, stated);
    }
    push(`best cheap eats${city ? ' ' + city : ''}`, stated);
  }

  // Tier 4: variety — restricted to the user's favored band when restricting.
  for (const cuisine of topCuisines) {
    push(
      `best ${cuisine} restaurants${city ? ' in ' + city : ''}`,
      restrict ? allowedTiers : undefined,
    );
  }

  // Tier 5: tail — always UNRESTRICTED. A price filter would drop every
  // place Google can't price, and hidden gems are disproportionately
  // unpriced; these queries keep them flowing into the pool.
  for (const cuisine of topCuisines) {
    push(`top rated ${cuisine} restaurants${city ? ' in ' + city : ''}`);
    push(`hidden gem ${cuisine} restaurants${city ? ' ' + city : ''}`);
  }

  // The city-wide anchors held back from tier 3, now that every query that
  // names a cuisine has had its turn.
  for (const emit of deferred) emit();

  if (city) {
    push(`trending restaurants ${city}`);
    push(`popular restaurants ${city}`);
  }

  return out;
}

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface CandidateSignals {
  expertUserIds: Set<string>;
  followedExpertIds: Set<string>;
  friendUserIds: Set<string>;
  communityByRestaurant: Map<string, CommunityRating[]>;
  expertRecRestaurantIds: Set<string>;
  /** Places returned by tonight's mood queries (see RecQuery.mood). Empty
   *  when no mood was stated. These are what Google itself considers
   *  "romantic with a view" — the community tag signal covers only places
   *  somebody here has already rated, which in a fresh city is nobody. */
  moodMatchIds?: Set<string>;
}

export interface ScoreCandidatesOptions {
  /** Max number of places to return. Defaults to 12. Pass e.g. Infinity to
   *  rank an entire pool (used by /location, which wants every restaurant
   *  in the city sorted but not truncated). */
  limit?: number;
  /** When true (default), restaurants the user has already rated, wishlisted,
   *  or recently viewed are dropped from the output. Surfaces that want to
   *  show every matching restaurant regardless of history (again, /location)
   *  pass `false`. */
  skipUserHistory?: boolean;
  /** With skipUserHistory on, keep wishlisted + recently-viewed places and
   *  drop only the ones the user has actually rated. The recs browser uses
   *  this: a wishlisted spot is a good recommendation — it gets an
   *  "On your wishlist" chip and a small boost instead of being hidden. */
  keepWishlisted?: boolean;
  /** Hard price-band enforcement for RECOMMENDATION surfaces: with enough
   *  priced history (n ≥ 8), tiers holding <5% of the user's positive price
   *  mass AND sitting more than one tier from their spending center are
   *  dropped entirely — a $$$/$$$$-only rater simply doesn't get $/$$ recs,
   *  and vice versa (wishlisted places are exempt: explicit intent wins).
   *  OFF by default so browse-everything surfaces (/location) keep listing
   *  the whole city. */
  enforcePriceBand?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const formatReviewCount = (n: number): string =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);

/**
 * Taste similarity per friend, from ratings you both logged: 1 point of
 * agreement when your scores match, fading to 0 at a 4-point gap, blended
 * with a neutral prior until enough co-ratings exist to trust it. Output is
 * 0.35 (consistent disagree-er) … 1.0 (rated the same places, same way);
 * friends with zero overlap fall back to 0.6 at the call site.
 */
function buildFriendSimilarity(
  profile: TasteProfile,
  signals: CandidateSignals,
): Map<string, number> {
  const sims = new Map<string, number>();
  const mine = profile.myScoreById;
  if (!mine || mine.size === 0) return sims;
  const stats = new Map<string, { n: number; agree: number }>();
  for (const rows of signals.communityByRestaurant.values()) {
    for (const row of rows) {
      if (!signals.friendUserIds.has(row.user_id)) continue;
      const my = mine.get(row.restaurant_id);
      if (my === undefined) continue;
      const s = stats.get(row.user_id) || { n: 0, agree: 0 };
      s.n++;
      s.agree += 1 - Math.min(1, Math.abs(my - row.score) / 4);
      stats.set(row.user_id, s);
    }
  }
  for (const [fid, s] of stats) {
    const conf = s.n / (s.n + 2);          // 1 co-rating → ⅓ trust, 4 → ⅔
    const blend = conf * (s.agree / s.n) + (1 - conf) * 0.5;
    sims.set(fid, 0.35 + 0.65 * blend);
  }
  return sims;
}

/**
 * Greedy MMR-style re-rank of the top of the list: each pick charges a fading
 * penalty to later same-cuisine picks, so a strong #1 still wins but the top
 * of the page doesn't become five pizzerias. Places past `depth` keep their
 * plain score order (the tail is browse territory, not the pitch).
 */
export function diversifyByCuisine(
  sorted: ScoredPlace[],
  inferCuisine: (types: string[]) => string,
  depth = 30,
  penalty = 0.7,
): ScoredPlace[] {
  if (sorted.length <= 2) return sorted;
  const pool = sorted.slice(0, depth);
  const rest = sorted.slice(depth);
  const out: ScoredPlace[] = [];
  const counts: Record<string, number> = {};
  while (pool.length > 0) {
    let bestI = 0;
    let bestV = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cu = inferCuisine(pool[i].types);
      const v = pool[i].recScore - (cu ? penalty * (counts[cu] || 0) : 0);
      if (v > bestV) { bestV = v; bestI = i; }
    }
    const [pick] = pool.splice(bestI, 1);
    const cu = inferCuisine(pick.types);
    if (cu) counts[cu] = (counts[cu] || 0) + 1;
    out.push(pick);
  }
  return [...out, ...rest];
}

/** Michelin distinction → distinctiveness weight / quality substitute. */
const MICHELIN_DIST_WEIGHT = (m: NonNullable<RecCandidate['michelin']>): number =>
  m.stars === 3 ? 1.0 : m.stars === 2 ? 0.9 : m.stars === 1 ? 0.8 : m.selected ? 0.55 : m.bibGourmand ? 0.45 : 0;
const MICHELIN_QUALITY_SUB = (m: NonNullable<RecCandidate['michelin']>): number =>
  m.stars === 3 ? 0.85 : m.stars === 2 ? 0.75 : m.stars === 1 ? 0.65 : m.bibGourmand ? 0.45 : m.selected ? 0.35 : 0;
const michelinChip = (m: NonNullable<RecCandidate['michelin']>): string =>
  m.stars > 0 ? `Michelin ${m.stars}-star` : m.bibGourmand ? 'Michelin Bib Gourmand' : 'In the Michelin Guide';

export function scoreCandidates(
  candidates: RecCandidate[],
  profile: TasteProfile,
  signals: CandidateSignals,
  target: RecTargetLocation,
  radiusMeters: number,
  options: ScoreCandidatesOptions = {},
): ScoredPlace[] {
  const W = DEFAULT_WEIGHTS;
  const limit = options.limit ?? 12;
  const skipUserHistory = options.skipUserHistory ?? true;
  const keepWishlisted = options.keepWishlisted ?? false;
  const enforcePriceBand = options.enforcePriceBand ?? false;

  const googleTypeToLabel: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) googleTypeToLabel[entry.type] = entry.label;
  }
  const inferCuisine = (types: string[]): string => {
    for (const t of types) {
      if (googleTypeToLabel[t]) return googleTypeToLabel[t];
    }
    return '';
  };

  const radiusKm = radiusMeters / 1000;
  const skipIds = new Set<string>();
  if (skipUserHistory) {
    profile.ratedIds.forEach((id) => skipIds.add(id));
    if (!keepWishlisted) {
      profile.wishlistedIds.forEach((id) => skipIds.add(id));
      profile.recentlyViewedIds.forEach((id) => skipIds.add(id));
    }
  }

  // Palate stats driving the v3 terms. Price weight and its mismatch slope
  // both grow with concentration — a user whose spend clusters in one band
  // has earned a hard opinion; a scattered profile keeps the mild v2 weight.
  const dist = profile.priceDist;
  const conc = dist?.concentration ?? 0;
  const distinct = profile.distinctiveTaste ?? 0;
  const wPrice = W.price + 1.1 * conc;
  const priceSlope = 0.6 + 0.6 * conc;
  const shareMax = dist ? Math.max(...dist.share, 0.0001) : 1;
  const wPopularity = W.popularity * (1 - 0.7 * distinct);

  // ── Normalizers ──
  // Raw profile sums are unbounded (a 200-rating power user's cuisine sums
  // run 50× a new user's), so every affinity is squashed to [-1, 1] against
  // the profile's own strongest signal before its weight applies. That keeps
  // the factor weights meaningful across account sizes: taste never drowns
  // out quality/friends for heavy raters, and never vanishes for light ones.
  const maxAbs = (m: Record<string, number> | Record<number, number>): number => {
    let x = 0;
    for (const v of Object.values(m)) x = Math.max(x, Math.abs(v));
    return x;
  };
  const cuisineMax = maxAbs(profile.cuisineScore) || 1;
  const priceMax = maxAbs(profile.priceScore) || 1;
  const pairMax = maxAbs(profile.pairScore) || 1;
  const tagMax = maxAbs(profile.tagScore) || 1;
  const aff = (raw: number | undefined, max: number): number =>
    raw === undefined ? 0 : clamp(raw / max, -1, 1);

  /**
   * Confidence shrinkage for the two SPARSE taste terms (cuisine, pair).
   *
   * Normalizing against the profile's own maximum answers "how strong is
   * this affinity" but not "how much do we actually know". One dinner at
   * one Peruvian place, enjoyed, made "Peruvian" a top cuisine with the
   * same authority as twelve consistent Italian ratings — and because
   * cuisine (1.6) and pair (1.8) are the heaviest taste weights, a single
   * observation could steer the whole ranking. `n/(n+2)` scales each
   * affinity by the evidence behind it: 1 rating → 0.33, 2 → 0.50,
   * 4 → 0.67, 8 → 0.80, converging on 1 as the user actually establishes a
   * pattern.
   *
   * Applied symmetrically to likes AND dislikes: one bad night shouldn't
   * blacklist a whole cuisine any more than one good night should crown it.
   *
   * Deliberately NOT applied to price or tags. Price has four buckets that
   * every rating votes in, and `priceDist` already carries its own
   * confidence factor (`n/(n+6)`); tags accumulate many per rating and are
   * capped at a combined 1.0. Sparsity is a cuisine/pair problem.
   */
  const EVIDENCE_K = 2;
  const confidence = (counts: Record<string, number> | undefined, key: string | undefined): number => {
    if (!key) return 0;
    const n = counts?.[key] ?? 0;
    return n / (n + EVIDENCE_K);
  };

  // Taste terms ramp in as the user rates (0 ratings → pure quality/social,
  // 3+ high ratings → full personalization) instead of the old binary
  // cold-start cliff at exactly 3.
  /**
   * How far the taste terms (cuisine, price, pair, tagOverlap) are open.
   *
   * This used to be `highRatedCount / 3` — ratings of 8.0+ only — which
   * meant a user who answered the entire quiz and rated nothing had ALL
   * FOUR taste terms multiplied by zero, and none of their reason chips
   * could render. "Built from your answers" was a top-rated-nearby list.
   *
   * Two changes. Stated taste now counts as half a slot (1.5 of the 3
   * needed), so a complete quiz opens the gate to 0.5 — weaker than a
   * rating the user actually gave, but not nothing. And the counter is
   * `scoreN` (any rating) rather than `highRatedCount`, because quizMass
   * also decays on scoreN: keyed differently, the priors evaporated
   * BEFORE the machinery consuming them switched on, leaving a user with
   * eight mediocre ratings more taste-blind than a user with none. It
   * also makes negativeMult reachable — a run of low scores is real
   * evidence about what someone dislikes, and it used to be computed and
   * then discarded until they finally loved something.
   */
  const ramp = clamp((profile.scoreN + 1.5 * profile.quizMass) / 3, 0, 1);

  const friendSim = buildFriendSimilarity(profile, signals);

  const scored: ScoredPlace[] = [];

  for (const c of candidates) {
    if (skipIds.has(c.id)) continue;
    // A Michelin synthetic candidate can duplicate an already-rated place
    // under a different id — suppress by normalized name.
    if (isMichelinSyntheticId(c.id) && profile.ratedNames?.has(normalizeName(c.name))) continue;
    // Hard price band (rec surfaces only): with real history behind the
    // distribution, tiers the user demonstrably never spends in aren't
    // demoted — they're not recommended at all. Thresholds: a tier below
    // 8% of the positive spend mass AND a full tier (or more) from the
    // spending center is out. (The old `> 1` distance let $$ through for
    // every $$$-centered profile — center 3.0 put $$ exactly 1.0 away.)
    if (
      enforcePriceBand &&
      dist &&
      dist.n >= 8 &&
      c.priceLevel >= 1 &&
      c.priceLevel <= 4 &&
      dist.share[c.priceLevel - 1] < 0.08 &&
      Math.abs(c.priceLevel - dist.center) >= 1 &&
      !profile.wishlistedIds.has(c.id)
    ) continue;

    const cuisine = inferCuisine(c.types);
    const price = c.priceLevel;
    const distKm = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: target.lat, lng: target.lng },
    );
    const communityRows = signals.communityByRestaurant.get(c.id) || [];

    // Personal-fit terms and generic-quality terms accumulate separately so
    // the predicted score can weigh taste evidence far above generic acclaim
    // (the old match % conflated them — a popular 4.6★ with zero taste fit
    // read as "80% match").
    let personalFit = 0;
    let genericQuality = 0;
    const sources: ScoredPlace['sources'] = ['google'];
  const reasons: Array<{ w: number; label: string; taste?: boolean }> = [];

    // ── Taste match ──
    if (ramp > 0) {
      // Loving a cuisine at $$$$ says little about its $ spots: positive
      // cuisine affinity is dampened for candidates priced well outside the
      // user's spend band, in proportion to how concentrated that band is.
      // (The pair term needs no scaling — its key is already cuisine|price.)
      const tierGap = dist && price >= 1 && price <= 4
        ? Math.max(0, Math.abs(price - dist.center) - 0.75)
        : 0;
      const crossPriceScale = 1 - clamp(tierGap * conc * 0.8, 0, 0.65);
      const cARaw = aff(cuisine ? profile.cuisineScore[cuisine] : undefined, cuisineMax)
        * confidence(profile.cuisineCounts, cuisine || undefined);
      const cA = cARaw > 0 ? cARaw * crossPriceScale : cARaw;
      const cTerm = W.cuisine * (cA < 0 ? cA * W.negativeMult : cA) * ramp;
      personalFit += cTerm;
      if (cA >= 0.35 && cuisine) reasons.push({ w: cTerm, taste: true, label: `Top cuisine: ${cuisine}` });

      // Price fit from the user's actual spend distribution: reward tiers
      // holding real mass, charge a concentration-scaled slope for straying
      // from the center — and give unknown prices a mild prior penalty
      // instead of the old free pass (backfill upstream fills most of them).
      let pA: number;
      if (dist && price >= 1 && price <= 4) {
        pA = clamp(
          dist.share[price - 1] / shareMax - priceSlope * Math.max(0, Math.abs(price - dist.center) - 0.5),
          -1,
          1,
        );
      } else if (dist) {
        pA = -0.35 * conc;
      } else {
        pA = 0;
      }
      const pTerm = wPrice * pA * ramp;
      personalFit += pTerm;
      if (pA >= 0.35 && price > 0) reasons.push({ w: pTerm, taste: true, label: `In your price range (${'$'.repeat(price)})` });

      const pairKey = cuisine && price > 0 ? `${cuisine}|${price}` : undefined;
      const prA = aff(pairKey ? profile.pairScore[pairKey] : undefined, pairMax)
        * confidence(profile.pairCounts, pairKey);
      const prTerm = W.pair * (prA < 0 ? prA * W.negativeMult : prA) * ramp;
      personalFit += prTerm;
      if (prA >= 0.5 && cuisine && price > 0) {
        reasons.push({ w: prTerm, taste: true, label: `Your sweet spot: ${'$'.repeat(price)} ${cuisine}` });
      }

      // Tag overlap — community tags on this place vs tags the user hands out.
      const tagSet = new Set<string>();
      for (const row of communityRows) {
        for (const t of row.tags || []) tagSet.add(t);
      }
      let tagSum = 0;
      const matchedTags: Array<{ t: string; a: number }> = [];
      for (const t of tagSet) {
        const a = aff(profile.tagScore[t], tagMax);
        if (a > 0) { tagSum += a * 0.5; matchedTags.push({ t, a }); }
      }
      const tTerm = W.tagOverlap * Math.min(1, tagSum) * ramp;
      if (tTerm > 0) {
        personalFit += tTerm;
        sources.push('tagSimilar');
        matchedTags.sort((x, y) => y.a - x.a);
        if (tTerm >= 0.3) {
          reasons.push({ w: tTerm, taste: true, label: `Your vibe: ${matchedTags.slice(0, 2).map((m) => m.t).join(', ')}` });
        }
      }
    }

    // ── Tonight's mood ──
    // Heavier than any single taste term and NOT ramped by evidence: the
    // user just said what they want, which beats anything inferred from
    // history — including for a brand-new account with no history at all.
    // It is a lift, never a filter: a place that doesn't match still ranks
    // on the merits, so a mood can't empty the list.
    if (signals.moodMatchIds?.has(c.id)) {
      const mTerm = W.moodMatch;
      personalFit += mTerm;
      sources.push('mood');
      reasons.push({ w: mTerm, taste: true, label: 'Matches your mood' });
    }

    // ── Distinctiveness (Michelin / boutique) ──
    // Scaled by the user's own palate: a crowd-follower gets ~nothing from a
    // star; the premium-and-curious profile gets a real lift. Not ramped —
    // distinctiveTaste already grows with data volume.
    const candDistinct = c.michelin
      ? MICHELIN_DIST_WEIGHT(c.michelin)
      : c.rating >= 4.5 && c.userRatingCount >= 25 && c.userRatingCount <= 800 && price >= 3
        ? 0.5
        : 0;
    if (candDistinct > 0 && distinct > 0) {
      const dTerm = W.distinctive * distinct * candDistinct;
      personalFit += dTerm;
      if (c.michelin) {
        sources.push('michelin');
        reasons.push({ w: dTerm + 1, label: michelinChip(c.michelin) });
      } else if (dTerm >= 0.4) {
        reasons.push({ w: dTerm, label: 'Under-the-radar find' });
      }
    } else if (c.michelin) {
      // Still badge the star for context even when the palate doesn't earn
      // a boost from it.
      sources.push('michelin');
      reasons.push({ w: 0.2, label: michelinChip(c.michelin) });
    }

    // ── Michelin taste match ──
    // Beyond generic distinctiveness: a user whose loved places are FULL of
    // starred rooms gets starred candidates lifted specifically (and a Bib
    // hunter gets Bibs). Share saturates at ⅓ of their history.
    if (c.michelin && profile.michelinTaste) {
      const mt = profile.michelinTaste;
      const share = c.michelin.stars > 0
        ? mt.starShare
        : c.michelin.bibGourmand
          ? mt.bibShare
          : mt.selectedShare;
      if (share > 0) {
        const mTerm = W.michelinTaste * Math.min(1, share * 3) * MICHELIN_DIST_WEIGHT(c.michelin);
        personalFit += mTerm;
      }
    }

    // ── Quality prior ──
    // While the platform is young, quality = Google's Bayesian-shrunk stars
    // (a 4.6 backed by a thousand reviews beats a 5.0 backed by three), with
    // a Michelin-distinction substitute for Guide rows Google hasn't rated.
    // As in-app raters accumulate on a place, the term HANDS OVER to the
    // community's own 0-10 average (wComm: 0 today → ~1 at 20+ raters), so
    // recs eventually run on what users of the app think, not Google.
    // Friends already have their dedicated similarity-weighted term — this
    // is the all-users consensus.
    let googleQ = 0;
    let googleCold10 = 2 * 3.8 - 1.6; // neutral 6.0 on the 10-scale
    if (c.rating > 0) {
      const v = c.userRatingCount || 0;
      const bayes = (v * c.rating + 25 * 3.8) / (v + 25);
      googleQ = clamp(bayes - 3.8, -1, 1);
      googleCold10 = 2 * bayes - 1.6;
      if (googleQ >= 0.55 && v >= 150) {
        reasons.push({ w: W.quality * googleQ, label: `${c.rating.toFixed(1)}★ from ${formatReviewCount(v)} reviews` });
      }
    } else if (c.michelin) {
      const qSub = MICHELIN_QUALITY_SUB(c.michelin);
      googleQ = qSub;
      googleCold10 = 2 * (3.8 + qSub) - 1.6;
    }
    const commAvg = c.appAvgScore;
    const commN = c.appRatingCount ?? 0;
    const wComm = commAvg !== undefined && commN > 0 ? commN / (commN + 8) : 0;
    const commQ = commAvg !== undefined ? clamp((commAvg - 6.5) / 2.5, -1, 1) : 0;
    genericQuality += W.quality * ((1 - wComm) * googleQ + wComm * commQ);
    if (wComm > 0.5 && commAvg !== undefined && commAvg >= 8) {
      reasons.push({ w: W.quality * wComm * commQ, label: `Community average ${commAvg.toFixed(1)}` });
    }
    const cold10 = (1 - wComm) * googleCold10 + wComm * clamp(commAvg ?? 6, 5, 9.4);
    genericQuality += wPopularity * Math.min(1, Math.log1p(c.userRatingCount || 0) / Math.log1p(3000));

    // ── In-app popularity ──
    // Distinct users of THIS app who rated the place. Saturates fast (~20
    // raters) because the platform is young; today this contributes ~0 and
    // it strengthens automatically as the community rates more.
    const appN = c.appRatingCount ?? 0;
    if (appN > 0) {
      const aTerm = W.appPopularity * Math.min(1, Math.log1p(appN) / Math.log1p(20));
      genericQuality += aTerm;
      if (appN >= 3) {
        reasons.push({ w: aTerm, label: `Rated by ${appN} in the community` });
      }
    }

    // ── Expert signal (bounded) ──
    let expertRaw = 0;
    let followedExpert = false;
    for (const row of communityRows) {
      if (row.score >= 8 && signals.expertUserIds.has(row.user_id)) {
        const followed = signals.followedExpertIds.has(row.user_id);
        if (followed) followedExpert = true;
        expertRaw += followed ? 0.75 : 0.5;
      }
    }
    const hasExpertRec = signals.expertRecRestaurantIds.has(c.id);
    if (hasExpertRec) expertRaw += 1;
    if (expertRaw > 3) expertRaw = 3;
    if (expertRaw > 0) {
      const eTerm = W.expert * (expertRaw / 3);
      personalFit += eTerm;
      sources.push('expert');
      if (hasExpertRec) sources.push('expertRec');
      reasons.push({ w: eTerm, label: followedExpert ? 'Pick from verified users you follow' : 'Verified pick' });
    }

    // ── Friend signal: enthusiasm × taste similarity, negatives included ──
    // A like-minded friend's 9 moves the needle hard; a friend whose taste
    // has never matched yours barely registers; a friend's 3 pushes DOWN.
    let friendRaw = 0;
    let friendsLoved = 0;
    for (const row of communityRows) {
      if (!signals.friendUserIds.has(row.user_id)) continue;
      const sim = friendSim.get(row.user_id) ?? 0.6;
      const enthusiasm = clamp((row.score - 6.5) / 3.5, -1, 1);
      friendRaw += enthusiasm * sim;
      if (row.score >= 8) friendsLoved++;
    }
    if (friendRaw !== 0) {
      const fTerm = W.friend * (clamp(friendRaw, -1.5, 2) / 2);
      personalFit += fTerm;
      if (fTerm > 0) {
        sources.push('friend');
        if (friendsLoved > 0) {
          reasons.push({
            w: fTerm,
            label: friendsLoved > 1 ? `Loved by ${friendsLoved} friends` : 'Loved by a friend',
          });
        }
      }
    }

    // ── Wishlist (only when kept in the pool) ──
    if (keepWishlisted && profile.wishlistedIds.has(c.id)) {
      personalFit += W.wishlist;
      reasons.push({ w: W.wishlist, label: 'On your wishlist' });
    }

    // ── Distance decay (soft, past half the radius; capped) ──
    // Ranks by it, but the predicted score deliberately ignores it — how much
    // you'd LIKE a place doesn't depend on how far you are from it today.
    const extra = Math.max(0, distKm - radiusKm * 0.5);
    const distancePenalty = W.distance * Math.min(1.5, extra / Math.max(radiusKm, 0.5));
    const score = personalFit + genericQuality - distancePenalty;

    // ── Predicted score (Beli-style, the user's own 0–10 scale) ──
    // Anchored to their shrunk personal mean (−0.35 self-selection correction:
    // people rate places they chose to visit, so the mean overstates a random
    // rec), spread by taste evidence, nudged by generic quality, capped by
    // their own realistic ceiling. Cold accounts fall back to Bayesian stars.
    const anchor = profile.anchor ?? 7;
    const fitN = Math.tanh(personalFit / 3.2);
    const qualN = Math.tanh(genericQuality / 2.5);
    const personalPredicted = anchor - 0.35 + 1.8 * fitN + 0.45 * qualN;
    const coldPredicted = clamp(cold10, 5.0, 9.0);
    const nPos = profile.myScoreById.size;
    const rampP = nPos / (nPos + 5);
    const cap = Math.min(9.8, (profile.scoreP90 ?? 9.4) + 0.4);
    const own = profile.myScoreById.get(c.id);
    /* Kept on the app's 0.01 grid, the same one real ratings are stored on
       (lib/score, settleScores.roundGrid) — NOT rounded to a tenth.
       Rounding here made every prediction end in 0: with the "Precise
       scores" setting on, a page of recommendations read 8.90, 8.90, 8.80,
       which looks like a broken formatter rather than a fine distinction,
       and it threw away real differences between candidates whose fits are
       genuinely a few hundredths apart. Display precision is the display's
       decision (formatScore + SettingsContext.twoDecimalScores); this is
       the value, and it should carry what it actually computed. */
    const predicted = own !== undefined
      ? own
      : Math.round(clamp(rampP * personalPredicted + (1 - rampP) * coldPredicted, 5.0, cap) * 100) / 100;

    reasons.sort((a, b) => b.w - a.w);
    scored.push({
      ...c,
      recScore: score,
      sources,
      reasons: reasons.slice(0, 3).map((r) => r.label),
      tasteReasons: reasons.filter((r) => r.taste).map((r) => r.label),
      predicted,
    });
  }

  scored.sort((a, b) => b.recScore - a.recScore);
  return diversifyByCuisine(scored, inferCuisine).slice(0, limit);
}

/** A gathered, score-ready candidate pool. Scoring is separate so the UI can
 *  re-rank the same pool synchronously whenever the user's ratings change. */
export interface RecPool {
  candidates: RecCandidate[];
  signals: CandidateSignals;
  fetchedAt: number;
}

/** First `max` queries, but always with ≥2 unrestricted ones mixed in — a
 *  price filter excludes every place Google can't price, and hidden gems are
 *  disproportionately unpriced. Exported for tests. */
export function sliceQueriesBalanced(queries: RecQuery[], max: number): RecQuery[] {
  const head = queries.slice(0, max);
  if (queries.length <= max) return head;
  const unrestricted = head.filter((q) => !q.priceLevels).length;
  if (unrestricted >= 2) return head;
  const extras = queries.slice(max).filter((q) => !q.priceLevels).slice(0, 2 - unrestricted);
  if (extras.length === 0) return head;
  return [...head.slice(0, max - extras.length), ...extras];
}

const toMichelinBadge = (info: MichelinInfo): NonNullable<RecCandidate['michelin']> => ({
  stars: info.stars,
  bibGourmand: info.bibGourmand,
  selected: info.selected,
});

/**
 * Gather a score-ready candidate pool for a location: price-aware Google text
 * queries + cached pool + community rows + nearby Michelin entries, with
 * unknown prices backfilled (Michelin tier, then community mode) so nothing
 * dodges the price term. Runs NO scoring — callers pass the pool through
 * scoreCandidates, and can re-score it for free when the profile changes.
 */
export async function gatherRecCandidates(
  opts: Omit<RecOptions, 'limit' | 'keepWishlisted'>,
): Promise<RecPool> {
  const maxQueries = opts.maxQueries ?? 5;
  // Canonical hash shared with Discover's home rail — see recPrefsHash in
  // supabase-rec-cache.ts. (The v3 tier fingerprint also invalidates every
  // pre-v3 cached pool: pools assembled without price-restricted queries
  // skew cheap and would otherwise satisfy hits for two more days.)
  const statedTiers = (opts.priceTiersOverride ?? []).filter((t) => t >= 1 && t <= 4);
  const moodTerms = (opts.moodTerms ?? []).slice(0, 3);
  const prefsHash = recPrefsHashForProfile(opts.profile, opts.radiusMeters)
    + (statedTiers.length > 0 ? `|pt:${[...statedTiers].sort().join('')}` : '')
    + (moodTerms.length > 0 ? `|mt:${moodTerms.join('_')}` : '');
  const locKey = locationKey(opts.target.lat, opts.target.lng);

  let mergeCached: PlaceResult[] = [];
  let skipGoogle = false;
  if (opts.userId) {
    const cached = await getHomeRecsCache(opts.userId, locKey);
    if (cached && Date.now() - cached.updatedAt < 2 * 24 * 60 * 60 * 1000) {
      mergeCached = cached.places;
      // A fresh same-prefs pool that's deep enough to rank is a full hit;
      // a thin or drifted one still merges in but gets fresh queries too.
      // A mood run must never take the full-hit shortcut: skipping Google
      // means no mood queries ran, so nothing is credited to the mood and
      // the ranking silently reverts to plain taste on the second identical
      // search. The cached places still MERGE in — only the shortcut is off.
      if (cached.preferencesHash === prefsHash && cached.places.length >= 25 && moodTerms.length === 0) {
        skipGoogle = true;
      }
    }
  }

  if (opts.signal?.aborted) return { candidates: [], signals: emptySignals(), fetchedAt: Date.now() };

  const queries = skipGoogle
    ? []
    : sliceQueriesBalanced(
        buildCandidateQueries(
          opts.profile,
          opts.target,
          statedTiers.length > 0 || moodTerms.length > 0 ? { priceTiers: statedTiers, moodTerms } : undefined,
        ),
        maxQueries,
      );

  const [
    googleBatches,
    tagSimilar,
    expertRatings,
    friendRatings,
    experts,
    followedExperts,
  ] = await Promise.all([
    Promise.all(
      queries.map((q) =>
        q.priceLevels && q.priceLevels.length > 0
          ? // Price-restricted: the paged search sends `priceLevels` so Google
            // filters server-side (one request; no food-type filter, so apply
            // ours locally).
            searchPlacesByTextPaged(q.text, {
              lat: opts.target.lat,
              lng: opts.target.lng,
              radiusMeters: opts.radiusMeters,
              useRestriction: true,
              priceLevels: q.priceLevels,
            })
              .then((page) => page.places.filter((p) => isFoodPlace(p.types) && !isVenuePlace(p)))
              .catch(() => [] as PlaceResult[])
          : searchPlacesByText(
              q.text,
              opts.target.lat,
              opts.target.lng,
              opts.target.label || undefined,
              /* useRestriction */ true,
              opts.radiusMeters,
              undefined,
              // Recs want POOL DEPTH, not the single best match: a thin
              // exact response here (a niche cuisine in a small city) is
              // worth widening with the broad phrasing. Typeaheads take the
              // opposite default — see TEXT_EXACT_SUFFICIENT_DEFAULT.
              { minExactResults: TEXT_EXACT_SUFFICIENT_POOL },
            ).catch(() => [] as PlaceResult[]),
      ),
    ),
    getTagSimilarRestaurants(
      opts.profile.topTags,
      opts.target.label,
      opts.userId ?? '',
      40,
    ).catch(() => [] as CommunityRating[]),
    getExpertRatings(100).catch(() => [] as CommunityRating[]),
    opts.userId
      ? getAllFriendRatings(opts.userId).catch(() => [] as CommunityRating[])
      : Promise.resolve([] as CommunityRating[]),
    getExpertProfiles().catch(() => []),
    opts.userId
      ? getFollowedExpertIds(opts.userId).catch(() => new Set<string>())
      : Promise.resolve(new Set<string>()),
    // Michelin dataset rides along in the same wait — needed below for the
    // nearby merge and the price/star attach. Free (local JSON chunk).
    ensureMichelinIndex().catch(() => undefined),
  ]);

  if (opts.signal?.aborted) return { candidates: [], signals: emptySignals(), fetchedAt: Date.now() };

  const expertUserIds = new Set<string>(experts.map((e) => e.user_id));
  const friendUserIds = new Set<string>(friendRatings.map((r) => r.user_id));

  // Self-picked slider scores never feed recommendation signals — only
  // head-to-head / imported / legacy rows are calibrated enough to trust.
  // (getTagSimilarRestaurants already filters server-side; the expert and
  // friend feeds serve display surfaces too, so they filter here instead.)
  const allCommunityRows: CommunityRating[] = [
    ...tagSimilar,
    ...expertRatings,
    ...friendRatings,
  ].filter(countsForCommunity);
  const communityByRestaurant = new Map<string, CommunityRating[]>();
  for (const row of allCommunityRows) {
    const arr = communityByRestaurant.get(row.restaurant_id);
    if (arr) arr.push(row);
    else communityByRestaurant.set(row.restaurant_id, [row]);
  }

  // Candidate pool: Google results win on id conflicts (richer metadata),
  // then cached places, then pseudo-places from community rows. Both
  // Google-sourced feeds pass the eligibility gate — hotels and other
  // non-food POIs must never enter the pool (this also scrubs hotels out
  // of pools cached before the gate existed).
  const byId = new Map<string, RecCandidate>();
  // googleBatches is index-parallel to `queries`, which is how a place can
  // be credited to the mood query that found it.
  const moodMatchIds = new Set<string>();
  googleBatches.forEach((batch, i) => {
    const isMood = queries[i]?.mood === true;
    for (const p of batch) {
      if (!recPoolEligible(p)) continue;
      if (isMood) moodMatchIds.add(p.id);
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  });
  for (const p of mergeCached) {
    if (!recPoolEligible(p)) continue;
    if (!byId.has(p.id)) byId.set(p.id, p);
  }
  // Community pseudo-places carry their rating's cuisine as a Google type so
  // the scorer's cuisine/pair affinities apply to them too (they used to land
  // with types: [] and score purely on the social term).
  const labelToType: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) labelToType[entry.label.toLowerCase()] = entry.type;
  }
  // Rows without coordinates can't survive the radius post-filter below —
  // the old (0,0) default parked them in the Atlantic and they were silently
  // discarded, so "a friend rated it in this city" candidates never surfaced
  // for coordinate-less rows. Resolve coords from the shared restaurant_geo
  // cache in one batched read; rows still unknown are skipped explicitly.
  const rowCoords = (row: CommunityRating): { lat: number; lng: number } | null =>
    typeof row.lat === 'number' && typeof row.lng === 'number'
    && Number.isFinite(row.lat) && Number.isFinite(row.lng)
    && !(Math.abs(row.lat) < 1 && Math.abs(row.lng) < 1) // (0,0)-ish = corrupted
      ? { lat: row.lat, lng: row.lng }
      : null;
  const coordlessIds = allCommunityRows
    .filter((row) => !byId.has(row.restaurant_id) && !rowCoords(row))
    .map((row) => row.restaurant_id);
  const geoCache = coordlessIds.length > 0
    ? await getRestaurantGeoBatch(coordlessIds).catch(() => ({} as Record<string, { lat: number; lng: number }>))
    : {};
  for (const row of allCommunityRows) {
    if (byId.has(row.restaurant_id)) continue;
    const geo = rowCoords(row) ?? geoCache[row.restaurant_id] ?? null;
    if (!geo) continue;
    const cuisineType = row.cuisine ? labelToType[row.cuisine.toLowerCase()] : undefined;
    byId.set(row.restaurant_id, {
      id: row.restaurant_id,
      name: row.restaurant_name,
      lat: geo.lat,
      lng: geo.lng,
      rating: 0,
      priceLevel: row.price?.length ?? 0,
      address: row.address,
      fullAddress: row.address,
      photoUrl: null,
      types: cuisineType ? [cuisineType] : [],
      userRatingCount: 0,
    });
  }

  // ── Michelin attach + nearby merge ──
  // 1) Stamp star/price info onto Google candidates that match the Guide,
  //    recording WHICH Guide entry each one claimed (by guide URL).
  // 2) Add nearby Guide entries the queries missed as candidates of their
  //    own (synthetic ids resolve to real places on the detail page) —
  //    but never one already claimed by a Google candidate, and never one
  //    whose name is a variant of a nearby candidate's. The old check
  //    required an EXACT name match within 0.12 mi, so "La Vague d'Or"
  //    (Google) and "La Vague d'Or - Cheval Blanc St-Tropez" (Guide)
  //    ranked as two different restaurants with two different scores.
  const claimedGuideUrls = new Set<string>();
  for (const c of byId.values()) {
    if (isMichelinSyntheticId(c.id)) continue;
    const info = findMichelinMatchSync(c.name, c.lat, c.lng, c.fullAddress || c.address);
    if (!info) continue;
    if (info.guideUrl) claimedGuideUrls.add(info.guideUrl);
    if (!c.michelin) {
      c.michelin = toMichelinBadge(info);
      if (c.priceLevel < 1 && info.priceTier >= 1) c.priceLevel = info.priceTier;
    }
  }
  const radiusMi = opts.radiusMeters / 1609.34;
  const existing = Array.from(byId.values());
  let added = 0;
  for (const m of michelinNearbySync(opts.target.lat, opts.target.lng, Math.min(radiusMi, 31))) {
    if (added >= 30) break;
    if (m.guideUrl && claimedGuideUrls.has(m.guideUrl)) continue;
    // Fuzzy name dedupe for entries the matcher didn't claim: normalized
    // equality OR containment either way ("Colette" ⊂ "Restaurant Colette
    // by Sezz St. Tropez"), within 0.4 mi — Guide coordinates for rooms
    // inside hotels routinely sit a few hundred meters off Google's.
    const mNorm = normalizeName(m.name);
    const dup = existing.some((p) => {
      if (haversineDistanceMi(p.lat, p.lng, m.lat, m.lng) >= 0.4) return false;
      const pNorm = normalizeName(p.name);
      if (pNorm === mNorm) return true;
      const shorter = pNorm.length <= mNorm.length ? pNorm : mNorm;
      const longer = pNorm.length <= mNorm.length ? mNorm : pNorm;
      return shorter.length >= 5 && longer.includes(shorter);
    });
    if (dup) continue;
    const place = michelinToPlaceResult(m) as RecCandidate;
    if (byId.has(place.id)) continue;
    place.michelin = toMichelinBadge(m);
    byId.set(place.id, place);
    added++;
  }

  // Post-filter by radius with 25% slack; the distance penalty handles the rest.
  const radiusKm = opts.radiusMeters / 1000;
  const slackKm = radiusKm * 1.25;
  const candidates: RecCandidate[] = [];
  for (const c of byId.values()) {
    const dist = haversineKm(
      { lat: c.lat, lng: c.lng },
      { lat: opts.target.lat, lng: opts.target.lng },
    );
    if (dist <= slackKm) candidates.push(c);
  }

  // ── Community backfill: prices + in-app popularity ──
  // Two batched queries: unknown tiers fill from the community's price
  // consensus (so the scorer's unknown-price prior only hits places nobody
  // has priced anywhere), and every candidate gets its distinct-rater count
  // for the platform-popularity term. Counts refresh on cache hits too —
  // cached pools may carry stale numbers.
  const nonSyntheticIds = candidates.filter((c) => !isMichelinSyntheticId(c.id)).map((c) => c.id);
  const unpricedIds = candidates
    .filter((c) => c.priceLevel < 1 && !isMichelinSyntheticId(c.id))
    .map((c) => c.id);
  try {
    const [communityPrices, ratingStats] = await Promise.all([
      unpricedIds.length > 0 ? getCommunityPricesForPlaces(unpricedIds) : Promise.resolve({} as Record<string, string>),
      nonSyntheticIds.length > 0
        ? getCommunityRatingStats(nonSyntheticIds)
        : Promise.resolve({} as Awaited<ReturnType<typeof getCommunityRatingStats>>),
    ]);
    for (const c of candidates) {
      if (c.priceLevel < 1) {
        const tier = (communityPrices[c.id] || '').length;
        if (tier >= 1 && tier <= 4) c.priceLevel = tier;
      }
      const stats = ratingStats[c.id];
      c.appRatingCount = stats?.raters ?? 0;
      c.appAvgScore = stats && stats.avgScore > 0 ? stats.avgScore : undefined;
    }
  } catch { /* display-quality data only — never block the pool */ }

  // Only fetch if we actually have candidates to look up. One batched query.
  const candidateIds = candidates.map((c) => c.id);
  const expertRecIds = new Set<string>();
  if (candidateIds.length > 0 && opts.userId) {
    try {
      const { supabase, supabaseConfigured } = await import('./supabase');
      if (supabaseConfigured) {
        const { data } = await supabase
          .from('expert_recommendations')
          .select('restaurant_id')
          .in('restaurant_id', candidateIds);
        for (const row of data || []) expertRecIds.add((row as { restaurant_id: string }).restaurant_id);
      }
    } catch { /* ignore */ }
  }

  const signals: CandidateSignals = {
    expertUserIds,
    followedExpertIds: followedExperts,
    friendUserIds,
    communityByRestaurant,
    expertRecRestaurantIds: expertRecIds,
    moodMatchIds,
  };

  // An aborted gather must not persist: a stale/cancelled browser session
  // writing the SHARED (user_id, location_key) cache row could clobber a
  // fresher entry another surface just saved.
  if (opts.signal?.aborted) return { candidates, signals, fetchedAt: Date.now() };

  // Persist the pool (not a scored page of it) whenever we actually hit
  // Google, so the next open of the same city ranks instantly with zero
  // Places spend. Michelin synthetics are excluded — they rebuild for free
  // from the local dataset. Ordered by a quality proxy so the cap keeps the
  // most useful 60.
  // A mood pool is NOT the everyday pool: it leans toward tonight's words
  // and shares the one (user_id, location_key) row, so persisting it would
  // clobber the plain pool and make the next ordinary open pay for Google
  // again. Mood runs stay in the in-memory pool cache for the session.
  if (opts.userId && !skipGoogle && candidates.length > 0 && moodTerms.length === 0) {
    const persistable = candidates
      .filter((c) => !isMichelinSyntheticId(c.id))
      .sort((a, b) => {
        const bayes = (p: RecCandidate) =>
          p.rating > 0 ? (p.userRatingCount * p.rating + 25 * 3.8) / (p.userRatingCount + 25) : 3.8;
        return bayes(b) - bayes(a);
      })
      .slice(0, 60);
    if (persistable.length > 0) {
      void saveHomeRecsCache(
        opts.userId,
        locKey,
        opts.target.label,
        opts.target.lat,
        opts.target.lng,
        prefsHash,
        persistable,
      );
    }
  }

  return { candidates, signals, fetchedAt: Date.now() };
}

function emptySignals(): CandidateSignals {
  return {
    expertUserIds: new Set(),
    followedExpertIds: new Set(),
    friendUserIds: new Set(),
    communityByRestaurant: new Map(),
    expertRecRestaurantIds: new Set(),
  };
}

/**
 * Full pipeline: gather a pool, rank it. A cache hit skips the Google spend,
 * never the scoring — results always carry recScore / reasons / predicted,
 * and the social lifts stay current even when the pool comes from cache.
 */
export async function getRecommendations(opts: RecOptions): Promise<ScoredPlace[]> {
  const limit = opts.limit ?? 12;
  const pool = await gatherRecCandidates(opts);
  if (opts.signal?.aborted) return [];
  return scoreCandidates(
    pool.candidates,
    opts.profile,
    pool.signals,
    opts.target,
    opts.radiusMeters,
    {
      limit,
      skipUserHistory: true,
      keepWishlisted: opts.keepWishlisted,
      enforcePriceBand: opts.enforcePriceBand ?? true,
    },
  );
}
