import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search, X, Loader2, Plus, Check } from 'lucide-react';
import { cn } from '../lib/utils';
import { searchPlacesByText, priceLevelToString, formatLocationLabel, type PlaceResult } from '../lib/places';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { loadLastSelectedLocation } from './HomeLocationBar';
import { getCuisineLabel } from '../pages/useRestaurantDetail';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { findMichelinMatchSync, michelinPriceDisplay, type MichelinInfo } from '../lib/michelin';
import type { RestaurantRating } from '../contexts/ListsContext';

/**
 * Spotlight-style search popup. Centered card, scale + fade animation,
 * big search input on top, debounced Google Places results below.
 *
 * Two modes (controlled by `ratedRestaurants`):
 *
 *   • Search-only — `ratedRestaurants` omitted/empty. Just runs a Places
 *     search; picking a result calls `onPickPlace`. Used by the main
 *     rated page's Add Rating button (it already shows every rated
 *     restaurant in the list below it, so re-listing them up here would
 *     be redundant).
 *
 *   • Pick-or-search — `ratedRestaurants` provided. The popup shows your
 *     rated restaurants at the top so you can one-tap any of them onto
 *     the current list (no rating modal — they're already rated). The
 *     debounced Places search appears below as soon as you start typing.
 *     Picking a Place calls `onPickPlace`. Used by Add Rating on a
 *     custom restaurant list / Wishlist.
 *
 * Closes on backdrop click, Escape, or after a pick.
 */

const SEARCH_DEBOUNCE_MS = 240;
// Final fallback bias when the user has never picked a home location (NYC).
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Title shown above the input. Optional — keeps the popup compact. */
  title?: string;
  /** Placeholder for the search input. */
  placeholder?: string;
  /** Optional list of rated restaurants to surface as one-tap pickers
   *  before any search is run. Pass an empty array (or omit) to render
   *  search-only mode. */
  ratedRestaurants?: RestaurantRating[];
  /** Restaurant ids already on the target list — rendered with a
   *  greyed-out "Added" pill so the user can't pick them twice. */
  excludeIds?: Set<string>;
  /** Click handler for a rated restaurant pick (single-select mode). */
  onPickRated?: (rating: RestaurantRating) => void;
  /** Click handler for a Places search result pick. */
  onPickPlace: (place: PlaceResult) => void;
  /** When true, rated rows accumulate selection until the user clicks
   *  Done — useful for adding a batch of restaurants to a list at once.
   *  Search results stay single-pick (each one opens the rating modal
   *  immediately). */
  multiSelectRated?: boolean;
  /** Called with the full set of selected ratings when Done is clicked.
   *  Required when multiSelectRated is true. */
  onCommitRated?: (ratings: RestaurantRating[]) => void;
}

