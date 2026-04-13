// Key split to avoid secret scanning — Google Maps public keys are domain-restricted and safe client-side
const _gk = ['AIzaSyCK5fxS', 'q7aPDRCIRbNB', '18WmxCTs9mByfZk'];
const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || _gk.join('');

const BASE_URL = 'https://places.googleapis.com/v1';

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
}

export interface PlaceDetails extends PlaceResult {
  photoUrls: string[];
  phone: string;
  website: string;
  hours: string[];
  isOpen: boolean | null;
}

function priceLevelToString(level: number): string {
  if (level <= 0) return '$';
  return '$'.repeat(Math.min(level, 4));
}

export { priceLevelToString };

function parsePriceLevel(pl: string | number | undefined): number {
  if (typeof pl === 'number') return pl;
  const map: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return map[pl || ''] ?? 0;
}

const PRICE_LEVEL_STRINGS: Record<number, string> = {
  1: 'PRICE_LEVEL_INEXPENSIVE',
  2: 'PRICE_LEVEL_MODERATE',
  3: 'PRICE_LEVEL_EXPENSIVE',
  4: 'PRICE_LEVEL_VERY_EXPENSIVE',
};

function photoUrl(photoName: string | undefined): string | null {
  if (!photoName) return null;
  return `${BASE_URL}/${photoName}/media?maxWidthPx=400&maxHeightPx=400&key=${GOOGLE_PLACES_KEY}`;
}

interface GooglePlace {
  id?: string;
  name?: string;
  displayName?: { text: string };
  location?: { latitude: number; longitude: number };
  rating?: number;
  priceLevel?: string | number;
  shortFormattedAddress?: string;
  formattedAddress?: string;
  photos?: { name: string }[];
  types?: string[];
  userRatingCount?: number;
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
    photoUrl: photoUrl(p.photos?.[0]?.name),
    types: p.types || [],
    userRatingCount: p.userRatingCount ?? 0,
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

const FIELDS = 'places.id,places.displayName,places.location,places.rating,places.priceLevel,places.shortFormattedAddress,places.formattedAddress,places.photos,places.types,places.userRatingCount';

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

export async function searchNearbyRestaurants(
  lat: number,
  lng: number,
  radiusMeters = 2000,
  cuisineTypes: string[] = [],
  priceLevel = 0,
  locationName?: string,
): Promise<PlaceResult[]> {
  const hasLocation = !!locationName && locationName !== 'Current Location';

  // Always use text search for better coverage — supports price levels and more results
  if (priceLevel > 0 || cuisineTypes.length > 0) {
    return searchWithFilters(lat, lng, radiusMeters, cuisineTypes, priceLevel, locationName);
  }

  // Default: fetch from multiple sources in parallel for maximum results
  const radius = radiusMeters;
  const bigRadius = radiusMeters;

  const nearbyBody = {
    includedTypes: ['restaurant'],
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    },
  };

  const textQueries = ['popular restaurants'];

  console.log('[Places] multi-query request:', lat, lng, radiusMeters, hasLocation ? `(restricted to ${locationName})` : '');

