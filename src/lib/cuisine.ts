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
import { CUISINE_TYPES, VENUE_TYPES } from './places';

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
 * Types that are not a cuisine, in two flavours.
 *
 * The first group says "this is a place that serves food" and nothing
 * more — answering 'Restaurant' for those is the bug this module exists
 * to fix. Note `bar`, `cafe`, `bakery`, `pub`, `diner` and `deli` are
 * deliberately absent: those are real answers.
 *
 * The second group is the property a restaurant sits INSIDE. Measuring the
 * real gap turned up a Relais & Châteaux place whose only Google label was
 * "Inn" — so the app would have shown Inn as its cuisine, and grouped a
 * profile top list under it. Hotel, resort and casino restaurants are
 * exactly the places Google describes worst, so this is the failure mode
 * to expect, not an oddity.
 *
 * VENUE_TYPES is folded in wholesale rather than restated, because the two
 * lists answer the same question and a copy would drift. It is what stops
 * a cinema's display name — "Movie theater" — being printed as a cuisine.
 */
const GENERIC = new Set([
  // Serves food, unspecified.
  'restaurant', 'food', 'point_of_interest', 'establishment', 'store',
  'meal_takeaway', 'meal_delivery', 'food_store', 'grocery_store',
  // The venue around the restaurant.
  'inn', 'hotel', 'motel', 'resort', 'resort_hotel', 'lodge', 'lodging',
  'bed_and_breakfast', 'guest_house', 'hostel', 'cottage', 'farmstay',
  'country_club',
  ...VENUE_TYPES,
]);

/**
 * "Colombian Restaurant" is a cuisine wearing a suffix. Dropping it is
 * what turns Google's label into the word that belongs on a card.
 * Deliberately applied only AFTER the taxonomy lookups, so "Barbecue
 * restaurant" still resolves to BBQ rather than the bare word "Barbecue".
 */
function stripVenueSuffix(name: string): string {
  return name.replace(/\s+(restaurant|cuisine|food|place|shop)$/i, '').trim();
}

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

    // Nothing in the taxonomy matched the whole label. Try again without
    // the suffix, which is where the cuisine usually is.
    const stripped = stripVenueSuffix(display);
    if (stripped && stripped.toLowerCase() !== display.toLowerCase()) {
      if (GENERIC.has(typeFromDisplayName(stripped))) return null;
      const viaStripped = TYPE_TO_LABEL[typeFromDisplayName(stripped)] ?? LABEL_TO_LABEL[stripped.toLowerCase()];
      if (viaStripped) return { label: viaStripped, canonical: true, source: 'displayName' };
      return { label: stripped, canonical: false, source: 'displayName' };
    }
    // Not in our taxonomy, but still a real answer for a human to read.
    return { label: display, canonical: false, source: 'displayName' };
  }

  return null;
}

/**
 * Is this stored cuisine actually an answer?
 *
 * For years the resolver ended in an unconditional `return 'Restaurant'`,
 * so every place it couldn't describe got that word written into the
 * user's own rating. It is indistinguishable from a place that genuinely
 * is just a restaurant, which is why the resolver now returns '' instead —
 * but the rows saved back then still carry the string, and anything that
 * asks "does this rating have a cuisine?" will say yes about all of them.
 *
 * That is not a display concern. It is the gate on every repair path in
 * the app: a backfill that only fills blanks will never look at a rating
 * that says "Restaurant", so those are exactly the rows that can never be
 * fixed. Ask this instead of checking for emptiness.
 */
export function isUnknownCuisine(cuisine: string | null | undefined): boolean {
  const trimmed = (cuisine || '').trim().toLowerCase();
  return trimmed === '' || NON_ANSWERS.has(trimmed);
}

/** The Places type strings the old resolvers leaked into saved data.
 *  FollowingFeed had been stripping these on its own surface for a while;
 *  this is that list, promoted to the one place everything can share. */
const NON_ANSWERS: ReadonlySet<string> = new Set([
  'restaurant', 'restaurants', 'food', 'establishment', 'point of interest',
  'point_of_interest', 'store', 'meal takeaway', 'meal delivery',
]);

/** A cuisine fit to print, or '' — the display counterpart of
 *  isUnknownCuisine, for the many meta lines built with .filter(Boolean). */
export function displayCuisine(cuisine: string | null | undefined): string {
  return isUnknownCuisine(cuisine) ? '' : (cuisine || '').trim();
}

/**
 * Several cuisines on one line.
 *
 * Comma-separated, NOT the ' · ' every meta line uses to separate its
 * fields — otherwise "Italian · Pizza · $$" reads as three fields and a
 * reader cannot tell where the cuisines stop and the price starts.
 * "Italian, Pizza · $$" is unambiguous.
 *
 * Non-answers are dropped and duplicates collapsed, so a caller can hand
 * over whatever it has without pre-cleaning.
 */
