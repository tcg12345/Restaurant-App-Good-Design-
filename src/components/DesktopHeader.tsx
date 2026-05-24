import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Plus, Heart, MessageCircle, Users, Clock, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';
import { useChat } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { usePageSearch } from '../contexts/PageSearchContext';
import { useCirclePanel } from '../contexts/CirclePanelContext';
import { usePageAddAction } from '../contexts/PageAddActionContext';
import { searchPlacesByText, priceLevelToString, formatLocationLabel, type PlaceResult } from '../lib/places';
import { getCuisineLabel } from '../pages/useRestaurantDetail';
import { HomeLocationBar } from './HomeLocationBar';
import { useHomeLocation } from '../contexts/HomeLocationContext';

/**
 * Sticky page header used across every signed-in main page on desktop
 * (rendered by App.tsx inside the sidebar layout).
 *
 *  ┌─────────────────────────────────────────────┐
 *  │  🔍 Search by name, cuisine, location  [+ Add Rating]  ❤  ✉ │
 *  └─────────────────────────────────────────────┘
 *
 * The search input opens a dropdown that does a live Google Places
 * search — same data path as the standalone /search/main page —
 * surfaced inline so the user never leaves the current page. With an
 * empty query the dropdown shows the user's recent restaurant
 * searches.
 *
 * Each result row has a + button (kicks off Add Rating with that
 * restaurant prefilled) and a heart toggle (wishlist). Tapping the
 * row body navigates to the detail page.
 */

interface RecentSearch {
  id: string;
  name: string;
  address: string;
  fullAddress?: string;
  cuisine: string;
  price: string;
  image: string;
  types?: string[];
  addressComponents?: PlaceResult['addressComponents'];
  timestamp: number;
}

const RECENT_KEY = 'gourmet-canvas-recent-searches-v2';
const MAX_RECENT = 8;
const SEARCH_DEBOUNCE_MS = 280;
// The text-search endpoint takes a lat/lng bias. Default to NYC if we
// don't have a better anchor — this just nudges relevance, it does not
// restrict results.
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;

function readRecents(): RecentSearch[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is RecentSearch => !!x && typeof x?.id === 'string' && typeof x?.name === 'string')
      .slice(0, MAX_RECENT);
  } catch { return []; }
}
function writeRecents(list: RecentSearch[]) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, MAX_RECENT))); } catch {}
}
function placeToRecent(place: PlaceResult): RecentSearch {
  return {
    id: place.id,
    name: place.name,
    address: place.address || '',
    fullAddress: place.fullAddress || place.address || '',
    cuisine: getCuisineLabel(place.types || []),
    price: priceLevelToString(place.priceLevel),
    image: place.photoUrl || '',
    types: place.types,
    addressComponents: place.addressComponents,
    timestamp: Date.now(),
  };
}

