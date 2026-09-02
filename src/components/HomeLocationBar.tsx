import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, MapPin, MapPinOff, X, Navigation, Loader2, Check, History, Building2, LocateFixed } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MAPBOX_TOKEN } from '../lib/keys';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { cn } from '../lib/utils';
import { SearchField } from './SearchField';
import { GlassButton } from '../lib/glass-buttons';
import {
  type HomeLocation,
  type GeoPermission,
  savePickedLocation,
  noteGeolocationGranted,
  noteGeolocationDenied,
  geolocationPermission,
} from '../lib/home-location-store';
import { canOpenAppSettings, openAppSettings } from '../lib/native-settings';

// The anchor itself lives in lib/home-location-store — one store, read by
// the home feed, the map, search and every distance label. Re-exported here
// because this file was its original home and half the app imports it by
// this path.
export type { HomeLocation };
export {
  loadLastSelectedLocation,
  saveLastSelectedLocation,
  loadPickedLocation,
  savePickedLocation,
  subscribeHomeLocation,
  geolocationAllowed,
  resolveStartupLocation,
  sameHomeLocation,
} from '../lib/home-location-store';

const RECENT_KEY = 'goodeats-home-recent-locations';
const MAX_RECENTS = 8;

// Small curated seed so the picker has content before the user has searched
// anything. Coords are each city's commercial centre — good enough to anchor
// nearby / text queries.
const POPULAR_CITIES: HomeLocation[] = [
  { label: 'New York, NY', lat: 40.7128, lng: -74.006 },
  { label: 'Los Angeles, CA', lat: 34.0522, lng: -118.2437 },
  { label: 'San Francisco, CA', lat: 37.7749, lng: -122.4194 },
  { label: 'Chicago, IL', lat: 41.8781, lng: -87.6298 },
  { label: 'Miami, FL', lat: 25.7617, lng: -80.1918 },
  { label: 'Austin, TX', lat: 30.2672, lng: -97.7431 },
  { label: 'Seattle, WA', lat: 47.6062, lng: -122.3321 },
  { label: 'New Orleans, LA', lat: 29.9511, lng: -90.0715 },
];

function sameLoc(a: HomeLocation, b: HomeLocation): boolean {
  return Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lng - b.lng) < 1e-4;
}

export function loadRecentLocations(): HomeLocation[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function saveRecentLocations(recents: HomeLocation[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, MAX_RECENTS)));
  } catch {}
}

// True when the saved location looks like a street address rather than a
// city / neighborhood / POI. Mapbox address features (and our reverse-geocode
// output) always start with the house number, so a leading digit is a robust
// proxy. Used to gate distance UI that only makes sense from a precise origin.
export function isExactAddress(loc: HomeLocation | null | undefined): boolean {
  if (!loc) return false;
  return /^\s*\d/.test(loc.label || '');
}

/**
 * Forward-geocode a free-text city/place query into a canonical
 * { label, lat, lng } HomeLocation. Returns null when nothing matches
 * or Mapbox is unreachable. Used outside the picker (profile editing,
 * onboarding) to resolve a typed home-city string to coords without
 * needing the user to drive the bottom-sheet picker.
 */
export async function geocodePlace(query: string): Promise<HomeLocation | null> {
  const q = query.trim();
  if (!q) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,district,neighborhood&language=en&limit=1`,
    );
    const data = await res.json();
    const f = data.features?.[0];
    if (!f || !Array.isArray(f.center) || f.center.length < 2) return null;
    return { label: f.place_name as string, lat: f.center[1] as number, lng: f.center[0] as number };
  } catch {
    return null;
  }
}

/**
 * Mapbox forward-geocoding suggestions for an autocomplete input. Returns
 * up to 6 results spanning neighborhoods → cities → regions → countries
 * so the user can pin a post to either a precise spot ("West Village,
 * Manhattan") or a broader scope ("Italy"). All entries carry lat/lng so
 * downstream code can store coordinates if it wants to.
 */
export async function searchLocations(query: string): Promise<HomeLocation[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,district,neighborhood,region,country&language=en&limit=6&autocomplete=true`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const features: any[] = Array.isArray(data.features) ? data.features : [];
    return features
      .filter((f) => Array.isArray(f.center) && f.center.length >= 2)
      .map((f) => ({
        label: (f.place_name as string) || (f.text as string) || '',
        lat: f.center[1] as number,
        lng: f.center[0] as number,
      }))
      .filter((l) => l.label);
  } catch {
    return [];
  }
}

