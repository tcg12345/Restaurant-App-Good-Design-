/**
 * Free-text mood → the levers the recommendation engine actually has.
 *
 * "Quiet date-night spot with great cocktails, not too pricey" is not a
 * job for a language model: the app's own vocabulary — ALL_TAGS (which
 * the scorer's tagOverlap term runs on), the canonical cuisine catalogue,
 * four price tiers, an open-now filter — covers what a mood sentence can
 * usefully say about a restaurant. Mapping onto it deterministically is
 * instant, free, works offline, and can be pinned by tests; the AI chat
 * is one tap away for anything genuinely conversational.
 *
 * Honesty rule: the UI shows exactly what was understood (the
 * `recognized` echo) and claims nothing for words it didn't match.
 *
 * Matching consumes text longest-phrase-first, so "date night" can't
 * double-fire "night" → Late Night, and "not too expensive" wins over
 * "expensive".
 */

export interface MoodQuery {
  /** Canonical cuisine labels (places.ts CUISINE_TYPES) → the cuisine filter. */
  cuisines: string[];
  /** ALL_TAGS tokens → a transient boost on the profile's tagScore, so the
   *  mood feeds the RANKING (and its reason chips), not just a filter. */
  tags: string[];
  /** Price tiers (1–4) → the price filter. Empty = no opinion. */
  priceLevels: number[];
  openNow: boolean;
  /** Phrases for the candidate-gathering queries (see Effect.q). */
  searchPhrases: string[];
  /** Human-readable echo of what was understood, in input order — the
   *  feedback chips under the field. */
  recognized: string[];
}

type Effect = {
  tags?: string[];
  cuisines?: string[];
  priceLevels?: number[];
  openNow?: boolean;
  /** Echo label; defaults to the tags/cuisines themselves. */
  say?: string;
  /** Words for the Google text search itself. The tag boost only bites on
   *  candidates the community has already tagged, and most places in a
   *  fresh pool carry no tags at all — so a mood that never reaches the
   *  QUERIES can't surface a rooftop that nobody here has rated yet.
   *  Google's own text search does understand "romantic with a view". */
  q?: string;
};

/** Phrase table. Multi-word phrases are matched before shorter ones.
 *  Tag values MUST be ALL_TAGS tokens (RatingShared) — the same invariant
 *  every prior table in the engine states: an invented token boosts a tag
 *  no rater has ever applied, i.e. nothing. */
