/**
 * Guide suggestions — reading the brief the user already wrote.
 *
 * By the time somebody reaches "Add places" they have typed a title and
 * maybe some tags: "Best Italian in the West Village", "Cheap weeknight
 * dinners", "Cozy date night spots". That is a description of exactly which
 * of their own places belong in the guide, and the picker used to ignore it
 * completely — handing them the same unordered list of everything they had
 * ever rated and letting them find the Italian ones themselves.
 *
 * This module turns the title + tags into criteria, scores the user's own
 * ratings / recipes against them, and returns a ranked shortlist with the
 * reason each one is there. Pure and synchronous by design: it runs on
 * every keystroke, it works on a plane, and it costs nothing.
 *
 * ── Why not an LLM ────────────────────────────────────────────────────
 * A model would read an abstract title ("somewhere to take my parents")
 * better than any keyword pass can. But the common briefs are concrete —
 * a cuisine, a price, a neighbourhood, a vibe — and for those this is
 * exact, instant, free, and cannot hallucinate a restaurant the user never
 * went to. The seam for a model is `scoreRatings` / `scoreRecipes`: same
 * input, same ScoredSuggestion out, so a ranker could re-order these
 * later without the UI changing.
 *
 * ── The one rule worth stating ────────────────────────────────────────
 * Suggestions come ONLY from what the user has already rated or cooked.
 * A guide is a personal recommendation with their name on it, so a place
 * they have never been to must never appear in a list called "suggested
 * for you" — that is what the Search tab is for.
 */

import { cuisinesNamedIn } from './cuisine';

/* ── The brief ─────────────────────────────────────────────────────── */

export interface GuideBrief {
  title: string;
  tags: string[];
  /** Optional free text from the "More details" fields. */
  subtitle?: string;
  city?: string;
}

export interface GuideCriteria {
  /** Cuisines named outright: "best italian food" → ['Italian']. */
  cuisines: string[];
  /** Words describing a room or an occasion, matched against the tags the
   *  user put on their own ratings ("Romantic", "Great cocktails"). */
  vibes: string[];
  /** Place words left over after the known vocabularies are consumed —
   *  matched against the address / neighbourhood. */
  places: string[];
  /** 'cheap' caps at $$, 'splurge' floors at $$$. */
  price: 'cheap' | 'splurge' | null;
  /** "best", "top", "favourite" — lean harder on the user's own score. */
  superlative: boolean;
  /** Recipes only. */
  maxMinutes: number | null;
  difficulty: 'easy' | null;
  /** True when nothing specific was found and the ranking is just
   *  "your highest rated" — the UI says so rather than implying a match. */
  isGeneric: boolean;
}

/* Words that describe an occasion or a room rather than a food. Matched
   against the user's own rating tags and notes, which is where this
   vocabulary actually pays off — the app already asks people to tag a
   rating "Romantic" or "Great cocktails". */
const VIBE_WORDS: Record<string, string[]> = {
  romantic: ['romantic', 'date', 'date night', 'anniversary', 'intimate'],
  cozy: ['cozy', 'cosy', 'warm', 'comfort', 'comforting', 'homey'],
  lively: ['lively', 'fun', 'buzzy', 'loud', 'party', 'vibey'],
  quiet: ['quiet', 'calm', 'peaceful', 'low key', 'mellow'],
  group: ['group', 'groups', 'friends', 'family', 'crowd', 'birthday', 'party'],
  outdoor: ['outdoor', 'outdoors', 'patio', 'terrace', 'garden', 'rooftop', 'al fresco'],
  brunch: ['brunch', 'breakfast', 'morning'],
  lunch: ['lunch', 'midday'],
  dinner: ['dinner', 'supper', 'evening'],
  latenight: ['late night', 'late-night', 'midnight', 'after hours'],
  drinks: ['drinks', 'cocktail', 'cocktails', 'wine', 'bar', 'natural wine'],
  view: ['view', 'views', 'waterfront', 'skyline'],
  solo: ['solo', 'alone', 'counter', 'bar seat'],
  classic: ['classic', 'institution', 'timeless', 'old school'],
  hidden: ['hidden', 'underrated', 'secret', 'sleeper', 'gem', 'hole in the wall'],
  healthy: ['healthy', 'light', 'fresh', 'clean'],
  hearty: ['hearty', 'filling', 'rich', 'indulgent'],
};

