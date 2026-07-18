import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  type HomeLocation,
  loadLastSelectedLocation,
  saveLastSelectedLocation,
  getCurrentHomeLocation,
} from '../components/HomeLocationBar';
import { haversineDistanceMi, formatDistance } from '../lib/distance';

/**
 * Shared "where am I dining" location used by the Discover page hero
 * AND the sticky DesktopHeader search-bar chip. Lifting the state up
 * here so both surfaces can read + mutate the same value without one
 * leaking its useState into the other.
 *
 * The picker UI itself still lives in HomeLocationBar — this context
 * just owns the location value + the change handlers.
 */
export interface HomeLocationContextValue {
  location: HomeLocation | null;
  /** Subscribers can bump this nonce when the picker selects the same
   *  coords but a more specific label, etc. */
  setLocation: (loc: HomeLocation) => void;
  useCurrent: () => Promise<void>;
}

const HomeLocationContext = createContext<HomeLocationContextValue | null>(null);

export function HomeLocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<HomeLocation | null>(() => loadLastSelectedLocation());

  const setLocation = useCallback((loc: HomeLocation) => {
    setLocationState(loc);
    saveLastSelectedLocation(loc);
  }, []);

  const useCurrent = useCallback(async (): Promise<void> => {
    const loc = await getCurrentHomeLocation();
    setLocationState(loc);
    saveLastSelectedLocation(loc);
  }, []);

  // Reflect localStorage changes from other tabs so the chip stays in
  // sync without a hard reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'gourmad-home-last-location') return;
      const fresh = loadLastSelectedLocation();
      if (fresh) setLocationState(fresh);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <HomeLocationContext.Provider value={{ location, setLocation, useCurrent }}>
      {children}
    </HomeLocationContext.Provider>
  );
}

/** Returns null when outside the provider (e.g. an unauthenticated
 *  route) so callers can render conditionally without throwing. */
export function useHomeLocation(): HomeLocationContextValue | null {
  return useContext(HomeLocationContext);
}

/**
 * Formatted distance ("3.2 mi") from the user's home anchor to the given
 * coords, or '' when either end is unknown. Reads the anchor REACTIVELY
 * from this context — cards that used to call loadLastSelectedLocation()
 * inside a useMemo kept stale distances until remount when the user picked
 * a new home location. Falls back to the stored value outside the provider.
 */
export function useDistanceFromHome(lat?: number | null, lng?: number | null): string {
  const ctx = useHomeLocation();
  // Outside the provider there's nothing to subscribe to — read storage
  // once (non-reactive, same as the old behavior there).
  const fallback = useMemo(() => (ctx ? null : loadLastSelectedLocation()), [ctx]);
  const home = ctx ? ctx.location : fallback;
  return useMemo(() => {
    if (!home || !Number.isFinite(home.lat) || !Number.isFinite(home.lng)) return '';
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return '';
    return formatDistance(haversineDistanceMi(home.lat, home.lng, lat, lng));
  }, [home?.lat, home?.lng, lat, lng]);
}
