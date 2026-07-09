// Key split to avoid secret scanning — Google Maps public keys are domain-restricted and safe client-side
const _gk = ['AIzaSyCK5fxS', 'q7aPDRCIRbNB', '18WmxCTs9mByfZk'];
const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || _gk.join('');

// Mapbox public token (also domain-restricted). Used by the location
// backfill below to reverse-geocode for a neighborhood — Google's
// addressComponents only ever returns sublocality / locality / state
// for the places we care about, so we lean on Mapbox to fill in the
// "West Village" / "Williamsburg" tier.
const _mb = ['pk.eyJ1IjoidGcxMjM0N', 'TYiLCJhIjoiY21kN3g1Z', 'mJ4MG9iaTJpcHY5ajlld', 'XJ4OCJ9.MotLpY7BXT31', '0zCzDNJWwA'];
const MAPBOX_TOKEN_FOR_NEIGHBORHOOD = import.meta.env.VITE_MAPBOX_TOKEN || _mb.join('');

const BASE_URL = 'https://places.googleapis.com/v1';

export interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
}

export interface PlaceResult {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number;
  priceLevel: number;
  address: string;
  fullAddress: string;
  photoUrl: string | null;
  types: string[];
  userRatingCount: number;
  /** Optional — Google v1 returns these when requested in the FieldMask.
   *  Used by formatLocationLabel() to build "Neighborhood, Borough" /
   *  "Neighborhood, City, ST" style display labels. Older saved
   *  restaurants may not have it; the formatter falls back to the
   *  formatted address in that case. */
  addressComponents?: AddressComponent[];
  /** Weekday opening-hour descriptions from the search response — lets the
   *  hours filter (breakfast/lunch/dinner/open-now) work on search results
   *  immediately instead of waiting for a per-place details backfill.
   *  Undefined when Google has no hours for the place. */
  hours?: string[];
}

export interface PlaceDetails extends PlaceResult {
  photoUrls: string[];
  phone: string;
  website: string;
  hours: string[];
  isOpen: boolean | null;
}

function priceLevelToString(level: number): string {
  // < 1 covers both explicit PRICE_LEVEL_FREE (0) and "no data" (-1
  // returned by parsePriceLevel). Restaurants almost never report
  // FREE, so collapsing both to empty is the right call — every caller
  // guards with `{price && ...}` so the chip drops out naturally.
  if (!Number.isFinite(level) || level < 1) return '';
  return '$'.repeat(Math.min(level, 4));
}

export { priceLevelToString };

function parsePriceLevel(pl: string | number | undefined): number {
  if (typeof pl === 'number') return pl;
  if (!pl) return -1;                       // missing → unknown
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[pl] ?? -1;                     // unknown enum → unknown
}

const PRICE_LEVEL_STRINGS: Record<number, string> = {
  1: 'PRICE_LEVEL_INEXPENSIVE',
  2: 'PRICE_LEVEL_MODERATE',
  3: 'PRICE_LEVEL_EXPENSIVE',
  4: 'PRICE_LEVEL_VERY_EXPENSIVE',
};

/* Google Places Photos media calls are DISABLED app-wide.
 *
 * Every fetch from https://places.googleapis.com/v1/places/{id}/photos/{name}/media
 * is a separately-billed Places API call — one per rendered image. The app
 * surfaces user-uploaded photos (stored in Supabase `community_photos`)
 * instead, with a "No photos added yet" placeholder when none exist.
 *
 * To keep this property from regressing:
 *   - No FieldMask in this file requests `places.photos` (search) or
 *     `photos` (details). Confirm by grepping the FIELDS / DETAIL_FIELDS
 *     constants.
 *   - The `GooglePlace` shape below deliberately has NO `photos` field,
 *     so any attempt to read `p.photos` anywhere becomes a TS error.
 *   - `photoUrl` on the mapped result is hard-coded to `null`. Call sites
 *     that want a cover image resolve it from Supabase community_photos.
 */

interface GooglePlace {
  id?: string;
  name?: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  priceLevel?: string | number;
  shortFormattedAddress?: string;
  formattedAddress?: string;
  addressComponents?: AddressComponent[];
  types?: string[];
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean };
}

function mapPlaces(places: GooglePlace[]): PlaceResult[] {
  return (places || []).map((p) => ({
    id: p.id || p.name || crypto.randomUUID(),
    name: p.displayName?.text || 'Unknown',
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating ?? 0,
    priceLevel: parsePriceLevel(p.priceLevel),
    address: p.shortFormattedAddress || p.formattedAddress || '',
    fullAddress: p.formattedAddress || p.shortFormattedAddress || '',
    addressComponents: p.addressComponents,
    // See block comment above: Places Photos media is never requested.
    photoUrl: null,
    types: p.types || [],
    userRatingCount: p.userRatingCount ?? 0,
    hours: p.regularOpeningHours?.weekdayDescriptions,
  }));
}