const CHEAP_WORDS = ['cheap', 'cheaper', 'budget', 'affordable', 'value', 'bargain', 'inexpensive', 'under'];
const SPLURGE_WORDS = ['splurge', 'fancy', 'upscale', 'fine dining', 'expensive', 'special occasion', 'blowout', 'tasting menu'];
const SUPERLATIVES = ['best', 'top', 'favourite', 'favorite', 'favourites', 'favorites', 'greatest', 'ultimate', 'essential', 'must', 'go-to', 'goto'];
const QUICK_WORDS = ['quick', 'fast', 'weeknight', 'easy', 'simple', 'speedy', '15 minute', '20 minute', '30 minute'];
const EASY_WORDS = ['easy', 'simple', 'beginner', 'no fuss', 'foolproof'];

/* Words that carry no signal — dropped before the leftovers are treated as
   place names, so "Best food in Rome" looks for Rome and not for "food". */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'my', 'our', 'your', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for',
  'from', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'i', 'we', 'you', 'it', 'this',
  'that', 'these', 'those', 'guide', 'guides', 'list', 'lists', 'places', 'place', 'spot',
  'spots', 'restaurant', 'restaurants', 'food', 'foods', 'eat', 'eats', 'eating', 'dining',
  'dish', 'dishes', 'meal', 'meals', 'recipe', 'recipes', 'cook', 'cooking', 'make',
  'where', 'what', 'when', 'who', 'how', 'go', 'going', 'take', 'try', 'love', 'like',
  'good', 'great', 'nice', 'all', 'some', 'more', 'most', 'very', 'really', 'so', 'too',
]);

const norm = (s: string): string => (s || '').toLowerCase().trim();

/** Minutes named outright: "30 minute dinners", "under 20 mins". */
function minutesIn(text: string): number | null {
  const m = text.match(/(\d{1,3})\s*(?:-|\s)?\s*(?:min|mins|minute|minutes)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 && n <= 600 ? n : null;
}

/**
 * Read the brief. Everything downstream keys off this, so it is exported
 * and tested on its own — the ranking is only as good as this reading.
 */
export function readBrief(brief: GuideBrief): GuideCriteria {
  const text = [brief.title, brief.subtitle, ...(brief.tags || [])].filter(Boolean).map(norm).join(' ');
  // Padded, so a single `includes(` word `)` is a word-boundary test for
  // one-word and multi-word phrases alike — no regex, no precedence traps.
  const hay = ` ${text} `;
  const has = (words: string[]) => words.some((w) => hay.includes(` ${w} `));

  const cuisines = cuisinesNamedIn(text);

  const vibes: string[] = [];
  for (const [key, words] of Object.entries(VIBE_WORDS)) {
    if (words.some((w) => hay.includes(` ${w} `))) vibes.push(key);
  }

  const price: GuideCriteria['price'] = has(CHEAP_WORDS) ? 'cheap' : has(SPLURGE_WORDS) ? 'splurge' : null;
  const superlative = has(SUPERLATIVES);
  const explicitMinutes = minutesIn(text);
  const maxMinutes = explicitMinutes ?? (has(QUICK_WORDS) ? 30 : null);
  const difficulty = has(EASY_WORDS) ? 'easy' as const : null;

  // Whatever is left after the known vocabularies have taken their words is
  // treated as a place name. Cuisine words are removed first so "Best Thai
  // in Austin" doesn't go looking for a neighbourhood called Thai.
  const consumed = new Set<string>();
  for (const c of cuisines) c.toLowerCase().split(/[^a-z0-9]+/).forEach((w) => consumed.add(w));
  for (const list of [CHEAP_WORDS, SPLURGE_WORDS, SUPERLATIVES, QUICK_WORDS, EASY_WORDS]) {
    for (const w of list) if (hay.includes(` ${w} `)) w.split(' ').forEach((x) => consumed.add(x));
  }
  for (const key of vibes) for (const w of VIBE_WORDS[key]) w.split(' ').forEach((x) => consumed.add(x));

  // Contiguous runs, not loose words: "Best pizza in the West Village"
  // must look for "west village", not for "west" and "village" separately —
  // the second reads back to the user as two nonsense chips, and "west"
  // alone matches every address on West 10th Street.
  const places: string[] = [];
  let run: string[] = [];
  for (const w of text.replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)) {
    const keep = w.length > 2 && !STOPWORDS.has(w) && !consumed.has(w) && !/^\d+$/.test(w);
    if (keep) run.push(w);
    else if (run.length) { places.push(run.join(' ')); run = []; }
  }
  if (run.length) places.push(run.join(' '));

  const isGeneric = cuisines.length === 0 && vibes.length === 0 && places.length === 0
    && !price && maxMinutes == null && !difficulty;

  return { cuisines, vibes, places, price, superlative, maxMinutes, difficulty, isGeneric };
}

/* ── Scoring ───────────────────────────────────────────────────────── */

export interface ScoredSuggestion<T> {
  item: T;
  score: number;
  /** Short chips shown on the row: why this one is here. */
  reasons: string[];
}