export const DesktopHeader: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toggleWishlist, isWishlisted, openAddRestaurantModal } = useLists();
  const { unreadCount } = useChat();
  const { pendingRequestCount } = useAuth();
  const { scopedSearch, setScopedSearch, focusBump } = usePageSearch();
  const { open: circleOpen, toggle: toggleCircle } = useCirclePanel();
  const { override: addActionOverride } = usePageAddAction();
  // True while a page (Pantry) has hijacked this input as a list filter.
  const isScoped = scopedSearch !== null;

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState<RecentSearch[]>(() => readRecents());

  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Dropdown position is tracked in viewport coords so we can render it
  // through a portal at <body> level. Renders outside the header's
  // stacking context (which is created by backdrop-blur + z-index) and
  // sidesteps any transform / overflow ancestors that would otherwise
  // clip or obscure the panel.
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const updateDropdownPos = () => {
    if (!wrapperRef.current) return;
    const rect = wrapperRef.current.getBoundingClientRect();
    setDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width });
  };
  useLayoutEffect(() => {
    if (!open) return;
    updateDropdownPos();
    const onScrollResize = () => updateDropdownPos();
    window.addEventListener('scroll', onScrollResize, true);
    window.addEventListener('resize', onScrollResize);
    return () => {
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize);
    };
  }, [open]);

  const trimmed = query.trim();
  const showResults = trimmed.length > 0;

  // ── Debounced live Places search ──────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!trimmed) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const reqId = ++requestIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const found = await searchPlacesByText(trimmed, DEFAULT_LAT, DEFAULT_LNG);
        // Drop stale responses if the user kept typing.
        if (reqId !== requestIdRef.current) return;
        setResults(found);
      } catch {
        if (reqId === requestIdRef.current) setResults([]);
      } finally {
        if (reqId === requestIdRef.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [trimmed]);

  useEffect(() => { setActiveIndex(0); }, [results, recents, showResults]);

  // Outside click + Escape close.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Reset whenever the route changes — if a result triggered the nav,
  // we don't want a stale dropdown over the new page. Also drop any
  // scoped-search state so the next page starts clean.
  useEffect(() => {
    setOpen(false);
    setQuery('');
    setScopedSearch(null);
  }, [location.pathname, setScopedSearch]);

  // Pages bump focusBump after activating a scope so the input grabs
  // focus and the user can start typing immediately.
  useEffect(() => {
    if (focusBump > 0) inputRef.current?.focus();
  }, [focusBump]);

  // ESC while scoped exits the scope without clearing global search.
  useEffect(() => {
    if (!isScoped) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        scopedSearch?.onDismiss?.();
        setScopedSearch(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isScoped, scopedSearch, setScopedSearch]);

  const persistRecent = (place: PlaceResult) => {
    setRecents((prev) => {
      const entry = placeToRecent(place);
      const next = [entry, ...prev.filter((r) => r.id !== entry.id)].slice(0, MAX_RECENT);
      writeRecents(next);
      return next;
    });
  };

  const goToPlace = (place: PlaceResult) => {
    persistRecent(place);
    navigate(`/restaurant/${place.id}`);
    setOpen(false);
    setQuery('');
  };
  const goToRecent = (r: RecentSearch) => {
    setRecents((prev) => {
      const next = [{ ...r, timestamp: Date.now() }, ...prev.filter((x) => x.id !== r.id)].slice(0, MAX_RECENT);
      writeRecents(next);
      return next;
    });
    navigate(`/restaurant/${r.id}`);
    setOpen(false);
    setQuery('');
  };
  const removeRecent = (id: string) => {
    setRecents((prev) => {
      const next = prev.filter((r) => r.id !== id);
      writeRecents(next);
      return next;
    });
  };

  const placeMeta = (p: PlaceResult) => ({
    id: p.id,
    name: p.name,
    image: p.photoUrl || '',
    cuisine: getCuisineLabel(p.types || []),
    price: priceLevelToString(p.priceLevel),
    address: p.fullAddress || p.address || '',
  });
  const recentMeta = (r: RecentSearch) => ({
    id: r.id,
    name: r.name,
    image: r.image || '',
    cuisine: r.cuisine,
    price: r.price,
    address: r.fullAddress || r.address,
  });

  // Active row navigation via keyboard.
  const navigableLength = showResults ? results.length : recents.length;
  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    // Scoped mode is just a filter input — no dropdown to navigate.
    if (isScoped) return;
    if (!open || navigableLength === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % navigableLength); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + navigableLength) % navigableLength); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (showResults) goToPlace(results[activeIndex]);
      else goToRecent(recents[activeIndex]);
    }
  };

  const isHomeRoute = location.pathname === '/' || location.pathname === '/index.html';
  const homeLocationCtx = useHomeLocation();

  return (
    <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-md border-b border-on-surface/[0.06]">
      <div className="px-6 py-2.5 flex items-center gap-3">
        {/* ── Location chip — only when on Discover home and a location
              context is available. Reuses HomeLocationBar's bottom-sheet
              picker so cities/recents/use-current all work as before. */}
        {isHomeRoute && homeLocationCtx && (
          <HomeLocationBar
            location={homeLocationCtx.location}
            onChange={homeLocationCtx.setLocation}
            onUseCurrent={homeLocationCtx.useCurrent}
            variant="chip"
          />
        )}

        {/* ── Search input + dropdown ─────────────────────────────── */}
        <div ref={wrapperRef} className="relative flex-1 max-w-2xl">
          <Search size={16} className={cn(
            'absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none',
            isScoped ? 'text-primary' : 'text-on-surface/50',
          )} />
          <input
            ref={inputRef}
            type="text"
            value={isScoped && scopedSearch ? scopedSearch.query : query}
            onChange={(e) => {
              if (isScoped && scopedSearch) {
                scopedSearch.setQuery(e.target.value);
              } else {
                setQuery(e.target.value);
                setOpen(true);
              }
            }}
            onFocus={() => { if (!isScoped) setOpen(true); }}
            onBlur={() => {
              // Click-off in scoped mode reverts the bar to the global
              // Places search. The page's list filter is preserved so
              // the results don't disappear — the page's "Search this
              // list" pill still shows the active query with its own
              // clear button.
              if (isScoped) setScopedSearch(null);
            }}
            onKeyDown={handleKeyDown}
            placeholder={isScoped && scopedSearch
              ? (scopedSearch.placeholder || `Search ${scopedSearch.scopeName.toLowerCase()}...`)
              : 'Search by name, cuisine, location...'}
            className={cn(
              'w-full',
              'rounded-full py-2.5 pl-11 pr-10 text-[14px] font-medium text-on-surface',
              'placeholder:text-on-surface/45',
              'focus:outline-none',
              'transition-all',
              isScoped
                ? 'bg-primary/[0.06] border border-primary/20 focus:border-primary/40 placeholder:text-primary/60'
                : 'bg-paper border border-on-surface/[0.08] hover:border-on-surface/15 focus:border-on-surface/25 focus:bg-white shadow-[0_1px_2px_rgba(30,27,26,0.04)]',
            )}
            aria-label={isScoped && scopedSearch ? `Search ${scopedSearch.scopeName}` : 'Search restaurants'}
            aria-haspopup={isScoped ? undefined : 'listbox'}
            aria-expanded={isScoped ? undefined : open}
          />
          {((isScoped && scopedSearch?.query) || (!isScoped && query)) && (
            <button
              type="button"
              // preventDefault on mousedown keeps the input focused, so
              // the blur-to-revert handler doesn't clear scoped mode out
              // from under the click before the clear runs.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (isScoped && scopedSearch) scopedSearch.setQuery('');
                else setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 hover:text-on-surface/70 transition-colors"
            >
              <X size={14} />
            </button>
          )}

          {createPortal(
            <AnimatePresence>
              {open && dropdownPos && !isScoped && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.99 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.99 }}
                  transition={{ duration: 0.14, ease: 'easeOut' }}
                  style={{
                    position: 'fixed',
                    top: dropdownPos.top,
                    left: dropdownPos.left,
                    width: dropdownPos.width,
                    zIndex: 200,
                  }}
                  className={cn(
                    'rounded-2xl bg-surface border border-on-surface/[0.08]',
                    'shadow-[0_18px_48px_-12px_rgba(0,0,0,0.22)]',
                    'overflow-hidden',
                  )}
                  role="listbox"
                >
                {/* ── Search results state ── */}
                {showResults ? (
                  searching && results.length === 0 ? (
                    <div className="px-4 py-6 flex items-center justify-center gap-2 text-on-surface/55">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-[13px] font-medium">Searching restaurants…</span>
                    </div>
                  ) : results.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-sm font-medium text-on-surface/60">No matches found</p>
                      <p className="text-[12px] text-on-surface/40 mt-1">Try a different name, cuisine, or city</p>
                    </div>
                  ) : (
                    <ul className="max-h-[480px] overflow-y-auto py-1">
                      {results.map((p, idx) => (
                        <SearchRow
                          key={p.id}
                          name={p.name}
                          location={formatLocationLabel(p.addressComponents, p.fullAddress || p.address)}
                          cuisine={getCuisineLabel(p.types || [])}
                          price={priceLevelToString(p.priceLevel)}
                          active={idx === activeIndex}
                          wishlisted={isWishlisted(p.id)}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => goToPlace(p)}
                          onAdd={(e) => {
                            e.stopPropagation();
                            persistRecent(p);
                            openAddRestaurantModal(placeMeta(p));
                            setOpen(false);
                            setQuery('');
                          }}
                          onWishlist={(e) => {
                            e.stopPropagation();
                            persistRecent(p);
                            toggleWishlist(placeMeta(p));
                          }}
                        />
                      ))}
                    </ul>
                  )
                ) : (
                  /* ── Empty query: history ── */
                  recents.length === 0 ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-sm font-medium text-on-surface/60">Start typing to search</p>
                      <p className="text-[12px] text-on-surface/40 mt-1">Find a restaurant by name, cuisine, or city</p>
                    </div>
                  ) : (
                    <div className="max-h-[480px] overflow-y-auto py-1">
                      <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface/40 flex items-center gap-1.5">
                        <Clock size={11} /> Recent searches
                      </p>
                      <ul>
                        {recents.map((r, idx) => (
                          <SearchRow
                            key={r.id}
                            name={r.name}
                            location={formatLocationLabel(r.addressComponents, r.fullAddress || r.address)}
                            cuisine={r.cuisine}
                            price={r.price}
                            active={idx === activeIndex}
                            wishlisted={isWishlisted(r.id)}
                            onMouseEnter={() => setActiveIndex(idx)}
                            onClick={() => goToRecent(r)}
                            onAdd={(e) => {
                              e.stopPropagation();
                              openAddRestaurantModal(recentMeta(r));
                              setOpen(false);
                            }}
                            onWishlist={(e) => {
                              e.stopPropagation();
                              toggleWishlist(recentMeta(r));
                            }}
                            onRemove={(e) => { e.stopPropagation(); removeRecent(r.id); }}
                          />
                        ))}
                      </ul>
                    </div>
                  )
                )}
                </motion.div>
              )}
            </AnimatePresence>,
            document.body,
          )}
        </div>

        {/* ── Right side actions ───────────────────────────────────
            Add CTA (when shown) stays as its own pill on the left.
            Circle + Messages are wrapped into a single rounded
            container so they read as one user-actions cluster
            instead of three loose icons. */}
        <div className="ml-auto flex items-center gap-3">
          {/* Add CTA — hidden on Discover (the home grid already has +
              buttons on every card and the search dropdown now exposes
              one per result). Pages can override the label + click via
              PageAddActionContext (e.g. Pantry swaps it to "Add Recipe"
              on recipe views and opens a SearchPopup on restaurant
              views). When no override is set, it routes to /search/main
              like before. */}
          {!isHomeRoute && !(addActionOverride?.hidden) && (
            <button
              type="button"
              onClick={() => {
                if (addActionOverride) addActionOverride.onClick();
                else navigate('/search/main');
              }}
              className={cn(
                'inline-flex items-center gap-2 px-4 py-2.5 rounded-full',
                'bg-primary text-white text-[13px] font-semibold',
                'hover:bg-primary/90 active:scale-[0.99] transition-all shadow-sm',
              )}
            >
              <Plus size={15} strokeWidth={2.5} />
              <span>{addActionOverride?.label ?? 'Add Rating'}</span>
            </button>
          )}

          <div className="flex items-center gap-0.5 px-1 py-1 rounded-full bg-paper border border-on-surface/[0.08]">
            <button
              type="button"
              onClick={toggleCircle}
              aria-label="Your circle"
              className={cn(
                'relative w-9 h-9 rounded-full flex items-center justify-center transition-colors',
                circleOpen
                  ? 'bg-on-surface/[0.08] text-on-surface'
                  : 'text-on-surface/65 hover:text-on-surface hover:bg-on-surface/[0.05]',
              )}
            >
              <Users size={17} />
              {pendingRequestCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-paper">
                  {pendingRequestCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => navigate('/messages')}
              aria-label="Messages"
              className="relative w-9 h-9 rounded-full text-on-surface/65 hover:text-on-surface hover:bg-on-surface/[0.05] flex items-center justify-center transition-colors"
            >
              <MessageCircle size={17} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-paper">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

/* ── Reusable row used for both live results and recent searches ── */
const SearchRow: React.FC<{
  name: string;
  location: string;
  cuisine: string;
  price: string;
  active: boolean;
  wishlisted: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  onAdd: (e: React.MouseEvent) => void;
  onWishlist: (e: React.MouseEvent) => void;
  onRemove?: (e: React.MouseEvent) => void;
}> = ({ name, location, cuisine, price, active, wishlisted, onClick, onMouseEnter, onAdd, onWishlist, onRemove }) => (
  <li>
    <button
      type="button"
      onMouseEnter={onMouseEnter}
      onClick={onClick}
      className={cn(
        'w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors',
        active ? 'bg-on-surface/[0.05]' : 'hover:bg-on-surface/[0.03]',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-serif font-bold text-[14px] text-on-surface leading-tight truncate">{name}</p>
        <p className="text-[11px] text-on-surface/50 leading-tight truncate mt-0.5">
          {(cuisine || 'Restaurant')}
          {price ? <span className="text-on-surface/30"> · {price}</span> : null}
          {location ? <span className="text-on-surface/30"> · {location}</span> : null}
        </p>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <span
          role="button"
          tabIndex={-1}
          onClick={onWishlist}
          aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          title={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
          className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center transition-colors',
            wishlisted
              ? 'bg-red-50 text-red-400 hover:bg-red-100'
              : 'text-on-surface/45 hover:text-red-400 hover:bg-red-50',
          )}
        >
          <Heart size={14} className={wishlisted ? 'fill-red-400' : ''} />
        </span>
        <span
          role="button"
          tabIndex={-1}
          onClick={onAdd}
          aria-label="Add rating"
          title="Add rating"
          className="w-8 h-8 rounded-full text-on-surface/55 hover:text-primary hover:bg-primary/[0.06] flex items-center justify-center transition-colors"
        >
          <Plus size={15} strokeWidth={2.4} />
        </span>
        {onRemove && (
          <span
            role="button"
            tabIndex={-1}
            onClick={onRemove}
            aria-label="Remove from history"
            title="Remove from history"
            className="w-7 h-7 rounded-full text-on-surface/30 hover:text-on-surface/60 hover:bg-on-surface/[0.05] flex items-center justify-center transition-colors"
          >
            <X size={12} />
          </span>
        )}
      </div>
    </button>
  </li>
);