const PHRASES: Array<[string, Effect]> = [
  // ── Negated price first, so the plain words can't claim them ──
  ['not too expensive', { priceLevels: [1, 2], say: 'Easy on the wallet' }],
  ['not expensive', { priceLevels: [1, 2], say: 'Easy on the wallet' }],
  ['not too pricey', { priceLevels: [1, 2], say: 'Easy on the wallet' }],
  ['not pricey', { priceLevels: [1, 2], say: 'Easy on the wallet' }],
  ['nothing fancy', { priceLevels: [1, 2], tags: ['Casual Vibes'], say: 'Nothing fancy' }],
  ['nothing too fancy', { priceLevels: [1, 2], tags: ['Casual Vibes'], say: 'Nothing fancy' }],

  // ── Occasions & atmosphere ──
  ['date night', { tags: ['Romantic', 'Intimate'], say: 'Date night', q: 'romantic' }],
  ['date', { tags: ['Romantic', 'Intimate'], say: 'Date night', q: 'romantic' }],
  ['romantic', { tags: ['Romantic', 'Intimate'], q: 'romantic' }],
  ['anniversary', { tags: ['Romantic', 'Special Occasion'], say: 'Anniversary', q: 'romantic' }],
  ['birthday', { tags: ['Special Occasion', 'Good for Groups'], say: 'Birthday', q: 'birthday' }],
  ['celebrate', { tags: ['Special Occasion'], say: 'A celebration', q: 'special occasion' }],
  ['celebrating', { tags: ['Special Occasion'], say: 'A celebration', q: 'special occasion' }],
  ['celebration', { tags: ['Special Occasion'], say: 'A celebration', q: 'special occasion' }],
  ['special occasion', { tags: ['Special Occasion'], q: 'special occasion' }],
  ['quiet', { tags: ['Quiet & Peaceful'], q: 'quiet' }],
  ['peaceful', { tags: ['Quiet & Peaceful'], q: 'quiet' }],
  ['calm', { tags: ['Quiet & Peaceful'], q: 'quiet' }],
  ['low key', { tags: ['Casual Vibes', 'Quiet & Peaceful'], say: 'Low-key', q: 'low key' }],
  ['lively', { tags: ['Lively Energy'], q: 'lively' }],
  ['buzzy', { tags: ['Lively Energy'], q: 'lively' }],
  ['vibey', { tags: ['Lively Energy', 'Hip & Trendy'], q: 'trendy' }],
  ['fun', { tags: ['Lively Energy'] }],
  ['cozy', { tags: ['Cozy Atmosphere'], q: 'cozy' }],
  ['charming', { tags: ['Charming Decor'], q: 'charming' }],
  ['trendy', { tags: ['Hip & Trendy'], q: 'trendy' }],
  ['hip', { tags: ['Hip & Trendy'], q: 'trendy' }],
  ['casual', { tags: ['Casual Vibes'] }],
  ['chill', { tags: ['Casual Vibes'] }],
  ['laid back', { tags: ['Casual Vibes'], say: 'Laid back' }],
  ['upscale', { tags: ['Upscale'], q: 'upscale' }],
  ['elegant', { tags: ['Upscale'], q: 'elegant' }],
  ['classy', { tags: ['Upscale'], q: 'upscale' }],
  ['fancy', { tags: ['Upscale'], priceLevels: [3, 4], q: 'upscale' }],
  ['fine dining', { tags: ['Upscale'], priceLevels: [3, 4], say: 'Fine dining', q: 'fine dining' }],
  ['michelin', { tags: ['Upscale'], priceLevels: [3, 4], say: 'Michelin-level', q: 'michelin star' }],
  ['rooftop', { tags: ['Rooftop'], q: 'rooftop' }],
  ['a view', { tags: ['Great Views'], say: 'Great Views', q: 'with a view' }],
  ['views', { tags: ['Great Views'], say: 'Great Views', q: 'with a view' }],
  ['view', { tags: ['Great Views'], say: 'Great Views', q: 'with a view' }],
  ['outdoor', { tags: ['Outdoor Seating'], q: 'outdoor seating' }],
  ['outside', { tags: ['Outdoor Seating'], say: 'Outdoor Seating', q: 'outdoor seating' }],
  ['patio', { tags: ['Outdoor Seating'], say: 'Outdoor Seating', q: 'outdoor seating' }],
  ['al fresco', { tags: ['Outdoor Seating'], say: 'Outdoor Seating', q: 'outdoor seating' }],

  // ── Food & drink leanings ──
  ['cocktails', { tags: ['Great Cocktails'], q: 'cocktails' }],
  ['cocktail', { tags: ['Great Cocktails'], say: 'Great Cocktails', q: 'cocktails' }],
  ['drinks', { tags: ['Great Cocktails'], say: 'Great Cocktails', q: 'cocktails' }],
  ['wine', { tags: ['Great Wine List'], q: 'wine' }],
  ['coffee', { tags: ['Great Coffee'], q: 'coffee' }],
  ['dessert', { tags: ['Amazing Desserts'], q: 'dessert' }],
  ['desserts', { tags: ['Amazing Desserts'], q: 'dessert' }],
  ['brunch', { tags: ['Good Brunch'], say: 'Brunch', q: 'brunch' }],
  ['breakfast', { cuisines: ['Breakfast'], say: 'Breakfast' }],
  ['vegetarian', { tags: ['Good Vegetarian Options'], q: 'vegetarian' }],
  ['vegan', { tags: ['Good Vegetarian Options', 'Healthy Options'], say: 'Vegan-friendly', q: 'vegan' }],
  ['healthy', { tags: ['Healthy Options'], q: 'healthy' }],
  ['light', { tags: ['Healthy Options'], say: 'Something light' }],
  ['creative', { tags: ['Creative Menu'], q: 'creative' }],
  ['tasting menu', { tags: ['Creative Menu', 'Upscale'], priceLevels: [3, 4], say: 'Tasting menu', q: 'tasting menu' }],

  // ── Practicalities ──
  ['quick', { tags: ['Quick Bite'], say: 'Something quick', q: 'quick' }],
  ['fast', { tags: ['Quick Bite'], say: 'Something quick', q: 'quick' }],
  ['grab a bite', { tags: ['Quick Bite'], say: 'Something quick', q: 'quick bite' }],
  ['open late', { tags: ['Late Night'], say: 'Open late', q: 'open late' }],
  ['late night', { tags: ['Late Night'], say: 'Open late', q: 'late night' }],
  ['open now', { openNow: true, say: 'Open now' }],
  ['still open', { openNow: true, say: 'Open now' }],
  ['big group', { tags: ['Good for Groups'], say: 'Good for Groups', q: 'large groups' }],
  ['group', { tags: ['Good for Groups'], say: 'Good for Groups' }],
  ['groups', { tags: ['Good for Groups'], say: 'Good for Groups' }],
  ['family', { tags: ['Kid Friendly'], say: 'Kid Friendly', q: 'family friendly' }],
  ['kids', { tags: ['Kid Friendly'], say: 'Kid Friendly', q: 'family friendly' }],
  ['kid friendly', { tags: ['Kid Friendly'], q: 'family friendly' }],
  ['dog friendly', { tags: ['Pet Friendly'], say: 'Pet Friendly', q: 'dog friendly' }],
  ['pet friendly', { tags: ['Pet Friendly'], q: 'dog friendly' }],
  ['solo', { tags: ['Good for Solo Dining'], say: 'Good for Solo Dining', q: 'counter seating' }],

  // ── Price words ──
  ['cheap', { priceLevels: [1, 2], tags: ['Good Value'], say: 'Cheap eats', q: 'cheap' }],
  ['budget', { priceLevels: [1, 2], tags: ['Good Value'], say: 'Easy on the wallet', q: 'cheap' }],
  ['affordable', { priceLevels: [1, 2], tags: ['Good Value'], say: 'Easy on the wallet', q: 'affordable' }],
  ['inexpensive', { priceLevels: [1, 2], say: 'Easy on the wallet', q: 'cheap' }],
  ['mid range', { priceLevels: [2, 3], say: 'Mid-range', q: 'mid range' }],
  ['expensive', { priceLevels: [3, 4], say: 'High end', q: 'upscale' }],
  ['splurge', { priceLevels: [3, 4], tags: ['Upscale', 'Special Occasion'], say: 'A splurge', q: 'fine dining' }],
  ['high end', { priceLevels: [3, 4], tags: ['Upscale'], say: 'High end', q: 'upscale' }],
  ['luxury', { priceLevels: [3, 4], tags: ['Upscale'], say: 'High end', q: 'upscale' }],
];

