import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bookmark, Check, ChevronDown, Clock, Loader2, MapPin, Navigation,
  Plus, Search, Star, X,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useLists } from '../contexts/ListsContext';
import { useAuth } from '../contexts/AuthContext';
import { cn } from '../lib/utils';
import {
  buildTasteProfile,
  gatherRecCandidates,
  scoreCandidates,
  haversineKm,
  type RecPool,
  type ScoredPlace,
} from '../lib/recommendations';
import { ScoreRing } from './cards';
import {
  HomeLocationBar,
  loadLastSelectedLocation,
  saveLastSelectedLocation,
  getCurrentHomeLocation,
  type HomeLocation,
} from './HomeLocationBar';
import { getCuisineLabel } from '../pages/useRestaurantDetail';
import { CUISINE_TYPES } from '../lib/places';
import { getOpenStatus } from '../lib/useRestaurantLocationLabel';
import { useMichelinIndexReady } from '../lib/useMichelinMatch';
import { MichelinMark } from './MichelinBadge';
import type { MichelinInfo } from '../lib/michelin';

/* ── Ranked recommendations browser ──────────────────────────────────────
   Opened from the Pantry's "For you" button. A full-surface popup that
   runs the recommendation engine for the selected location and shows the
   ENTIRE ranked list — #1 downward — with dropdown filters (cuisine /
   price / Michelin / open now / radius), sorting that keeps each place's
   best-match rank number, and a location switcher.

   Chrome follows the app's two established popup modes (see GuidesBrowser):
   - Desktop: backdrop + centered spotlight card.
   - Mobile: full-page slide-up panel with a back arrow.
   ──────────────────────────────────────────────────────────────────────── */

const RADIUS_OPTIONS = [2, 5, 8, 15, 25] as const;
const PRICE_TIERS = [1, 2, 3, 4] as const;

type MichKey = 'star1' | 'star2' | 'star3' | 'bib' | 'selected';
const MICH_FILTERS: Array<{ key: MichKey; label: string }> = [
  { key: 'star1', label: '1 Michelin star' },
  { key: 'star2', label: '2 Michelin stars' },
  { key: 'star3', label: '3 Michelin stars' },
  { key: 'bib', label: 'Bib Gourmand' },
  { key: 'selected', label: 'Michelin Guide' },
];

// The full cuisine menu — every canonical label (same catalogue the location
// page filters by), not just whatever the current pool happens to contain.
const ALL_CUISINE_LABELS = CUISINE_TYPES.filter((c) => c.type !== '').map((c) => c.label);

/* Gathered pools outlive the popup AND the page that mounted it: reopening
   recs for a recently viewed city re-ranks the cached pool with ZERO network
   spend (Google text search, Michelin sync, community batches all live in
   the pool). TTL keeps hours/ratings from going stale; the size cap bounds
   memory when someone tours many cities. */
const POOL_TTL_MS = 30 * 60 * 1000;
const POOL_CACHE_MAX = 12;
const poolCache = new Map<string, RecPool>();

type SortKey = 'match' | 'rating' | 'distance';
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'match', label: 'Best match' },
  { key: 'rating', label: 'Top rated' },
  { key: 'distance', label: 'Nearest' },
];

const fmtMiles = (mi: number): string => {
  if (!Number.isFinite(mi)) return '';
  if (mi < 0.1) return '<0.1 mi';
  if (mi < 10) return `${mi.toFixed(1)} mi`;
  return `${Math.round(mi)} mi`;
};

/* Compact dropdown filter pill — trigger + backdrop + anchored panel. The
   panel stays open across multi-select toggles; the backdrop (or the pill)
   closes it. */