/**
 * City-only autocomplete suggestions. Like {@link searchLocations} but limited
 * to cities / towns (Mapbox `place`, `locality`) so a "which city is this for?"
 * field doesn't surface neighborhoods, regions or countries. Each result also
 * carries `cityName` — just the city token, no region/country suffix — for
 * callers that want to store a clean city name.
 */
export async function searchCities(
  query: string,
): Promise<Array<HomeLocation & { cityName: string }>> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&types=place,locality&language=en&limit=6&autocomplete=true`,
    );
    if (!res.ok) return [];
    const data = await res.json();
    const features: any[] = Array.isArray(data.features) ? data.features : [];
    return features
      .filter((f) => Array.isArray(f.center) && f.center.length >= 2)
      .map((f) => {
        const label = (f.place_name as string) || (f.text as string) || '';
        const cityName = ((f.text as string) || label.split(',')[0] || '').trim();
        return { label, cityName, lat: f.center[1] as number, lng: f.center[0] as number };
      })
      .filter((l) => l.label && l.cityName);
  } catch {
    return [];
  }
}

/**
 * Resolve the device's current location to a HomeLocation (lat/lng + address
 * label). Used by every "Use current location" entry point in the app.
 *
 * Why this is more than a thin wrapper around `getCurrentPosition`:
 *
 *  - On iOS WKWebView (Capacitor), the native geolocation bridge can hang
 *    silently if `NSLocationWhenInUseUsageDescription` is missing from
 *    Info.plist, or if the user has the permission set to "Ask Next Time"
 *    but the prompt never surfaces. The browser-level `timeout` option is
 *    not always honoured in that path, so we race the call against an
 *    explicit JS-side deadline that always fires.
 *  - We start with `enableHighAccuracy: false` (network/Wi-Fi positioning,
 *    typically <50 m on a phone and resolves in ~1–3 s). That's plenty for
 *    Mapbox to reverse-geocode to the right street address and it avoids
 *    the cold-GPS wait that was making the picker sit on "Locating…"
 *    indefinitely indoors.
 */
export async function getCurrentHomeLocation(opts?: { cityOnly?: boolean }): Promise<HomeLocation> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    throw Object.assign(new Error('Geolocation is not available in this browser.'), { code: 2 });
  }
  const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
    let settled = false;
    const safety = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(Object.assign(new Error('Location request timed out.'), { code: 3 }));
    }, 12000);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        // A fix arrived, so permission exists. Remembered for the launch-time
        // resolver on runtimes whose Permissions API can't answer that.
        noteGeolocationGranted();
        resolve(p);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        // 1 = permission denied. Only that clears the flag — a timeout or a
        // failed fix indoors says nothing about permission.
        if (err?.code === 1) noteGeolocationDenied();
        reject(err);
      },
      {
        maximumAge: 5 * 60 * 1000,
        timeout: 10000,
        enableHighAccuracy: false,
      },
    );
  });
  const { latitude: lat, longitude: lng } = pos.coords;
  const label = await reverseGeocode(lat, lng, opts);
  return { label, lat, lng };
}

// Reverse-geocode a coordinate into a street-address label
// ("123 Main St, San Francisco, CA") using Mapbox. Falls back to the
// city/locality label if no address feature is returned, and to
// "Current location" if the geocoder is unreachable.
//
// `cityOnly` skips the address lookup entirely and goes straight to the
// city/locality fallback below — for callers asking "which city do you
// live in", a street number is noise, not precision.
export async function reverseGeocode(lat: number, lng: number, opts?: { cityOnly?: boolean }): Promise<string> {
  try {
    const addrRes = opts?.cityOnly ? null : await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address&language=en&limit=1`,
    );
    const addrData = addrRes ? await addrRes.json() : null;
    const a = addrData?.features?.[0];
    if (a) {
      // Mapbox splits an address into `address` (house number) and `text`
      // (street name). Combine them, then synthesise "{street}, {city},
      // {region}" from the context array so the label stays compact.
      const houseNumber = (a.address || '').toString().trim();
      const streetName = (a.text || '').toString().trim();
      const street = [houseNumber, streetName].filter(Boolean).join(' ').trim();
      const place = (a.context || []).find((c: any) => c.id?.startsWith('place') || c.id?.startsWith('locality'));
      const region = (a.context || []).find((c: any) => c.id?.startsWith('region'));
      const city = place?.text;
      const regionCode = region?.short_code?.split('-')?.[1] || region?.text;
      if (street && city && regionCode) return `${street}, ${city}, ${regionCode}`;
      if (street && city) return `${street}, ${city}`;
      if (street) return street;
      if (a.place_name) return a.place_name;
    }
    // No street match — fall back to the city/locality label.
    const cityRes = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=place,locality&language=en&limit=1`,
    );
    const cityData = await cityRes.json();
    const f = cityData.features?.[0];
    if (!f) return 'Current location';
    const city = f.text;
    const region = (f.context || []).find((c: any) => c.id?.startsWith('region'));
    const regionCode = region?.short_code?.split('-')?.[1] || region?.text;
    if (city && regionCode) return `${city}, ${regionCode}`;
    return f.place_name || city || 'Current location';
  } catch {
    return 'Current location';
  }
}

interface Props {
  location: HomeLocation | null;
  onChange: (loc: HomeLocation) => void;
  // Returns a Promise so the picker can show a spinner and surface an error
  // if the browser denies or can't resolve a fix.
  onUseCurrent: () => Promise<void>;
  // Visual treatment of the trigger button. 'block' keeps the original
  // stacked "DINING IN / Serif label / chevron" used on phone home; 'chip'
  // renders a compact inline pill the new Discover hero composes alongside
  // a "View all" link. 'headless' renders no trigger at all — used when a
  // parent (like the redesigned LocationPage hero) supplies its own button
  // and drives the sheet via the controlled `open` / `onOpenChange` props.
  variant?: 'block' | 'chip' | 'headless';
  // Optional controlled open state. When supplied, the parent owns the
  // sheet's open/closed state; the internal `open` useState falls back to
  // these. Used by LocationPage's "Change" pill to open the picker without
  // rendering the default trigger button.
  open?: boolean;
  onOpenChange?: (next: boolean) => void;
  /**
   * Stacking layer for the portaled sheet. The default sits above ordinary
   * page chrome, which is right almost everywhere — the picker's host is
   * usually at the same level and later in DOM order, so it wins on order.
   *
   * A host on its OWN raised layer has to say so: the sheet portals to the
   * phone-frame root, so a `z-[215]` caller would otherwise open this
   * picker underneath itself and look like a dead button.
   */
  sheetZ?: string;
}

export const HomeLocationBar: React.FC<Props> = ({ location, onChange, onUseCurrent, variant = 'block', open: openProp, onOpenChange, sheetZ = 'z-50' }) => {
  const { setHideBottomNav, phoneMode } = useSettings();
  const [openInternal, setOpenInternal] = useState(false);
  const open = openProp !== undefined ? openProp : openInternal;
  const setOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    // Resolve against the current (merged) open value, then fire both state
    // updates directly. Calling onOpenChange *inside* the setOpenInternal
    // updater warned "Cannot update a component while rendering a different
    // component" when a parent owns the open state (controlled mode).
    const value = typeof next === 'function' ? (next as (p: boolean) => boolean)(open) : next;
    setOpenInternal(value);
    if (onOpenChange) onOpenChange(value);
  }, [onOpenChange, open]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HomeLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<HomeLocation[]>(() => loadRecentLocations());
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  /* Asked (never prompted for) each time the sheet opens, so a blocked
     permission is met with the way OUT of it rather than with a button
     that can only fail. 'unknown' stays optimistic — see
     geolocationPermission. */
  const [geoPerm, setGeoPerm] = useState<GeoPermission>('unknown');
  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, () => setOpen(false), sheetScrollRef);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Hide the floating bottom nav while the picker is open so it doesn't
  // overlap the sheet content.
  useEffect(() => {
    setHideBottomNav(open);
    return () => setHideBottomNav(false);
  }, [open, setHideBottomNav]);

  useEffect(() => {
    if (!open) return;
    // Refresh recents from storage every time the sheet opens so external
    // writes (another tab, etc.) are reflected.
    setRecents(loadRecentLocations());
    let cancelled = false;
    void geolocationPermission().then((p) => { if (!cancelled) setGeoPerm(p); });
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => { cancelled = true; clearTimeout(t); };
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        // Two calls, not one — Mapbox's `proximity` re-ranks the WHOLE
        // response toward the anchor point, and this field has to serve two
        // different intents at once: "change my browsing city" (global reach
        // — searching "Tokyo" while anchored in New York must still find
        // Tokyo, Japan, not a street called Tokyo Crescent three towns over)
        // and "find this address" (local — "Main St" should mean the nearby
        // Main St, not one across the country). One proximity-biased query
        // can't be right for both: it was making city search actively worse,
        // burying the real city under nearer but far-less-relevant address
        // matches and sometimes dropping it from the result page entirely.
        // So: place/locality/neighborhood/district run unbiased (global,
        // ranked on text relevance alone), address/postcode keep the
        // proximity bias (still local by nature). Cities are listed first —
        // typing a city name is what this field is for; a precise address is
        // the secondary case.
        const encoded = encodeURIComponent(query);
        // English labels regardless of the place's own local language —
        // this app has no i18n, every other string in it is English, so a
        // Japanese/Cyrillic/etc. result label would be the one inconsistent
        // thing on the screen.
        const LANG = '&language=en';
        const proximity = location ? `&proximity=${location.lng},${location.lat}` : '';
        const [placeRes, addressRes] = await Promise.all([
          fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,neighborhood,district${LANG}&limit=6`),
          fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&types=address,postcode${LANG}&limit=4${proximity}`),
        ]);
        const [placeData, addressData] = await Promise.all([placeRes.json(), addressRes.json()]);
        const toItems = (data: any): HomeLocation[] =>
          (data.features || []).map((f: any) => ({
            label: f.place_name,
            lat: f.center[1],
            lng: f.center[0],
          }));
        setResults([...toItems(placeData), ...toItems(addressData)]);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, location]);

  const select = useCallback(
    (loc: HomeLocation) => {
      const nextRecents = [loc, ...recents.filter((r) => !sameLoc(r, loc))].slice(0, MAX_RECENTS);
      setRecents(nextRecents);
      saveRecentLocations(nextRecents);
      // A pick, not a guess: it anchors the app now AND becomes the place the
      // next launch returns to when the device's location isn't available.
      // The store broadcasts it, so surfaces this picker knows nothing about
      // (the map, the search chip) follow without a remount.
      savePickedLocation(loc);
      onChange(loc);
      setOpen(false);
      setQuery('');
      setResults([]);
    },
    [recents, onChange],
  );

  const removeRecent = useCallback(
    (loc: HomeLocation) => {
      const nextRecents = recents.filter((r) => !sameLoc(r, loc));
      setRecents(nextRecents);
      saveRecentLocations(nextRecents);
    },
    [recents],
  );

  const clearRecents = useCallback(() => {
    setRecents([]);
    saveRecentLocations([]);
  }, []);

  const useCurrent = useCallback(async () => {
    setCurrentError(null);
    setCurrentLoading(true);
    try {
      await onUseCurrent();
      setOpen(false);
    } catch (err: any) {
      // GeolocationPositionError codes: 1 = permission denied, 2 = unavailable,
      // 3 = timeout. Surface something human instead of failing silently.
      if (err?.code === 1) {
        // Not an error message but a state: the row below becomes the
        // route to Settings, which is the only place this can be undone.
        setGeoPerm('denied');
      } else if (err?.code === 2) {
        setCurrentError("Couldn't determine your location. Try picking a city below.");
      } else if (err?.code === 3) {
        setCurrentError('Getting your location timed out. Try again or pick a city below.');
      } else {
        setCurrentError(err?.message || 'Unable to get your current location.');
      }
    } finally {
      setCurrentLoading(false);
    }
  }, [onUseCurrent]);

  // Show up to three label chunks so a reverse-geocoded street address
  // ("123 Main St, San Francisco, CA") fits without losing the state.
  // For shorter labels (popular cities, etc.) the slice is a no-op.
  const shortLabel = location?.label?.split(',').slice(0, 3).join(',').trim() || 'Select a location';

  return (
    <>
      {variant === 'headless' ? null : variant === 'chip' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/[0.09] border border-on-surface/[0.06] text-left group transition-colors max-w-full min-w-0"
          aria-label="Change location"
        >
          <MapPin size={14} className="text-on-surface/55 flex-shrink-0" />
          <span className="font-serif font-bold text-[15px] leading-none text-on-surface truncate">
            {shortLabel}
          </span>
          <ChevronDown size={14} className="text-on-surface/45 flex-shrink-0" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-start gap-1.5 group text-left max-w-full min-w-0"
          aria-label="Change location"
        >
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40 leading-none">
              Dining in
            </p>
            {/* Long addresses (e.g. "21 High Point Road, Staples, CT") used to
                truncate off the edge on narrow phones. We now let them wrap
                across 2–3 lines; `break-words` handles the rare extra-long
                single token, and the parent's max-width cap on phone mode
                (see Map.tsx) is what actually triggers the wrap point. */}
            <p className="mt-1 font-serif font-bold text-lg sm:text-xl leading-tight text-on-surface group-hover:text-primary transition-colors break-words">
              {shortLabel}
            </p>
          </div>
          <ChevronDown size={16} className="text-on-surface/50 mt-4 flex-shrink-0" />
        </button>
      )}

      {/* Picker sheet is rendered through a portal so its
          `position: fixed` is relative to the viewport — when this
          component is mounted inside the sticky DesktopHeader (which
          uses backdrop-blur, creating a containing block), the sheet
          would otherwise get trapped inside the topbar's height.
          In phone-frame preview mode (desktop with phoneMode on) we
          target the phone-frame container so the sheet stays inside
          the simulated device rather than spanning the full desktop. */}
      {createPortal(
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={cn(
                'fixed inset-0',
                sheetZ,
                phoneMode
                  ? 'bg-black/30 backdrop-blur-sm'
                  : 'bg-black/45 backdrop-blur-md flex items-start justify-center pt-[9vh] px-5',
              )}
              onClick={() => setOpen(false)}
            />
            <motion.div
              ref={phoneMode ? (sheetRef as React.RefObject<HTMLDivElement>) : undefined}
              {...(phoneMode
                ? {
                    initial: { y: '100%' },
                    animate: { y: 0 },
                    exit: { y: '100%' },
                    transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const },
                    ...dragProps,
                  }
                : {
                    initial: { opacity: 0, scale: 0.96, y: -8 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    exit: { opacity: 0, scale: 0.97, y: -4 },
                    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                  })}
              onClick={(e: React.MouseEvent) => { if (!phoneMode) e.stopPropagation(); }}
              className={cn(
                'bg-surface flex flex-col overflow-hidden',
                sheetZ,
                phoneMode
                  // A FIXED height, not max-h. Sizing to content meant the
                  // sheet resized under the finger the moment you typed —
                  // eight popular cities collapsing to two matches yanked
                  // the whole surface (and the field you were typing in)
                  // down the screen. A picker that changes size while you
                  // use it is worse than one with room to spare at the
                  // bottom, so the height is settled once, on open.
                  ? 'fixed bottom-0 left-0 right-0 rounded-t-[28px] h-[88vh] shadow-[0_-16px_48px_rgba(0,0,0,0.35)]'
                  // Spotlight-style centered card. Position fixed with
                  // explicit centering rather than wrapping in a flex
                  // container so the backdrop above stays clickable to
                  // dismiss.
                  : 'fixed left-1/2 -translate-x-1/2 top-[9vh] w-full max-w-2xl max-h-[82vh] rounded-3xl shadow-[0_30px_80px_-16px_rgba(28,24,22,0.42)] ring-1 ring-on-surface/[0.06]',
              )}
            >
              {phoneMode && (
                <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
                  <div className="h-[5px] w-10 rounded-full bg-on-surface/20" />
                </div>
              )}
              {/* A plain title. The old header led with WHERE YOU ARE at
                  headline size, then repeated it in Recent and again in
                  Popular with checkmarks — three copies of the answer before
                  the question. The current place now has exactly one home,
                  the "Browsing now" row under the search. */}
              <div className="flex items-center justify-between gap-3 px-5 pt-1.5 pb-3.5 flex-shrink-0">
                <h3 className="font-serif font-bold text-[22px] leading-tight tracking-[-0.02em] text-on-surface">
                  Where to?
                </h3>
                <GlassButton
                  id="location-picker-close"
                  symbol="xmark"
                  label="Close"
                  onClick={() => setOpen(false)}
                  className="hit-44 flex-none w-9 h-9 rounded-full flex items-center justify-center text-on-surface/70 active:scale-95 transition-transform"
                >
                  <X size={16} />
                </GlassButton>
              </div>

              <div className="px-5 pb-4 flex-shrink-0">
                <SearchField
                  glassId="location-picker-search"
                  inputRef={inputRef}
                  value={query}
                  onChange={setQuery}
                  placeholder="Search city, neighborhood, or address"
                  aria-label="Search locations"
                />
              </div>

              {/* Pinned under the search: the one place that is the answer
                  right now, and the one-tap way to change it. One grouped
                  card — the same row language as the chat's Find-a-place
                  sheet that opens this picker, so the two read as a family. */}
              {!query.trim() && (
                <div className="flex-shrink-0 px-5 pb-4">
                  <div className="overflow-hidden rounded-[22px] bg-on-surface/[0.04]">
                    {location?.label && (
                      <>
                        <div className="flex items-center gap-3.5 px-4 py-3.5">
                          <span className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-primary text-on-primary shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                            <MapPin size={17} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-bold uppercase tracking-[0.12em] text-primary">Browsing now</span>
                            <span className="mt-[2px] block truncate text-[15px] font-semibold text-on-surface">{primaryOf(location.label)}</span>
                            {location.label.includes(',') && (
                              <span className="block truncate text-[12.5px] text-on-surface/50">
                                {location.label.split(',').map((x) => x.trim()).filter(Boolean).slice(1).join(', ')}
                              </span>
                            )}
                          </span>
                          <Check size={18} strokeWidth={2.6} className="flex-none text-primary" />
                        </div>
                        <div className="mx-4 h-px bg-on-surface/[0.07]" />
                      </>
                    )}

                    {geoPerm === 'denied' ? (
                      /* Denied is a dead end unless the app points out of it:
                         iOS grants one dialog per permission, so "Use my
                         current location" can only fail from here. The row
                         becomes the way back instead — the same Settings
                         deep link the photo and contacts primers use. */
                      <div className="flex items-start gap-3.5 px-4 py-3.5">
                        <span className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-surface text-on-surface/45 shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                          <MapPinOff size={17} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <span className="block text-[15px] font-semibold text-on-surface">Location is off for GoodEats</span>
                          <span className="mt-[2px] block text-[12.5px] leading-snug text-on-surface/50">
                            {canOpenAppSettings()
                              ? 'Turn it on in Settings to see places around you — or pick a city below.'
                              : 'Allow location for this site in your browser, or pick a city below.'}
                          </span>
                          {canOpenAppSettings() && (
                            <button
                              type="button"
                              onClick={() => { void openAppSettings(); }}
                              className="mt-2.5 inline-flex h-9 items-center rounded-full bg-primary px-4 text-[12.5px] font-bold text-on-primary active:opacity-80 transition-opacity"
                            >
                              Open Settings
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={useCurrent}
                          disabled={currentLoading}
                          className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors active:bg-on-surface/[0.04] disabled:opacity-60"
                        >
                          <span className="grid h-10 w-10 flex-none place-items-center rounded-[14px] bg-surface text-primary shadow-[0_1px_2px_rgba(0,0,0,0.12)]">
                            {currentLoading
                              ? <Loader2 size={17} className="animate-spin" />
                              : <LocateFixed size={17} />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block text-[15px] font-semibold text-on-surface">
                              {currentLoading ? 'Locating…' : 'Use my current location'}
                            </span>
                            <span className="mt-[2px] block text-[12.5px] text-on-surface/50">Places around you right now</span>
                          </span>
                          <ChevronRight size={16} className="flex-none text-on-surface/30" />
                        </button>
                        {currentError && (
                          <p className="px-4 pb-3 text-[12px] leading-snug text-red-600">{currentError}</p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Lists run edge to edge under the card, separated by space
                  and small-caps captions rather than tinted bands and double
                  hairlines. */}
              <div ref={sheetScrollRef} className="flex-1 min-h-0 overflow-y-auto pb-safe-5">
                {query.trim() ? (
                  searching && results.length === 0 ? (
                    <div className="flex items-center gap-2.5 px-5 py-4">
                      <Loader2 size={14} className="animate-spin text-on-surface/35" />
                      <span className="text-[13.5px] text-on-surface/45">Searching…</span>
                    </div>
                  ) : results.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                      <p className="font-serif font-bold text-[16px] tracking-[-0.02em] text-on-surface">No matches</p>
                      <p className="mt-1 text-[12.5px] text-on-surface/45">Try a city, neighborhood, or street address.</p>
                    </div>
                  ) : (
                    results.map((r, i) => (
                      <LocationRow key={`s-${r.label}-${i}`} location={r} onClick={() => select(r)} selected={!!location && sameLoc(location, r)} />
                    ))
                  )
                ) : (
                  <>
                    {recents.length > 0 && (
                      <>
                        <SectionLabel icon={<History size={12} />} action={<button onClick={clearRecents} className="text-[12.5px] font-bold text-primary active:opacity-70">Clear</button>}>
                          Recent
                        </SectionLabel>
                        {recents.map((r, i) => (
                          <LocationRow
                            key={`r-${r.label}-${i}`}
                            location={r}
                            onClick={() => select(r)}
                            onDelete={() => removeRecent(r)}
                            selected={!!location && sameLoc(location, r)}
                          />
                        ))}
                      </>
                    )}

                    <SectionLabel icon={<Building2 size={12} />}>Popular cities</SectionLabel>
                    {/* The current place already has its home in the card
                        above; listing it again here with a second check was
                        the old sheet's third copy of the same answer. Recent
                        keeps it — that list is history, not a menu. */}
                    {POPULAR_CITIES.filter((c) => !(location && sameLoc(location, c))).map((c) => (
                      <LocationRow key={c.label} location={c} onClick={() => select(c)} />
                    ))}
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>,
      document.getElementById('phone-frame-root') ?? document.body,
      )}
    </>
  );
};

/** The city out of a full label — "New York" from "New York, NY". */
const primaryOf = (label?: string): string =>
  (label || '').split(',')[0]?.trim() || label || '';

/** A section caption with an optional icon and trailing action. Space and
 *  small caps do the separating — no tinted band, no double hairline. */
const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }> = ({ children, icon, action }) => (
  <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-1.5">
    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/40">
      {icon}
      {children}
    </p>
    {action}
  </div>
);

const LocationRow: React.FC<{
  location: HomeLocation;
  onClick: () => void;
  onDelete?: () => void;
  selected?: boolean;
}> = ({ location, onClick, onDelete, selected }) => {
  // "New York" over "NY" — city first, the rest as a quiet second line.
  const primary = primaryOf(location.label);
  const secondary = location.label.split(',').map((s) => s.trim()).filter(Boolean).slice(1).join(', ');
  return (
    // A single row voice — sans, one weight — so the list reads as a list
    // and the pinned card above it reads as the thing that matters. The
    // current place is marked once, with a check, not a row-wide tint.
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-3.5 px-5 py-3 text-left transition-colors active:bg-on-surface/[0.04]"
      >
        <span className={cn(
          'grid h-9 w-9 flex-none place-items-center rounded-full',
          selected ? 'bg-primary/[0.12] text-primary' : 'bg-on-surface/[0.05] text-on-surface/55',
        )}>
          {/* One glyph for every row. isExactAddress is a leading-digit
              proxy that reads "16th arrondissement" as a street address —
              fine for gating distance UI, wrong as an icon rule. */}
          <MapPin size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('block truncate text-[15px] font-semibold leading-tight', selected ? 'text-primary' : 'text-on-surface')}>{primary}</span>
          {secondary && <span className="mt-[2px] block truncate text-[12.5px] text-on-surface/50">{secondary}</span>}
        </span>
        {selected && <Check size={17} strokeWidth={2.6} className="flex-none text-primary" />}
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="mr-2 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface/30 transition-colors active:bg-on-surface/[0.06] active:text-on-surface/70"
          aria-label={`Remove ${primary}`}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
};
