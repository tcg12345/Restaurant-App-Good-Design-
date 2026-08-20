/**
 * Reading a cuisine out of OpenStreetMap.
 *
 * Google describes rural places and hotel/resort restaurants worst — the
 * exact places OSM mappers describe by hand, with a `cuisine=*` tag that
 * exists for no other purpose. This module is the pure half of that
 * lookup: build the query, match Overpass elements to our places, and turn
 * an OSM tag into a label the app shows.
 *
 * Deliberately free of Deno and browser APIs so the app's test suite can
 * import it directly (src/lib/osm-cuisine.test.ts). The only thing not
 * covered by those tests is the fetch itself, which lives in the handler.
 *
 * Data © OpenStreetMap contributors, ODbL. See CUISINE_ATTRIBUTION.
 */

export const CUISINE_ATTRIBUTION = 'Cuisine data © OpenStreetMap contributors (ODbL)';

/** What we ask Overpass about. Anything that serves food to a customer. */
const AMENITIES = ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'ice_cream', 'biergarten', 'food_court'];

export interface OsmPlace {
  restaurantId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface OsmElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/* ── Query ─────────────────────────────────────────────────────────── */

/** Metres around each place to look. Tight on purpose: a wider net finds
 *  the neighbouring restaurant, and a confidently wrong cuisine is worse
 *  than none. */
export const SEARCH_RADIUS_M = 120;

/**
 * One Overpass query covering every place in the batch.
 *
 * One `around:` clause per place rather than a single bounding box: a box
 * spanning a whole city of search results would return thousands of
 * elements, most of them irrelevant, and Overpass asks callers not to do
 * that. A union of small circles is the same number of round trips and a
 * fraction of the payload.
 */
export function buildOverpassQuery(places: OsmPlace[], radiusM = SEARCH_RADIUS_M): string {
  const filter = `[amenity~"^(${AMENITIES.join('|')})$"]`;
  const clauses = places
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => `nwr${filter}(around:${radiusM},${p.lat.toFixed(6)},${p.lng.toFixed(6)});`)
    .join('\n  ');
  return `[out:json][timeout:25];\n(\n  ${clauses}\n);\nout tags center;`;
}

/* ── Matching ──────────────────────────────────────────────────────── */

/** Words that appear in a restaurant's name without identifying it. */
const NOISE = new Set([
  'the', 'a', 'an', 'and', 'at', 'of', 'by', 'on', 'in',
  'restaurant', 'restaurante', 'ristorante', 'cafe', 'café', 'bar', 'grill',
  'kitchen', 'house', 'room', 'co', 'inc', 'llc', 'ltd',
]);

