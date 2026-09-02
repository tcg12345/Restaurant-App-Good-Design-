import React, { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getCurrentHomeLocation } from '../components/HomeLocationBar';
import {
  type HomeLocation,
  type StartupSource,
  loadLastSelectedLocation,
  loadPickedLocation,
  saveLastSelectedLocation,
  savePickedLocation,
  subscribeHomeLocation,
  geolocationAllowed,
  resolveStartupLocation,
  sameHomeLocation,
} from '../lib/home-location-store';
import { haversineDistanceMi, formatDistance } from '../lib/distance';

/**
 * The one "where am I dining" location — the home feed's hero, the map's
 * camera, the search takeover's chip and every distance label read it, and
 * any of them can move it. Changing the city on the home page moves the map;
 * picking one on the map moves the home page.
 *
 * The picker UI itself still lives in HomeLocationBar — this context owns
 * the value, the launch-time resolution, and the change handlers.
 */
export interface HomeLocationContextValue {
  location: HomeLocation | null;
  /** How the current value was arrived at this launch: 'resolving' until the
   *  device check settles, then the winning source. 'none' means we have
   *  nothing at all and the value below is a placeholder — the home feed
   *  uses that as its cue to ask. */
  status: 'resolving' | StartupSource;
  /** Subscribers can bump this nonce when the picker selects the same
   *  coords but a more specific label, etc. */
  setLocation: (loc: HomeLocation) => void;
  /** Set the location for this session WITHOUT writing it to storage.
   *  For guesses the app made on the user's behalf — a denied-permission
   *  fallback is not a choice, and persisting it makes the guess
   *  permanent. */
  setLocationTransient: (loc: HomeLocation) => void;
  /** Seed this device from the signed-in profile's home city when local
   *  storage has nothing. No-op when a local pick already exists. */
  hydrateFromProfile: (city: string, lat?: number | null, lng?: number | null) => void;
  useCurrent: () => Promise<void>;
}

const HomeLocationContext = createContext<HomeLocationContextValue | null>(null);

/** Last resort, and deliberately never persisted: a placeholder city is not
 *  something the user chose, and writing it would pin them to it. */
const PLACEHOLDER: HomeLocation = { label: 'New York, NY', lat: 40.7128, lng: -74.006 };

export function HomeLocationProvider({ children }: { children: React.ReactNode }) {
  const [location, setLocationState] = useState<HomeLocation | null>(() => loadLastSelectedLocation());
  const [status, setStatus] = useState<'resolving' | StartupSource>('resolving');
  // Set the moment anything user-driven moves the anchor, so the launch
  // resolver — which can be seconds away, waiting on a GPS fix — can tell
  // that its answer is already stale and drop it rather than yanking the
  // user back out of the city they just picked.
  const movedByUserRef = useRef(false);

  const setLocation = useCallback((loc: HomeLocation) => {
    movedByUserRef.current = true;
    setStatus('picked');
    setLocationState(loc);
    savePickedLocation(loc);
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
    // Anything at all on this device — a pick, or an anchor a device fix
    // already landed — beats the profile row.
    if (loadPickedLocation()) return;
    if (!city || typeof lat !== 'number' || typeof lng !== 'number') return;
    const loc = { label: city, lat, lng };
    setStatus('picked');
    setLocationState(loc);
    savePickedLocation(loc);
  }, []);

  const useCurrent = useCallback(async (): Promise<void> => {
    const loc = await getCurrentHomeLocation();
    movedByUserRef.current = true;
    setStatus('device');
    setLocationState(loc);
    // Asking for it explicitly IS the choice — remember it, so a later
    // launch without permission comes back here rather than to a city they
    // last typed months ago.
    savePickedLocation(loc);
  }, []);

  /**
   * Where the app opens.
   *
   * Every launch starts on the device's location when location is allowed —
   * that's what opening a restaurant app means. When it isn't (denied, never
   * answered, or the fix failed) the last location the user chose takes
   * over, which for a new account is the city they gave during onboarding.
   *
   * This never surfaces the permission dialog: `geolocationAllowed` only
   * says yes to an existing grant. Launch is not a moment where that dialog
   * explains itself, and on iOS it is one-shot — a reflexive "Don't Allow"
   * on a splash screen can't be taken back from inside the app. The home
   * feed asks instead, where the ask has a visible reason (see Discover).
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const allowed = await geolocationAllowed();
      // `cityOnly` here, unlike the picker's explicit "use my current
      // location": this fix is one the app took on its own, and the header
      // reading "1400 E 6th St" because that is where the phone happened to
      // be unlocked is noise. The coordinates are still exact, so distances
      // and nearby results are measured from the real position.
      const device = allowed ? await getCurrentHomeLocation({ cityOnly: true }).catch(() => null) : null;
      if (cancelled || movedByUserRef.current) return;
      const picked = loadPickedLocation();
      const { location: next, source } = resolveStartupLocation({
        allowed,
        device,
        picked,
        anchor: loadLastSelectedLocation(),
      });
      setStatus(source);
      if (!next) {
        setLocationState(PLACEHOLDER);
        return;
      }
      setLocationState(next);
      // Publish to the anchor key so every surface that reads storage
      // directly (the map's initial camera, the recs browser, universal
      // search) agrees with what's on screen. Skipped when it already does —
      // an identical write would still wake every subscriber.
      if (!sameHomeLocation(next, loadLastSelectedLocation())) saveLastSelectedLocation(next);
    })();
    return () => { cancelled = true; };
  }, []);

  // Any writer, anywhere: the picker sheet, the map's location chip, the
  // explore page. A same-tab localStorage write fires no `storage` event, so
  // without this the surfaces that persist directly left this value stale.
  useEffect(() => subscribeHomeLocation((loc) => setLocationState(loc)), []);

  // Reflect localStorage changes from other tabs so the chip stays in
  // sync without a hard reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'goodeats-home-last-location') return;
      const fresh = loadLastSelectedLocation();
      if (fresh) setLocationState(fresh);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo(
    () => ({ location, status, setLocation, setLocationTransient, hydrateFromProfile, useCurrent }),
    [location, status, setLocation, setLocationTransient, hydrateFromProfile, useCurrent],
  );

  return <HomeLocationContext.Provider value={value}>{children}</HomeLocationContext.Provider>;
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
