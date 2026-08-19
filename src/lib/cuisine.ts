/**
 * Resolving a restaurant's cuisine from a Google place.
 *
 * This was previously four near-identical helpers (`getCuisineLabel`,
 * `inferCuisineLabel` ×2, `cuisineFromTypes` ×2) that each scanned the
 * place's `types` array for something in CUISINE_TYPES and gave up
 * otherwise. Two problems, both worst in rural areas:
 *
 *   1. `types` is often just ['restaurant', 'point_of_interest',
 *      'establishment'] outside big cities, even when Google knows more.
 *      `primaryType` and `primaryTypeDisplayName` carry the answer and were
 *      never requested — see the field masks in lib/places.ts.
 *   2. The detail-page helper answered 'Restaurant' when it didn't know,
 *      which is indistinguishable from a place that genuinely is just a
 *      restaurant. It put a fake "Restaurant" cuisine on saved ratings,
 *      which then became a fake "Restaurant" category in profile top lists.
 *      Unknown is now null, and callers show nothing.
 *
 * Resolution order, most to least trustworthy:
 *   primaryType → types[] → primaryTypeDisplayName → null
 */
import { CUISINE_TYPES } from './places';

export interface CuisineSource {
  /** Google's unordered type array. */
  types?: string[];
  /** Google's single best type for the place. Preferred over `types`
   *  precisely because it is the one Google committed to. */
  primaryType?: string;
  /** Google's localized human label for `primaryType`, e.g. "Barbecue
   *  restaurant". Present for many places whose `primaryType` isn't in our
   *  taxonomy at all. */
  primaryTypeDisplayName?: string;
}

export interface ResolvedCuisine {
  label: string;
  /** True when `label` is one of CUISINE_TYPES' own labels, so it's safe to
   *  use as a filter facet or a top-list category. A verbatim Google display
   *  name is legitimate to SHOW but must not enter the taxonomy — it is
   *  localized and open-ended, so filtering on it would fragment the
   *  categories per user locale. */
  canonical: boolean;
  source: 'primaryType' | 'types' | 'displayName';
}

/** Google type → our label. */
const TYPE_TO_LABEL: Record<string, string> = {};
/** Our label, lowercased → our label. Lets a display name that already
 *  matches a taxonomy label ("Sushi") come back canonical. */
const LABEL_TO_LABEL: Record<string, string> = {};
for (const c of CUISINE_TYPES) {
  if (!c.type || c.label === 'All') continue;
  TYPE_TO_LABEL[c.type] = c.label;
  LABEL_TO_LABEL[c.label.toLowerCase()] = c.label;
}

/**
 * Types that say "this is a place that serves food" and nothing more.
 * They must not resolve to a cuisine — answering 'Restaurant' for these is
 * the bug this module exists to fix. Note `bar`, `cafe`, `bakery`, `pub`,
 * `diner` and `deli` are deliberately NOT here: those are real answers.
 */
const GENERIC = new Set([
  'restaurant', 'food', 'point_of_interest', 'establishment', 'store',
  'meal_takeaway', 'meal_delivery', 'food_store', 'grocery_store',
]);

/**
 * Google's display names are the type in sentence case — "Barbecue
 * restaurant" for `barbecue_restaurant`, "Steak house" for `steak_house`.
 * Reversing that mapping is what lets a display name land back in the
 * taxonomy instead of being kept as a one-off string.
 */
function typeFromDisplayName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Resolve a place's cuisine, or null when nothing usable is available. */
export function resolveCuisine(place: CuisineSource): ResolvedCuisine | null {
  const primary = place.primaryType?.trim();
  if (primary && !GENERIC.has(primary) && TYPE_TO_LABEL[primary]) {
    return { label: TYPE_TO_LABEL[primary], canonical: true, source: 'primaryType' };
  }

  for (const t of place.types ?? []) {
    if (!t || GENERIC.has(t)) continue;
    const label = TYPE_TO_LABEL[t];
    if (label) return { label, canonical: true, source: 'types' };
  }

  const display = place.primaryTypeDisplayName?.trim();
  if (display) {
    const asType = typeFromDisplayName(display);
    if (GENERIC.has(asType)) return null;
    const canonicalLabel = TYPE_TO_LABEL[asType] ?? LABEL_TO_LABEL[display.toLowerCase()];
    if (canonicalLabel) return { label: canonicalLabel, canonical: true, source: 'displayName' };
    // Not in our taxonomy, but still a real answer for a human to read.
    return { label: display, canonical: false, source: 'displayName' };
  }

  return null;
}

/**
 * The label to display, or '' when unknown.
 *
 * '' rather than 'Restaurant' on purpose: every meta line in the app builds
 * itself with `.filter(Boolean).join(' · ')`, so an empty cuisine simply
 * drops out of the line instead of asserting something we don't know.
 */
export function cuisineLabel(place: CuisineSource): string {
  return resolveCuisine(place)?.label ?? '';
}

/**
 * The label only when it belongs to the taxonomy — for anything that
 * groups, filters or counts by cuisine (search facets, profile top lists,
 * recommendation signals). Keeps open-ended Google display names out of
 * places where they'd fragment the categories.
 */