/** Lowercase, unaccented, punctuation-free, noise-word-free. */
export function normalizeName(name: string): string {
  return (name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Apostrophes are DELETED, not split on. Google and OSM disagree about
    // them constantly — "Joe's Pizza" against "Joes Pizza" — and splitting
    // leaves a stray "s" that makes the two names look different.
    .replace(/['\u2018\u2019\u02bc`\u00b4]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !NOISE.has(w))
    .join(' ')
    .trim();
}

/** Metres between two coordinates. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/**
 * Does this OSM element name the same restaurant?
 *
 * Conservative on purpose. A wrong cuisine shown confidently is worse than
 * no cuisine, and these are dense areas where the place next door is a
 * different restaurant. Accepts an exact normalized match, or containment
 * where the shorter side is substantial enough not to be a coincidence.
 */
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  // "Kro" inside "Falsled Kro" is a coincidence waiting to happen; six
  // characters and a word boundary is the smallest that isn't.
  if (short.length < 6) return false;
  return long.includes(short);
}

export interface OsmMatch {
  /** The raw OSM tag, e.g. "italian;pizza". */
  rawCuisine: string;
  /** Our label, or '' when the tag maps to nothing we'd show. */
  label: string;
  /** True when the label is in the app's taxonomy. */
  canonical: boolean;
  distanceM: number;
  osmName: string;
}

/**
 * How far an element may sit from the place and still be it.
 *
 * The query asks for elements within SEARCH_RADIUS_M, but `around:` measures
 * to the nearest point of a way while `out center` reports its centroid, so
 * a large building legitimately comes back a little outside the circle.
 * Double the radius covers that.
 *
 * This cap is not belt-and-braces — it is load-bearing. One query covers the
 * whole batch, so `elements` is the union of every circle: without it, a
 * "Joe's Pizza" that OSM doesn't know would happily match the Joe's Pizza
 * eight kilometres away that it does.
 */
export const MAX_MATCH_DISTANCE_M = SEARCH_RADIUS_M * 2;

/**
 * The best element for one place: nearest name match that actually carries
 * a cuisine tag. An element with no cuisine tells us nothing, so it never
 * wins over one that does — matching the building is not the goal.
 *
 * An element we cannot locate is rejected outright rather than accepted at
 * unknown distance: unverifiable is not the same as close.
 */
export function matchPlace(
  place: OsmPlace,
  elements: OsmElement[],
  maxDistanceM = MAX_MATCH_DISTANCE_M,
): OsmMatch | null {
  let best: OsmMatch | null = null;
  for (const el of elements) {
    const tags = el.tags || {};
    const rawCuisine = (tags.cuisine || '').trim();
    if (!rawCuisine) continue;
    const osmName = tags.name || '';
    if (!namesMatch(place.name, osmName)) continue;

    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const d = distanceM(place.lat, place.lng, lat as number, lon as number);
    if (d > maxDistanceM) continue;

    const mapped = cuisineFromOsmTag(rawCuisine);
    if (!mapped.label) continue;
    if (!best || d < best.distanceM) {
      best = { rawCuisine, label: mapped.label, canonical: mapped.canonical, distanceM: d, osmName };
    }
  }
  return best;
}

/* ── Tag → label ───────────────────────────────────────────────────── */

/**
 * OSM `cuisine` values → the app's labels.
 *
 * Values are lowercase and underscore-separated, and a place can carry
 * several separated by semicolons ("pizza;italian"). Where a value has no
 * label of ours it is title-cased and marked non-canonical, same as an
 * unmapped Google display name.
 */
const TAG_TO_LABEL: Record<string, string> = {
  // Regional
  american: 'American', italian: 'Italian', chinese: 'Chinese', japanese: 'Japanese',
  mexican: 'Mexican', indian: 'Indian', thai: 'Thai', french: 'French', greek: 'Greek',
  spanish: 'Spanish', turkish: 'Turkish', vietnamese: 'Vietnamese', korean: 'Korean',
  german: 'German', lebanese: 'Lebanese', ethiopian: 'Ethiopian', peruvian: 'Peruvian',
  brazilian: 'Brazilian', portuguese: 'Portuguese', russian: 'Russian', polish: 'Polish',
  moroccan: 'Moroccan', caribbean: 'Caribbean', cuban: 'Cuban', filipino: 'Filipino',
  indonesian: 'Indonesian', malaysian: 'Malaysian', pakistani: 'Pakistani',
  bangladeshi: 'Bangladeshi', nepalese: 'Nepalese', nepali: 'Nepalese', afghan: 'Afghan',
  persian: 'Persian', iranian: 'Persian', syrian: 'Syrian', georgian: 'Georgian',
  mediterranean: 'Mediterranean', asian: 'Asian', latin_american: 'Latin American',
  middle_eastern: 'Middle Eastern', african: 'African', irish: 'Irish', british: 'British',
  argentinian: 'Argentinian', argentine: 'Argentinian', colombian: 'Colombian',
  venezuelan: 'Venezuelan', salvadoran: 'Salvadoran', jamaican: 'Jamaican',
  ukrainian: 'Ukrainian', hungarian: 'Hungarian', czech: 'Czech', austrian: 'Austrian',
  swiss: 'Swiss', belgian: 'Belgian', dutch: 'Dutch', danish: 'Danish', swedish: 'Swedish',
  norwegian: 'Norwegian', finnish: 'Finnish', basque: 'Basque', catalan: 'Catalan',
  sicilian: 'Sicilian', tuscan: 'Tuscan', cantonese: 'Cantonese', sichuan: 'Sichuan',
  // Both spellings land on the one the suggestion list offers. A writer
  // that stores "Szechuan" while the picker only offers "Sichuan" splits
  // one cuisine across two labels, and consensus never fires for either.
  szechuan: 'Sichuan', hunan: 'Hunanese', taiwanese: 'Taiwanese', tibetan: 'Tibetan',
  burmese: 'Burmese', cambodian: 'Cambodian', laotian: 'Laotian', singaporean: 'Singaporean',
  sri_lankan: 'Sri Lankan', israeli: 'Israeli', egyptian: 'Egyptian', nigerian: 'Nigerian',
  senegalese: 'Senegalese', somali: 'Somali', tunisian: 'Tunisian', uzbek: 'Uzbek',
  armenian: 'Armenian', romanian: 'Romanian', croatian: 'Croatian', bulgarian: 'Bulgarian',
  // Dish and format
  pizza: 'Pizza', burger: 'Burgers', hamburger: 'Burgers', sandwich: 'Sandwich',
  sushi: 'Sushi', ramen: 'Ramen', noodle: 'Noodle', noodles: 'Noodle', pasta: 'Italian',
  kebab: 'Kebab', barbecue: 'BBQ', bbq: 'BBQ', steak_house: 'Steakhouse',
  steak: 'Steakhouse', seafood: 'Seafood', fish: 'Seafood', crab: 'Seafood',
  fish_and_chips: 'Fish & Chips', chicken: 'Fried Chicken', fried_chicken: 'Fried Chicken',
  wings: 'Fried Chicken', breakfast: 'Breakfast', brunch: 'Brunch', bagel: 'Bagel Shop',
  donut: 'Donuts', ice_cream: 'Ice Cream', gelato: 'Gelato', frozen_yogurt: 'Ice Cream',
  coffee_shop: 'Coffee Shop', coffee: 'Coffee Shop', tea: 'Tea House',
  bubble_tea: 'Bubble Tea', juice: 'Juice Bar', smoothie: 'Juice Bar',
  crepe: 'Crepes', waffle: 'Waffles', pancake: 'Breakfast', curry: 'Indian',
  dumpling: 'Dumplings', dumplings: 'Dumplings', dim_sum: 'Dim Sum', hot_pot: 'Hot Pot',
  tapas: 'Tapas', salad: 'Salad', soup: 'Soup', tacos: 'Taco', taco: 'Taco',
  burrito: 'Mexican', empanada: 'Empanadas', falafel: 'Falafel', shawarma: 'Shawarma',
  gyro: 'Greek', poke: 'Poke', vegan: 'Vegan', vegetarian: 'Vegetarian',
  dessert: 'Dessert', cake: 'Bakery', bakery: 'Bakery', pastry: 'Bakery',
  chocolate: 'Chocolatier', pie: 'Bakery', deli: 'Deli', diner: 'Diner',
  fine_dining: 'Fine Dining', buffet: 'Buffet', food_court: 'Food Court',
  'tex-mex': 'Tex-Mex', tex_mex: 'Tex-Mex', cajun: 'Cajun', creole: 'Creole',
  southern: 'Southern', soul_food: 'Soul Food', hawaiian: 'Hawaiian',
  wine: 'Wine Bar', wine_bar: 'Wine Bar', beer: 'Pub', pub_food: 'Pub',
  gastropub: 'Gastropub', tapas_bar: 'Tapas', oyster: 'Oyster Bar',
};

/**
 * Tags that describe HOW a place serves rather than WHAT, or say nothing.
 * Same principle as the venue types in lib/cuisine: showing one as the
 * cuisine is worse than showing none.
 */
const UNINFORMATIVE = new Set([
  'regional', 'local', 'international', 'variable', 'various', 'fusion',
  'yes', 'no', 'other', 'restaurant', 'food', 'lunch', 'dinner',
  'takeaway', 'take_away', 'delivery', 'self_service', 'buffet_service',
  'friture', 'snack', 'street_food',
]);

/** Title-case an unmapped tag: "sri_lankan" → "Sri Lankan". */
function titleCase(tag: string): string {
  return tag.split(/[_\s]+/).filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * Turn an OSM `cuisine` tag into a label. Multi-value tags are read left
 * to right and the first informative value wins — mappers put the most
 * specific first ("pizza;italian").
 */
export function cuisineFromOsmTag(tag: string): { label: string; canonical: boolean } {
  const parts = (tag || '').split(';').map((t) => t.trim().toLowerCase()).filter(Boolean);
  // A mapped value beats an unmapped one wherever it appears, so take a
  // full pass for mapped values before falling back.
  for (const part of parts) {
    if (UNINFORMATIVE.has(part)) continue;
    const mapped = TAG_TO_LABEL[part];
    if (mapped) return { label: mapped, canonical: true };
  }
  for (const part of parts) {
    if (UNINFORMATIVE.has(part)) continue;
    // Only tags that read like a word, not a code or a stray number.
    if (!/^[a-z][a-z_ -]{2,}$/.test(part)) continue;
    return { label: titleCase(part), canonical: false };
  }
  return { label: '', canonical: false };
}
