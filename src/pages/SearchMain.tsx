import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search as SearchIcon, X, Clock, Loader2, Star } from 'lucide-react';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
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

function extractLocation(address: string): string {
  if (!address) return '';
  const parts = address.split(',').map((s) => s.trim());
  if (parts.length >= 2) return parts.slice(-2).join(', ').replace(/\d{5}.*/, '').trim().replace(/,\s*$/, '');
  return parts[0] || '';
}

function placeToRecent(place: PlaceResult): RecentSearch {
  return {
    id: place.id,
    name: place.name,
    cuisine: extractLocation(place.fullAddress || place.address) || '',
    price: priceLevelToString(place.priceLevel),
    image: place.photoUrl || '',
    address: place.address || '',
    rating: place.rating,
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
      (pos) => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude); },
      () => { /* keep defaults */ },
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
          loading && results.length === 0 ? (
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
                const location = extractLocation(place.fullAddress || place.address);
                const price = priceLevelToString(place.priceLevel);
                return (
                  <li key={place.id}>
                    <button
                      type="button"
                      onClick={() => handleSelectResult(place)}
                      className="w-full flex gap-4 py-3.5 text-left group active:scale-[0.99] transition-transform"
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
                            <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5 text-primary">
                              <Star size={12} className="fill-primary" />
                              <span className="text-xs font-bold">{place.rating.toFixed(1)}</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                          {location || 'Restaurant'}
                          {price && <><span className="text-on-surface/25 mx-1.5">·</span>{price}</>}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        ) : recentSearches.length > 0 ? (
          // ── Recent searches ──
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
            <ul className="divide-y divide-on-surface/[0.06]">
              {recentSearches.map((r) => {
                const location = extractLocation(r.address);
                return (
                  <li key={r.id} className="relative group">
                    <button
                      type="button"
                      onClick={() => handleRecentClick(r)}
                      className="w-full flex gap-4 py-3.5 text-left active:scale-[0.99] transition-transform"
                    >
                      <div className="w-20 h-20 rounded-2xl overflow-hidden bg-on-surface/[0.05] flex-shrink-0 flex items-center justify-center">
                        {r.image ? (
                          <img
                            src={r.image}
                            alt={r.name}
                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <span className="text-2xl font-serif font-bold text-on-surface/15">{r.name.charAt(0)}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 flex flex-col justify-center pr-10">
                        <div className="flex items-start justify-between gap-3">
                          <h3 className="font-serif font-bold text-[15px] leading-snug line-clamp-2 flex-1">{r.name}</h3>
                          {typeof r.rating === 'number' && r.rating > 0 && (
                            <div className="flex items-center gap-0.5 flex-shrink-0 pt-0.5 text-primary">
                              <Star size={12} className="fill-primary" />
                              <span className="text-xs font-bold">{r.rating.toFixed(1)}</span>
                            </div>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-on-surface/50 font-medium uppercase tracking-wider truncate">
                          {location || r.cuisine || 'Restaurant'}
                          {r.price && <><span className="text-on-surface/25 mx-1.5">·</span>{r.price}</>}
                        </p>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleRemove(r.id); }}
                      className={cn(
                        "absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full text-on-surface/25 hover:bg-on-surface/[0.05] hover:text-on-surface/50 flex items-center justify-center transition-colors"
                      )}
                      aria-label={`Remove ${r.name} from recent searches`}
                    >
                      <X size={14} />
                    </button>
                  </li>
                );
              })}
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