export function canonicalCuisineLabel(place: CuisineSource): string {
  const resolved = resolveCuisine(place);
  return resolved?.canonical ? resolved.label : '';
}

/**
 * The label for one Google place type, or '' if we don't map it.
 * For UI that already holds a type (filter chips, saved facets) rather than
 * a place — not a resolution path.
 */
export function labelForCuisineType(type: string | undefined): string {
  return (type && TYPE_TO_LABEL[type]) || '';
}

/* ── The list people can suggest from ──────────────────────────────────
   CUISINE_TYPES exists to map Google's place types, so it stops where
   Google's taxonomy stops — no Portuguese-speaking West Africa, no
   Levant beyond "Middle Eastern", nothing between "Asian" and the six
   Asian cuisines Google happens to model. That is fine for reading a
   place's `types` and far too thin for a person telling us what a
   restaurant actually is.

   So suggestions draw from a wider list: every taxonomy label, plus the
   cuisines and formats people actually name. A suggested label that has
   no Google type still works everywhere the app groups by the cuisine
   STRING (profile top lists, a rating's meta line); it simply isn't a
   Google-type search facet, which no user-entered label could be. */
const EXTRA_CUISINES: string[] = [
  // Europe
  'Albanian', 'Austrian', 'Basque', 'Belgian', 'British', 'Bulgarian', 'Catalan',
  'Croatian', 'Czech', 'Danish', 'Dutch', 'English', 'Finnish', 'Georgian',
  'Hungarian', 'Icelandic', 'Neapolitan', 'Nordic', 'Norwegian', 'Romanian',
  'Scandinavian', 'Scottish', 'Sicilian', 'Swedish', 'Swiss', 'Tuscan', 'Ukrainian',
  // Middle East, North Africa, Central Asia
  'Afghan', 'Armenian', 'Egyptian', 'Iraqi', 'Israeli', 'Jordanian', 'Levantine',
  'Palestinian', 'Persian', 'Syrian', 'Tunisian', 'Uzbek', 'Yemeni',
  // Africa
  'Eritrean', 'Ghanaian', 'Kenyan', 'Nigerian', 'Senegalese', 'Somali', 'South African',
  // South & Southeast Asia
  'Bangladeshi', 'Burmese', 'Cambodian', 'Cantonese', 'Goan', 'Hakka', 'Hunan',
  'Kerala', 'Laotian', 'Nepalese', 'Pakistani', 'Punjabi', 'Singaporean',
  'South Indian', 'Sri Lankan', 'Szechuan', 'Taiwanese', 'Tibetan', 'Uyghur',
  // East Asia formats
  'Bento', 'Donburi', 'Izakaya', 'Katsu', 'Korean BBQ', 'Okonomiyaki', 'Omakase',
  'Poke', 'Shabu Shabu', 'Soba', 'Teppanyaki', 'Tonkatsu', 'Udon', 'Yakitori',
  // The Americas
  'Argentinian', 'Bolivian', 'Cajun', 'Californian', 'Chilean', 'Colombian',
  'Creole', 'Dominican', 'Ecuadorian', 'Guatemalan', 'Haitian', 'Honduran',
  'Jamaican', 'New American', 'Nuevo Latino', 'Oaxacan', 'Pacific Northwest',
  'Puerto Rican', 'Salvadoran', 'Southwestern', 'Tex-Mex', 'Trinidadian',
  'Venezuelan', 'Yucatecan',
  // Formats, rooms and specialities
  'Bistro', 'Brasserie', 'Brewery', 'Bubble Tea', 'Charcuterie', 'Chocolatier',
  'Churrascaria', 'Cider House', 'Cocktail Bar', 'Crepes', 'Dumplings', 'Empanadas',
  'Falafel', 'Farm to Table', 'Fish & Chips', 'Fondue', 'Food Hall', 'Food Truck',
  'Gastropub', 'Gelato', 'Health Food', 'Izakaya Bar', 'Juice & Smoothies',
  'Meze', 'Oyster Bar', 'Pierogi', 'Pintxos', 'Poutine', 'Pretzels', 'Raw Bar',
  'Rotisserie', 'Shawarma', 'Small Plates', 'Smokehouse', 'Speakeasy',
  'Steak Frites', 'Street Food', 'Supper Club', 'Tasting Menu', 'Tea Room',
  'Waffles', 'Wine Bar',
  // Dietary
  'Gluten Free', 'Plant Based', 'Raw', 'Vegan', 'Vegetarian',
];

/**
 * Every label a person may suggest — the Google-mapped taxonomy plus the
 * wider world list above, deduplicated and alphabetical.
 */
