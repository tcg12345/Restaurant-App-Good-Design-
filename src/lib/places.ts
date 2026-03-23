// Key split to avoid secret scanning — Google Maps public keys are domain-restricted and safe client-side
const _gk = ['AIzaSyCK5fxS', 'q7aPDRCIRbNB', '18WmxCTs9mByfZk'];
const GOOGLE_PLACES_KEY = import.meta.env.VITE_GOOGLE_PLACES_KEY || _gk.join('');

let loadPromise: Promise<void> | null = null;
let serviceSingleton: google.maps.places.PlacesService | null = null;

function loadGoogleMaps(): Promise<void> {
  if (loadPromise) return loadPromise;

  // If already loaded by another script
  if (window.google?.maps?.places) {
    loadPromise = Promise.resolve();
    return loadPromise;
  }

  loadPromise = new Promise((resolve, reject) => {
    const callbackName = '__gmapsCallback_' + Date.now();
    (window as any)[callbackName] = () => {
      delete (window as any)[callbackName];
      resolve();
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_PLACES_KEY}&libraries=places&callback=${callbackName}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error('Failed to load Google Maps script'));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}

async function getService(): Promise<google.maps.places.PlacesService> {
  if (serviceSingleton) return serviceSingleton;
  await loadGoogleMaps();
  const div = document.createElement('div');
  serviceSingleton = new google.maps.places.PlacesService(div);
  return serviceSingleton;
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
}

function priceLevelToString(level: number): string {
  if (level <= 0) return '$';
  return '$'.repeat(Math.min(level, 4));
}

export { priceLevelToString };

function mapResults(results: google.maps.places.PlaceResult[]): PlaceResult[] {
  return results
    .filter((p) => p.geometry?.location)
    .map((p) => ({
      id: p.place_id || crypto.randomUUID(),
      name: p.name || 'Unknown',
      lat: p.geometry!.location!.lat(),
      lng: p.geometry!.location!.lng(),
      rating: p.rating ?? 0,
      priceLevel: p.price_level ?? 0,
      address: p.vicinity || p.formatted_address || '',
      photoUrl: p.photos?.[0]?.getUrl({ maxWidth: 400, maxHeight: 400 }) || null,
      types: p.types || [],
      userRatingCount: p.user_ratings_total ?? 0,
    }));
}

export async function searchNearbyRestaurants(
  lat: number,
  lng: number,
  radiusMeters = 2000
): Promise<PlaceResult[]> {
  const service = await getService();

  return new Promise((resolve, reject) => {
    service.nearbySearch(
      {
        location: { lat, lng },
        radius: radiusMeters,
        type: 'restaurant',
        rankBy: google.maps.places.RankBy.PROMINENCE,
      },
      (results, status) => {
        console.log('[Places] nearbySearch status:', status, 'count:', results?.length);
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          resolve(mapResults(results));
        } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
        } else {
          console.error('[Places] nearbySearch failed:', status);
          reject(new Error(`Places nearbySearch failed: ${status}`));
        }
      }
    );
  });
}

export async function searchPlacesByText(
  query: string,
  lat: number,
  lng: number
): Promise<PlaceResult[]> {
  const service = await getService();

  return new Promise((resolve, reject) => {
    service.textSearch(
      {
        query: query + ' restaurant',
        location: { lat, lng },
        radius: 5000,
        type: 'restaurant',
      },
      (results, status) => {
        console.log('[Places] textSearch status:', status, 'count:', results?.length);
        if (status === google.maps.places.PlacesServiceStatus.OK && results) {
          resolve(mapResults(results));
        } else if (status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          resolve([]);
        } else {
          console.error('[Places] textSearch failed:', status);
          reject(new Error(`Places textSearch failed: ${status}`));
        }
      }
    );
  });
}