export function formatCuisines(cuisines: Array<string | null | undefined>): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of cuisines) {
    const c = displayCuisine(raw);
    if (!c || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    out.push(c);
  }
  return out.join(', ');
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
  // ── How a kitchen cooks, not where it is from ──────────────────────
  // The biggest gap by far, and the app's own Michelin data proves it:
  // "Modern" labels 4,229 restaurants in that set, "Contemporary" 1,690,
  // "Creative" 1,426 — the app SHOWED these and nobody could suggest one.
  'Classic', 'Comfort Food', 'Contemporary', 'Country Cooking', 'Creative',
  'Fusion', 'Home Cooking', 'Innovative', 'Modern', 'Organic', 'Seasonal',
  'Traditional', 'Upscale Casual',
  // Style crossed with a place — how the guides actually name a kitchen
  // that cooks one tradition in a modern register.
  'American Contemporary', 'Asian Contemporary', 'British Contemporary',
  'Chinese Contemporary', 'Classic French', 'Creative French',
  'European Contemporary', 'French Contemporary', 'Italian Contemporary',
  'Japanese Contemporary', 'Korean Contemporary', 'Modern British',
  'Modern Chinese', 'Modern French', 'Modern Indian', 'Modern Italian',
  'Modern Japanese', 'Modern Mexican', 'Spanish Contemporary',
  'Thai Contemporary', 'Traditional British', 'Vietnamese Contemporary',
  // ── Europe ─────────────────────────────────────────────────────────
  'Albanian', 'Alpine', 'Austrian', 'Balkan', 'Basque', 'Belarusian',
  'Belgian', 'Bosnian', 'British', 'Bulgarian', 'Catalan', 'Croatian',
  'Cypriot', 'Czech', 'Danish', 'Dutch', 'English', 'Estonian', 'European',
  'Finnish', 'Georgian', 'German', 'Hungarian', 'Icelandic', 'Irish',
  'Latvian', 'Lithuanian', 'Maltese', 'Moldovan', 'Nordic', 'Norwegian',
  'Polish', 'Portuguese', 'Romanian', 'Russian', 'Scandinavian', 'Scottish',
  'Serbian', 'Slovak', 'Slovenian', 'Swedish', 'Swiss', 'Ukrainian', 'Welsh',
  // Regional Italy — a Roman trattoria and a Sicilian one are not the
  // same restaurant, and the guides have always said so.
  'Abruzzese', 'Apulian', 'Calabrian', 'Campanian', 'Emilian', 'Ligurian',
  'Lombard', 'Neapolitan', 'Piedmontese', 'Roman', 'Sardinian', 'Sicilian',
  'Tuscan', 'Umbrian', 'Venetian',
  // Regional France, Spain, Portugal
  'Alsatian', 'Andalusian', 'Breton', 'Galician', 'Lyonnaise', 'Norman',
  'Provençal', 'Savoyard', 'Valencian',
  // ── Middle East, North Africa, Central Asia ────────────────────────
  'Afghan', 'Algerian', 'Armenian', 'Azerbaijani', 'Egyptian', 'Emirati',
  'Iraqi', 'Israeli', 'Jordanian', 'Kazakh', 'Kurdish', 'Kuwaiti',
  'Lebanese', 'Levantine', 'Libyan', 'Moroccan', 'Palestinian', 'Persian',
  'Saudi', 'Syrian', 'Tunisian', 'Turkish', 'Uzbek', 'Yemeni',
  // ── Africa ─────────────────────────────────────────────────────────
  'African', 'Cameroonian', 'Congolese', 'Eritrean', 'Ethiopian', 'Ghanaian',
  'Ivorian', 'Kenyan', 'Malagasy', 'Nigerian', 'Senegalese', 'Somali',
  'South African', 'Sudanese', 'Tanzanian', 'Ugandan', 'West African',
  'Zimbabwean',
  // ── South & Southeast Asia ─────────────────────────────────────────
  'Balinese', 'Bangladeshi', 'Bengali', 'Burmese', 'Cambodian', 'Chettinad',
  'Filipino', 'Goan', 'Gujarati', 'Hyderabadi', 'Indonesian', 'Isan',
  'Kerala', 'Laotian', 'Malaysian', 'Mughlai', 'Nepalese', 'North Indian',
  'Northern Thai', 'Nyonya', 'Pakistani', 'Peranakan', 'Punjabi',
  'Rajasthani', 'Singaporean', 'South East Asian', 'South Indian',
  'Southern Thai', 'Sri Lankan', 'Thai-Chinese',
  // ── East Asia ──────────────────────────────────────────────────────
  'Beijing', 'Cantonese', 'Chaozhou', 'Dongbei', 'Fujian', 'Hakka',
  'Huaiyang', 'Hunanese', 'Mongolian', 'Shanghainese', 'Shandong',
  'Sichuan', 'Taiwanese', 'Tibetan', 'Uyghur', 'Xinjiang', 'Yunnan',
  'Zhejiang',
  // East Asian rooms and formats
  'Bento', 'Bibimbap', 'Congee', 'Donburi', 'Hot Pot', 'Izakaya', 'Kaiseki',
  'Katsu', 'Korean BBQ', 'Korean Fried Chicken', 'Kushiage', 'Naengmyeon',
  'Okonomiyaki', 'Omakase', 'Onigiri', 'Poke', 'Robatayaki', 'Sashimi',
  'Shabu Shabu', 'Soba', 'Sukiyaki', 'Tempura', 'Teppanyaki', 'Tonkatsu',
  'Udon', 'Unagi', 'Yakiniku', 'Yakitori',
  // ── The Americas ───────────────────────────────────────────────────
  'Appalachian', 'Argentinian', 'Bolivian', 'Brazilian', 'Californian',
  'Central American', 'Chilean', 'Colombian', 'Costa Rican', 'Cuban',
  'Dominican', 'Ecuadorian', 'Guatemalan', 'Haitian', 'Honduran',
  'Italian-American', 'Jamaican', 'Lowcountry', 'Mid-Atlantic', 'Midwestern',
  'New American', 'New England', 'New Mexican', 'Nicaraguan', 'North American',
  'Nuevo Latino', 'Oaxacan', 'Pacific Northwest', 'Panamanian', 'Paraguayan',
  'Puerto Rican', 'Salvadoran', 'South American', 'Southwestern',
  'Tex-Mex', 'Trinidadian', 'Uruguayan', 'Venezuelan', 'Yucatecan',
  // ── Dishes and specialities ────────────────────────────────────────
  'Arepas', 'Bagels', 'Banh Mi', 'Bao', 'Biryani', 'Burritos', 'Ceviche',
  'Cheesesteak', 'Chicken Wings', 'Crepes', 'Curry', 'Dumplings',
  'Empanadas', 'Falafel', 'Fish & Chips', 'Fried Chicken', 'Gelato',
  'Grain Bowls', 'Grills', 'Hot Dogs', 'Hummus', 'Kebab', 'Pasta',
  'Pierogi', 'Pintxos', 'Poutine', 'Pretzels', 'Pupusas', 'Rice Dishes',
  'Risotto', 'Rotisserie', 'Shakshuka', 'Shawarma', 'Smash Burgers',
  'Souvlaki', 'Steak Frites', 'Tagine', 'Tamales', 'Waffles',
  // ── Rooms, formats and the way a meal is served ────────────────────
  'Bakery', 'Beer Garden', 'Bistro', 'Brasserie', 'Brewery', 'Bubble Tea',
  'Charcuterie', 'Cheese', 'Chocolatier', 'Churrascaria', 'Cider House',
  'Cocktail Bar', 'Creamery', 'Deli', 'Dessert', 'Farm to Table',
  'Fine Dining', 'Fondue', 'Food Hall', 'Food Truck', 'Gastropub',
  'Health Food', 'Juice & Smoothies', 'Meze', 'Natural Wine', 'Oyster Bar',
  'Patisserie', 'Raclette', 'Raw Bar', 'Sharing Plates', 'Small Plates',
  'Smokehouse', 'Speakeasy', 'Steakhouse', 'Street Food', 'Supper Club',
  'Tapas', 'Tasting Menu', 'Tea Room', 'Wine Bar',
  // ── Dietary and sourcing ───────────────────────────────────────────
  'Gluten Free', 'Halal', 'Kosher', 'Plant Based', 'Raw', 'Sustainable',
  'Vegan', 'Vegetarian',
];

