/**
 * Relevance ranking for the combined search results (restaurants, people,
 * recipes) on the Search takeover.
 *
 * The problem this solves: results used to be grouped by KIND, so every
 * restaurant that merely contained your letters outranked the person whose
 * name you actually typed. Typing "Jenifer" showed restaurants first and
 * buried the one Jenifer you were looking for. Ranking has to cross the
 * kind boundary, or the kinds are really three separate searches wearing
 * one field.
 *
 * The tiering mirrors lib/cuisine.ts `searchCuisines` on purpose — the app
 * already ranks that way, and two different notions of "better match" in
 * one product is worse than either.
 */

import { cuisinesNamedIn } from './cuisine';

export type ResultKind = 'person' | 'restaurant' | 'recipe';

/* ── How well one string answers the query ─────────────────────────────── */

/**
 * 0 (no match) … 100 (exact). Tiers, not a continuum: the gaps between
 * them are what stop a long substring match from creeping above a clean
 * prefix match.
 */
export function matchScore(text: string | null | undefined, query: string): number {
  const t = (text ?? '').trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!t || !q) return 0;
  if (t === q) return 100;
  if (t.startsWith(q)) return 85;
  // A word inside it starts with the query — "jen" reaching "Ana Jenkins",
  // "amer" reaching "Contemporary American".
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 70;
  if (t.includes(q)) return 40;
  return 0;
}

/* ── Does the QUERY look like a person's name? ─────────────────────────── */

/**
 * Words that make a query about food rather than a person. Cuisines come
 * from lib/cuisine.ts; these are the venue/dish words that surround them
 * and are not cuisines themselves.
 */
const FOOD_WORDS = new Set([
  'restaurant', 'restaurants', 'cafe', 'café', 'coffee', 'bar', 'pub', 'grill', 'grille',
  'kitchen', 'bistro', 'brasserie', 'diner', 'deli', 'bakery', 'pizzeria', 'steakhouse',
  'tavern', 'eatery', 'canteen', 'buffet', 'food', 'menu', 'dish', 'dishes', 'recipe',
  'recipes', 'brunch', 'lunch', 'dinner', 'breakfast', 'dessert', 'cocktail', 'wine',
  'beer', 'pizza', 'burger', 'burgers', 'taco', 'tacos', 'sushi', 'pasta', 'noodle',
  'noodles', 'ramen', 'salad', 'sandwich', 'steak', 'chicken', 'seafood', 'bbq',
  'near', 'best', 'open', 'cheap', 'top',
]);

/**
 * 0 … 1 — how much the query reads as a personal name rather than a place
 * or a dish.
 *
 * Deliberately a SHAPE heuristic, not a dictionary of first names: a name
 * list would be huge, English-biased, and would still miss most of the
 * world's names while confidently mis-ranking them. What actually
 * generalises is the shape — one or two alphabetic words, no digits, no
 * food vocabulary. "Jenifer" scores high without anyone having listed it;
 * so does "Ayesha", "Kwame", "Nguyen".
 *
 * This is only a PRIOR. It nudges; the real evidence is whether a person
 * actually matched (see `rankResults`), so a high score here can never
 * invent a person who isn't there.
 */
export function personNameLikeness(query: string): number {
  const q = query.trim();
  if (!q) return 0;
  // Digits, @, or punctuation beyond name punctuation → not a name.
  if (/[0-9@#/\\]/.test(q)) return 0;
  if (!/^[\p{L}][\p{L}'’.\- ]*$/u.test(q)) return 0;

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length > 3) return 0;
  // Any food/cuisine vocabulary at all disqualifies it.
  if (words.some((w) => FOOD_WORDS.has(w))) return 0;
  if (cuisinesNamedIn(q).length > 0) return 0;

  // A single very short token is more likely a prefix of anything than a
  // name ("ba" should not privilege people).
  const shortest = Math.min(...words.map((w) => w.length));
  if (shortest < 3) return words.length === 1 ? 0.25 : 0.5;
  return words.length <= 2 ? 1 : 0.7;
}

/* ── Ranking a mixed result set ────────────────────────────────────────── */

export interface Rankable {
  kind: ResultKind;
  /** The name a user would have typed: restaurant name, display name, title. */
  primary: string;
  /** A second matchable identity — a @username, a cuisine, a recipe author. */
  secondary?: string | null;
  /** Someone the user follows or is friends with. */
  connected?: boolean;
  /** Verified reviewer / notable account. */
  verified?: boolean;
  /**
   * Kind-local popularity already normalised to 0…1 by the caller (rating
   * count, follower count). Only ever breaks ties — popularity must not
   * out-argue what the user actually typed.
   */
  popularity?: number;
}

/** Bonus added to a person's score, scaled by how name-like the query is. */
const PERSON_NAME_BONUS = 26;
/** Applied when the query is clearly about food, to settle the reverse case. */
const FOOD_INTENT_BONUS = 18;

/**
 * Score one result. Exported for tests and for callers that want to sort a
 * single kind without merging.
 */
export function scoreResult(item: Rankable, query: string): number {
  const base = Math.max(
    matchScore(item.primary, query),
    // A handle match is real but slightly weaker evidence than the name.
    matchScore(item.secondary, query) * 0.92,
  );
  if (base <= 0) return 0;

  let score = base;
  const nameLike = personNameLikeness(query);

  if (item.kind === 'person') {
    score += PERSON_NAME_BONUS * nameLike;
  } else if (nameLike === 0) {
    // The query looks like food, so the food kinds get the mirror boost.
    // Without this, a name-like query merely demotes restaurants rather
    // than a food-like query promoting them.
    score += FOOD_INTENT_BONUS;
  }

  if (item.connected) score += 12;
  if (item.verified) score += 4;
  // Strictly a tie-break: at most a few points, never a tier.
  score += Math.min(Math.max(item.popularity ?? 0, 0), 1) * 6;
  return score;
}

/**
 * Sort a mixed set by relevance, dropping non-matches. Stable for equal
 * scores, so the caller's own order (distance, recency) survives as the
 * final tie-break.
 */
export function rankResults<T extends Rankable>(items: T[], query: string): T[] {
  return rankBy(items, query, (item) => item);
}

/**
 * `rankResults` for domain objects. The projection keeps `UserProfile`,
 * `PlaceResult` and `Recipe` free of ranking fields they have no other
 * reason to carry — search is one consumer of those types, not their owner.
 *
 * Non-matches are dropped, so callers that need every item back (a section
 * that shows its own "no matches" copy) should check length before use.
 */
export function rankBy<T>(items: T[], query: string, project: (item: T) => Rankable): T[] {
  if (!query.trim()) return items;
  return items
    .map((item, i) => ({ item, i, score: scoreResult(project(item), query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((r) => r.item);
}

/**
 * The best score anything in `items` achieves — how strongly this whole
 * group answers the query. Used to order the result SECTIONS against each
 * other, which is what lets People outrank Restaurants for "Jenifer".
 */
export function bestScore<T>(items: T[], query: string, project: (item: T) => Rankable): number {
  if (!query.trim()) return 0;
  let best = 0;
  for (const item of items) best = Math.max(best, scoreResult(project(item), query));
  return best;
}