/** The slice of a rating this module needs — structural, so tests don't
 *  have to build a whole RestaurantRating and the shape can't drift. */
export interface RatingLike {
  restaurantId: string;
  name: string;
  cuisine?: string;
  price?: string;
  address?: string;
  score?: number;
  notes?: string;
  tags?: string[];
  favoriteDishes?: string[];
}

export interface RecipeLike {
  id: string;
  title: string;
  cuisine?: string;
  difficulty?: string;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  tags?: string[];
  /** From the matching home meal, when there is one. */
  score?: number;
}

/** $ count, or 0 when unpriced. */
const priceLevel = (p?: string): number => (p || '').split('').filter((c) => c === '$').length;

/** A rating's own score contribution, 0–1. Unrated sits at the middle
 *  rather than the bottom: absent is not the same as bad. */
const scoreWeight = (score?: number): number =>
  typeof score === 'number' && score > 0 ? Math.min(1, Math.max(0, score / 10)) : 0.5;

function cuisineMatches(itemCuisine: string | undefined, wanted: string[]): string | null {
  if (wanted.length === 0) return null;
  const own = norm(itemCuisine);
  if (!own) return null;
  for (const w of wanted) {
    const lw = w.toLowerCase();
    // Substring both ways: the stored cuisine may be "Modern Italian" for a
    // wanted "Italian", or plain "Thai" for a wanted "Thai Contemporary".
    if (own.includes(lw) || lw.includes(own)) return w;
  }
  return null;
}

/** Does any of the item's own free text mention one of the vibe words? */
function vibeMatches(haystacks: Array<string | undefined>, vibes: string[]): string | null {
  if (vibes.length === 0) return null;
  const hay = ` ${haystacks.filter(Boolean).map(norm).join(' ')} `;
  if (hay.trim() === '') return null;
  for (const v of vibes) {
    for (const w of VIBE_WORDS[v] || []) {
      if (hay.includes(` ${w} `) || hay.includes(w)) return v;
    }
  }
  return null;
}

/**
 * The whole phrase first, then its individual words as a fallback — so
 * "west village" matches as a neighbourhood, while "lower east side
 * dumplings" (where the run swept up a word that isn't part of the place)
 * still finds the address on "lower". Short words are excluded from the
 * fallback: three letters match far too much of an address line.
 */
function placeMatches(address: string | undefined, places: string[]): string | null {
  if (places.length === 0 || !address) return null;
  const hay = norm(address);
  for (const p of places) if (hay.includes(p)) return p;
  for (const p of places) {
    for (const w of p.split(' ')) if (w.length >= 4 && hay.includes(w)) return w;
  }
  return null;
}

/** "west village" → "West Village", for the chip and the summary line. */
const titleCase = (s: string): string =>
  s.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

/** Title-case a vibe key for display ("latenight" → "Late night"). */
const VIBE_LABELS: Record<string, string> = {
  romantic: 'Date night', cozy: 'Cozy', lively: 'Lively', quiet: 'Quiet',
  group: 'Good for groups', outdoor: 'Outdoor', brunch: 'Brunch', lunch: 'Lunch',
  dinner: 'Dinner', latenight: 'Late night', drinks: 'Drinks', view: 'View',
  solo: 'Solo', classic: 'Classic', hidden: 'Hidden gem', healthy: 'Healthy',
  hearty: 'Hearty',
};

/**
 * Rank the user's rated restaurants against the brief.
 *
 * A specific brief is a filter, not a nudge: if the title says Italian, a
 * 9.8 Thai place is not a near miss to be listed below the Italian ones —
 * it is the wrong answer, and showing it teaches the user the suggestions
 * are noise. So items matching no stated criterion are dropped outright,
 * and score only orders what survives. When the brief says nothing
 * specific, everything qualifies and this is simply "your highest rated".
 *
 * A named cuisine is stronger still — a hard filter rather than one
 * criterion among several. "Best Italian in the West Village" names two
 * things, but they are not equal: an Italian place in Nolita is a fair
 * suggestion, a West Village Thai place is not. Cuisine decides who is
 * eligible; everything else decides the order.
 */