/**
 * Alternate spellings, so searching finds the label the app actually
 * stores instead of nothing.
 *
 * The picker matches on the label text, which quietly made whole cuisines
 * unreachable: the taxonomy calls it "BBQ", so a person typing the word
 * "barbecue" — the word on the restaurant's own sign — got an empty list
 * and concluded the app didn't have it.
 *
 * Aliases rather than extra labels, deliberately. Shipping both "BBQ" and
 * "Barbecue" would split five people who agree into two groups of two or
 * three, and consensus (migration 069) would never fire for either.
 * One canonical label, many ways to reach it.
 */
const CUISINE_ALIASES: Record<string, string> = {
  barbecue: 'BBQ', barbeque: 'BBQ', 'bar-b-q': 'BBQ', 'bar b q': 'BBQ',
  'bbq joint': 'BBQ', brisket: 'BBQ',
  'contemporary american': 'American Contemporary',
  'modern american': 'American Contemporary',
  'new nordic': 'Nordic', 'szechuan': 'Sichuan', 'szechwan': 'Sichuan',
  'schezwan': 'Sichuan', 'hunan': 'Hunanese', 'chiu chow': 'Chaozhou',
  'chao zhou': 'Chaozhou', 'peking': 'Beijing', 'shanghai': 'Shanghainese',
  boba: 'Bubble Tea', 'milk tea': 'Bubble Tea',
  hamburger: 'Burgers', hamburgers: 'Burgers', 'burger joint': 'Burgers',
  'hot pot': 'Hot Pot', hotpot: 'Hot Pot', 'shabu': 'Shabu Shabu',
  'kbbq': 'Korean BBQ', 'k-bbq': 'Korean BBQ', 'kfc': 'Korean Fried Chicken',
  'fish and chips': 'Fish & Chips', 'fish n chips': 'Fish & Chips',
  'ice creamery': 'Ice Cream', 'frozen yogurt': 'Ice Cream',
  'juice bar': 'Juice & Smoothies', smoothies: 'Juice & Smoothies',
  smoothie: 'Juice & Smoothies', acai: 'Juice & Smoothies',
  'sandwich shop': 'Sandwich', sandwiches: 'Sandwich', subs: 'Sandwich',
  hoagie: 'Sandwich', 'banh mi': 'Banh Mi',
  'coffee house': 'Coffee Shop', coffeehouse: 'Coffee Shop',
  espresso: 'Coffee Shop', 'roastery': 'Coffee Shop',
  'pub food': 'Pub', tavern: 'Pub', alehouse: 'Pub', brewpub: 'Brewery',
  taqueria: 'Mexican', cantina: 'Mexican', trattoria: 'Italian',
  osteria: 'Italian', ristorante: 'Italian', pizzeria: 'Pizza',
  'sushi bar': 'Sushi', omakase: 'Omakase', izakaya: 'Izakaya',
  'noodle bar': 'Noodle', noodles: 'Noodle', ramen: 'Ramen',
  'dim sum': 'Dim Sum', 'yum cha': 'Dim Sum',
  'soul': 'Soul Food', 'southern comfort': 'Southern',
  'farm-to-table': 'Farm to Table', 'farm to fork': 'Farm to Table',
  'plant-based': 'Plant Based', 'gluten-free': 'Gluten Free',
  'tex mex': 'Tex-Mex', 'texmex': 'Tex-Mex',
  'new-american': 'New American', 'californian cuisine': 'Californian',
  'chop house': 'Steakhouse', chophouse: 'Steakhouse', steak: 'Steakhouse',
  'raw fish': 'Sashimi', 'poke bowl': 'Poke', 'rice bowl': 'Grain Bowls',
  'mediterranean cuisine': 'Mediterranean', 'middle east': 'Middle Eastern',
  'latin': 'Latin American', 'latino': 'Latin American',
  'creative cuisine': 'Creative', 'modern cuisine': 'Modern',
  'traditional cuisine': 'Traditional', 'seasonal cuisine': 'Seasonal',
  'classic cuisine': 'Classic', 'country cooking': 'Country Cooking',
};

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

