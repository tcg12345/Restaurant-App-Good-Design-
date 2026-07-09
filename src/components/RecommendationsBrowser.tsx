import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bookmark, ChevronDown, Clock, Loader2, MapPin, Navigation,
  Plus, Sparkles, Star, X,
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
import { getOpenStatus } from '../lib/useRestaurantLocationLabel';

/* ── Ranked recommendations browser ──────────────────────────────────────
   Opened from the Pantry's "For you" button. A full-surface popup that
   runs the recommendation engine for the selected location and shows the
   ENTIRE ranked list — #1 downward — with the engine's "why this" reason
   chips on every row, client-side filters (cuisine / price / open now /
   radius / sort) and a location switcher.

   Chrome follows the app's two established popup modes (see GuidesBrowser):
   - Desktop: backdrop + centered spotlight card.
   - Mobile: full-page slide-up panel with a back arrow.
   ──────────────────────────────────────────────────────────────────────── */

const RADIUS_OPTIONS = [2, 5, 8, 15, 25] as const;
const PRICE_TIERS = [1, 2, 3, 4] as const;

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

interface RecommendationsBrowserProps {
  open: boolean;
  onClose: () => void;
  /** Parent-supplied mobile signal (each page already has its own). */
  isMobile: boolean;
}

export const RecommendationsBrowser: React.FC<RecommendationsBrowserProps> = ({ open, onClose, isMobile }) => {
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
  // One GATHER per (location, radius) per mount — the pool is unscored, so
  // reopening, filtering, and every rating change re-rank instantly from it
  // with zero API spend.
  const poolCacheRef = useRef<Map<string, RecPool>>(new Map());

  const [cuisineSel, setCuisineSel] = useState<Set<string>>(new Set());
  const [priceSel, setPriceSel] = useState<Set<number>>(new Set());
  const [openNowOnly, setOpenNowOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('match');

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
    setPriceSel(new Set());
    setOpenNowOnly(false);
    setSortBy('match');
    setRadiusMenuOpen(false);
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
  // refetch, no stale rows, predictions and chips update in place.
  const liveProfile = useMemo(() => buildTasteProfile(ratings, wishlist, lists, []), [ratings, wishlist, lists]);

  // Gather the candidate pool (network) — profile changes deliberately do
  // NOT re-run this; they only re-score.
  useEffect(() => {
    if (!open || !target) return;
    const key = `${target.lat.toFixed(3)},${target.lng.toFixed(3)}|${radiusMiles}`;
    const cached = poolCacheRef.current.get(key);
    if (cached) {
      setPool(cached);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setPool(null);
    gatherRecCandidates({
      userId,
      profile: liveProfile,
      target: { label: target.label, lat: target.lat, lng: target.lng },
      radiusMeters: Math.round(radiusMiles * 1609.34),
      maxQueries: 8,
    })
      .then((out) => {
        if (cancelled) return;
        poolCacheRef.current.set(key, out);
        setPool(out);
      })
      .catch(() => { if (!cancelled) setPool(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
      { limit: 60, skipUserHistory: true, keepWishlisted: true },
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

  // Cuisine chips, ordered by how many picks carry each label.
  const cuisineOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of enriched) {
      if (e.cuisineLabel) counts.set(e.cuisineLabel, (counts.get(e.cuisineLabel) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10);
  }, [enriched]);

  const visible = useMemo(() => {
    const list = enriched.filter((e) => {
      if (cuisineSel.size > 0 && !cuisineSel.has(e.cuisineLabel)) return false;
      if (priceSel.size > 0 && !(e.place.priceLevel > 0 && priceSel.has(e.place.priceLevel))) return false;
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
  }, [enriched, cuisineSel, priceSel, openNowOnly, sortBy]);

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

      {/* Cuisine + price chips (phone prepends the Open-now toggle) */}
      <div className={cn('no-scrollbar flex items-center gap-2 overflow-x-auto', isMobile ? '-mx-4 px-4' : '-mx-5 px-5')}>
        {isMobile && (
          <>
            {openNowBtn}
            <span aria-hidden className="mx-0.5 h-5 w-px flex-shrink-0 bg-on-surface/[0.10]" />
          </>
        )}
        <button
          type="button"
          onClick={() => setCuisineSel(new Set())}
          className={cn(
            'flex-shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
            cuisineSel.size === 0
              ? 'border-on-surface bg-on-surface text-surface'
              : 'border-on-surface/12 text-on-surface/60 hover:border-on-surface/35',
          )}
        >
          All
        </button>
        {cuisineOptions.map(([label, count]) => {
          const active = cuisineSel.has(label);
          return (
            <button
              key={label}
              type="button"
              onClick={() => toggleCuisine(label)}
              aria-pressed={active}
              className={cn(
                'flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
                active
                  ? 'border-on-surface bg-on-surface text-surface'
                  : 'border-on-surface/12 text-on-surface/60 hover:border-on-surface/35',
              )}
            >
              {label}
              <span className={cn('text-[10.5px] font-bold', active ? 'text-surface/60' : 'text-on-surface/35')}>{count}</span>
            </button>
          );
        })}
        <span aria-hidden className="mx-0.5 h-5 w-px flex-shrink-0 bg-on-surface/[0.10]" />
        {PRICE_TIERS.map((tier) => {
          const active = priceSel.has(tier);
          return (
            <button
              key={tier}
              type="button"
              onClick={() => togglePrice(tier)}
              aria-pressed={active}
              className={cn(
                'flex-shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-bold tracking-wide transition-colors',
                active
                  ? 'border-on-surface bg-on-surface text-surface'
                  : 'border-on-surface/12 text-on-surface/60 hover:border-on-surface/35',
              )}
            >
              {'$'.repeat(tier)}
            </button>
          );
        })}
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
        onClick={() => { onClose(); navigate(`/restaurant/${p.id}`); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClose(); navigate(`/restaurant/${p.id}`); }
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

        {/* Name · meta · reasons */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h4 className="min-w-0 truncate font-serif text-[15.5px] font-semibold leading-[1.2] tracking-[-0.01em] text-on-surface group-hover:text-primary transition-colors">
              {p.name}
            </h4>
            {p.rating > 0 && (
              <span className="inline-flex flex-shrink-0 items-center gap-0.5 text-[11.5px] font-semibold text-on-surface/50">
                <Star size={10.5} className="fill-amber-400 text-amber-400" />
                {p.rating.toFixed(1)}
              </span>
            )}
          </div>
          {metaLine && <p className="mt-0.5 truncate text-[12px] font-medium text-on-surface/55">{metaLine}</p>}
          {(p.reasons?.length ?? 0) > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {p.reasons!.slice(0, isMobile ? 2 : 3).map((r, i) => (
                <span
                  key={r}
                  className={cn(
                    'inline-flex max-w-full items-center truncate rounded-full px-2 py-[3px] text-[10.5px] font-semibold leading-none',
                    i === 0 ? 'bg-primary/[0.08] text-primary' : 'bg-on-surface/[0.045] text-on-surface/55',
                  )}
                >
                  {r}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Match + actions. Phone keeps this to a slim match% + bookmark
            stack (rating lives on the detail page) so the name and reason
            chips get the width; desktop shows both actions on hover. */}
        {isMobile ? (
          <div className="flex flex-shrink-0 flex-col items-center gap-1">
            {typeof p.predicted === 'number' && (
              <div className="flex flex-col items-center">
                <ScoreRing score={p.predicted} size={40} />
                <p className="mt-0.5 text-[8px] font-bold uppercase tracking-[0.12em] text-on-surface/35">for you</p>
              </div>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
              className={cn(
                'grid h-7 w-7 place-items-center rounded-full bg-on-surface/[0.05] transition-colors',
                wishlisted ? 'text-primary' : 'text-on-surface/55',
              )}
              aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
            >
              <Bookmark size={13} className={wishlisted ? 'fill-current' : ''} />
            </button>
          </div>
        ) : (
          <div className="flex flex-shrink-0 items-center gap-2.5">
            {typeof p.predicted === 'number' && (
              <div className="flex flex-col items-center">
                <ScoreRing score={p.predicted} size={44} />
                <p className="mt-0.5 text-[8.5px] font-bold uppercase tracking-[0.12em] text-on-surface/35">for you</p>
              </div>
            )}
            <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); toggleWishlist(meta); }}
                className={cn(
                  'grid h-8 w-8 place-items-center rounded-full bg-on-surface/[0.05] transition-colors hover:bg-on-surface/[0.1]',
                  wishlisted ? 'text-primary' : 'text-on-surface/60',
                )}
                aria-label={wishlisted ? 'In wishlist' : 'Add to wishlist'}
              >
                <Bookmark size={14} className={wishlisted ? 'fill-current' : ''} />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClose(); openAddRestaurantModal(meta); }}
                className="grid h-8 w-8 place-items-center rounded-full bg-on-surface/[0.05] text-on-surface/60 transition-colors hover:bg-on-surface/[0.1]"
                aria-label="Rate"
              >
                <Plus size={15} />
              </button>
            </div>
          </div>
        )}
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
            <Sparkles size={20} />
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
              onClick={() => { setCuisineSel(new Set()); setPriceSel(new Set()); setOpenNowOnly(false); }}
              className="mt-4 rounded-full bg-on-surface px-4 py-2 text-[13px] font-semibold text-surface transition-opacity hover:opacity-90"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-on-surface/[0.05] pb-4">
          {visible.map((entry, i) => rankedRow(entry, i + 1))}
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
                  <p className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-primary">
                    <Sparkles size={11} />
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