export function scoreRatings(
  ratings: RatingLike[],
  criteria: GuideCriteria,
  opts: { exclude?: ReadonlySet<string>; limit?: number } = {},
): ScoredSuggestion<RatingLike>[] {
  const { exclude, limit = 8 } = opts;
  const out: ScoredSuggestion<RatingLike>[] = [];

  for (const r of ratings) {
    if (exclude?.has(r.restaurantId)) continue;

    const reasons: string[] = [];
    let score = 0;
    let matched = false;

    const cuisineHit = cuisineMatches(r.cuisine, criteria.cuisines);
    // Named cuisine, wrong cuisine → not eligible, whatever else it answers.
    if (criteria.cuisines.length > 0 && !cuisineHit) continue;
    if (cuisineHit) { score += 4; matched = true; reasons.push(cuisineHit); }

    const vibeHit = vibeMatches([r.notes, (r.tags || []).join(' '), (r.favoriteDishes || []).join(' ')], criteria.vibes);
    if (vibeHit) { score += 2.2; matched = true; reasons.push(VIBE_LABELS[vibeHit] || vibeHit); }

    const placeHit = placeMatches(r.address, criteria.places);
    if (placeHit) { score += 2.2; matched = true; reasons.push(titleCase(placeHit)); }

    const lvl = priceLevel(r.price);
    if (criteria.price === 'cheap' && lvl > 0 && lvl <= 2) { score += 1.6; matched = true; reasons.push(r.price!); }
    if (criteria.price === 'splurge' && lvl >= 3) { score += 1.6; matched = true; reasons.push(r.price!); }

    // The brief named something and this place answers none of it.
    if (!criteria.isGeneric && !matched) continue;

    // Their own score always contributes; a superlative title makes it the
    // dominant term rather than the tiebreak.
    score += scoreWeight(r.score) * (criteria.superlative ? 4 : 2);
    if (typeof r.score === 'number' && r.score > 0 && (criteria.superlative || criteria.isGeneric)) {
      reasons.push(r.score.toFixed(1));
    }

    out.push({ item: r, score, reasons: reasons.slice(0, 3) });
  }

  // Name as the tiebreak so the order is stable between renders rather than
  // depending on however the ratings array happened to arrive.
  out.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return out.slice(0, limit);
}

/** The recipe half. Same contract; time and difficulty replace price. */
export function scoreRecipes(
  recipes: RecipeLike[],
  criteria: GuideCriteria,
  opts: { exclude?: ReadonlySet<string>; limit?: number } = {},
): ScoredSuggestion<RecipeLike>[] {
  const { exclude, limit = 8 } = opts;
  const out: ScoredSuggestion<RecipeLike>[] = [];

  for (const r of recipes) {
    if (exclude?.has(r.id)) continue;

    const reasons: string[] = [];
    let score = 0;
    let matched = false;

    const cuisineHit = cuisineMatches(r.cuisine, criteria.cuisines);
    if (criteria.cuisines.length > 0 && !cuisineHit) continue;
    if (cuisineHit) { score += 4; matched = true; reasons.push(cuisineHit); }

    const vibeHit = vibeMatches([r.title, (r.tags || []).join(' ')], criteria.vibes);
    if (vibeHit) { score += 2.2; matched = true; reasons.push(VIBE_LABELS[vibeHit] || vibeHit); }

    const total = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0);
    if (criteria.maxMinutes != null && total > 0 && total <= criteria.maxMinutes) {
      score += 2.4; matched = true; reasons.push(`${total} min`);
    }

    if (criteria.difficulty === 'easy' && norm(r.difficulty) === 'easy') {
      score += 1.8; matched = true; reasons.push('Easy');
    }

    if (!criteria.isGeneric && !matched) continue;

    score += scoreWeight(r.score) * (criteria.superlative ? 4 : 2);
    if (typeof r.score === 'number' && r.score > 0 && (criteria.superlative || criteria.isGeneric)) {
      reasons.push(r.score.toFixed(1));
    }

    out.push({ item: r, score, reasons: reasons.slice(0, 3) });
  }

  out.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return out.slice(0, limit);
}

/**
 * One line explaining the shortlist, shown above it. Saying what was
 * matched on is what makes a wrong suggestion legible as a wrong reading
 * of the title rather than the app being broken.
 */
export function describeCriteria(c: GuideCriteria): string {
  if (c.isGeneric) return 'Your highest rated — name the guide and this narrows to match.';
  const bits: string[] = [];
  if (c.cuisines.length) bits.push(c.cuisines.join(' + '));
  if (c.price === 'cheap') bits.push('under $$');
  if (c.price === 'splurge') bits.push('$$$ and up');
  if (c.maxMinutes != null) bits.push(`under ${c.maxMinutes} min`);
  if (c.difficulty === 'easy') bits.push('easy');
  for (const v of c.vibes.slice(0, 2)) bits.push((VIBE_LABELS[v] || v).toLowerCase());
  for (const p of c.places.slice(0, 2)) bits.push(titleCase(p));
  const joined = bits.slice(0, 4).join(' · ');
  return c.superlative ? `Your best ${joined}` : `Matching ${joined}`;
}
