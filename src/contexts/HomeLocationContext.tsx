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
  /** Set the location for this session WITHOUT writing it to storage.
   *  For guesses the app made on the user's behalf — a denied-permission
   *  fallback is not a choice, and persisting it makes the guess
   *  permanent, since the resolver skips GPS whenever a location exists. */
  setLocationTransient: (loc: HomeLocation) => void;
  /** Seed this device from the signed-in profile's home city when local
   *  storage has nothing. No-op when a local pick already exists. */
  hydrateFromProfile: (city: string, lat?: number | null, lng?: number | null) => void;
  useCurrent: () => Promise<void>;
}

const HomeLocationContext = createContext<HomeLocationContextValue | null>(null);

export function HomeLocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<HomeLocation | null>(() => loadLastSelectedLocation());

  const setLocation = useCallback((loc: HomeLocation) => {
    setLocationState(loc);
    saveLastSelectedLocation(loc);
  }, []);

  const setLocationTransient = useCallback((loc: HomeLocation) => {
    setLocationState(loc);
  }, []);

  /**
   * Backstop for reinstalls and second devices: the profile knows the
   * user's home city (they gave it during signup) but this device's
   * localStorage is empty, and nothing else ever reads those columns back.
   * Without this, a returning user on a new phone gets the GPS prompt and,
   * on denial, New York — while their real city sits in the database.
   */
  const hydrateFromProfile = useCallback((city: string, lat?: number | null, lng?: number | null) => {
    if (loadLastSelectedLocation()) return;
    if (!city || typeof lat !== 'number' || typeof lng !== 'number') return;
    const loc = { label: city, lat, lng };
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
    <HomeLocationContext.Provider value={{ location, setLocation, setLocationTransient, hydrateFromProfile, useCurrent }}>
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
