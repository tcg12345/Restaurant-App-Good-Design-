import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Search, MapPin, X, Navigation, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MAPBOX_TOKEN } from '../pages/useRestaurantDetail';
import { useSettings } from '../contexts/SettingsContext';

export type HomeLocation = { label: string; lat: number; lng: number };

const RECENT_KEY = 'gourmad-home-recent-locations';
const LAST_SELECTED_KEY = 'gourmad-home-last-location';
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

export function loadLastSelectedLocation(): HomeLocation | null {
  try {
    const raw = localStorage.getItem(LAST_SELECTED_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

export function saveLastSelectedLocation(loc: HomeLocation) {
  try {
    localStorage.setItem(LAST_SELECTED_KEY, JSON.stringify(loc));
  } catch {}
}

// Reverse-geocode a coordinate into a street-address label
// ("123 Main St, San Francisco, CA") using Mapbox. Falls back to the
// city/locality label if no address feature is returned, and to
// "Current location" if the geocoder is unreachable.
export async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const addrRes = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=address&limit=1`,
    );
    const addrData = await addrRes.json();
    const a = addrData.features?.[0];
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
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=place,locality&limit=1`,
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
}

export const HomeLocationBar: React.FC<Props> = ({ location, onChange, onUseCurrent }) => {
  const { setHideBottomNav } = useSettings();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HomeLocation[]>([]);
  const [searching, setSearching] = useState(false);
  const [recents, setRecents] = useState<HomeLocation[]>(() => loadRecentLocations());
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
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
    const t = setTimeout(() => inputRef.current?.focus(), 180);
    return () => clearTimeout(t);
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
        // Bias address-level matches toward whatever the user is currently
        // anchored to (their last picked / GPS location) so "Main St" surfaces
        // the nearby Main St rather than a random one across the country.
        const proximity = location ? `&proximity=${location.lng},${location.lat}` : '';
        const res = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&types=address,place,locality,neighborhood,district,postcode&limit=8${proximity}`,
        );
        const data = await res.json();
        const items: HomeLocation[] = (data.features || []).map((f: any) => ({
          label: f.place_name,
          lat: f.center[1],
          lng: f.center[0],
        }));
        setResults(items);
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
      saveLastSelectedLocation(loc);
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
        setCurrentError("Location access is blocked. Enable it in your browser settings or pick a city below.");
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
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 group text-left max-w-full"
        aria-label="Change location"
      >
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40 leading-none">
            Dining in
          </p>
          <p className="mt-1 font-serif font-bold text-lg sm:text-xl leading-tight text-on-surface group-hover:text-primary transition-colors truncate">
            {shortLabel}
          </p>
        </div>
        <ChevronDown size={16} className="text-on-surface/50 mt-4 flex-shrink-0" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              drag="y"
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.5 }}
              onDragEnd={(_: any, info: any) => {
                if (info.offset.y > 100 || info.velocity.y > 300) setOpen(false);
              }}
              className="fixed bottom-0 left-0 right-0 z-50 bg-surface rounded-t-3xl h-[85vh] flex flex-col overflow-hidden shadow-2xl"
            >
              <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <div className="flex items-center justify-between px-5 pt-1 pb-3 border-b border-on-surface/6 flex-shrink-0">
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-on-surface/60">
                  Change location
                </h3>
                <button
                  onClick={() => setOpen(false)}
                  className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors"
                  aria-label="Close"
                >
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>

              <div className="px-5 py-3 flex-shrink-0">
                <div className="relative">
                  <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search address, city, or neighborhood"
                    className="w-full bg-on-surface/[0.04] rounded-full py-3 pl-11 pr-4 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06]"
                    autoCapitalize="off"
                    autoCorrect="off"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-5">
                {query.trim() ? (
                  <div className="space-y-0.5">
                    {searching && (
                      <p className="text-xs text-on-surface/40 px-2 py-2">Searching…</p>
                    )}
                    {!searching && results.length === 0 && (
                      <p className="text-xs text-on-surface/40 px-2 py-2">No locations match</p>
                    )}
                    {results.map((r, i) => (
                      <LocationRow key={`s-${r.label}-${i}`} location={r} onClick={() => select(r)} />
                    ))}
                  </div>
                ) : (
                  <>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40 mb-2 px-2">
                        Near you
                      </p>
                      <button
                        onClick={useCurrent}
                        disabled={currentLoading}
                        className="w-full flex items-center gap-3 py-2.5 text-left hover:bg-on-surface/[0.03] rounded-lg px-2 transition-colors disabled:opacity-60"
                      >
                        <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center flex-shrink-0">
                          {currentLoading ? (
                            <Loader2 size={16} className="text-accent animate-spin" />
                          ) : (
                            <Navigation size={16} className="text-accent" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-serif font-bold text-base">
                            {currentLoading ? 'Locating…' : 'Current location'}
                          </p>
                          <p className="text-xs text-on-surface/50 mt-0.5">Use your device's GPS</p>
                        </div>
                      </button>
                      {currentError && (
                        <p className="mt-1 px-2 text-[11px] text-red-600 leading-snug">{currentError}</p>
                      )}
                    </div>

                    {recents.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between mb-2 px-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">
                            Recent searches
                          </p>
                          <button
                            onClick={clearRecents}
                            className="text-[10px] font-bold uppercase tracking-wider text-primary hover:text-primary/80"
                          >
                            Clear all
                          </button>
                        </div>
                        <div className="space-y-0.5">
                          {recents.map((r, i) => (
                            <LocationRow
                              key={`r-${r.label}-${i}`}
                              location={r}
                              onClick={() => select(r)}
                              onDelete={() => removeRecent(r)}
                            />
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40 mb-2 px-2">
                        Popular cities
                      </p>
                      <div className="space-y-0.5">
                        {POPULAR_CITIES.map((c) => (
                          <LocationRow key={c.label} location={c} onClick={() => select(c)} />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

const LocationRow: React.FC<{
  location: HomeLocation;
  onClick: () => void;
  onDelete?: () => void;
}> = ({ location, onClick, onDelete }) => {
  const primary = location.label.split(',')[0]?.trim() || location.label;
  return (
    <div className="flex items-center gap-3 py-2 hover:bg-on-surface/[0.03] rounded-lg px-2 transition-colors group">
      <button type="button" onClick={onClick} className="flex-1 flex items-center gap-3 text-left min-w-0">
        <div className="w-10 h-10 rounded-xl bg-on-surface/[0.05] flex items-center justify-center flex-shrink-0">
          <MapPin size={16} className="text-on-surface/60" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-serif font-bold text-base truncate">{primary}</p>
          <p className="text-xs text-on-surface/50 mt-0.5 truncate">{location.label}</p>
        </div>
      </button>
      {onDelete && (
        <button
          onClick={onDelete}
          className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface/30 hover:text-primary hover:bg-on-surface/[0.04] transition-colors flex-shrink-0"
          aria-label={`Remove ${primary}`}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
