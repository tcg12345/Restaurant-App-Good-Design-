import { Loader } from '@googlemaps/js-api-loader';

const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || '';

let loaderInstance: Loader | null = null;
let placesLib: google.maps.PlacesLibrary | null = null;

function getLoader() {
  if (!loaderInstance) {
    loaderInstance = new Loader({
      apiKey: GOOGLE_PLACES_KEY,
      version: 'weekly',
      libraries: ['places'],
    });
  }
  return loaderInstance;
}

async function getPlacesLib() {
  if (placesLib) return placesLib;
  const loader = getLoader();
  placesLib = await loader.importLibrary('places');
  return placesLib;
}

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
  isOpen?: boolean;
}

function priceLevelToString(level: number): string {
  if (level <= 0) return '$';
  return '$'.repeat(Math.min(level, 4));
}

export { priceLevelToString };

export async function searchNearbyRestaurants(
  lat: number,
  lng: number,
  radiusMeters = 2000
): Promise<PlaceResult[]> {
  const lib = await getPlacesLib();

  const request = {
    fields: [
      'displayName',
      'id',
      'location',
      'rating',
      'priceLevel',
      'formattedAddress',
      'photos',
      'primaryType',
      'types',
      'userRatingCount',
      'regularOpeningHours',
    ],
    locationRestriction: {
      center: { lat, lng },
      radius: radiusMeters,
    },
    includedPrimaryTypes: ['restaurant'],
    maxResultCount: 20,
    rankPreference: 'POPULARITY' as any,
  };

  // @ts-ignore — Places New API
  const { places } = await lib.Place.searchNearby(request);

  return (places || []).map((place: any) => ({
    id: place.id,
    name: place.displayName || 'Unknown',
    lat: place.location?.lat() ?? lat,
    lng: place.location?.lng() ?? lng,
    rating: place.rating ?? 0,
    priceLevel: typeof place.priceLevel === 'number'
      ? place.priceLevel
      : (['FREE', 'INEXPENSIVE', 'MODERATE', 'EXPENSIVE', 'VERY_EXPENSIVE'].indexOf(place.priceLevel) ?? 0),
    address: place.formattedAddress || '',
    photoUrl: place.photos?.[0]?.getURI?.({ maxWidth: 400, maxHeight: 400 }) || null,
    types: place.types || [],
    userRatingCount: place.userRatingCount ?? 0,
    isOpen: place.regularOpeningHours?.periods ? undefined : undefined,
  }));
}

export async function searchPlacesByText(
  query: string,
  lat: number,
  lng: number
): Promise<PlaceResult[]> {
  const lib = await getPlacesLib();

  const request = {
    textQuery: query + ' restaurant',
    fields: [
      'displayName',
      'id',
      'location',
      'rating',
      'priceLevel',
      'formattedAddress',
      'photos',
      'primaryType',
      'types',
      'userRatingCount',
    ],
    locationBias: {
      center: { lat, lng },
      radius: 5000,
    },
    includedType: 'restaurant',
    maxResultCount: 20,
  };

  // @ts-ignore — Places New API
  const { places } = await lib.Place.searchByText(request);

  return (places || []).map((place: any) => ({
    id: place.id,
    name: place.displayName || 'Unknown',
    lat: place.location?.lat() ?? lat,
    lng: place.location?.lng() ?? lng,
    rating: place.rating ?? 0,
    priceLevel: typeof place.priceLevel === 'number'
      ? place.priceLevel
      : (['FREE', 'INEXPENSIVE', 'MODERATE', 'EXPENSIVE', 'VERY_EXPENSIVE'].indexOf(place.priceLevel) ?? 0),
    address: place.formattedAddress || '',
    photoUrl: place.photos?.[0]?.getURI?.({ maxWidth: 400, maxHeight: 400 }) || null,
    types: place.types || [],
    userRatingCount: place.userRatingCount ?? 0,
  }));
}