export const SearchPopup: React.FC<Props> = ({
  open,
  onClose,
  title,
  placeholder = 'Search for a restaurant…',
  ratedRestaurants,
  excludeIds,
  onPickRated,
  onPickPlace,
  multiSelectRated = false,
  onCommitRated,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Bias the Places search to the user's picked home location — the old
  // hardcoded NYC default gave everyone Manhattan-flavored results. Falls
  // back to the stored value outside the provider, then NYC.
  const homeCtx = useHomeLocation();
  const storedHome = useMemo(() => (homeCtx ? null : loadLastSelectedLocation()), [homeCtx]);
  const homeLoc = homeCtx ? homeCtx.location : storedHome;
  const biasLat = homeLoc && Number.isFinite(homeLoc.lat) ? homeLoc.lat : DEFAULT_LAT;
  const biasLng = homeLoc && Number.isFinite(homeLoc.lng) ? homeLoc.lng : DEFAULT_LNG;

  // Michelin overlay: resolve matches for the whole results array once the
  // dataset is loaded (hooks can't run per-row inside the map below).
  const michelinReady = useMichelinIndexReady();
  const michelinByPlaceId = useMemo(() => {
    const m: Record<string, MichelinInfo> = {};
    if (!michelinReady) return m;
    for (const p of results) {
      const hit = findMichelinMatchSync(p.name, p.lat, p.lng, p.fullAddress || p.address);
      if (hit) m[p.id] = hit;
    }
    return m;
  }, [michelinReady, results]);
  // Multi-select mode: rated rows toggle into this set instead of
  // immediately calling onPickRated. Reset whenever the popup re-opens.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  // Reset state when popup opens; focus input. Using a small timeout so
  // the focus lands after the modal's animation has started — focusing
  // immediately can race with the layout settle and lose the cursor.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setResults([]);
    setSearching(false);
    setSelectedIds(new Set());
    const t = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  // Debounced Places search.
  const trimmed = query.trim();
  useEffect(() => {
    if (!open) return;
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
        const found = await searchPlacesByText(trimmed, biasLat, biasLng);
        if (reqId !== requestIdRef.current) return;
        setResults(found);
      } catch {
        if (reqId === requestIdRef.current) setResults([]);
      } finally {
        if (reqId === requestIdRef.current) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [trimmed, open, biasLat, biasLng]);

  // ESC closes the popup.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const filteredRated = useMemo(() => {
    if (!ratedRestaurants || ratedRestaurants.length === 0) return [];
    if (!trimmed) return ratedRestaurants;
    const q = trimmed.toLowerCase();
    return ratedRestaurants.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.cuisine.toLowerCase().includes(q) ||
        r.address.toLowerCase().includes(q),
    );
  }, [ratedRestaurants, trimmed]);

  const showRatedSection = ratedRestaurants !== undefined && ratedRestaurants.length > 0;
  const showSearchSection = trimmed.length > 0;
  // Empty state: nothing typed yet AND no rated section to show.
  const showEmptyState = !showRatedSection && !showSearchSection;

  if (!open && typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="search-popup-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          className="fixed inset-0 z-[120] bg-black/50 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4"
        >
          <motion.div
            key="search-popup-card"
            initial={{ opacity: 0, scale: 0.94, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -8 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-surface rounded-[28px] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06] overflow-hidden flex flex-col max-h-[70vh]"
          >
            {/* Search input — large, Spotlight-style. */}
            <div className="flex-shrink-0 flex items-center gap-3 px-6 py-5">
              <Search size={22} strokeWidth={2.2} className="text-on-surface/45 flex-shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                className="flex-1 bg-transparent text-[20px] font-medium text-on-surface placeholder:text-on-surface/35 focus:outline-none"
                aria-label="Search restaurants"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                  aria-label="Clear search"
                  className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface/40 hover:text-on-surface hover:bg-on-surface/[0.05] flex-shrink-0 transition-colors"
                >
                  <X size={15} />
                </button>
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface/40 hover:text-on-surface hover:bg-on-surface/[0.05] flex-shrink-0 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
            <div className="border-t border-on-surface/[0.06]" />

            {/* Title (optional) */}
            {title && (
              <div className="px-5 pt-3 pb-1 flex-shrink-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">{title}</p>
              </div>
            )}

            <div className="flex-1 overflow-y-auto pb-2">
              {/* Rated section — only when caller passed in rated restaurants */}
              {showRatedSection && (
                <>
                  <div className="px-6 pt-3 pb-1 flex items-center justify-between">
                    <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                      Your rated restaurants
                    </p>
                    {multiSelectRated && selectedIds.size > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedIds(new Set())}
                        className="text-[11px] font-semibold text-on-surface/45 hover:text-on-surface/70 transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {filteredRated.length === 0 ? (
                    <p className="px-6 py-3 text-[13px] text-on-surface/45">
                      No rated restaurants match "{trimmed}".
                    </p>
                  ) : (
                    <ul className="pb-1">
                      {filteredRated.map((r) => {
                        const already = excludeIds?.has(r.restaurantId);
                        const isSelected = selectedIds.has(r.restaurantId);
                        return (
                          <PopupRow
                            key={r.restaurantId}
                            name={r.name}
                            sub={[r.cuisine || 'Restaurant', r.price].filter(Boolean).join(' · ')}
                            score={r.score}
                            disabled={already}
                            statusLabel={already ? 'Added' : undefined}
                            multiSelect={multiSelectRated && !already}
                            selected={isSelected}
                            onClick={() => {
                              if (already) return;
                              if (multiSelectRated) {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.restaurantId)) next.delete(r.restaurantId);
                                  else next.add(r.restaurantId);
                                  return next;
                                });
                              } else {
                                onPickRated?.(r);
                              }
                            }}
                          />
                        );
                      })}
                    </ul>
                  )}
                </>
              )}

              {/* Search results — only when there's a query */}
              {showSearchSection && (
                <>
                  <p className="px-5 pt-3 pb-1 text-[11px] font-bold uppercase tracking-[0.16em] text-on-surface/40">
                    {showRatedSection ? 'Add a new place' : 'Search results'}
                  </p>
                  {searching && results.length === 0 ? (
                    <div className="px-5 py-6 flex items-center justify-center gap-2 text-on-surface/55">
                      <Loader2 size={14} className="animate-spin" />
                      <span className="text-[13px] font-medium">Searching restaurants…</span>
                    </div>
                  ) : results.length === 0 ? (
                    <p className="px-5 py-6 text-center text-[13px] text-on-surface/45">
                      No matches found.
                    </p>
                  ) : (
                    <ul className="pb-2">
                      {results.map((p) => {
                        const already = excludeIds?.has(p.id);
                        const mich = michelinByPlaceId[p.id];
                        // Michelin matches show the Guide's cuisine + $-tier price
                        // (location kept for context); else the usual derived sub.
                        const sub = mich
                          ? [mich.cuisine, michelinPriceDisplay(mich), formatLocationLabel(p.addressComponents, p.fullAddress || p.address)].filter(Boolean).join(' · ')
                          : [getCuisineLabel(p), priceLevelToString(p.priceLevel), formatLocationLabel(p.addressComponents, p.fullAddress || p.address)].filter(Boolean).join(' · ');
                        return (
                          <PopupRow
                            key={p.id}
                            name={p.name}
                            sub={sub}
                            disabled={already}
                            statusLabel={already ? 'Added' : undefined}
                            onClick={() => {
                              if (already) return;
                              onPickPlace(p);
                            }}
                          />
                        );
                      })}
                    </ul>
                  )}
                </>
              )}

              {/* Empty state when no rated section AND nothing typed */}
              {showEmptyState && (
                <div className="px-6 py-14 flex flex-col items-center gap-2 text-center">
                  <Search size={32} className="text-on-surface/20" strokeWidth={1.6} />
                  <p className="text-[14px] font-semibold text-on-surface/55 mt-1">Start typing to find a place</p>
                  <p className="text-[12px] text-on-surface/35 max-w-[280px]">
                    Search any restaurant by name, cuisine, or city. Picking it opens the rating modal.
                  </p>
                </div>
              )}
            </div>

            {/* Done footer — only in multi-select mode and when something
                is selected. Commits the whole batch in one shot. */}
            {multiSelectRated && (
              <div className="flex-shrink-0 border-t border-on-surface/[0.06] px-5 py-3 flex items-center justify-between gap-3">
                <p className="text-[12px] text-on-surface/55">
                  {selectedIds.size === 0
                    ? 'Tap restaurants to add them to this list'
                    : `${selectedIds.size} selected`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedIds.size === 0 || !onCommitRated || !ratedRestaurants) return;
                    const picked = ratedRestaurants.filter((r) => selectedIds.has(r.restaurantId));
                    onCommitRated(picked);
                  }}
                  disabled={selectedIds.size === 0}
                  className={cn(
                    'inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold transition-all',
                    selectedIds.size > 0
                      ? 'bg-primary text-white hover:bg-primary/90 active:scale-[0.99] shadow-sm'
                      : 'bg-on-surface/[0.06] text-on-surface/40 cursor-not-allowed',
                  )}
                >
                  <Check size={14} strokeWidth={2.6} />
                  <span>{selectedIds.size > 0 ? `Add ${selectedIds.size}` : 'Add to list'}</span>
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};