export const SUGGESTABLE_CUISINES: string[] = (() => {
  const seen = new Map<string, string>();
  for (const c of CUISINE_TYPES) {
    if (c.type && c.label !== 'All') seen.set(c.label.toLowerCase(), c.label);
  }
  for (const label of EXTRA_CUISINES) {
    if (!seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
})();

/* ── Inference from the restaurant's name ──────────────────────────────
   The rural long tail is exactly where Google's structured data is
   thinnest and where names are most explicit: a "Taqueria", a "Trattoria",
   a "Sushi House" tell you what they are. This is a guess and is ranked
   below every human source in the shared cache (migration 068) — it is
   shown, never persisted into someone's own rating.

   Two rules keep it accurate rather than merely productive:
     • whole words only, so "Barbounia" is not barbecue and "Phoenix" is
       not pho;
     • no weak tokens. "Grill", "Kitchen", "House", "Bar" and "Restaurant"
       appear in the names of every cuisine on earth and are left out. */
const NAME_HINTS: Array<[RegExp, string]> = [
  // Cuisine-specific venue words — the strongest signal a name can carry.
  [/\b(taqueria|taquer[ií]a|cantina|burrito|burritos)\b/i, 'Mexican'],
  [/\b(taco|tacos)\b/i, 'Taco'],
  [/\b(trattoria|osteria|ristorante|enoteca)\b/i, 'Italian'],
  [/\b(pizzeria|pizza)\b/i, 'Pizza'],
  [/\b(sushi|izakaya|omakase|yakitori)\b/i, 'Sushi'],
  [/\bramen\b/i, 'Ramen'],
  [/\b(pho|banh\s?mi)\b/i, 'Vietnamese'],
  [/\b(brasserie|bistro|bistrot|creperie|cr[êe]perie|boulangerie)\b/i, 'French'],
  [/\b(patisserie|p[âa]tisserie|bakery|bakehouse|panaderia|panader[ií]a)\b/i, 'Bakery'],
  [/\b(taverna|souvlaki|gyro|gyros)\b/i, 'Greek'],
  [/\b(tandoori|masala|curry|biryani|dhaba)\b/i, 'Indian'],
  [/\b(bbq|barbecue|barbeque|smokehouse|pit\s?bbq)\b/i, 'BBQ'],
  [/\b(steakhouse|chophouse)\b/i, 'Steakhouse'],
  [/\b(cantonese|dim\s?sum|wok|szechuan|sichuan|hunan)\b/i, 'Chinese'],
  [/\b(kebab|kebob|shawarma|doner|d[öo]ner)\b/i, 'Kebab'],
  [/\b(trattoria|paella|tapas)\b/i, 'Tapas'],
  [/\b(pierogi|pierogies)\b/i, 'Polish'],
  [/\b(oyster|oysters|lobster|clam\s?shack|fish\s?house|crab\s?house|seafood)\b/i, 'Seafood'],
  [/\b(creamery|gelato|gelateria|ice\s?cream)\b/i, 'Ice Cream'],
  [/\b(espresso|roasters|roasting|coffee|caff[èe]|coffeehouse)\b/i, 'Coffee Shop'],
  [/\b(delicatessen|deli)\b/i, 'Deli'],
  [/\b(diner|luncheonette)\b/i, 'Diner'],
  [/\b(alehouse|brewhouse|brewpub|tavern|publick\s?house)\b/i, 'Pub'],
  [/\b(noodle|noodles)\b/i, 'Noodle'],
  [/\b(cafe|caf[ée])\b/i, 'Cafe'],
  // Nationality words in a name are near-unambiguous, and are checked last
  // so a more specific venue word above wins ("Thai Noodle" → Noodle).
  [/\bmexican\b/i, 'Mexican'],
  [/\bitalian\b/i, 'Italian'],
  [/\bchinese\b/i, 'Chinese'],
  [/\bjapanese\b/i, 'Japanese'],
  [/\bkorean\b/i, 'Korean'],
  [/\bthai\b/i, 'Thai'],
  [/\bvietnamese\b/i, 'Vietnamese'],
  [/\bindian\b/i, 'Indian'],
  [/\bgreek\b/i, 'Greek'],
  [/\bfrench\b/i, 'French'],
  [/\bspanish\b/i, 'Spanish'],
  [/\bturkish\b/i, 'Turkish'],
  [/\blebanese\b/i, 'Lebanese'],
  [/\bethiopian\b/i, 'Ethiopian'],
  [/\bperuvian\b/i, 'Peruvian'],
  [/\bcuban\b/i, 'Cuban'],
  [/\bbrazilian\b/i, 'Brazilian'],
  [/\bgerman\b/i, 'German'],
  [/\birish\b/i, 'Irish'],
  [/\bpolish\b/i, 'Polish'],
  [/\bcaribbean\b/i, 'Caribbean'],
  [/\bmediterranean\b/i, 'Mediterranean'],
  [/\bbarbecue\b/i, 'BBQ'],
];

/**
 * Guess a cuisine from the restaurant's name, or '' when the name says
 * nothing. Always a guess — rank it below every human source, and don't
 * write it into a user's own rating.
 */
export function cuisineFromName(name: string | undefined): string {
  const n = (name || '').trim();
  if (!n) return '';
  for (const [pattern, label] of NAME_HINTS) {
    if (pattern.test(n)) return label;
  }
  return '';
}

/** Convenience for the many call sites that only hold a `types` array. */
export function cuisineFromTypes(types: string[] | undefined): string {
  return cuisineLabel({ types });
}