const DropdownPill: React.FC<{
  label: string;
  badge?: number;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  alignRight?: boolean;
  /** Extra panel classes (tailwind-merged over the defaults) — used by the
   *  cuisine menu to widen itself and pin a search box above the scroll. */
  panelClassName?: string;
  children: React.ReactNode;
}> = ({ label, badge, open, onToggle, onClose, alignRight, panelClassName, children }) => (
  <div className="relative flex-shrink-0">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors whitespace-nowrap',
        badge
          ? 'border-on-surface bg-on-surface text-surface'
          : 'border-on-surface/12 text-on-surface/60 hover:border-on-surface/30',
      )}
    >
      {label}
      {badge ? <span className="text-[10.5px] font-bold text-surface/60">{badge}</span> : null}
      <ChevronDown size={12} className={cn('transition-transform', open && 'rotate-180')} />
    </button>
    {open && (
      <>
        <div className="fixed inset-0 z-10" onClick={onClose} />
        <div
          className={cn(
            'absolute top-full z-20 mt-1.5 max-h-72 w-56 overflow-y-auto overscroll-contain rounded-2xl border border-on-surface/[0.08] bg-white py-1 shadow-xl',
            alignRight ? 'right-0' : 'left-0',
            panelClassName,
          )}
        >
          {children}
        </div>
      </>
    )}
  </div>
);

