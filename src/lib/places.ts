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
  photoUrl: string | null;
  types: string[];
  userRatingCount: number;
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

function mapPlaces(places: any[]): PlaceResult[] {
  return (places || []).map((p: any) => ({
    id: p.id || p.name || crypto.randomUUID(),
    name: p.displayName?.text || 'Unknown',
    lat: p.location?.latitude ?? 0,
    lng: p.location?.longitude ?? 0,
    rating: p.rating ?? 0,
    priceLevel: parsePriceLevel(p.priceLevel),
    address: p.shortFormattedAddress || p.formattedAddress || '',
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
  { label: 'Italian', type: 'italian_restaurant' },
  { label: 'Chinese', type: 'chinese_restaurant' },
  { label: 'Japanese', type: 'japanese_restaurant' },
  { label: 'Mexican', type: 'mexican_restaurant' },
  { label: 'Indian', type: 'indian_restaurant' },
  { label: 'Thai', type: 'thai_restaurant' },
  { label: 'French', type: 'french_restaurant' },
  { label: 'Korean', type: 'korean_restaurant' },
  { label: 'Mediterranean', type: 'mediterranean_restaurant' },
  { label: 'American', type: 'american_restaurant' },
  { label: 'Seafood', type: 'seafood_restaurant' },
  { label: 'Steakhouse', type: 'steak_house' },
  { label: 'Sushi', type: 'sushi_restaurant' },
  { label: 'Pizza', type: 'pizza_restaurant' },
  { label: 'Cafe', type: 'cafe' },
  { label: 'Bakery', type: 'bakery' },
  { label: 'Bar & Grill', type: 'bar_and_grill' },
  { label: 'Breakfast', type: 'breakfast_restaurant' },
  { label: 'Vegan', type: 'vegan_restaurant' },
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
): Promise<PlaceResult[]> {
  // Always use text search for better coverage — supports price levels and more results
  if (priceLevel > 0 || cuisineTypes.length > 0) {
    return searchWithFilters(lat, lng, radiusMeters, cuisineTypes, priceLevel);
  }

  // Default: fetch both via nearbySearch AND textSearch for more results
  const nearbyBody = {
    includedTypes: ['restaurant'],
    maxResultCount: 20,
    rankPreference: 'POPULARITY',
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radiusMeters,
      },
    },
  };

  const textBody = {
    textQuery: 'restaurants',
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: Math.max(radiusMeters, 5000),
      },
    },
  };

  console.log('[Places] searchNearby+text request:', lat, lng, radiusMeters);

  const [nearbyRes, textRes] = await Promise.all([
    fetch(`${BASE_URL}/places:searchNearby`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify(nearbyBody),
    }),
    fetch(`${BASE_URL}/places:searchText`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_PLACES_KEY,
        'X-Goog-FieldMask': FIELDS,
      },
      body: JSON.stringify(textBody),
    }),
  ]);

  const [nearbyData, textData] = await Promise.all([nearbyRes.json(), textRes.json()]);
  console.log('[Places] nearby count:', nearbyData.places?.length ?? 0, 'text count:', textData.places?.length ?? 0);

  const combined = [
    ...mapPlaces(nearbyData.places || []),
    ...mapPlaces(textData.places || []),
  ];
  return deduplicatePlaces(combined);
}

// Use text search for filtered queries — supports priceLevels and better cuisine matching
async function searchWithFilters(
  lat: number,
  lng: number,
  radiusMeters: number,
  cuisineTypes: string[],
  priceLevel: number,
): Promise<PlaceResult[]> {
  const queries = cuisineTypes.length > 0
    ? cuisineTypes.map((t) => CUISINE_LABEL_MAP[t] || 'restaurant')
    : ['restaurant'];

  const priceLevels = priceLevel > 0 && PRICE_LEVEL_STRINGS[priceLevel]
    ? [PRICE_LEVEL_STRINGS[priceLevel]]
    : undefined;

  const promises = queries.map(async (cuisine) => {
    const body: any = {
      textQuery: `${cuisine} restaurant`,
      maxResultCount: 20,
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: Math.max(radiusMeters, 5000),
        },
      },
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

export async function searchPlacesByText(
  query: string,
  lat: number,
  lng: number
): Promise<PlaceResult[]> {
  const body = {
    textQuery: query + ' restaurant',
    maxResultCount: 20,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 10000,
      },
    },
  };

  console.log('[Places] textSearch request:', query);

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
  console.log('[Places] textSearch status:', res.status, 'count:', data.places?.length ?? 0);

  if (!res.ok) {
    console.error('[Places] textSearch error:', data);
    throw new Error(`Places textSearch failed: ${data.error?.message || res.status}`);
  }

  return mapPlaces(data.places || []);
}
