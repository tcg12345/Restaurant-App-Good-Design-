import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, MapPin, X, Loader2, Check, History, Building2, LocateFixed } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { MAPBOX_TOKEN } from '../lib/keys';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';
import { LocationPickerSurface } from './LocationPickerSurface';
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
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [recents, setRecents] = useState<HomeLocation[]>(() => loadRecentLocations());
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  /* Asked (never prompted for) each time the sheet opens, so a blocked
     permission is met with the way OUT of it rather than with a button
     that can only fail. 'unknown' stays optimistic — see
     geolocationPermission. */
  const [geoPerm, setGeoPerm] = useState<GeoPermission>('unknown');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSearchError(null);
    setResults([]);
    if (!open || !query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
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
          fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&types=place,locality,neighborhood,district${LANG}&limit=6`, { signal: controller.signal }),
          fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${MAPBOX_TOKEN}&types=address,postcode${LANG}&limit=4${proximity}`, { signal: controller.signal }),
        ]);
        if (!placeRes.ok || !addressRes.ok) throw new Error('Search unavailable');
        const [placeData, addressData] = await Promise.all([placeRes.json(), addressRes.json()]);
        const toItems = (data: any): HomeLocation[] =>
          (data.features || []).map((f: any) => ({
            label: f.place_name,
            lat: f.center[1],
            lng: f.center[0],
          }));
        if (cancelled) return;
        const items = [...toItems(placeData), ...toItems(addressData)];
        setResults(items.filter((item, index) => items.findIndex(other => sameLoc(item, other)) === index));
      } catch {
        if (!cancelled) { setResults([]); setSearchError('Location search is unavailable'); }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true; controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, query, location, searchAttempt]);

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
    [recents, onChange, setOpen],
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
  }, [onUseCurrent, setOpen]);

  const visibleRecents = recents.filter(recent => !location || !sameLoc(location, recent));

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

      {createPortal(<AnimatePresence>
        {open && <LocationPickerSurface phoneMode={phoneMode} sheetZ={sheetZ} query={query} onQueryChange={setQuery} onClose={() => setOpen(false)}>
          {!query.trim() && <>
            {location?.label && <div className="location-picker-current"><MapPin size={21} /><span><small>Browsing in</small><strong>{location.label}</strong></span><Check size={18} /></div>}
            {geoPerm === 'denied' ? <div className="location-picker-notice"><strong>Location access is off</strong><p>{canOpenAppSettings() ? 'Enable location in Settings, or choose a place below.' : 'Allow location in your browser, or choose a place below.'}</p>{canOpenAppSettings() && <button onClick={() => void openAppSettings()}>Open Settings</button>}</div>
              : <button className="location-picker-nearby" onClick={useCurrent} disabled={currentLoading}>{currentLoading ? <Loader2 size={21} className="animate-spin" /> : <LocateFixed size={21} />}<span><strong>{currentLoading ? 'Finding your location…' : 'Use current location'}</strong><small>Discover places around you</small></span><ChevronRight size={17} /></button>}
            {currentError && <p className="location-picker-notice" role="alert">{currentError}</p>}
          </>}
                {query.trim() ? (
                  searching && results.length === 0 ? (
                    <div className="flex items-center gap-2.5 px-5 py-4">
                      <Loader2 size={14} className="animate-spin text-on-surface/35" />
                      <span className="text-[13.5px] text-on-surface/45">Searching…</span>
                    </div>
                  ) : results.length === 0 ? (
                    <div className="px-5 py-10 text-center">
                      <p className="font-semibold text-[16px] text-on-surface">{searchError || 'No matching locations'}</p>
                      <p className="mt-1 text-[12.5px] text-on-surface/45">Try a city, neighborhood, or street address.</p>{searchError && <button className="text-primary p-3" onClick={() => setSearchAttempt(value => value + 1)}>Try again</button>}
                    </div>
                  ) : (
                    results.map((r, i) => (
                      <LocationRow key={`s-${r.label}-${i}`} location={r} onClick={() => select(r)} selected={!!location && sameLoc(location, r)} />
                    ))
                  )
                ) : (
                  <>
                    {visibleRecents.length > 0 && (
                      <>
                        <SectionLabel icon={<History size={12} />} action={<button onClick={clearRecents} className="text-[12.5px] font-bold text-primary active:opacity-70">Clear</button>}>
                          Recent
                        </SectionLabel>
                        {visibleRecents.map((r, i) => (
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
                    {/* The selected location appears only in the current-location card. */}
                    {POPULAR_CITIES.filter((c) => !(location && sameLoc(location, c))).map((c) => (
                      <LocationRow key={c.label} location={c} onClick={() => select(c)} />
                    ))}
                  </>
                )}
        </LocationPickerSurface>}
      </AnimatePresence>, document.body)}
    </>
  );
};

/** The city out of a full label — "New York" from "New York, NY". */
const primaryOf = (label?: string): string =>
  (label || '').split(',')[0]?.trim() || label || '';

/** A section caption with an optional icon and trailing action. Space and
 *  small caps do the separating — no tinted band, no double hairline. */
const SectionLabel: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; action?: React.ReactNode }> = ({ children, icon, action }) => (
  <div className="location-picker-section">
    <p>
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