const MenuOption: React.FC<{
  label: string;
  count?: number;
  selected: boolean;
  onToggle: () => void;
}> = ({ label, count, selected, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={selected}
    className={cn(
      'flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-on-surface/[0.04]',
      selected ? 'text-primary' : 'text-on-surface/75',
    )}
  >
    <span className="min-w-0 truncate">{label}</span>
    <span className="flex flex-shrink-0 items-center gap-2">
      {count !== undefined && <span className="text-[11px] font-bold text-on-surface/35">{count}</span>}
      {selected && <Check size={14} />}
    </span>
  </button>
);

interface RecommendationsBrowserProps {
  open: boolean;
  onClose: () => void;
  /** Parent-supplied mobile signal (each page already has its own). */
  isMobile: boolean;
  /**
   * 'popup' (default) — portaled overlay: slide-up pager on mobile,
   * spotlight card on desktop. 'page' — inline full-height layout for the
   * /pantry/recommended route: restaurant taps push the detail page on top
   * (no closing), so swipe-back returns here with the ranking intact.
   */
  variant?: 'popup' | 'page';
}

export const RecommendationsBrowser: React.FC<RecommendationsBrowserProps> = ({ open, onClose, isMobile, variant = 'popup' }) => {
  const isPage = variant === 'page';
  const navigate = useNavigate();
  const { setHideBottomNav } = useSettings();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { ratings, wishlist, lists, toggleWishlist, isWishlisted, openAddRestaurantModal } = useLists();

  const [target, setTarget] = useState<HomeLocation | null>(() => loadLastSelectedLocation());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [radiusMiles, setRadiusMiles] = useState<number>(8);
  const [radiusMenuOpen, setRadiusMenuOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [pool, setPool] = useState<RecPool | null>(null);

  const [cuisineSel, setCuisineSel] = useState<Set<string>>(new Set());
  const [cuisineQuery, setCuisineQuery] = useState('');
  const [priceSel, setPriceSel] = useState<Set<number>>(new Set());
  const [michSel, setMichSel] = useState<Set<MichKey>>(new Set());
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('match');
  const [openFilter, setOpenFilter] = useState<'cuisine' | 'price' | 'michelin' | null>(null);

  // Sync to the app-wide saved location every open (it may have changed on
  // Discover / the location page since the last one), and reset the view
  // filters so each visit starts from the honest full ranking. Keep the
  // previous object identity when nothing changed — a fresh-but-equal target
  // would re-fire the gather effect mid-flight and double the Places spend.
  useEffect(() => {
    if (!open) return;
    setTarget((prev) => {
      const next = loadLastSelectedLocation();
      if (prev && next && prev.lat === next.lat && prev.lng === next.lng && prev.label === next.label) {
        return prev;
      }
      return next;
    });
    setCuisineSel(new Set());
    setCuisineQuery('');
    setPriceSel(new Set());
    setMichSel(new Set());
    setOpenNowOnly(false);
    setSortBy('match');
    setRadiusMenuOpen(false);
    setOpenFilter(null);
  }, [open]);

  // The mobile full-pager covers the bottom nav's space — hide it.
  useEffect(() => {
    setHideBottomNav(open && isMobile);
    return () => setHideBottomNav(false);
  }, [open, isMobile, setHideBottomNav]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // The taste profile stays LIVE: any rating add/edit/delete rebuilds it and
  // the scoring memo below re-ranks the cached pool synchronously — no
  // refetch, no stale rows, predictions and chips update in place. The
  // Michelin-readiness flag is a dep so the profile's michelinTaste shares
  // (index-gated inside the builder) appear once the dataset loads.
  const michelinReady = useMichelinIndexReady();
  const liveProfile = useMemo(
    () => buildTasteProfile(ratings, wishlist, lists, []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ratings, wishlist, lists, michelinReady],
  );

  // Gather the candidate pool (network) — profile changes deliberately do
  // NOT re-run this; they only re-score.
  useEffect(() => {
    if (!open || !target) return;
    const key = `${userId ?? 'anon'}|${target.lat.toFixed(3)},${target.lng.toFixed(3)}|${radiusMiles}`;
    const cached = poolCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < POOL_TTL_MS) {
      setPool(cached);
      setLoading(false);
      return;
    }
    if (cached) poolCache.delete(key); // expired
    let cancelled = false;
    // Abort the in-flight Google fan-out on close/retarget — the cancelled
    // flag alone only ignored the RESULT while up to 8 queries kept running
    // (and their pool write could land in the shared cache anyway).
    const controller = new AbortController();
    setLoading(true);
    setPool(null);
    gatherRecCandidates({
      userId,
      profile: liveProfile,
      target: { label: target.label, lat: target.lat, lng: target.lng },
      radiusMeters: Math.round(radiusMiles * 1609.34),
      maxQueries: 8,
      signal: controller.signal,
    })
      .then((out) => {
        if (cancelled) return;
        poolCache.set(key, out);
        // Evict oldest-inserted entries past the cap (Map preserves order).
        while (poolCache.size > POOL_CACHE_MAX) {
          const oldest = poolCache.keys().next().value;
          if (oldest === undefined) break;
          poolCache.delete(oldest);
        }
        setPool(out);
      })
      .catch(() => { if (!cancelled) setPool(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target, radiusMiles, userId]);

  // Rank the pool against the live profile. Rated places drop out here
  // (skipUserHistory), so rating from inside the popup removes the row and
  // re-ranks the rest in the same render.
  const results = useMemo<ScoredPlace[]>(() => {
    if (!pool || !target) return [];
    return scoreCandidates(
      pool.candidates,
      liveProfile,
      pool.signals,
      { label: target.label, lat: target.lat, lng: target.lng },
      Math.round(radiusMiles * 1609.34),
      { limit: 60, skipUserHistory: true, keepWishlisted: true, enforcePriceBand: true },
    );
  }, [pool, liveProfile, target, radiusMiles]);

  const enriched = useMemo(
    () =>
      results.map((p) => ({
        place: p,
        cuisineLabel: getCuisineLabel(p.types || []),
        distanceMi: target
          ? haversineKm({ lat: p.lat, lng: p.lng }, { lat: target.lat, lng: target.lng }) * 0.621371
          : Number.NaN,
      })),
    [results, target],
  );

  // Every place keeps its BEST-MATCH rank number no matter how the list is
  // re-sorted or filtered — "#7" means the 7th best pick for you, always.
  const rankById = useMemo(() => {
    const m = new Map<string, number>();
    enriched.forEach((e, i) => m.set(e.place.id, i + 1));
    return m;
  }, [enriched]);

  // Cuisine dropdown options: the FULL canonical catalogue (same list the
  // location page filters by) plus any pool-only labels, with live counts.
  // Cuisines present in the current ranking float to the top by count;
  // the rest follow alphabetically so the search box has everything.
  const cuisineOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enriched) {
      if (e.cuisineLabel) counts.set(e.cuisineLabel, (counts.get(e.cuisineLabel) ?? 0) + 1);
    }
    const all = new Set<string>([...ALL_CUISINE_LABELS, ...counts.keys()]);
    return Array.from(all, (label): [string, number] => [label, counts.get(label) ?? 0])
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [enriched]);

  const visibleCuisineOptions = useMemo(() => {
    const q = cuisineQuery.trim().toLowerCase();
    if (!q) return cuisineOptions;
    return cuisineOptions.filter(([label]) => label.toLowerCase().includes(q));
  }, [cuisineOptions, cuisineQuery]);

  const priceCounts = useMemo(() => {
    const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
    for (const e of enriched) {
      if (e.place.priceLevel >= 1 && e.place.priceLevel <= 4) counts[e.place.priceLevel]++;
    }
    return counts;
  }, [enriched]);

  // The Michelin dropdown only renders for categories actually present in
  // the current pool — no dead filters in Guide-less cities. Stars are
  // bucketed per count so "only 3-star places" is one tap.
  const michelinCounts = useMemo(() => {
    const counts: Record<MichKey, number> = { star1: 0, star2: 0, star3: 0, bib: 0, selected: 0 };
    for (const e of enriched) {
      const m = e.place.michelin;
      if (!m) continue;
      if (m.stars >= 3) counts.star3++;
      else if (m.stars === 2) counts.star2++;
      else if (m.stars === 1) counts.star1++;
      else if (m.bibGourmand) counts.bib++;
      else if (m.selected) counts.selected++;
    }
    return counts;
  }, [enriched]);
  const anyMichelin = MICH_FILTERS.some(({ key }) => michelinCounts[key] > 0);

  const visible = useMemo(() => {
    const list = enriched.filter((e) => {
      if (cuisineSel.size > 0 && !cuisineSel.has(e.cuisineLabel)) return false;
      if (priceSel.size > 0 && !(e.place.priceLevel > 0 && priceSel.has(e.place.priceLevel))) return false;
      if (michSel.size > 0) {
        const m = e.place.michelin;
        const hit = !!m && (
          (michSel.has('star1') && m.stars === 1) ||
          (michSel.has('star2') && m.stars === 2) ||
          (michSel.has('star3') && m.stars >= 3) ||
          (michSel.has('bib') && m.bibGourmand && m.stars === 0) ||
          (michSel.has('selected') && m.selected && m.stars === 0 && !m.bibGourmand)
        );
        if (!hit) return false;
      }
      // "Open now" keeps unknown-hours places (same convention as the app's
      // hours filter): missing data shouldn't read as "closed".
      if (openNowOnly && getOpenStatus(e.place.hours).open === false) return false;
      return true;
    });
    switch (sortBy) {
      case 'rating':
        return [...list].sort((a, b) => (b.place.rating || 0) - (a.place.rating || 0));
      case 'distance':
        return [...list].sort((a, b) => (a.distanceMi || Infinity) - (b.distanceMi || Infinity));
      default:
        return list; // engine order = best match
    }
  }, [enriched, cuisineSel, priceSel, michSel, openNowOnly, sortBy]);

  const city = target?.label?.split(',')[0]?.trim() || '';

  const toggleCuisine = (label: string) =>
    setCuisineSel((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  const togglePrice = (tier: number) =>
    setPriceSel((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });

  const toggleMich = (key: MichKey) =>
    setMichSel((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const handleUseCurrent = async (): Promise<void> => {
    const loc = await getCurrentHomeLocation();
    saveLastSelectedLocation(loc);
    setTarget(loc);
  };

  /* ── Header ── */
  const locationChip = (
    <button
      type="button"
      onClick={() => setPickerOpen(true)}
      className={cn(
        'inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-on-surface/[0.08] bg-on-surface/[0.04] px-3 py-1.5 text-left transition-colors hover:bg-on-surface/[0.08]',
        isMobile && 'flex-1',
      )}
      aria-label="Change location"
    >
      <MapPin size={12} className="flex-shrink-0 text-on-surface/55" />
      <span className="truncate text-[12.5px] font-bold leading-none text-on-surface">
        {target ? target.label.split(',').slice(0, 2).join(',') : 'Choose a location'}
      </span>
      <ChevronDown size={12} className={cn('flex-shrink-0 text-on-surface/45', isMobile && 'ml-auto')} />
    </button>
  );

  /* ── Controls ── */
  const sortSegment = (
    <div className={cn('flex items-center gap-0.5 rounded-full bg-on-surface/[0.045] p-0.5', isMobile && 'w-full')}>
      {SORTS.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => setSortBy(key)}
          aria-pressed={sortBy === key}
          className={cn(
            'rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors whitespace-nowrap',
            isMobile && 'flex-1 text-center',
            sortBy === key ? 'bg-white text-on-surface shadow-sm' : 'text-on-surface/50 hover:text-on-surface',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const openNowBtn = (
    <button
      type="button"
      onClick={() => setOpenNowOnly((v) => !v)}
      aria-pressed={openNowOnly}
      className={cn(
        'inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors whitespace-nowrap',
        openNowOnly
          ? 'border-primary/30 bg-primary/10 text-primary'
          : 'border-on-surface/12 text-on-surface/60 hover:border-on-surface/30',
      )}
    >
      <Clock size={12} />
      Open now
    </button>
  );

  const radiusMenu = (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setRadiusMenuOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-on-surface/12 px-3 py-1.5 text-[12px] font-semibold text-on-surface/60 transition-colors hover:border-on-surface/30 whitespace-nowrap"
        aria-label="Search radius"
      >
        <Navigation size={12} />
        {radiusMiles} mi
        <ChevronDown size={12} className={cn('transition-transform', radiusMenuOpen && 'rotate-180')} />
      </button>
      {radiusMenuOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setRadiusMenuOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-36 overflow-hidden rounded-2xl border border-on-surface/[0.08] bg-white py-1 shadow-xl">
            {RADIUS_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => { setRadiusMiles(r); setRadiusMenuOpen(false); }}
                className={cn(
                  'flex w-full items-center justify-between px-3.5 py-2 text-left text-[13px] font-semibold transition-colors hover:bg-on-surface/[0.04]',
                  r === radiusMiles ? 'text-primary' : 'text-on-surface/75',
                )}
              >
                Within {r} mi
                {r === radiusMiles && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );

  const controls = (
    <div className={cn('flex-shrink-0 space-y-2.5 border-b border-on-surface/6 pb-3 pt-3', isMobile ? 'px-4' : 'px-5')}>
      {isMobile ? (
        <>
          {/* Phone: location + radius get their own non-scrolling row (the
              radius popover would be clipped inside an overflow-x row),
              then full-width sort tabs. */}
          <div className="flex items-center gap-2">
            {locationChip}
            {radiusMenu}
          </div>
          {sortSegment}
        </>
      ) : (
        <div className="flex items-center gap-2">
          {sortSegment}
          <div className="ml-auto flex items-center gap-2">
            {openNowBtn}
            {radiusMenu}
          </div>
        </div>
      )}

      {/* Filter dropdowns — compact pills instead of one long chip row.
          Panels are anchored popovers, so this row never scrolls. */}
      <div className="flex flex-wrap items-center gap-2">
        {isMobile && openNowBtn}
        <DropdownPill
          label="Cuisine"
          badge={cuisineSel.size || undefined}
          open={openFilter === 'cuisine'}
          onToggle={() => { setCuisineQuery(''); setOpenFilter((v) => (v === 'cuisine' ? null : 'cuisine')); }}
          onClose={() => setOpenFilter(null)}
          panelClassName="flex max-h-80 w-64 flex-col overflow-hidden p-0"
        >
          <div className="flex-shrink-0 border-b border-on-surface/[0.06] p-2">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-on-surface/35" />
              <input
                type="text"
                autoFocus={!isMobile}
                value={cuisineQuery}
                onChange={(e) => setCuisineQuery(e.target.value)}
                placeholder="Search cuisines..."
                aria-label="Search cuisines"
                className="w-full rounded-lg bg-on-surface/[0.05] py-1.5 pl-8 pr-2.5 text-[12.5px] font-medium text-on-surface placeholder:text-on-surface/40 focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
            {visibleCuisineOptions.length === 0 ? (
              <p className="px-3.5 py-4 text-center text-[12.5px] text-on-surface/45">No matches</p>
            ) : (
              visibleCuisineOptions.map(([label, count]) => (
                <MenuOption
                  key={label}
                  label={label}
                  count={count || undefined}
                  selected={cuisineSel.has(label)}
                  onToggle={() => toggleCuisine(label)}
                />
              ))
            )}
          </div>
        </DropdownPill>
        <DropdownPill
          label="Price"
          badge={priceSel.size || undefined}
          open={openFilter === 'price'}
          onToggle={() => setOpenFilter((v) => (v === 'price' ? null : 'price'))}
          onClose={() => setOpenFilter(null)}
        >
          {PRICE_TIERS.map((tier) => (
            <MenuOption
              key={tier}
              label={'$'.repeat(tier)}
              count={priceCounts[tier]}
              selected={priceSel.has(tier)}
              onToggle={() => togglePrice(tier)}
            />
          ))}
        </DropdownPill>
        {anyMichelin && (
          <DropdownPill
            label="Michelin"
            badge={michSel.size || undefined}
            open={openFilter === 'michelin'}
            onToggle={() => setOpenFilter((v) => (v === 'michelin' ? null : 'michelin'))}
            onClose={() => setOpenFilter(null)}
          >
            {MICH_FILTERS.map(({ key, label }) => {
              const count = michelinCounts[key];
              if (count === 0) return null;
              return (
                <MenuOption
                  key={key}
                  label={label}
                  count={count}
                  selected={michSel.has(key)}
                  onToggle={() => toggleMich(key)}
                />
              );
            })}
          </DropdownPill>
        )}
        {(cuisineSel.size > 0 || priceSel.size > 0 || michSel.size > 0) && (
          <button
            type="button"
            onClick={() => { setCuisineSel(new Set()); setPriceSel(new Set()); setMichSel(new Set()); }}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-red-500/80 transition-colors hover:text-red-500"
          >
            <X size={11} />
            Clear
          </button>
        )}
      </div>
    </div>
  );

  /* ── Rows ── */
  const rankedRow = (entry: (typeof visible)[number], rank: number) => {
    const p = entry.place;
    const wishlisted = isWishlisted(p.id);
    const priceText = p.priceLevel > 0 ? '$'.repeat(p.priceLevel) : '';
    const metaLine = [entry.cuisineLabel, priceText, Number.isFinite(entry.distanceMi) ? fmtMiles(entry.distanceMi) : '']
      .filter(Boolean)
      .join(' · ');
    const meta = {
      id: p.id,
      name: p.name,
      image: p.photoUrl || '',
      cuisine: entry.cuisineLabel,
      price: priceText,
      address: p.fullAddress || p.address,
    };
    return (
      <div
        key={p.id}
        role="button"
        tabIndex={0}
        // Page mode keeps this surface alive underneath — the detail page
        // pushes on top and a back-swipe reveals the ranking again.
        onClick={() => { if (!isPage) onClose(); navigate(`/restaurant/${p.id}`); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!isPage) onClose(); navigate(`/restaurant/${p.id}`); }
        }}
        className={cn(
          'group flex w-full cursor-pointer items-center gap-3 py-3.5 text-left transition-colors hover:bg-on-surface/[0.025] sm:gap-3.5',
          isMobile ? 'px-4' : 'px-5',
        )}
      >
        {/* Rank — text-only rows: the number IS the visual anchor. */}
        <span
          className={cn(
            'grid h-7 w-7 flex-shrink-0 place-items-center rounded-full text-[12.5px] font-bold tabular-nums',
            rank <= 3 ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/55',
          )}
        >
          {rank}
        </span>

        {/* Name · meta. The engine's "why" chips are intentionally NOT
            rendered — the card stays factual (name, cuisine, price,
            distance, stars); the ranking itself is the recommendation. */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h4 className="min-w-0 truncate font-serif text-[15.5px] font-semibold leading-[1.2] tracking-[-0.01em] text-on-surface group-hover:text-primary transition-colors">
              {p.name}
            </h4>
            {p.michelin && (
              <MichelinMark michelin={p.michelin as MichelinInfo} size={11} className="flex-shrink-0 self-center" />
            )}
            {p.rating > 0 && (
              <span className="inline-flex flex-shrink-0 items-center gap-0.5 text-[11.5px] font-semibold text-on-surface/50">
                <Star size={10.5} className="fill-amber-400 text-amber-400" />
                {p.rating.toFixed(1)}
              </span>
            )}
          </div>
          {metaLine && <p className="mt-0.5 truncate text-[12px] font-medium text-on-surface/55">{metaLine}</p>}
        </div>

        {/* Actions + prediction — one horizontal cluster on BOTH layouts:
            wishlist and rate sit to the LEFT of the score ring and are
            always visible (no hover reveal). */}
        <div className={cn('flex flex-shrink-0 items-center', isMobile ? 'gap-2' : 'gap-2.5')}>
          <div className={cn('flex items-center', isMobile ? 'gap-1' : 'gap-1.5')}>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
              className={cn(
                'grid place-items-center rounded-full bg-on-surface/[0.05] transition-colors hover:bg-on-surface/[0.1]',
                isMobile ? 'h-7 w-7' : 'h-8 w-8',
                wishlisted ? 'text-primary' : 'text-on-surface/60',
              )}
              aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
            >
              <Bookmark size={isMobile ? 13 : 14} className={wishlisted ? 'fill-current' : ''} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); if (!isPage) onClose(); openAddRestaurantModal(meta); }}
              className={cn(
                'grid place-items-center rounded-full bg-on-surface/[0.05] text-on-surface/60 transition-colors hover:bg-on-surface/[0.1]',
                isMobile ? 'h-7 w-7' : 'h-8 w-8',
              )}
              aria-label="Rate"
            >
              <Plus size={isMobile ? 14 : 15} />
            </button>
          </div>
          {typeof p.predicted === 'number' && (
            <div className="flex flex-col items-center">
              <ScoreRing score={p.predicted} size={isMobile ? 40 : 44} />
              <p className={cn('mt-0.5 font-bold uppercase tracking-[0.12em] text-on-surface/35', isMobile ? 'text-[8px]' : 'text-[8.5px]')}>for you</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ── Body ── */
  const body = (
    <div className="flex-1 overflow-y-auto overscroll-contain pb-safe-5">
      {!target ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-on-surface/[0.05] text-on-surface/40">
            <MapPin size={20} />
          </div>
          <p className="mt-3 font-serif text-[17px] font-semibold text-on-surface">Where are we eating?</p>
          <p className="mt-1 max-w-[260px] text-[13px] leading-snug text-on-surface/55">
            Pick a location and we&rsquo;ll rank the restaurants around it for your taste.
          </p>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="mt-4 rounded-full bg-primary px-4 py-2 text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
          >
            Choose a location
          </button>
        </div>
      ) : loading ? (
        <div className="divide-y divide-on-surface/[0.05]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className={cn('flex items-center gap-3.5 py-4', isMobile ? 'px-4' : 'px-5')}>
              <div className="h-7 w-7 animate-pulse rounded-full bg-on-surface/[0.06]" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-3.5 w-1/2 animate-pulse rounded bg-on-surface/[0.06]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-on-surface/[0.05]" />
              </div>
              <div className="h-8 w-11 animate-pulse rounded bg-on-surface/[0.05]" />
            </div>
          ))}
          <p className="flex items-center justify-center gap-2 px-5 py-5 text-[12px] font-medium text-on-surface/40">
            <Loader2 size={13} className="animate-spin text-primary/50" />
            Ranking {city ? `${city} spots` : 'restaurants'} for your taste…
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center px-6 py-16 text-center">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-on-surface/[0.05] text-on-surface/40">
            <MapPin size={20} />
          </div>
          <p className="mt-3 font-serif text-[17px] font-semibold text-on-surface">
            {enriched.length === 0 ? 'No recommendations here yet' : 'Nothing matches those filters'}
          </p>
          <p className="mt-1 max-w-[280px] text-[13px] leading-snug text-on-surface/55">
            {enriched.length === 0
              ? 'Try widening the radius or picking a different location.'
              : 'Loosen a filter or two — the ranking is still here.'}
          </p>
          {enriched.length === 0 ? (
            radiusMiles < 25 && (
              <button
                type="button"
                onClick={() => setRadiusMiles(25)}
                className="mt-4 rounded-full bg-on-surface px-4 py-2 text-[13px] font-semibold text-surface transition-opacity hover:opacity-90"
              >
                Widen to 25 mi
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => { setCuisineSel(new Set()); setPriceSel(new Set()); setMichSel(new Set()); setOpenNowOnly(false); }}
              className="mt-4 rounded-full bg-on-surface px-4 py-2 text-[13px] font-semibold text-surface transition-opacity hover:opacity-90"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-on-surface/[0.05] pb-4">
          {visible.map((entry) => rankedRow(entry, rankById.get(entry.place.id) ?? 0))}
        </div>
      )}
    </div>
  );

  const subtitle = !target
    ? 'Personal picks, ranked for your taste'
    : loading
      ? `Ranking spots near ${city}…`
      : `${visible.length} spot${visible.length === 1 ? '' : 's'} ranked for your taste near ${city}`;

  /* Location picker rides along in both layouts; it portals its own sheet. */
  const picker = (
    <HomeLocationBar
      variant="headless"
      location={target}
      onChange={(loc) => setTarget(loc)}
      onUseCurrent={handleUseCurrent}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
    />
  );

  /* Mobile header — back arrow + title. Shared by the slide-up popup and
     the /pantry/recommended route page. */
  const mobileHeader = (
    <div className="flex flex-shrink-0 items-center gap-1 pb-1 pl-2 pr-4 pt-safe-4">
      <button
        type="button"
        onClick={onClose}
        className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-full text-on-surface/70 transition-colors hover:bg-on-surface/[0.05]"
        aria-label="Back"
      >
        <ArrowLeft size={22} />
      </button>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-serif text-[19px] font-semibold tracking-[-0.015em] text-on-surface">
          Recommended for you
        </h3>
        <p className="truncate text-[11.5px] font-medium text-on-surface/45">{subtitle}</p>
      </div>
    </div>
  );

  /* Page mode — a normal route-owned layout (no portal, no overlay): the
     route transition animates it, swipe-back works, and pushed detail
     pages cover it instead of replacing it. */
  if (isPage) {
    if (!open) return null;
    return (
      <div className="flex h-[100dvh] flex-col bg-surface">
        {mobileHeader}
        {controls}
        {body}
        {picker}
      </div>
    );
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        isMobile ? (
          /* Mobile: full-page slide-up panel. */
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring' as const, damping: 28, stiffness: 300 }}
            className="fixed inset-0 z-50 flex flex-col bg-surface"
          >
            {mobileHeader}
            {controls}
            {body}
            {picker}
          </motion.div>
        ) : (
          /* Desktop: backdrop + centered spotlight card. */
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/45 backdrop-blur-md"
              onClick={onClose}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] as const }}
              className="fixed left-1/2 top-[6vh] z-50 flex max-h-[86vh] w-full max-w-3xl -translate-x-1/2 flex-col overflow-hidden rounded-3xl bg-surface shadow-[0_30px_80px_-16px_rgba(28,24,22,0.42)] ring-1 ring-on-surface/[0.06]"
            >
              <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-on-surface/6 px-5 pb-4 pt-5">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
                    Ranked for you
                  </p>
                  <h3 className="mt-1 truncate font-serif text-[24px] font-semibold leading-tight tracking-[-0.02em] text-on-surface">
                    Recommended for you
                  </h3>
                  <p className="mt-0.5 truncate text-[12.5px] font-medium text-on-surface/50">{subtitle}</p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  {locationChip}
                  <button
                    type="button"
                    onClick={onClose}
                    className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full bg-on-surface/5 transition-colors hover:bg-on-surface/10"
                    aria-label="Close"
                  >
                    <X size={16} className="text-on-surface/60" />
                  </button>
                </div>
              </div>
              {controls}
              {body}
              {picker}
            </motion.div>
          </>
        )
      )}
    </AnimatePresence>,
    document.getElementById('phone-frame-root') ?? document.body,
  );
};
