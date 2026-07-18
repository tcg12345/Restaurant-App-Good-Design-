import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { MAPBOX_TOKEN } from './keys';

interface Coord {
  lat: number;
  lng: number;
}

export interface DirectionsDestination {
  /** Google place id, when known — pins chains to the exact branch instead
   *  of whatever location Google resolves the address string to. */
  placeId?: string | null;
  /** Street address — the preferred destination text. */
  address?: string | null;
  /** Display name; labels the pin and doubles as an address fallback. */
  name?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Directions deep link for the current platform.
 *
 * Web → a Google Maps dir URL, always carrying `destination_place_id` when
 * the place id is known (an address alone routes ambiguous/chain
 * destinations to the wrong branch). Native → an Apple Maps universal link,
 * so iOS hands the tap to the Maps app instead of parking the user on the
 * Google Maps web page in Safari. Open it via openExternalUrl (external-links)
 * rather than a raw target=_blank so native gets the system handoff.
 */
export function buildDirectionsUrl(dest: DirectionsDestination): string | null {
  const hasCoords =
    typeof dest.lat === 'number' && Number.isFinite(dest.lat) &&
    typeof dest.lng === 'number' && Number.isFinite(dest.lng) &&
    !(dest.lat === 0 && dest.lng === 0); // 0/0 is the "unknown" sentinel
  const target = dest.address || dest.name || (hasCoords ? `${dest.lat},${dest.lng}` : '');
  if (!target) return null;
  if (Capacitor.isNativePlatform()) {
    const params = new URLSearchParams({ daddr: target });
    if (dest.name) params.set('q', dest.name);
    return `https://maps.apple.com/?${params.toString()}`;
  }
  const params = new URLSearchParams({ api: '1', destination: target });
  if (dest.placeId) params.set('destination_place_id', dest.placeId);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export interface TravelTimes {
  driveMin: number | null;
  walkMin: number | null;
}

// Module-level cache so revisits and re-renders don't re-fetch the same
// (origin, destination) pair. Stored as the in-flight Promise to also
// dedupe concurrent requests for the same key.
const cache = new Map<string, Promise<TravelTimes>>();

const cacheKey = (o: Coord, d: Coord): string =>
  `${o.lat.toFixed(5)},${o.lng.toFixed(5)}->${d.lat.toFixed(5)},${d.lng.toFixed(5)}`;

async function fetchProfile(profile: string, o: Coord, d: Coord): Promise<number | null> {
  if (!MAPBOX_TOKEN) return null;
  try {
    const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${o.lng},${o.lat};${d.lng},${d.lat}?access_token=${MAPBOX_TOKEN}&overview=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const seconds = data?.routes?.[0]?.duration;
    return Number.isFinite(seconds) ? seconds / 60 : null;
  } catch {
    return null;
  }
}

export async function fetchTravelTimes(origin: Coord, dest: Coord): Promise<TravelTimes> {
  const key = cacheKey(origin, dest);
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = (async () => {
    const [driveMin, walkMin] = await Promise.all([
      // driving-traffic factors live congestion data from Mapbox.
      fetchProfile('driving-traffic', origin, dest),
      fetchProfile('walking', origin, dest),
    ]);
    return { driveMin, walkMin };
  })();
  cache.set(key, promise);
  // Drop the cache entry on failure so a transient error doesn't poison
  // future lookups for this pair.
  promise.then(
    (r) => {
      if (r.driveMin == null && r.walkMin == null) cache.delete(key);
    },
    () => cache.delete(key),
  );
  return promise;
}

// Format a travel duration as a compact label: "12 min", "1 h 5 min".
export function formatTravelTime(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '';
  const m = Math.round(minutes);
  if (m < 1) return '1 min';
  if (m < 60) return `${m} min`;
  const hours = Math.floor(m / 60);
  const mins = m % 60;
  return mins === 0 ? `${hours} h` : `${hours} h ${mins} min`;
}

// React hook — fetches drive + walk durations whenever either endpoint
// changes. Returns nulls until the request resolves (or if either input
// is missing), so call sites can render conditionally with `&&`.
export function useTravelTimes(origin: Coord | null, dest: Coord | null): TravelTimes {
  const [times, setTimes] = useState<TravelTimes>({ driveMin: null, walkMin: null });
  const oLat = origin?.lat;
  const oLng = origin?.lng;
  const dLat = dest?.lat;
  const dLng = dest?.lng;
  useEffect(() => {
    if (oLat == null || oLng == null || dLat == null || dLng == null) {
      setTimes({ driveMin: null, walkMin: null });
      return;
    }
    let cancelled = false;
    fetchTravelTimes({ lat: oLat, lng: oLng }, { lat: dLat, lng: dLng }).then((r) => {
      if (!cancelled) setTimes(r);
    });
    return () => {
      cancelled = true;
    };
  }, [oLat, oLng, dLat, dLng]);
  return times;
}