/** Cuisine aliases beyond the canonical labels themselves. */
const CUISINE_ALIASES: Array<[string, string]> = [
  ['sushi', 'Sushi'], ['ramen', 'Ramen'], ['tacos', 'Taco'], ['taco', 'Taco'],
  ['noodles', 'Noodle'], ['noodle', 'Noodle'], ['pasta', 'Italian'],
  ['pizza', 'Pizza'], ['burger', 'Burgers'], ['burgers', 'Burgers'],
  ['bbq', 'BBQ'], ['barbecue', 'BBQ'], ['steak', 'Steakhouse'],
  ['steakhouse', 'Steakhouse'], ['dim sum', 'Dim Sum'], ['hot pot', 'Hot Pot'],
  ['seafood', 'Seafood'], ['tapas', 'Tapas'], ['thai', 'Thai'],
  ['italian', 'Italian'], ['japanese', 'Japanese'], ['mexican', 'Mexican'],
  ['indian', 'Indian'], ['chinese', 'Chinese'], ['french', 'French'],
  ['korean', 'Korean'], ['greek', 'Greek'], ['spanish', 'Spanish'],
  ['mediterranean', 'Mediterranean'], ['vietnamese', 'Vietnamese'],
  ['american', 'American'], ['peruvian', 'Peruvian'], ['ethiopian', 'Ethiopian'],
  ['filipino', 'Filipino'], ['turkish', 'Turkish'], ['lebanese', 'Lebanese'],
  ['caribbean', 'Caribbean'], ['brazilian', 'Brazilian'], ['cuban', 'Cuban'],
  ['deli', 'Deli'], ['bakery', 'Bakery'], ['wings', 'Fried Chicken'],
  ['fried chicken', 'Fried Chicken'],
];

interface Rule { phrase: string; words: string[]; effect: Effect; kind: 'phrase' | 'cuisine' }