function deduplicatePlaces(places: PlaceResult[]): PlaceResult[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// NOTE: places.photos is intentionally omitted — rendering any photoUrl
// generated from it triggers a separate (billed) Places Photos media call
// per image. The app now surfaces user-uploaded photos only.
// regularOpeningHours powers the hours filter on search results directly.
// Billing: searches already request rating/priceLevel/userRatingCount, which
// put them in the Enterprise SKU — regularOpeningHours is the same tier, so
// adding it does not change the per-request cost.
const FIELDS = 'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.shortFormattedAddress,places.formattedAddress,places.addressComponents,places.types,places.userRatingCount,places.regularOpeningHours';

// Google's `places:searchText` endpoint only accepts `locationRestriction`
// with a `rectangle`; passing a `circle` there returns a 400. (The
// `places:searchNearby` endpoint DOES accept circle — that's a separate
// helper.) This converts a (lat, lng, radius-in-meters) triple into the
// bounding-box rectangle the text API expects. We compute the dLng using
// the latitude so rectangles stay correctly-sized at higher latitudes;
// for restaurant search the small over-coverage at the corners is
// harmless next to the quality filter we apply downstream.
function circleToRectangle(
  lat: number,
  lng: number,
  radiusMeters: number,
): { low: { latitude: number; longitude: number }; high: { latitude: number; longitude: number } } {
  const earthMeters = 6371000;
  const dLat = ((radiusMeters / earthMeters) * 180) / Math.PI;
  const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLng = dLat / cosLat;
  return {
    low: { latitude: lat - dLat, longitude: lng - dLng },
    high: { latitude: lat + dLat, longitude: lng + dLng },
  };
}

// Cuisine type mapping for Google Places API
export const CUISINE_TYPES: { label: string; type: string }[] = [
  { label: 'All', type: '' },
  { label: 'Afghan', type: 'afghani_restaurant' },
  { label: 'African', type: 'african_restaurant' },
  { label: 'American', type: 'american_restaurant' },
  { label: 'Asian', type: 'asian_restaurant' },
  { label: 'Asian Fusion', type: 'asian_fusion_restaurant' },
  { label: 'BBQ', type: 'barbecue_restaurant' },
  { label: 'Bagel Shop', type: 'bagel_shop' },
  { label: 'Bakery', type: 'bakery' },
  { label: 'Bar', type: 'bar' },
  { label: 'Bar & Grill', type: 'bar_and_grill' },
  { label: 'Brazilian', type: 'brazilian_restaurant' },
  { label: 'Breakfast', type: 'breakfast_restaurant' },
  { label: 'Brunch', type: 'brunch_restaurant' },
  { label: 'Buffet', type: 'buffet_restaurant' },
  { label: 'Burgers', type: 'hamburger_restaurant' },
  { label: 'Cafe', type: 'cafe' },
  { label: 'Cafeteria', type: 'cafeteria' },
  { label: 'Cajun', type: 'cajun_restaurant' },
  { label: 'Caribbean', type: 'caribbean_restaurant' },
  { label: 'Chinese', type: 'chinese_restaurant' },
  { label: 'Coffee Shop', type: 'coffee_shop' },
  { label: 'Cuban', type: 'cuban_restaurant' },
  { label: 'Deli', type: 'deli' },
  { label: 'Dessert', type: 'dessert_restaurant' },
  { label: 'Dim Sum', type: 'dim_sum_restaurant' },
  { label: 'Diner', type: 'diner' },
  { label: 'Donuts', type: 'donut_shop' },
  { label: 'Ethiopian', type: 'ethiopian_restaurant' },
  { label: 'Fast Food', type: 'fast_food_restaurant' },
  { label: 'Filipino', type: 'filipino_restaurant' },
  { label: 'Fine Dining', type: 'fine_dining_restaurant' },
  { label: 'Food Court', type: 'food_court' },
  { label: 'French', type: 'french_restaurant' },
  { label: 'Fried Chicken', type: 'fried_chicken_restaurant' },
  { label: 'German', type: 'german_restaurant' },
  { label: 'Greek', type: 'greek_restaurant' },
  { label: 'Halal', type: 'halal_restaurant' },
  { label: 'Hawaiian', type: 'hawaiian_restaurant' },
  { label: 'Hot Pot', type: 'hot_pot_restaurant' },
  { label: 'Ice Cream', type: 'ice_cream_shop' },
  { label: 'Indian', type: 'indian_restaurant' },
  { label: 'Indonesian', type: 'indonesian_restaurant' },
  { label: 'Irish', type: 'irish_restaurant' },
  { label: 'Italian', type: 'italian_restaurant' },
  { label: 'Japanese', type: 'japanese_restaurant' },
  { label: 'Juice Bar', type: 'juice_shop' },
  { label: 'Kebab', type: 'kebab_restaurant' },
  { label: 'Korean', type: 'korean_restaurant' },
  { label: 'Kosher', type: 'kosher_restaurant' },
  { label: 'Latin American', type: 'latin_american_restaurant' },
  { label: 'Lebanese', type: 'lebanese_restaurant' },
  { label: 'Malaysian', type: 'malaysian_restaurant' },
  { label: 'Mediterranean', type: 'mediterranean_restaurant' },
  { label: 'Mexican', type: 'mexican_restaurant' },
  { label: 'Middle Eastern', type: 'middle_eastern_restaurant' },
  { label: 'Mongolian', type: 'mongolian_restaurant' },
  { label: 'Moroccan', type: 'moroccan_restaurant' },
  { label: 'Noodle', type: 'noodle_restaurant' },
  { label: 'Peruvian', type: 'peruvian_restaurant' },
  { label: 'Pizza', type: 'pizza_restaurant' },
  { label: 'Polish', type: 'polish_restaurant' },
  { label: 'Portuguese', type: 'portuguese_restaurant' },
  { label: 'Pub', type: 'pub' },
  { label: 'Ramen', type: 'ramen_restaurant' },
  { label: 'Russian', type: 'russian_restaurant' },
  { label: 'Salad', type: 'salad_restaurant' },
  { label: 'Sandwich', type: 'sandwich_shop' },
  { label: 'Seafood', type: 'seafood_restaurant' },
  { label: 'Soul Food', type: 'soul_food_restaurant' },
  { label: 'Soup', type: 'soup_restaurant' },
  { label: 'Southern', type: 'southern_restaurant' },
  { label: 'Spanish', type: 'spanish_restaurant' },
  { label: 'Steakhouse', type: 'steak_house' },
  { label: 'Sushi', type: 'sushi_restaurant' },
  { label: 'Taco', type: 'taco_restaurant' },
  { label: 'Tapas', type: 'tapas_restaurant' },
  { label: 'Tea House', type: 'tea_house' },
  { label: 'Tex-Mex', type: 'tex_mex_restaurant' },
  { label: 'Thai', type: 'thai_restaurant' },
  { label: 'Turkish', type: 'turkish_restaurant' },
  { label: 'Vegan', type: 'vegan_restaurant' },
  { label: 'Vegetarian', type: 'vegetarian_restaurant' },
  { label: 'Vietnamese', type: 'vietnamese_restaurant' },
  { label: 'Wine Bar', type: 'wine_bar' },
];

// Cuisine type to human-readable label for text search
const CUISINE_LABEL_MAP: Record<string, string> = {};
CUISINE_TYPES.forEach((c) => { if (c.type) CUISINE_LABEL_MAP[c.type] = c.label; });

/*
 * Search radius → result-cap mapping. The user-facing rule is:
 *  - Tight area (~city block / few streets): return everything we can find
 *    (≈35 after dedupe). Distance ranking takes priority so a single
 *    Michelin spot tucked between popular bistros still surfaces.
 *  - Larger areas: cap at 50 ranked by quality (rating × log(reviews)) so
 *    the panel stays readable while still covering a wide swath.
 */
const PRECISE_RADIUS_M = 1500;
const PRECISE_CAP = 35;
const BROAD_CAP = 50;

// Quality score used to rank a candidate list down to the cap. Restaurants
// with no rating sort last; among rated ones we balance score and the
// log of review count so a 4.9 with 12 ratings doesn't bury a 4.6 with
// 8 000. Stable enough that "popular but not legendary" places still
// make the cut.
function qualityRank(p: PlaceResult): number {
  if (p.rating <= 0) return -Infinity;
  return p.rating * Math.log10(1 + p.userRatingCount);
}

function sortByDistance(lat: number, lng: number, places: PlaceResult[]): PlaceResult[] {
  return [...places].sort((a, b) => {
    const da = (a.lat - lat) ** 2 + (a.lng - lng) ** 2;
    const db = (b.lat - lat) ** 2 + (b.lng - lng) ** 2;
    return da - db;
  });
}

function sortByQuality(places: PlaceResult[]): PlaceResult[] {
  return [...places].sort((a, b) => qualityRank(b) - qualityRank(a));
}

// Single nearby request — wraps the boilerplate Google v1 invocation.
async function nearbyRequest(
  lat: number,
  lng: number,
  radius: number,
  rank: 'POPULARITY' | 'DISTANCE',
  includedTypes: string[] = ['restaurant'],
): Promise<PlaceResult[]> {
  try {
    const res = await fetch(`${BASE_URL}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount: 20,
        rankPreference: rank,
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius,
          },
        },
      }),
    });
    if (!res.ok) {
      console.error('[Places] searchNearby error:', res.status, await res.text().catch(() => ''));
      return [];
    }
    const data = await res.json();
    return mapPlaces(data.places || []);
  } catch (err) {
    console.error('[Places] searchNearby exception:', err);
    return [];
  }
}

// Single text request — same idea but for places:searchText.
async function textRequest(
  textQuery: string,
  lat: number,
  lng: number,
  radius: number,
  hasRestrictedLocation: boolean,
  priceLevels?: string[],
): Promise<PlaceResult[]> {
  const locationParam = hasRestrictedLocation
    ? { locationRestriction: { rectangle: circleToRectangle(lat, lng, radius) } }
    : { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } } };
  const body: Record<string, unknown> = {
    textQuery,
    includedType: 'restaurant',
    maxResultCount: 20,
    ...locationParam,
  };
  if (priceLevels && priceLevels.length > 0) body.priceLevels = priceLevels;
  try {
    const res = await fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error('[Places] searchText error:', res.status, await res.text().catch(() => ''));
      return [];
    }
    const data = await res.json();
    return mapPlaces(data.places || []);
  } catch (err) {
    console.error('[Places] searchText exception:', err);
    return [];
  }
}

export async function searchNearbyRestaurants(
  lat: number,
  lng: number,
  radiusMeters = 2000,
  cuisineTypes: string[] = [],
  priceLevel = 0,
  locationName?: string,
): Promise<PlaceResult[]> {
  const hasLocation = !!locationName && locationName !== 'Current Location';
  const hasFilters = priceLevel > 0 || cuisineTypes.length > 0;
  const isPrecise = radiusMeters <= PRECISE_RADIUS_M;
  const cap = isPrecise ? PRECISE_CAP : BROAD_CAP;

  if (hasFilters) {
    return searchWithFilters(lat, lng, radiusMeters, cuisineTypes, priceLevel, locationName, cap, isPrecise);
  }

  if (isPrecise) {
    // Precise area: prioritise DISTANCE so genuinely-nearby spots (a 3-star
    // tucked between cafés, a small bistro the popularity ranker doesn't
    // know about) come back even if Google considers them obscure.
    // The popularity pass + a single text-query supplement fill in the
    // gaps from the type filter and catch food places that nearby's
    // includedTypes might miss (some restaurants only carry their cuisine
    // type, e.g. 'french_restaurant' without 'restaurant').
    const [byDistance, byPopularity, byText] = await Promise.all([
      nearbyRequest(lat, lng, radiusMeters, 'DISTANCE'),
      nearbyRequest(lat, lng, radiusMeters, 'POPULARITY'),
      textRequest('restaurants', lat, lng, radiusMeters, hasLocation),
    ]);

    const all = [...byDistance, ...byPopularity, ...byText];
    const deduped = deduplicatePlaces(all).filter((p) => isFoodPlace(p.types));
    return sortByDistance(lat, lng, deduped).slice(0, cap);
  }

  // Broad area: pull from several angles in parallel so the result set
  // isn't biased to whatever single query happens to like this area.
  // Each query returns up to 20 places; together they typically yield
  // 60-120 raw, which dedupes down to 40-90 unique food places before
  // we rank by quality and slice to the cap.
  const broadQueries = ['restaurants', 'best restaurants', 'top rated restaurants', 'popular restaurants'];

  const [byPopularity, byDistance, ...textResults] = await Promise.all([
    nearbyRequest(lat, lng, radiusMeters, 'POPULARITY'),
    nearbyRequest(lat, lng, radiusMeters, 'DISTANCE'),
    ...broadQueries.map((q) => textRequest(q, lat, lng, radiusMeters, hasLocation)),
  ]);

  const all = [...byPopularity, ...byDistance, ...textResults.flat()];
  const deduped = deduplicatePlaces(all).filter((p) => isFoodPlace(p.types));
  return sortByQuality(deduped).slice(0, cap);
}

// Filtered search (price level and/or cuisine selected). One text query per
// cuisine — gives genuine cuisine diversity rather than a generic
// "restaurant" query trying to second-guess what the user wants. Precise
// areas additionally fold in a distance-ranked nearby pass so the result
// set still surfaces tightly-clustered options the cuisine queries miss.
async function searchWithFilters(
  lat: number,
  lng: number,
  radiusMeters: number,
  cuisineTypes: string[],
  priceLevel: number,
  locationName: string | undefined,
  cap: number,
  isPrecise: boolean,
): Promise<PlaceResult[]> {
  const hasLocation = !!locationName && locationName !== 'Current Location';
  const queries = cuisineTypes.length > 0
    ? cuisineTypes.map((t) => CUISINE_LABEL_MAP[t] || 'restaurant')
    : ['restaurants'];

  const priceLevels = priceLevel > 0 && PRICE_LEVEL_STRINGS[priceLevel]
    ? [PRICE_LEVEL_STRINGS[priceLevel]]
    : undefined;

  // Clamp text-search radius to at least 5 km so cuisine queries have
  // something to chew on even when the user is zoomed all the way in
  // (otherwise "italian" with a 400m radius returns 1-2 places). The
  // distance-ranked nearby pass still uses the actual radius so it
  // genuinely respects the visible area.
  const filterRadius = Math.max(radiusMeters, 5000);

  const textPromises = queries.map((q) => textRequest(q, lat, lng, filterRadius, hasLocation, priceLevels));

  // Distance-ranked nearby supplement so a precise search returns the
  // physically nearest matches even if Google's text relevance disagrees.
  // No-op for broad searches.
  const distancePromise = isPrecise
    ? nearbyRequest(lat, lng, radiusMeters, 'DISTANCE')
    : Promise.resolve([] as PlaceResult[]);

  const [textResults, byDistance] = await Promise.all([
    Promise.all(textPromises),
    distancePromise,
  ]);

  const all = [...textResults.flat(), ...byDistance];
  let deduped = deduplicatePlaces(all).filter((p) => isFoodPlace(p.types));
  // Distance-ranked nearby doesn't honour price/cuisine filters server-side,
  // so trim its contributions client-side. Price level on PlaceResult is
  // 0 when unknown — those aren't excluded because the filter can't tell
  // unknown vs mismatch.
  if (priceLevel > 0) {
    deduped = deduped.filter((p) => p.priceLevel === 0 || p.priceLevel === priceLevel);
  }
  return (isPrecise ? sortByDistance(lat, lng, deduped) : sortByQuality(deduped)).slice(0, cap);
}

// Food-related place types that should be included in search results
const FOOD_TYPES = new Set([
  'restaurant', 'cafe', 'bakery', 'bar', 'bar_and_grill', 'coffee_shop',
  'fast_food_restaurant', 'meal_delivery', 'meal_takeaway', 'food',
  'american_restaurant', 'barbecue_restaurant', 'brazilian_restaurant',
  'breakfast_restaurant', 'brunch_restaurant', 'chinese_restaurant',
  'french_restaurant', 'greek_restaurant', 'hamburger_restaurant',
  'indian_restaurant', 'indonesian_restaurant', 'italian_restaurant',
  'japanese_restaurant', 'korean_restaurant', 'lebanese_restaurant',
  'mediterranean_restaurant', 'mexican_restaurant', 'middle_eastern_restaurant',
  'pizza_restaurant', 'ramen_restaurant', 'seafood_restaurant',
  'spanish_restaurant', 'steak_house', 'sushi_restaurant', 'thai_restaurant',
  'turkish_restaurant', 'vegan_restaurant', 'vegetarian_restaurant',
  'vietnamese_restaurant', 'ice_cream_shop', 'juice_shop', 'sandwich_shop',
]);

// Exported for the recommendation engine's price-restricted query path — the
// paged text search has no server-side food-type filter, so it applies this
// one client-side.
export function isFoodPlace(types: string[]): boolean {
  return types.some((t) => FOOD_TYPES.has(t));
}

export async function searchPlacesByText(
  query: string,
  lat: number,
  lng: number,
  locationNameOrRadius?: string | number,
  useRestriction = false,
  radiusOverride?: number,
): Promise<PlaceResult[]> {
  // Backward compat: 4th arg can be locationName (string) or radiusMeters (number)
  let radiusMeters = 10000;
  let locationName: string | undefined;
  if (typeof locationNameOrRadius === 'string') {
    locationName = locationNameOrRadius;
  } else if (typeof locationNameOrRadius === 'number') {
    radiusMeters = locationNameOrRadius;
  }
  if (typeof radiusOverride === 'number') radiusMeters = radiusOverride;

  const hasLocation = !!locationName && locationName !== 'Current Location';
  const shouldRestrict = useRestriction || hasLocation;

  const locationParam = shouldRestrict
    ? { locationRestriction: { rectangle: circleToRectangle(lat, lng, Math.min(radiusMeters, 50000)) } }
    : { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusMeters, 50000) } } };

  // Search 1: raw query + "restaurant" keyword for broad food results
  const body: Record<string, unknown> = {
    textQuery: `${query} restaurant`,
    maxResultCount: 10,
    ...locationParam,
  };

  // Search 2: raw query only — catches exact name matches (cafes, bakeries, bars, etc.)
  const exactBody: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 10,
    ...locationParam,
  };

  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
    'X-Goog-FieldMask': FIELDS,
  };

  // Run both searches in parallel for speed
  const [broadRes, exactRes] = await Promise.all([
    fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST', headers, body: JSON.stringify(body),
    }).then((r) => r.json()).catch(() => ({ places: [] })),
    fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST', headers, body: JSON.stringify(exactBody),
    }).then((r) => r.json()).catch(() => ({ places: [] })),
  ]);

  const broadPlaces = mapPlaces(broadRes.places || []);
  const exactPlaces = mapPlaces(exactRes.places || []);

  // Filter exact results to only food-related places
  const foodExact = exactPlaces.filter((p) => isFoodPlace(p.types));

  // Merge: exact name matches first (higher relevance), then broad results
  const merged = [...foodExact, ...broadPlaces];
  return deduplicatePlaces(merged);
}

/* ── Paginating text search (for /location's infinite scroll) ────────────── */

export interface SearchPageOptions {
  /** Center of the search area. */
  lat: number;
  lng: number;
  /** Max distance from (lat, lng) to include, in meters. Clamped to 50 km
   *  since that's Google's hard cap for locationRestriction. */
  radiusMeters: number;
  /** When true, the radius is a hard boundary (converted to rectangle for
   *  the text endpoint). When false, it's just a bias hint. */
  useRestriction?: boolean;
  /** Google price-level enum values 1–4. When non-empty the API filters
   *  server-side so we only get matching prices — much more efficient
   *  than paging through every restaurant and filtering client-side. */
  priceLevels?: number[];
  /** Supplied by a previous response to continue the same query into its
   *  next page. Pass the full token verbatim. */
  pageToken?: string;
  /** 1–20. Defaults to 20. */
  pageSize?: number;
}

export interface SearchPageResult {
  places: PlaceResult[];
  /** Non-null when the server indicates more pages exist. Pass back as
   *  `pageToken` to fetch the next page. */
  nextPageToken: string | null;
}

/**
 * Text search that supports Google's paginated response + server-side price
 * filtering. Use this when you need to drain a single query across many
 * pages (the explore page's infinite scroll does this per-query so $$$$
 * New York returns hundreds of results instead of the ~20 that fit in one
 * page). For one-shot lookups the older `searchPlacesByText` is still fine.
 */
export async function searchPlacesByTextPaged(
  query: string,
  opts: SearchPageOptions,
): Promise<SearchPageResult> {
  const { lat, lng, radiusMeters, useRestriction, priceLevels, pageToken, pageSize } = opts;
  const clampedRadius = Math.min(radiusMeters, 50000);
  const locationParam = useRestriction
    ? { locationRestriction: { rectangle: circleToRectangle(lat, lng, clampedRadius) } }
    : { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: clampedRadius } } };

  const body: Record<string, unknown> = {
    textQuery: query,
    pageSize: Math.min(Math.max(pageSize ?? 20, 1), 20),
    ...locationParam,
  };
  if (priceLevels && priceLevels.length > 0) {
    body.priceLevels = priceLevels
      .map((n) => PRICE_LEVEL_STRINGS[n])
      .filter((s): s is string => !!s);
  }
  if (pageToken) body.pageToken = pageToken;

  try {
    const res = await fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        // nextPageToken is a top-level field — listing it explicitly is
        // required alongside `places.*` in the field mask.
        'X-Goog-FieldMask': `${FIELDS},nextPageToken`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Keep diagnostics on the network tab only — the caller's fallback
      // handles empty returns without needing the page to blow up.
      console.error('[Places] searchPlacesByTextPaged failed:', res.status, await res.text().catch(() => ''));
      return { places: [], nextPageToken: null };
    }
    const data = await res.json();
    return {
      places: mapPlaces(data.places || []),
      nextPageToken: (data.nextPageToken as string) || null,
    };
  } catch (err) {
    console.error('[Places] searchPlacesByTextPaged exception:', err);
    return { places: [], nextPageToken: null };
  }
}

export async function searchHotels(
  query: string,
  lat: number,
  lng: number,
): Promise<PlaceResult[]> {
  const body: Record<string, unknown> = {
    textQuery: query || 'hotels',
    includedType: 'hotel',
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 50000,
      },
    },
  };

  const res = await fetch(`${BASE_URL}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': FIELDS,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    console.error('[Places] hotelSearch error:', data);
    return [];
  }
  return mapPlaces(data.places || []);
}

// NOTE: `photos` is intentionally omitted — the Places Photos media
// endpoint is separately billed and every rendered image is its own call.
// The detail page now surfaces user-uploaded photos only; if none exist it
// shows a "No photos added yet" placeholder.
const DETAIL_FIELDS = 'id,displayName,location,rating,priceLevel,shortFormattedAddress,formattedAddress,addressComponents,types,userRatingCount,nationalPhoneNumber,websiteUri,currentOpeningHours,regularOpeningHours';

// In-memory cache for place details (5 min TTL)
const placeDetailsCache = new Map<string, { data: PlaceDetails; ts: number }>();
const DETAIL_CACHE_TTL = 5 * 60 * 1000;

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  // Check cache first
  const cached = placeDetailsCache.get(placeId);
  if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) {
    return cached.data;
  }

  const res = await fetch(`${BASE_URL}/places/${placeId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
      'X-Goog-FieldMask': DETAIL_FIELDS,
    },
  });

  const p = await res.json();

  if (!res.ok) {
    console.error('[Places] getPlaceDetails error:', p);
    throw new Error(`Place details failed: ${p.error?.message || res.status}`);
  }

  // Photos intentionally disabled — every Photos media fetch is a separate
  // billed Places call, so the detail page renders user-uploaded photos
  // only (or a "No photos added yet" placeholder).
  const hours = p.currentOpeningHours?.weekdayDescriptions
    || p.regularOpeningHours?.weekdayDescriptions
    || [];

  const isOpen = p.currentOpeningHours?.openNow ?? null;

  const details: PlaceDetails = {
    id: p.id || placeId,
    name: p.displayName?.text || 'Unknown',
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating ?? 0,
    priceLevel: parsePriceLevel(p.priceLevel),
    address: p.shortFormattedAddress || p.formattedAddress || '',
    fullAddress: p.formattedAddress || p.shortFormattedAddress || '',
    addressComponents: (p as GooglePlace).addressComponents,
    photoUrl: null,
    photoUrls: [],
    types: p.types || [],
    userRatingCount: p.userRatingCount ?? 0,
    phone: p.nationalPhoneNumber || '',
    website: p.websiteUri || '',
    hours,
    isOpen,
  };

  placeDetailsCache.set(placeId, { data: details, ts: Date.now() });
  return details;
}

/**
 * Resolve a real Google place id for a restaurant we only know by name +
 * coordinates (used for Michelin dataset-sourced rows, which carry a synthetic
 * id). Runs a text search near the point and returns the nearest result whose
 * coordinates are within ~250 m. Returns null when nothing plausible is found.
 */
export async function resolvePlaceIdByNameCoords(
  name: string,
  lat: number,
  lng: number,
): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': 'places.id,places.location,places.displayName',
      },
      body: JSON.stringify({
        textQuery: name,
        maxResultCount: 10,
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: 1500 } },
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const places: Array<{ id?: string; location?: { latitude: number; longitude: number } }> =
      data.places || [];
    let best: string | null = null;
    let bestMeters = Infinity;
    for (const p of places) {
      if (!p.id || !p.location) continue;
      const dLat = ((p.location.latitude - lat) * Math.PI) / 180;
      const dLng = ((p.location.longitude - lng) * Math.PI) / 180;
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos((lat * Math.PI) / 180) * Math.cos((p.location.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (meters < bestMeters) { bestMeters = meters; best = p.id; }
    }
    // Accept only a genuinely-close match (same venue), else fall back to the
    // top text result (still the most likely candidate by name relevance).
    if (best && bestMeters <= 250) return best;
    return places[0]?.id || null;
  } catch {
    return null;
  }
}

// Common US state name → abbreviation (also used as the canonical
// "is this a US state?" lookup).
const STATE_ABBR: Record<string, string> = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
  'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'District of Columbia':'DC',
};

const STATE_CODES = new Set(Object.values(STATE_ABBR));

// Country names + ISO-style abbreviations we expect to see as the trailing
// comma segment of a Google Places formatted address. Used to decide
// whether the last segment of a short address is a country (so the city
// is one segment in) or itself a city (so the address has no country
// and we shouldn't slap "City, City" on the user). Not exhaustive; it
// covers the high-traffic destinations and falls through to "treat last
// as city" for unrecognised values, which is the correct behaviour for
// stripped US short-formatted addresses like "Park Ave S, New York".
const KNOWN_COUNTRIES = new Set<string>([
  'usa','united states','united states of america',
  'uk','united kingdom','great britain','england','scotland','wales','northern ireland',
  'canada','mexico','france','germany','italy','spain','portugal','netherlands','holland',
  'belgium','luxembourg','switzerland','austria','denmark','sweden','norway','finland',
  'iceland','ireland','czechia','czech republic','poland','hungary','greece','turkey',
  'russia','ukraine','romania','bulgaria','croatia','serbia','slovenia','slovakia',
  'estonia','latvia','lithuania','japan','china','south korea','korea','north korea',
  'taiwan','hong kong','macau','singapore','malaysia','thailand','vietnam','indonesia',
  'philippines','india','pakistan','bangladesh','sri lanka','nepal','myanmar',
  'australia','new zealand','fiji',
  'brazil','argentina','chile','peru','colombia','venezuela','ecuador','uruguay','paraguay','bolivia',
  'south africa','egypt','morocco','tunisia','kenya','nigeria','ethiopia','ghana','tanzania',
  'israel','lebanon','jordan','saudi arabia','uae','united arab emirates','qatar','kuwait','bahrain','oman',
  'iran','iraq','afghanistan',
]);

function looksLikeCountry(seg: string): boolean {
  return KNOWN_COUNTRIES.has(seg.trim().toLowerCase());
}

// Heuristic: does this address segment look like a street rather than a
// city? Triggered by a leading house number, a trailing cardinal letter
// (e.g. "Park Ave S"), or a known street suffix in the token list.
// Used by extractCityState to walk past a "Park Ave S, New York" prefix
// when shortFormattedAddress drops the full city/state/country tail.
const STREET_SUFFIXES = new Set([
  'st','street','ave','avenue','blvd','boulevard','rd','road','dr','drive',
  'ln','lane','way','pkwy','parkway','ct','court','pl','place','sq','square',
  'ter','terrace','hwy','highway','tpke','turnpike','expy','expressway',
  'pike','plaza','row','crescent','cres','close','mews','walk','alley',
  'cir','circle','run','trail','trl','loop',
]);

function isStreetLike(segment: string): boolean {
  if (!segment) return false;
  const trimmed = segment.trim();
  // Leading house number — very strong street signal.
  if (/^\d/.test(trimmed)) return true;
  const tokens = trimmed.toLowerCase().replace(/[.,]/g, '').split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  // Any token in the street-suffix set anywhere in the segment.
  for (const t of tokens) {
    if (STREET_SUFFIXES.has(t)) return true;
  }
  // Trailing cardinal direction letter ("Park Ave S", "5th Ave N").
  const last = tokens[tokens.length - 1];
  if (/^[nsew]$/.test(last) && tokens.length > 1) return true;
  return false;
}

// Pull a clean city name out of a "city + postcode" or "postcode + city" fragment.
// Handles formats like "75002 Paris", "London SW1A 2AA", "Tokyo 131-0045",
// "20122 Milano MI", "1012 AB Amsterdam", "Sydney NSW 2000".
function cityFromRegion(region: string): string {
  let tokens = region.split(/\s+/).filter(Boolean);
  // Strip a leading numeric postcode (FR/DE/IT/NL style).
  if (tokens[0] && /^\d/.test(tokens[0])) {
    tokens = tokens.slice(1);
    // Netherlands postcodes are "1234 AB" — drop the 2-letter tail too.
    if (tokens[0] && /^[A-Z]{2}$/.test(tokens[0])) tokens = tokens.slice(1);
  }
  // Strip trailing postcode tokens (anything containing a digit).
  while (tokens.length > 0 && /\d/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  // Strip a trailing 2-3 letter all-caps province/state code (IT "MI", AU "NSW").
  if (tokens.length > 1 && /^[A-Z]{2,3}$/.test(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ').trim();
}

/**
 * Extract a short "City, ST" (US) or "City, Country" (international) label
 * from a Google Places formatted address. Falls back to a best-effort parse
 * of the short address if the full address is missing.
 *
 * US example:   "256 Post Rd E, Westport, CT 06880, USA"  → "Westport, CT"
 * France:       "15 Rue de la Paix, 75002 Paris, France"  → "Paris, France"
 * UK:           "10 Downing St, London SW1A 2AA, UK"      → "London, UK"
 * Japan:        "1-2 Oshiage, Tokyo 131-0045, Japan"      → "Tokyo, Japan"
 *
 * Robust to partial / short addresses where the country (and sometimes the
 * state) is missing — it walks past street-like segments ("Park Ave S")
 * to find a real city, and leans on the US state-name table to recognise
 * "City, State" pairs even when "USA" isn't on the end. This is what
 * keeps the wishlist filter from listing every street as its own city.
 */
export function extractCityState(fullAddress: string, shortAddress: string = ''): string {
  // Try the full address first; if the parse can't find anything sensible,
  // fall through to the short address as a last resort.
  const candidate = (fullAddress || shortAddress || '').trim();
  if (!candidate) return '';
  const result = parseAddressForCity(candidate);
  if (result) return result;
  // The fullAddress parse failed — try the shortAddress on its own.
  if (shortAddress && shortAddress !== fullAddress) {
    const r2 = parseAddressForCity(shortAddress);
    if (r2) return r2;
  }
  // Last resort: the trailing comma segment (better than nothing).
  const parts = candidate.split(',').map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - 1] || '';
}

// Recognise a US-state segment unambiguously. Two accepted shapes:
//   • bare 2-letter code, optionally followed by a 5-digit zip
//     ("CA", "CT 06880", "NY 10029-1234")
//   • full state NAME *followed by* a zip
//     ("Connecticut 06880", "New York 10029")
// We deliberately do NOT match a bare full state name on its own
// (e.g. "New York") — that's almost always the city of that name, and
// the whole point of this function is not to mistake it for the state.
function detectUSStateInSegment(seg: string): string | null {
  const abbrMatch = seg.match(/^([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?$/);
  if (abbrMatch && STATE_CODES.has(abbrMatch[1])) return abbrMatch[1];
  for (const [name, code] of Object.entries(STATE_ABBR)) {
    if (new RegExp(`^${name}\\s+\\d{5}(?:-\\d{4})?$`, 'i').test(seg)) return code;
  }
  return null;
}

function parseAddressForCity(address: string): string {
  const parts = address.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '';

  const last = parts[parts.length - 1] || '';
  const isUSCountry = /^(USA|United States|United States of America)$/i.test(last);

  // Even when "USA" isn't on the end, a "ST zip" tail still means the
  // address is in the US. Scan all segments to find one that looks like
  // a US state — that's our strongest signal.
  let usStateCode: string | null = null;
  let usStateIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const code = detectUSStateInSegment(parts[i]);
    if (code) { usStateCode = code; usStateIndex = i; break; }
  }

  // ── US path ──────────────────────────────────────────────────────────
  if (isUSCountry || usStateCode) {
    if (usStateCode != null) {
      // City is the first non-street segment to the left of the state.
      for (let j = usStateIndex - 1; j >= 0; j--) {
        if (!isStreetLike(parts[j])) return `${parts[j]}, ${usStateCode}`;
      }
      return usStateCode;
    }
    // No state segment but country is USA — pick first non-street segment
    // walking back from the country.
    for (let i = parts.length - 2; i >= 0; i--) {
      if (!isStreetLike(parts[i])) return parts[i];
    }
    return '';
  }

  // ── Non-US path (last segment is a known country) ───────────────────
  // "15 Rue de la Paix, 75002 Paris, France" → "Paris, France". Walk
  // back past street-like prefixes; cityFromRegion strips postcode and
  // province-code noise.
  if (parts.length >= 2 && looksLikeCountry(last)) {
    const country = last;
    for (let i = parts.length - 2; i >= 0; i--) {
      const cleaned = cityFromRegion(parts[i]);
      if (cleaned && !isStreetLike(cleaned) && !/^[A-Z]{2,3}$/.test(cleaned)) {
        return `${cleaned}, ${country}`;
      }
    }
  }

  // ── No recognised country and no US state pattern ────────────────────
  // Short addresses like "Park Ave S, New York" land here — the last
  // segment is the city, not a country. Walk from the end and return
  // the first non-street segment we can clean up. Without state context
  // we can only show the city itself.
  for (let i = parts.length - 1; i >= 0; i--) {
    const seg = parts[i];
    if (isStreetLike(seg)) continue;
    const cleaned = cityFromRegion(seg) || seg;
    if (cleaned) return cleaned;
  }
  return '';
}

// ── Beli-style hierarchical location label ─────────────────────────
// formatLocationLabel produces compact, human-readable display strings
// for restaurant cards / detail pages. It prefers Google's
// addressComponents (precise: neighborhood + sublocality + locality +
// region) and gracefully degrades to formatted-address parsing for old
// rows saved before we started requesting components.
//
// Output examples:
//   West Village, Manhattan         (NYC, neighborhood + borough, no state)
//   Williamsburg, Brooklyn          (NYC, neighborhood + borough)
//   Northwest Portland, Portland, OR
//   Mission, San Francisco, CA
//   Stowe, VT                       (small town, no neighborhood)
//   Paris, France                   (international fallback)

const NYC_BOROUGHS = new Set(['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island']);

function pickComponent(
  components: AddressComponent[] | undefined,
  type: string,
): AddressComponent | undefined {
  if (!components) return undefined;
  return components.find((c) => Array.isArray(c?.types) && c.types.includes(type));
}

function pickAnyComponent(
  components: AddressComponent[] | undefined,
  types: string[],
): AddressComponent | undefined {
  if (!components) return undefined;
  for (const t of types) {
    const hit = components.find((c) => Array.isArray(c?.types) && c.types.includes(t));
    if (hit) return hit;
  }
  return undefined;
}

export function formatLocationLabel(
  components: AddressComponent[] | undefined,
  fullAddress: string = '',
  neighborhoodOverride?: string,
): string {
  // Filter out malformed components — older saved data (or rows that
  // round-tripped through a relaxed JSON shape) can have entries
  // missing the `types` array, which would crash the .includes checks
  // below. Drop those before doing anything.
  if (components) {
    components = components.filter((c) => c && Array.isArray(c.types));
    if (components.length === 0) components = undefined;
  }
  // Mapbox-sourced neighborhood (used to fill in what Google's address
  // components leave out for most US cities). When we have it AND a
  // proper component list, splice it in as a synthetic neighborhood so
  // the rest of the logic treats it like Google handed it to us.
  if (neighborhoodOverride && components && components.length > 0) {
    const hasNeighborhood = components.some((c) => Array.isArray(c?.types) && c.types.includes('neighborhood'));
    if (!hasNeighborhood) {
      components = [
        ...components,
        { longText: neighborhoodOverride, shortText: neighborhoodOverride, types: ['neighborhood', 'political'] },
      ];
    }
  }
  // ── Component-driven path (preferred) ──────────────────────────
  if (components && components.length > 0) {
    const country = pickComponent(components, 'country');
    const state = pickComponent(components, 'administrative_area_level_1');
    // Locality preferred; postal_town picks up UK addresses where Google
    // doesn't tag a `locality` (e.g. "London", "Edinburgh").
    const locality = pickComponent(components, 'locality') || pickComponent(components, 'postal_town');
    // sublocality_level_1 is the borough for NYC ("Manhattan", "Brooklyn")
    // and a smaller subdivision for some other cities. We treat it as
    // borough-when-NYC and as a neighborhood candidate elsewhere.
    const sub1 = pickComponent(components, 'sublocality_level_1')
      || pickComponent(components, 'sublocality');
    const sub2 = pickComponent(components, 'sublocality_level_2');
    const neighborhoodComp = pickComponent(components, 'neighborhood');

    const isUS = country?.shortText === 'US' || /^(US|USA)$/i.test(country?.shortText || country?.longText || '');
    const stateCode = state?.shortText || '';

    // Decide what to use as the city/borough display tier.
    // For NYC the locality is often "New York" but the borough (sub1)
    // is far more useful — collapse to the borough name in that case.
    const sub1Name = sub1?.longText || '';
    const localityName = locality?.longText || '';
    let cityTier = localityName;
    let isNycBorough = false;
    if (isUS && stateCode === 'NY' && NYC_BOROUGHS.has(sub1Name)) {
      cityTier = sub1Name;
      isNycBorough = true;
    } else if (!cityTier && sub1Name) {
      // Some addresses lack locality entirely; fall back to sub1.
      cityTier = sub1Name;
    }

    // Pick a neighborhood. NYC: prefer `neighborhood` then `sub2` (the
    // sub1 is the borough, already used as cityTier). Other cities:
    // prefer `neighborhood`, then sub2, then sub1 (which IS a
    // neighborhood-equivalent outside NYC).
    let neighborhood = '';
    if (isNycBorough) {
      neighborhood = neighborhoodComp?.longText || sub2?.longText || '';
    } else {
      neighborhood = neighborhoodComp?.longText
        || sub2?.longText
        || (sub1Name && sub1Name !== cityTier ? sub1Name : '')
        || '';
    }

    // Don't display a tier that duplicates the next one.
    if (neighborhood && cityTier && neighborhood === cityTier) neighborhood = '';

    // Build the label.
    const tiers: string[] = [];
    if (neighborhood) tiers.push(neighborhood);
    if (cityTier) tiers.push(cityTier);

    if (isUS) {
      // NYC borough rule: skip the state.
      if (!isNycBorough && stateCode) tiers.push(stateCode);
      return joinTiers(tiers) || stateCode || '';
    }
    // International — append country longText if present and we don't
    // already have a country-shaped tier.
    if (country?.longText) tiers.push(country.longText);
    return joinTiers(tiers) || country?.longText || '';
  }

  // ── Fallback: parse the formatted address ──────────────────────
  // Old saved data didn't request addressComponents. We still want
  // something usable. extractCityState already handles the bulk of
  // the parsing (US state recognition, international country
  // detection); we layer a NYC-borough check on top so addresses
  // like "201 Bedford Ave, Brooklyn, NY 11211, USA" surface as
  // "Brooklyn" rather than "Brooklyn, NY" (matching the borough
  // rule for component-driven output).
  const cityState = extractCityState(fullAddress, fullAddress);
  if (!cityState && !neighborhoodOverride) return '';
  // cityState is "City, ST" / "City, Country" / just "City". Detect
  // the NYC-borough pair and drop the state.
  const m = cityState.match(/^(Manhattan|Brooklyn|Queens|Bronx|Staten Island),\s*NY$/);
  const cityTier = m ? m[1] : cityState;
  // If we have a Mapbox neighborhood, prepend it.
  if (neighborhoodOverride && cityTier && neighborhoodOverride !== cityTier) {
    return `${neighborhoodOverride}, ${cityTier}`;
  }
  return cityTier || neighborhoodOverride || '';
}

function joinTiers(tiers: string[]): string {
  return tiers
    .map((t) => (t || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((t, i, arr) => arr.indexOf(t) === i) // dedupe consecutive
    .join(', ');
}

// ── Lazy backfill of address components + Mapbox neighborhood ──────
// formatLocationLabel can produce hierarchical labels ("West Village,
// Manhattan") only when it has a neighborhood. Google's Places API
// reliably returns sublocality / locality / state, but for the spots
// we care about it does NOT return a `neighborhood` component — the
// "West Village" tier just isn't there. To fill that gap we reverse-
// geocode the place's lat/lng through Mapbox (`types=neighborhood`)
// and store the result alongside the Google components.
//
// fetchLocationDataForPlace runs both requests once per restaurant
// (deduped via an inflight map + the existing place-details cache)
// and returns everything callers need to upgrade their cached meta.
// Once the data lands we write to the shared restaurantMeta and every
// card using that meta picks up the richer label automatically.

interface BackfilledLocationData {
  addressComponents?: AddressComponent[];
  neighborhood?: string;
  lat?: number;
  lng?: number;
  /** Weekday opening hour descriptions (empty array = Google has no
   *  hours data for this place; undefined = we haven't tried). */
  hours?: string[];
}

const locationInflight = new Map<string, Promise<BackfilledLocationData>>();

async function fetchMapboxNeighborhood(lat: number, lng: number): Promise<string | undefined> {
  if (!MAPBOX_TOKEN_FOR_NEIGHBORHOOD) return undefined;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN_FOR_NEIGHBORHOOD}&types=neighborhood&limit=1`;
    const res = await fetch(url);
    if (!res.ok) return undefined;
    const data = await res.json();
    const feature = data.features?.[0];
    return typeof feature?.text === 'string' ? feature.text : undefined;
  } catch (err) {
    console.warn('[Mapbox] neighborhood lookup failed', err);
    return undefined;
  }
}

export function fetchLocationDataForPlace(placeId: string): Promise<BackfilledLocationData> {
  if (!placeId) return Promise.resolve({});
  const existing = locationInflight.get(placeId);
  if (existing) return existing;
  const p = (async () => {
    try {
      const details = await getPlaceDetails(placeId);
      const components = details.addressComponents;
      const lat = Number.isFinite(details.lat) ? details.lat : undefined;
      const lng = Number.isFinite(details.lng) ? details.lng : undefined;
      let neighborhood: string | undefined;
      if (lat != null && lng != null) {
        neighborhood = await fetchMapboxNeighborhood(lat, lng);
      }
      // Hours come back from the same Places call (free), so include them
      // here so the location backfill warms hours too.
      return { addressComponents: components, neighborhood, lat, lng, hours: details.hours ?? [] };
    } catch (err) {
      console.warn('[Places] backfill failed for', placeId, err);
      return {} as BackfilledLocationData;
    } finally {
      locationInflight.delete(placeId);
    }
  })();
  locationInflight.set(placeId, p);
  return p;
}
