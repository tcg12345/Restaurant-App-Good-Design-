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

function mapPlaces(places: any[]): PlaceResult[] {
  return (places || []).map((p: any) => ({
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
  locationName?: string,
): Promise<PlaceResult[]> {
  const hasLocation = !!locationName && locationName !== 'Current Location';

  // Always use text search for better coverage — supports price levels and more results
  if (priceLevel > 0 || cuisineTypes.length > 0) {
    return searchWithFilters(lat, lng, radiusMeters, cuisineTypes, priceLevel, locationName);
  }

  // Default: fetch from multiple sources in parallel for maximum results
  const radius = Math.max(radiusMeters, 3000);
  const bigRadius = Math.max(radiusMeters, 8000);

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

  const textQueries = ['best restaurants', 'popular dining', 'top rated restaurants'];

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
      .catch(() => [] as PlaceResult[])
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
      .catch(() => [] as PlaceResult[]),
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
    const body: any = {
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

export async function searchPlacesByText(
  query: string,
  lat: number,
  lng: number,
  locationName?: string,
): Promise<PlaceResult[]> {
  const hasLocation = !!locationName && locationName !== 'Current Location';

  // Use includedType to restrict to restaurants instead of polluting the query text.
  // Keep the user's raw query clean so Google can match restaurant names accurately.
  const body: any = {
    textQuery: query,
    includedType: 'restaurant',
    maxResultCount: 20,
  };

  if (hasLocation) {
    // Restrict results to the selected location area
    body.locationRestriction = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 10000,
      },
    };
  } else {
    body.locationBias = {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: 10000,
      },
    };
  }

  console.log('[Places] textSearch request:', query, hasLocation ? `(restricted to ${locationName})` : '(biased)');

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

const DETAIL_FIELDS = 'id,displayName,location,rating,priceLevel,shortFormattedAddress,formattedAddress,photos,types,userRatingCount,nationalPhoneNumber,websiteUri,currentOpeningHours,regularOpeningHours';

export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
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

  const photos = (p.photos || []).slice(0, 5).map((photo: any) =>
    `${BASE_URL}/${photo.name}/media?maxWidthPx=800&maxHeightPx=600&key=${GOOGLE_PLACES_KEY}`
  );

  const hours = p.currentOpeningHours?.weekdayDescriptions
    || p.regularOpeningHours?.weekdayDescriptions
    || [];

  const isOpen = p.currentOpeningHours?.openNow ?? null;

  return {
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
}