/**
 * The picker's search, here rather than in the component so the matching
 * rules are testable and the aliases above are actually reachable.
 *
 * Ranked, because ranking is the difference between a list of 400 and a
 * usable one:
 *   1. the label starts with what you typed — "ch" must reach Chinese
 *      before French, which merely contains those letters
 *   2. a word inside the label starts with it — "amer" reaches
 *      "Contemporary American"
 *   3. an alias matches, so "barbecue" reaches BBQ
 *   4. the label contains it anywhere
 * Empty query returns everything, alphabetical, as before.
 */
export function searchCuisines(query: string, labels: string[] = SUGGESTABLE_CUISINES): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return labels;

  // Which labels an alias points at, for tier 3.
  const viaAlias = new Set<string>();
  for (const [alias, target] of Object.entries(CUISINE_ALIASES)) {
    if (alias.startsWith(q) || alias.includes(q)) viaAlias.add(target.toLowerCase());
  }

  const rank = (label: string): number => {
    const l = label.toLowerCase();
    if (l.startsWith(q)) return 0;
    if (l.split(/[\s&/-]+/).some((w) => w.startsWith(q))) return 1;
    if (viaAlias.has(l)) return 2;
    if (l.includes(q)) return 3;
    return -1;
  };

  return labels
    .map((label) => ({ label, r: rank(label) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.label.localeCompare(b.label))
    .map((x) => x.label);
}

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
