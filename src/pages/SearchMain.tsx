import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, X, Clock, Loader2, Star, ArrowUpLeft } from 'lucide-react';
import { searchPlacesByText, priceLevelToString, extractCityState, type PlaceResult } from '../lib/places';
import { cn } from '../lib/utils';

const RECENT_SEARCHES_KEY = 'gourmet-canvas-recent-searches-v2';
const MAX_RECENT = 10;
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;

interface RecentSearch {
  id: string;
  name: string;
  cuisine: string;
  price: string;
  image: string;
  address: string;
  rating?: number;
  timestamp?: number;
}

// Short human-readable "time ago" for recent search rows.
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w ago`;
  return new Date(ts).toLocaleDateString();
}

// Haversine distance in miles between two lat/lng points.
function haversineDistanceMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  if (!lat2 || !lng2) return 0;
  const R = 3958.8; // Earth radius in miles
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(miles: number): string {
  if (miles <= 0) return '';
  if (miles < 0.1) return '< 0.1 mi away';
  if (miles < 10) return `${miles.toFixed(1)} mi away`;
  return `${Math.round(miles)} mi away`;
}

// Bold the matching portion of a suggestion label as the user types.
function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="font-bold text-primary">{text.slice(idx, idx + query.length)}</span>
      {text.slice(idx + query.length)}
    </>
  );
}

function readRecentSearches(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_SEARCHES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is RecentSearch =>
      !!x && typeof x === 'object' && typeof x.id === 'string' && typeof x.name === 'string'
    );
  } catch {
    return [];
  }
}

function writeRecentSearches(list: RecentSearch[]) {
  try {
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

function placeToRecent(place: PlaceResult): RecentSearch {
  return {
    id: place.id,
    name: place.name,
    cuisine: extractCityState(place.fullAddress || '', place.address || ''),
    price: priceLevelToString(place.priceLevel),
    image: place.photoUrl || '',
    address: place.address || '',
    rating: place.rating,
    timestamp: Date.now(),
  };
}

export const SearchMain: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => readRecentSearches());
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);
  const [locationKnown, setLocationKnown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQueryRef = useRef<string>('');

  useEffect(() => {
    // Auto-focus the input so the user can start typing immediately.
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setUserLat(pos.coords.latitude);
        setUserLng(pos.coords.longitude);
        setLocationKnown(true);
      },
      () => { /* keep defaults; locationKnown stays false so distance is hidden */ },
      { timeout: 5000 },
    );
  }, []);

  const runSearch = useCallback(async (query: string) => {
    const q = query.trim();
    lastQueryRef.current = q;
    if (!q) { setResults([]); setLoading(false); return; }
    setLoading(true);
    try {
      const found = await searchPlacesByText(q, userLat, userLng);
      // Discard stale responses if the query has changed since this request began
      if (lastQueryRef.current !== q) return;
      setResults(found);
    } catch {
      if (lastQueryRef.current === q) setResults([]);
    } finally {
      if (lastQueryRef.current === q) setLoading(false);
    }
  }, [userLat, userLng]);

  // Debounced auto-search as the user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!searchQuery.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(() => {
      runSearch(searchQuery);
    }, 450);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery, runSearch]);

  const handleSelectResult = (place: PlaceResult) => {
    const entry = placeToRecent(place);
    const next = [entry, ...recentSearches.filter((x) => x.id !== entry.id)].slice(0, MAX_RECENT);
    setRecentSearches(next);
    writeRecentSearches(next);
    navigate(`/restaurant/${place.id}`);
  };

  const handleRecentClick = (r: RecentSearch) => {
    navigate(`/restaurant/${r.id}`);
  };

  const handleRemove = (id: string) => {
    const next = recentSearches.filter((x) => x.id !== id);
    setRecentSearches(next);
    writeRecentSearches(next);
  };

  const handleClearAll = () => {
    setRecentSearches([]);
    writeRecentSearches([]);
  };

  const hasQuery = searchQuery.trim().length > 0;

  // Autocomplete suggestions from local data. Today we only have recent
  // searches in localStorage; TODO: also surface suggestions from the user's
  // rated restaurants, preferred cuisines, and saved neighborhoods once that
  // data is plumbed into this page.
  const matchingRecents = useMemo(() => {
    if (!hasQuery) return [];
    const q = searchQuery.trim().toLowerCase();
    return recentSearches
      .filter((r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [hasQuery, searchQuery, recentSearches]);

  return (
    <div className="pb-32 min-h-screen bg-surface">
      <header className="sticky top-0 w-full px-4 py-3 flex items-center gap-3 bg-surface/80 backdrop-blur-md z-40">
        <button
          type="button"
          onClick={() => navigate('/search')}
          className="w-10 h-10 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/70 transition-colors flex-shrink-0"
          aria-label="Back"
        >
          <ArrowLeft size={20} />
        </button>
        <form
          className="flex-1 relative"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(searchQuery);
          }}
        >
          <SearchIcon size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
          <input
            ref={inputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search restaurants, cuisines..."
            className="w-full bg-on-surface/[0.04] rounded-full py-3 pl-11 pr-10 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06] transition-all"
            autoCapitalize="off"
            autoCorrect="off"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setResults([]);
                inputRef.current?.focus();
              }}
              className="absolute inset-y-0 right-3 flex items-center text-on-surface/30 hover:text-on-surface/60"
              aria-label="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </form>
      </header>

      <main className="px-4 pt-2">
        {hasQuery ? (
          // ── Search results ──
          <>
            {/* Autocomplete suggestion shell — pulls from recent searches
                today; TODO: merge in user's rated restaurants, cuisine
                preferences, and neighborhood history for richer suggestions. */}
            {matchingRecents.length > 0 && (
              <section className="mb-4 pt-2">
                <p className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em] mb-1">
                  From your history
                </p>
                <ul className="divide-y divide-on-surface/10">
                  {matchingRecents.map((r) => (
                    <li key={`suggest-${r.id}`}>
                      <button
                        type="button"
                        onClick={() => handleRecentClick(r)}
                        className="w-full flex items-center gap-3 py-2.5 text-left group"
                      >
                        <SearchIcon size={15} className="text-on-surface/35 flex-shrink-0" />
                        <span className="flex-1 text-[15px] text-on-surface truncate">
                          {highlightMatch(r.name, searchQuery)}
                        </span>
                        <ArrowUpLeft
                          size={14}
                          className="text-on-surface/30 group-hover:text-on-surface/55 flex-shrink-0 transition-colors"
                        />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {loading && results.length === 0 ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 size={22} className="text-primary/50 animate-spin" />
                <span className="ml-3 text-sm text-on-surface/50 font-medium">Finding restaurants...</span>
              </div>
            ) : results.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <SearchIcon size={32} className="text-on-surface/15 mb-3" />
                <p className="text-sm font-medium text-on-surface/40">No restaurants found</p>
                <p className="text-xs text-on-surface/30 mt-1">Try a different search</p>
              </div>
            ) : (
              <ul className="divide-y divide-on-surface/[0.06]">
                {results.map((place) => {
                  const location = extractCityState(place.fullAddress || '', place.address || '');
                  const price = priceLevelToString(place.priceLevel);
                  const distance = locationKnown
                    ? formatDistance(haversineDistanceMi(userLat, userLng, place.lat, place.lng))
                    : '';
                  return (
                    <li key={place.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectResult(place)}
                        className="w-full flex gap-4 py-4 text-left group active:scale-[0.99] transition-transform"
                      >
                        <div className="w-20 h-20 rounded-2xl overflow-hidden bg-on-surface/[0.05] flex-shrink-0 flex items-center justify-center">
                          {place.photoUrl ? (
                            <img
                              src={place.photoUrl}
                              alt={place.name}
                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <span className="text-2xl font-serif font-bold text-on-surface/15">{place.name.charAt(0)}</span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <div className="flex items-start justify-between gap-3">
                            <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2 flex-1">{place.name}</h3>
                            {place.rating > 0 && (
                              <div className="flex items-center gap-1 flex-shrink-0 pt-0.5 text-primary">
                                <Star size={13} className="fill-primary" />
                                <span className="text-sm font-bold">{place.rating.toFixed(1)}</span>
                              </div>
                            )}
                          </div>
                          <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                            {location || 'Restaurant'}
                            {price && <><span className="text-on-surface/25 mx-1.5">·</span>{price}</>}
                          </p>
                          {distance && (
                            <p className="mt-0.5 text-xs text-on-surface/50">{distance}</p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : recentSearches.length > 0 ? (
          // ── Recent searches — simple text list, no per-item card ──
          <section>
            <div className="flex items-center justify-between mb-2 mt-2">
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-on-surface/40" />
                <h2 className="text-[10px] font-bold text-on-surface/40 uppercase tracking-[0.15em]">Recent Searches</h2>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-[10px] font-bold text-primary uppercase tracking-wider"
              >
                Clear All
              </button>
            </div>
            <ul className="divide-y divide-on-surface/10 border-y border-on-surface/10">
              {recentSearches.map((r) => (
                <li key={r.id} className="relative">
                  <button
                    type="button"
                    onClick={() => handleRecentClick(r)}
                    className="w-full flex items-center gap-3 py-3.5 pr-10 text-left"
                  >
                    <SearchIcon size={15} className="text-on-surface/35 flex-shrink-0" />
                    <span className="flex-1 text-[15px] text-on-surface truncate">{r.name}</span>
                    {r.timestamp && (
                      <span className="text-xs text-on-surface/45 flex-shrink-0">
                        {formatRelativeTime(r.timestamp)}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemove(r.id); }}
                    className={cn(
                      "absolute right-0 top-1/2 -translate-y-1/2 min-w-[40px] h-10 rounded-full text-on-surface/25 hover:text-on-surface/55 flex items-center justify-center transition-colors",
                    )}
                    aria-label={`Remove ${r.name} from recent searches`}
                  >
                    <X size={14} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <SearchIcon size={32} className="text-on-surface/15 mb-3" />
            <p className="text-sm font-medium text-on-surface/40">Search for a restaurant</p>
            <p className="text-xs text-on-surface/30 mt-1">Recent picks will appear here</p>
          </div>
        )}
      </main>
    </div>
  );
};