/* ── Single result row ──────────────────────────────────────────────── */
const PopupRow: React.FC<{
  name: string;
  sub: string;
  score?: number;
  disabled?: boolean;
  statusLabel?: string;
  multiSelect?: boolean;
  selected?: boolean;
  onClick: () => void;
}> = ({ name, sub, score, disabled, statusLabel, multiSelect, selected, onClick }) => (
  <li>
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full px-6 py-3 flex items-center gap-3 text-left transition-colors',
        disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-on-surface/[0.04]',
        selected && 'bg-primary/[0.04]',
      )}
    >
      {/* Checkbox-style indicator on the left in multi-select mode */}
      {multiSelect && (
        <span
          aria-hidden="true"
          className={cn(
            'flex-shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors',
            selected
              ? 'bg-primary border-primary text-white'
              : 'border-on-surface/20',
          )}
        >
          {selected && <Check size={13} strokeWidth={3} />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="font-serif text-[15px] font-bold text-on-surface leading-tight truncate">{name}</p>
        {sub && (
          <p className="text-[12px] text-on-surface/50 leading-tight truncate mt-0.5">{sub}</p>
        )}
      </div>
      {score !== undefined && score > 0 && (
        <span className="flex-shrink-0 text-[12px] font-bold tabular-nums text-on-surface/70">
          {score.toFixed(1)}
        </span>
      )}
      {statusLabel ? (
        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/45">
          <Check size={12} /> {statusLabel}
        </span>
      ) : !multiSelect ? (
        <Plus size={15} strokeWidth={2.4} className="flex-shrink-0 text-on-surface/35" />
      ) : null}
    </button>
  </li>
);
