import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, X, Clock, Star, ArrowUpLeft, Plus, Heart } from 'lucide-react';
import { searchPlacesByText, priceLevelToString, extractCityState, formatLocationLabel, type PlaceResult } from '../lib/places';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { findMichelinMatchSync, michelinPriceDisplay, type MichelinInfo } from '../lib/michelin';
import { cn } from '../lib/utils';
import { LoadingSkeletonList } from '../components/LoadingSkeleton';
import { EmptyState } from '../components/EmptyState';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';

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
    address: place.fullAddress || place.address || '',
    rating: place.rating,
    timestamp: Date.now(),
  };
}

export const SearchMain: React.FC = () => {
  const navigate = useNavigate();
  const { openAddRestaurantModal, toggleWishlist, isWishlisted } = useLists();
  const { phoneMode } = useSettings();
  const [searchQuery, setSearchQuery] = useState('');
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>(() => readRecentSearches());
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [userLat, setUserLat] = useState(DEFAULT_LAT);
  const [userLng, setUserLng] = useState(DEFAULT_LNG);
  const [locationKnown, setLocationKnown] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Michelin overlay for search rows. Matches are resolved for the whole
  // results array in one memo (hooks can't run per-row); michelinByPlaceId maps
  // a Google place id to its Michelin record when starred.
  const michelinReady = useMichelinIndexReady();
  const michelinByPlaceId = useMemo(() => {
    const m: Record<string, MichelinInfo> = {};
    if (!michelinReady) return m;
    for (const place of results) {
      const hit = findMichelinMatchSync(place.name, place.lat, place.lng, place.fullAddress || place.address);
      if (hit) m[place.id] = hit;
    }
    return m;
  }, [michelinReady, results]);
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
    <div className="min-h-screen bg-surface" style={{ paddingBottom: 'calc(8rem + var(--keyboard-height, 0px))' }}>
      <header className="sticky top-0 w-full bg-surface/80 backdrop-blur-md z-40">
        <div className="px-4 pt-safe-3 pb-3 flex items-center gap-3 md:max-w-2xl md:mx-auto">
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
        </div>
      </header>

      <main className={cn("pt-2 md:max-w-2xl md:mx-auto md:px-4", !phoneMode && "px-4")}>
        {hasQuery ? (
          // ── Search results ──
          <>
            {/* Autocomplete suggestion shell — pulls from recent searches
                today; TODO: merge in user's rated restaurants, cuisine
                preferences, and neighborhood history for richer suggestions. */}
            {matchingRecents.length > 0 && (
              <section className={cn("mb-4 pt-2", phoneMode && "px-4")}>
                <p className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em] mb-1">
                  From your history
                </p>
                <ul className="divide-y divide-on-surface/[0.06]">
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
              <LoadingSkeletonList count={5} variant="list-item" className={cn("divide-y divide-on-surface/[0.06]", phoneMode && "px-4")} />
            ) : results.length === 0 ? (
              <EmptyState
                icon={<SearchIcon size={48} />}
                heading="No restaurants found"
                description="Try a different search."
              />
            ) : (
              <ul className="divide-y divide-on-surface/[0.06]">
                {results.map((place) => {
                  const location = formatLocationLabel(place.addressComponents, place.fullAddress || place.address || '');
                  const price = priceLevelToString(place.priceLevel);
                  const distance = locationKnown
                    ? formatDistance(haversineDistanceMi(userLat, userLng, place.lat, place.lng))
                    : '';
                  const wishlisted = isWishlisted(place.id);
                  const meta = {
                    id: place.id,
                    name: place.name,
                    image: place.photoUrl || '',
                    cuisine: location || 'Restaurant',
                    price,
                    address: place.fullAddress || place.address || '',
                  };
                  return (
                    <li key={place.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectResult(place)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectResult(place);
                          }
                        }}
                        className={cn(
                          "w-full flex gap-3 py-4 text-left group transition-colors hover:bg-on-surface/[0.03] active:bg-on-surface/[0.05] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                          phoneMode ? "px-4" : "px-2 -mx-2 rounded-xl",
                        )}
                      >
                        <div className="flex-1 min-w-0 flex flex-col justify-center">
                          <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">{place.name}</h3>
                          {(() => {
                            const mich = michelinByPlaceId[place.id];
                            // For Michelin matches show the Guide's cuisine + $-tier
                            // price; otherwise keep the existing location · price. The
                            // star/bib marker is reserved for the detail page.
                            const label = mich ? mich.cuisine : (location || 'Restaurant');
                            const priceText = mich ? michelinPriceDisplay(mich) : price;
                            return (
                              <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                                {label}
                                {priceText && <><span className="text-on-surface/25 mx-1.5">·</span>{priceText}</>}
                              </p>
                            );
                          })()}
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-on-surface/50">
                            {place.rating > 0 && (
                              <span className="flex items-center gap-1 text-primary font-bold">
                                <Star size={12} className="fill-primary" />
                                {place.rating.toFixed(1)}
                              </span>
                            )}
                            {place.rating > 0 && distance && <span className="text-on-surface/25">·</span>}
                            {distance && <span>{distance}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 self-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleWishlist(meta);
                            }}
                            className={cn(
                              'w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95',
                              wishlisted ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
                            )}
                            aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                          >
                            <Heart size={16} className={cn(wishlisted && 'fill-primary')} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              openAddRestaurantModal(meta);
                            }}
                            className="w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm text-primary transition-transform duration-150 hover:scale-105 active:scale-95"
                            aria-label="Add to list"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : recentSearches.length > 0 ? (
          // ── Recent searches — thin restaurant cards ──
          <section>
            <div className={cn("flex items-center justify-between mb-2 mt-2", phoneMode && "px-4")}>
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-on-surface/40" />
                <h2 className="text-xs font-bold text-on-surface/40 uppercase tracking-[0.15em]">Recent Searches</h2>
              </div>
              <button
                type="button"
                onClick={handleClearAll}
                className="text-xs font-bold text-primary uppercase tracking-wider"
              >
                Clear All
              </button>
            </div>
            <ul className="divide-y divide-on-surface/[0.06]">
              {recentSearches.map((r) => {
                const wishlisted = isWishlisted(r.id);
                const location = formatLocationLabel(undefined, r.address);
                const meta = { id: r.id, name: r.name, image: r.image, cuisine: r.cuisine, price: r.price, address: r.address };
                return (
                  <li key={r.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleRecentClick(r)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleRecentClick(r);
                        }
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 py-4 text-left group transition-colors hover:bg-on-surface/[0.03] active:bg-on-surface/[0.05] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                        phoneMode ? "px-4" : "px-2 -mx-2 rounded-xl",
                      )}
                    >
                      {/* Clock affordance — signals "this is a recent search,
                          not a fresh result". Sits where the search-results
                          row has no leading element, so the two rows share a
                          visual rhythm but recents are still distinguishable
                          at a glance. */}
                      <div className="w-9 h-9 flex-shrink-0 rounded-full bg-on-surface/[0.05] flex items-center justify-center text-on-surface/40">
                        <Clock size={15} />
                      </div>

                      <div className="flex-1 min-w-0 flex flex-col justify-center">
                        <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2">{r.name}</h3>
                        {(r.cuisine || location) && (
                          <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                            {r.cuisine}
                            {r.cuisine && location && <span className="text-on-surface/25 mx-1.5">·</span>}
                            {location}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0 self-center" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleWishlist(meta);
                          }}
                          className={cn(
                            'w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm transition-transform duration-150 hover:scale-105 active:scale-95',
                            wishlisted ? 'text-primary' : 'text-on-surface/70 hover:text-primary',
                          )}
                          aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
                        >
                          <Heart size={16} className={cn(wishlisted && 'fill-primary')} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openAddRestaurantModal(meta);
                          }}
                          className="w-9 h-9 rounded-full flex items-center justify-center bg-on-surface/[0.04] shadow-sm text-primary transition-transform duration-150 hover:scale-105 active:scale-95"
                          aria-label="Add to list"
                        >
                          <Plus size={16} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleRemove(r.id);
                          }}
                          className="w-9 h-9 rounded-full flex items-center justify-center text-on-surface/30 hover:text-on-surface/60 hover:bg-on-surface/[0.04] transition-colors"
                          aria-label={`Remove ${r.name}`}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <EmptyState
            icon={<SearchIcon size={48} />}
            heading="Search for a restaurant"
            description="Recent picks will appear here."
          />
        )}
      </main>
    </div>
  );
};