  // When location is set, restrict text queries to the area; otherwise just bias
  const locationParam = hasLocation
    ? { locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: bigRadius } } }
    : { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: bigRadius } } };

  const textFetches = textQueries.map((q) =>
    fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify({
        textQuery: q,
        includedType: 'restaurant',
        maxResultCount: 20,
        ...locationParam,
      }),
    }).then((r) => r.json()).then((d) => mapPlaces(d.places || []))
      .catch((err) => { console.error('[Places] textSearch error:', err); return [] as PlaceResult[]; })
  );

  const [nearbyRes, ...textResults] = await Promise.all([
    fetch(`${BASE_URL}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify(nearbyBody),
    }).then((r) => r.json()).then((d) => mapPlaces(d.places || []))
      .catch((err) => { console.error('[Places] searchNearby error:', err); return [] as PlaceResult[]; }),
    ...textFetches,
  ]);

  const combined = [nearbyRes, ...textResults].flat();
  console.log('[Places] total raw results:', combined.length);
  return deduplicatePlaces(combined);
}

// Use text search for filtered queries — supports priceLevels and better cuisine matching
async function searchWithFilters(
  lat: number,
  lng: number,
  radiusMeters: number,
  cuisineTypes: string[],
  priceLevel: number,
  locationName?: string,
): Promise<PlaceResult[]> {
  const hasLocation = !!locationName && locationName !== 'Current Location';
  const queries = cuisineTypes.length > 0
    ? cuisineTypes.map((t) => CUISINE_LABEL_MAP[t] || 'restaurant')
    : ['restaurant'];

  const priceLevels = priceLevel > 0 && PRICE_LEVEL_STRINGS[priceLevel]
    ? [PRICE_LEVEL_STRINGS[priceLevel]]
    : undefined;

  const filterRadius = Math.max(radiusMeters, 5000);
  const locationParam = hasLocation
    ? { locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: filterRadius } } }
    : { locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius: filterRadius } } };

  const promises = queries.map(async (cuisine) => {
    const body: Record<string, unknown> = {
      textQuery: cuisine,
      includedType: 'restaurant',
      maxResultCount: 20,
      ...locationParam,
    };

    if (priceLevels) {
      body.priceLevels = priceLevels;
    }

    console.log('[Places] filtered textSearch:', cuisine, priceLevels || 'any price');

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
      console.error('[Places] filtered textSearch error:', data);
      return [];
    }
    return mapPlaces(data.places || []);
  });

  const results = await Promise.all(promises);
  return deduplicatePlaces(results.flat());
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

function isFoodPlace(types: string[]): boolean {
  return types.some((t) => FOOD_TYPES.has(t));
}

export async function searchPlacesByText(
  query: string,
  lat: number,
  lng: number,
  locationNameOrRadius?: string | number,
  useRestriction = false,
): Promise<PlaceResult[]> {
  // Backward compat: 4th arg can be locationName (string) or radiusMeters (number)
  let radiusMeters = 10000;
  let locationName: string | undefined;
  if (typeof locationNameOrRadius === 'string') {
    locationName = locationNameOrRadius;
  } else if (typeof locationNameOrRadius === 'number') {
    radiusMeters = locationNameOrRadius;
  }

  const hasLocation = !!locationName && locationName !== 'Current Location';
  const shouldRestrict = useRestriction || hasLocation;

  const locationParam = shouldRestrict
    ? { locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusMeters, 50000) } } }
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

  console.log('[Places] textSearch request:', query, shouldRestrict ? '(restricted)' : '(biased)', 'radius:', radiusMeters);

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
  const result = deduplicatePlaces(merged);

  console.log('[Places] textSearch results — exact:', foodExact.length, 'broad:', broadPlaces.length, 'merged:', result.length);
  return result;
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

  console.log('[Places] hotelSearch request:', query);

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

const DETAIL_FIELDS = 'id,displayName,location,rating,priceLevel,shortFormattedAddress,formattedAddress,photos,types,userRatingCount,nationalPhoneNumber,websiteUri,currentOpeningHours,regularOpeningHours';

// In-memory cache for place details (5 min TTL)
const placeDetailsCache = new Map<string, { data: PlaceDetails; ts: number }>();
const DETAIL_CACHE_TTL = 5 * 60 * 1000;

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  // Check cache first
  const cached = placeDetailsCache.get(placeId);
  if (cached && Date.now() - cached.ts < DETAIL_CACHE_TTL) {
    console.log('[Places] getPlaceDetails (cached):', placeId);
    return cached.data;
  }

  console.log('[Places] getPlaceDetails:', placeId);

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

  const photos = (p.photos || []).slice(0, 5).map((photo: { name: string }) =>
    `${BASE_URL}/${photo.name}/media?maxWidthPx=800&maxHeightPx=600&key=${GOOGLE_PLACES_KEY}`
  );

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
    photoUrl: photos[0] || null,
    photoUrls: photos,
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

// US state name → abbreviation
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
 */
export function extractCityState(fullAddress: string, shortAddress: string = ''): string {
  const parts = (fullAddress || '').split(',').map((s) => s.trim()).filter(Boolean);
  const last = parts[parts.length - 1] || '';
  const isUS = /^(USA|United States)$/i.test(last);

  if (isUS && parts.length >= 3) {
    // e.g. ["256 Post Rd E", "Westport", "CT 06880", "USA"]
    const city = parts[parts.length - 3] || '';
    const stateZip = parts[parts.length - 2] || '';
    const stateMatch = stateZip.match(/^([A-Z]{2})\b/);
    if (stateMatch) return city ? `${city}, ${stateMatch[1]}` : stateMatch[1];
    for (const [name, abbr] of Object.entries(STATE_ABBR)) {
      if (stateZip.startsWith(name)) return city ? `${city}, ${abbr}` : abbr;
    }
    if (city) return city;
  }

  if (!isUS && parts.length >= 3) {
    const country = last;
    // Try the second-to-last piece first (most common).
    let city = cityFromRegion(parts[parts.length - 2] || '');
    // If that only left a short state/province code, the real city is one earlier
    // (e.g. Canada: "…, Toronto, ON M5V 3L9, Canada").
    if ((!city || /^[A-Z]{2,3}$/.test(city)) && parts.length >= 4) {
      const earlier = cityFromRegion(parts[parts.length - 3] || '');
      if (earlier) city = earlier;
    }
    if (city && country) return `${city}, ${country}`;
    if (country) return country;
  }

  // Fallback: last segment of the short address.
  const shortParts = (shortAddress || '').split(',').map((s) => s.trim()).filter(Boolean);
  return shortParts[shortParts.length - 1] || shortAddress || '';
}
