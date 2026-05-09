import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Plus, Heart, MessageCircle, MapPin, Star, Bookmark, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';
import { useChat } from '../contexts/ChatContext';
import { useAuth } from '../contexts/AuthContext';
import { scoreColor } from '../lib/score';

/**
 * Sticky page header used across every signed-in main page on desktop
 * (rendered by App.tsx inside the sidebar layout). Replaces the older
 * per-page TopBar on Discover.
 *
 *  ┌─────────────────────────────────────────────┐
 *  │  🔍 Search by name, cuisine, location  + Add Rating  ❤  ✉ │
 *  └─────────────────────────────────────────────┘
 *
 * The search input opens a dropdown that filters the user's local
 * data — rated restaurants, wishlist, and lists — instead of routing
 * to a separate /search page. Click any result to deep-link to it.
 */

type SearchResult =
  | { kind: 'restaurant'; id: string; name: string; cuisine?: string; address?: string; score?: number; wishlisted: boolean }
  | { kind: 'list'; id: string; name: string; emoji: string; total: number; type?: string };

const MAX_RESTAURANTS = 6;
const MAX_LISTS = 4;

export const DesktopHeader: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { ratings, wishlist, lists, getRestaurantInfo } = useLists();
  const { unreadCount } = useChat();
  const { pendingRequestCount } = useAuth();

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Search index ─────────────────────────────────────────────────
  // Pull every restaurant the user knows about (rated + wishlisted)
  // and every list, then filter against the query. Local data only —
  // no Google Places call from the header search.
  const restaurantIndex = useMemo(() => {
    const map = new Map<string, SearchResult & { kind: 'restaurant' }>();
    for (const r of ratings) {
      const info = getRestaurantInfo(r.restaurantId) ?? r;
      map.set(r.restaurantId, {
        kind: 'restaurant',
        id: r.restaurantId,
        name: info.name || r.name,
        cuisine: info.cuisine || r.cuisine,
        address: info.address || r.address,
        score: r.score,
        wishlisted: false,
      });
    }
    for (const w of wishlist) {
      const existing = map.get(w.restaurantId);
      if (existing) {
        existing.wishlisted = true;
        continue;
      }
      const info = getRestaurantInfo(w.restaurantId);
      map.set(w.restaurantId, {
        kind: 'restaurant',
        id: w.restaurantId,
        name: info?.name || w.name,
        cuisine: info?.cuisine || w.cuisine,
        address: info?.address || w.address,
        wishlisted: true,
      });
    }
    return Array.from(map.values());
  }, [ratings, wishlist, getRestaurantInfo]);

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const restaurantHits = restaurantIndex
      .filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.cuisine || '').toLowerCase().includes(q) ||
        (r.address || '').toLowerCase().includes(q),
      )
      .slice(0, MAX_RESTAURANTS);
    const listHits: SearchResult[] = lists
      .filter((l) => l.name.toLowerCase().includes(q))
      .slice(0, MAX_LISTS)
      .map((l) => ({
        kind: 'list' as const,
        id: l.id,
        name: l.name,
        emoji: l.emoji,
        total: l.restaurantIds.length + (l.wishlistIds?.length || 0),
        type: l.type,
      }));
    return [...restaurantHits, ...listHits];
  }, [query, restaurantIndex, lists]);

  // Reset highlighted row whenever the result set changes.
  useEffect(() => { setActiveIndex(0); }, [results]);

  // Close on outside click / Escape.
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

  // Close the dropdown whenever the route changes — clicking a result
  // navigates, but other navigation (sidebar clicks etc) shouldn't
  // leave a stale dropdown sitting on top of the new page.
  useEffect(() => {
    setOpen(false);
    setQuery('');
  }, [location.pathname, location.search]);

  const navigateToResult = (r: SearchResult) => {
    if (r.kind === 'restaurant') navigate(`/restaurant/${r.id}`);
    else navigate(`/pantry?list=${encodeURIComponent(r.id)}`);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (!open || results.length === 0) {
      if (e.key === 'Enter' && query.trim()) {
        // Fallback when no local hits — let users still kick off a
        // proper places search from the header.
        navigate('/search/main');
        setOpen(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      navigateToResult(results[activeIndex]);
    }
  };

  const showDropdown = open && (query.trim().length > 0);
  const hasHits = results.length > 0;

  // Group rendering — restaurants first, then lists.
  const restaurantResults = results.filter((r) => r.kind === 'restaurant') as Array<SearchResult & { kind: 'restaurant' }>;
  const listResults = results.filter((r) => r.kind === 'list') as Array<SearchResult & { kind: 'list' }>;

  return (
    <header className="sticky top-0 z-40 bg-surface/85 backdrop-blur-md border-b border-on-surface/[0.06]">
      <div className="px-6 py-3 flex items-center gap-3">
        {/* Search + dropdown */}
        <div ref={wrapperRef} className="relative flex-1 max-w-2xl">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search by name, cuisine, location..."
            className={cn(
              'w-full bg-on-surface/[0.04] hover:bg-on-surface/[0.06]',
              'rounded-full py-2.5 pl-11 pr-10 text-[14px] font-medium text-on-surface',
              'placeholder:text-on-surface/40',
              'focus:outline-none focus:bg-on-surface/[0.06] focus:ring-2 focus:ring-primary/20',
              'transition-colors',
            )}
            aria-label="Search"
            aria-haspopup="listbox"
            aria-expanded={showDropdown}
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); inputRef.current?.focus(); }}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 hover:text-on-surface/70 transition-colors"
            >
              <X size={14} />
            </button>
          )}

          <AnimatePresence>
            {showDropdown && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.99 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.99 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className={cn(
                  'absolute left-0 right-0 top-full mt-2 z-50',
                  'rounded-2xl bg-surface border border-on-surface/[0.08]',
                  'shadow-[0_18px_48px_-12px_rgba(0,0,0,0.22)]',
                  'overflow-hidden',
                )}
                role="listbox"
              >
                {!hasHits ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-sm font-medium text-on-surface/60">No matches yet</p>
                    <p className="text-[12px] text-on-surface/40 mt-1">Try a different name, cuisine, or city</p>
                    <button
                      type="button"
                      onClick={() => { navigate('/search/main'); setOpen(false); }}
                      className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/15 transition-colors"
                    >
                      <Search size={12} /> Search the web for "{query.trim()}"
                    </button>
                  </div>
                ) : (
                  <div className="max-h-[440px] overflow-y-auto py-1">
                    {restaurantResults.length > 0 && (
                      <div>
                        <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                          Restaurants
                        </p>
                        <ul>
                          {restaurantResults.map((r, idx) => {
                            const globalIdx = idx; // restaurants come first
                            const active = activeIndex === globalIdx;
                            return (
                              <li key={`r-${r.id}`}>
                                <button
                                  type="button"
                                  onMouseEnter={() => setActiveIndex(globalIdx)}
                                  onClick={() => navigateToResult(r)}
                                  className={cn(
                                    'w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors',
                                    active ? 'bg-on-surface/[0.05]' : 'hover:bg-on-surface/[0.03]',
                                  )}
                                >
                                  <div className="w-8 h-8 rounded-lg bg-on-surface/[0.05] flex items-center justify-center flex-shrink-0">
                                    {r.score !== undefined && r.score > 0 ? (
                                      <span className={cn('text-[11px] font-serif font-bold tabular-nums', scoreColor(r.score))}>{r.score.toFixed(1)}</span>
                                    ) : r.wishlisted ? (
                                      <Heart size={13} className="text-red-400 fill-red-400" />
                                    ) : (
                                      <Star size={13} className="text-on-surface/35" />
                                    )}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-serif font-bold text-[14px] text-on-surface leading-tight truncate">{r.name}</p>
                                    <p className="text-[11px] text-on-surface/45 leading-tight truncate mt-0.5">
                                      {r.cuisine || 'Restaurant'}
                                      {r.address ? <span className="text-on-surface/30"> · {r.address.split(',').slice(-2)[0]?.trim() || ''}</span> : null}
                                    </p>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {listResults.length > 0 && (
                      <div className={restaurantResults.length > 0 ? 'border-t border-on-surface/[0.06] mt-1 pt-1' : ''}>
                        <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                          Lists
                        </p>
                        <ul>
                          {listResults.map((l, idx) => {
                            const globalIdx = restaurantResults.length + idx;
                            const active = activeIndex === globalIdx;
                            return (
                              <li key={`l-${l.id}`}>
                                <button
                                  type="button"
                                  onMouseEnter={() => setActiveIndex(globalIdx)}
                                  onClick={() => navigateToResult(l)}
                                  className={cn(
                                    'w-full px-4 py-2.5 flex items-center gap-3 text-left transition-colors',
                                    active ? 'bg-on-surface/[0.05]' : 'hover:bg-on-surface/[0.03]',
                                  )}
                                >
                                  <div className="w-8 h-8 rounded-lg bg-on-surface/[0.05] flex items-center justify-center flex-shrink-0 text-base">
                                    {l.emoji}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-serif font-bold text-[14px] text-on-surface leading-tight truncate">{l.name}</p>
                                    <p className="text-[11px] text-on-surface/45 leading-tight truncate mt-0.5 flex items-center gap-1">
                                      <Bookmark size={10} className="text-on-surface/30" /> {l.total} restaurant{l.total === 1 ? '' : 's'}
                                    </p>
                                  </div>
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right side actions */}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/search/main')}
            className={cn(
              'inline-flex items-center gap-2 px-4 py-2.5 rounded-full',
              'bg-primary text-white text-[13px] font-semibold',
              'hover:bg-primary/90 active:scale-[0.99] transition-all shadow-sm',
            )}
          >
            <Plus size={15} strokeWidth={2.5} />
            <span>Add Rating</span>
          </button>

          <button
            type="button"
            onClick={() => navigate('/circle')}
            aria-label="Your circle"
            className="relative w-10 h-10 rounded-full text-on-surface/60 hover:text-on-surface hover:bg-on-surface/[0.05] flex items-center justify-center transition-colors"
          >
            <Users size={18} />
            {pendingRequestCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-surface">
                {pendingRequestCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigate('/messages')}
            aria-label="Messages"
            className="relative w-10 h-10 rounded-full text-on-surface/60 hover:text-on-surface hover:bg-on-surface/[0.05] flex items-center justify-center transition-colors"
          >
            <MessageCircle size={18} />
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-surface">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