const RULES: Rule[] = [
  ...PHRASES.map(([phrase, effect]): Rule => ({ phrase, words: phrase.split(' '), effect, kind: 'phrase' })),
  ...CUISINE_ALIASES.map(([phrase, label]): Rule => ({
    phrase,
    words: phrase.split(' '),
    // `q` is the user's own word: Google understands "sushi" and "pasta"
    // better than a canonical label, and the cuisine is usually the most
    // load-bearing word in the sentence.
    effect: { cuisines: [label], say: label, q: phrase },
    kind: 'cuisine',
  })),
]
  // Longest phrases claim their words first.
  .sort((a, b) => b.words.length - a.words.length || b.phrase.length - a.phrase.length);

export function parseMoodText(text: string): MoodQuery {
  const out: MoodQuery = { cuisines: [], tags: [], priceLevels: [], openNow: false, searchPhrases: [], recognized: [] };
  const cleaned = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/-/g, ' ');
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return out;

  const consumed = new Array<boolean>(words.length).fill(false);
  // Track order of recognition by first word index, so the echo reads in
  // the order the user said things.
  const hits: Array<{ at: number; effect: Effect; say: string }> = [];

  for (const rule of RULES) {
    for (let i = 0; i + rule.words.length <= words.length; i++) {
      let ok = true;
      for (let j = 0; j < rule.words.length; j++) {
        if (consumed[i + j] || words[i + j] !== rule.words[j]) { ok = false; break; }
      }
      if (!ok) continue;
      for (let j = 0; j < rule.words.length; j++) consumed[i + j] = true;
      const say = rule.effect.say
        ?? rule.effect.tags?.join(', ')
        ?? rule.effect.cuisines?.join(', ')
        ?? rule.phrase;
      hits.push({ at: i, effect: rule.effect, say });
      // One hit per rule is enough — "sushi sushi sushi" is one opinion.
      break;
    }
  }

  hits.sort((a, b) => a.at - b.at);
  const seenSay = new Set<string>();
  for (const h of hits) {
    for (const t of h.effect.tags ?? []) if (!out.tags.includes(t)) out.tags.push(t);
    for (const c of h.effect.cuisines ?? []) if (!out.cuisines.includes(c)) out.cuisines.push(c);
    for (const p of h.effect.priceLevels ?? []) if (!out.priceLevels.includes(p)) out.priceLevels.push(p);
    if (h.effect.openNow) out.openNow = true;
    if (h.effect.q && !out.searchPhrases.includes(h.effect.q)) out.searchPhrases.push(h.effect.q);
    if (!seenSay.has(h.say)) { seenSay.add(h.say); out.recognized.push(h.say); }
  }
  out.priceLevels.sort((a, b) => a - b);
  return out;
}

/** True when the parse found anything actionable at all. */
export function moodHasSignal(q: MoodQuery): boolean {
  return q.tags.length > 0 || q.cuisines.length > 0 || q.priceLevels.length > 0 || q.openNow;
}

import type { TasteProfile } from './recommendations';

/**
 * The mood's ranking half: a transient boost on the profile's tagScore.
 *
 * The scorer already has a tag machine — tagOverlap normalizes each tag
 * affinity against the profile's strongest and emits "Your vibe: …"
 * reason chips. Riding it means the mood genuinely RE-RANKS (places the
 * community has tagged Romantic rise for "date night") instead of merely
 * filtering, with zero new scoring code — and it composes with everything
 * else the profile knows.
 *
 * The boost is pinned just above the profile's own strongest tag, so a
 * stated mood outranks accumulated habit for the length of this search —
 * asking is stronger evidence about TONIGHT than history is — without
 * drowning the cuisine/price/friend terms, whose weights are untouched.
 */
export function withMoodTags(
  profile: TasteProfile,
  tags: string[],
  /** Cuisines the mood named. Boosted, NEVER filtered on: a hard cuisine
   *  filter is how "expensive sushi" returned an empty list — Google types
   *  most sushi rooms as Japanese, so the label never matched. */
  cuisines: string[] = [],
): TasteProfile {
  if (tags.length === 0 && cuisines.length === 0) return profile;
  let tagMax = 1;
  for (const v of Object.values(profile.tagScore)) tagMax = Math.max(tagMax, Math.abs(v));
  const tagScore = { ...profile.tagScore };
  for (const t of tags) tagScore[t] = tagMax * 1.25;

  let cMax = 1;
  for (const v of Object.values(profile.cuisineScore)) cMax = Math.max(cMax, Math.abs(v));
  const cuisineScore = { ...profile.cuisineScore };
  for (const c of cuisines) cuisineScore[c] = cMax * 1.25;

  return { ...profile, tagScore, cuisineScore };
}
