/**
 * RestaurantPanel — side panel / bottom sheet that opens when a viewer taps
 * a "featured restaurant" card on a reel or post. Shows the restaurant at a
 * glance without yanking the user out of the feed:
 *
 *   - Non-interactive Mapbox hero pinned to the place's lat/lng
 *   - Directions / call / website action row
 *   - Address + thin hours accordion (closed by default)
 *   - Community / friends / expert score chips
 *   - Your-rating block (no card chrome — divider-separated rows, with
 *     an expandable details accordion mirroring the detail page)
 *   - Filler "Featured in" reels strip
 *   - Friend reviews + expert picks
 *   - View full restaurant page primary button
 *
 * The panel is presentation-only — it pulls everything it needs from
 * ListsContext (your rating, lists membership) and the supabase-community
 * helpers (community / friends / expert ratings). Modals (rate, add-to-list)
 * are opened by toggling state on ListsContext so the page-level mounted
 * modals handle them — no chrome duplicated here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Link } from 'react-router-dom';
import {
  X, MapPin, Star, Heart, Plus, ArrowUpRight, Pencil, Users, Award, Loader2, ImageOff,
  Navigation, Phone, Globe, Clock, ChevronDown, StickyNote, Tag, Image as ImageIcon, CalendarDays, DollarSign,
} from 'lucide-react';
import mapboxgl from 'mapbox-gl';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';
import { useLists } from '../contexts/ListsContext';
import {
  getCommunityStats,
  getFriendsStats,
  getExpertRecommendations,
  getProfilesByIds,
  type CommunityRating,
  type ExpertRecommendation,
  type UserProfile,
} from '../lib/supabase-community';
import type { ReelRestaurantSnapshot } from '../lib/supabase-reels';
import { getPlaceDetails, type PlaceDetails } from '../lib/places';
import { MAPBOX_TOKEN, getTodayHours } from '../pages/useRestaurantDetail';
import { RestaurantFeaturedReels } from './RestaurantFeaturedReels';

/* ── Snapshot the panel accepts ───────────────────────────────────────────
   We accept any object that quacks like a ReelRestaurantSnapshot so reels
   and posts can both open the same panel without conversion. */
export type RestaurantPanelSnapshot = ReelRestaurantSnapshot;

interface RestaurantPanelProps {
  snapshot: RestaurantPanelSnapshot | null;
  onClose: () => void;
  currentUserId: string | null;
  variant: 'panel' | 'sheet';
}

function formatRelativeDate(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const d = Math.floor((Date.now() - t) / 86_400_000);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatVisitDate(iso: string): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* ── Score pill (Community / Friends / Experts) ───────────────────────── */

const ScorePill: React.FC<{
  label: string;
  score: number;
  count: number;
  icon: React.ReactNode;
}> = ({ label, score, count, icon }) => {
  const has = count > 0;
  return (
    <div className={cn(
      'flex flex-col gap-2 rounded-2xl px-3 py-3.5 transition-colors',
      has ? 'bg-paper ring-1 ring-on-surface/[0.09]' : 'bg-on-surface/[0.03]',
    )}>
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/55">
        <span className="opacity-70">{icon}</span>
        {label}
      </div>
      {has ? (
        <div className="flex items-baseline gap-1">
          <span className={cn('text-[24px] font-bold tabular-nums leading-none tracking-tight', scoreColor(score))}>
            {score.toFixed(1)}
          </span>
          <span className="text-[11px] text-on-surface/45 tabular-nums">
            · {count}
          </span>
        </div>
      ) : (
        <span className="text-[12px] text-on-surface/40 leading-none mt-0.5">No ratings</span>
      )}
    </div>
  );
};

/* ── A single review row (friend or expert) ───────────────────────────── */

const ReviewRow: React.FC<{
  initials: string;
  name: string;
  username?: string;
  isExpert?: boolean;
  score: number;
  body: string;
  date: string;
}> = ({ initials, name, username, isExpert, score, body, date }) => (
  <div className="flex items-start gap-3 py-3">
    <div className="w-9 h-9 rounded-full bg-on-surface/10 text-on-surface flex items-center justify-center text-[12px] font-bold flex-shrink-0">
      {initials}
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline gap-1.5 flex-wrap">
        <span className="text-[13px] font-bold text-on-surface truncate">{name}</span>
        {isExpert && (
          <span className="inline-flex items-center gap-0.5 px-1 py-px rounded-sm bg-amber-200 text-amber-900 text-[9px] font-bold">
            <Star size={8} className="fill-amber-900" />
            EXPERT
          </span>
        )}
        {username && (
          <span className="text-[11px] text-on-surface/45 truncate">@{username}</span>
        )}
      </div>
      <div className="flex items-baseline gap-2 mt-0.5">
        <span className={cn('text-[14px] font-bold tabular-nums leading-none', scoreColor(score))}>
          {score.toFixed(1)}
        </span>
        <span className="text-[11px] text-on-surface/40">{date}</span>
      </div>
      {body && (
        <p className="text-[13px] text-on-surface/75 leading-snug mt-1 line-clamp-3">
          {body}
        </p>
      )}
    </div>
  </div>
);

/* ── Action button (Directions / Call / Website) ──────────────────────── */

interface ActionButtonProps {
  icon: React.ReactNode;
  label: string;
  href?: string | null;
  external?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ icon, label, href, external }) => {
  const inner = (
    <>
      <span className="text-on-surface/75">{icon}</span>
      <span className="text-[11px] font-semibold text-on-surface/75">{label}</span>
    </>
  );
  const cls = 'flex flex-col items-center justify-center gap-1 h-[60px] rounded-2xl bg-paper ring-1 ring-on-surface/[0.08] hover:bg-on-surface/[0.04] hover:ring-on-surface/[0.14] transition-colors';
  const disabledCls = 'flex flex-col items-center justify-center gap-1 h-[60px] rounded-2xl bg-on-surface/[0.03] ring-1 ring-on-surface/[0.05] opacity-40 cursor-not-allowed';
  if (!href) return <div className={disabledCls}>{inner}</div>;
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={cls}
    >
      {inner}
    </a>
  );
};

/* ── Your Rating expanded details (mirrors detail page layout) ────────── */

const RatingDetailRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  onEdit: () => void;
  children: React.ReactNode;
}> = ({ icon, label, onEdit, children }) => (
  <div>
    <button
      type="button"
      onClick={onEdit}
      className="flex items-center gap-1.5 uppercase text-on-surface/70 hover:text-on-surface transition-colors"
      style={{
        fontFamily: '"JetBrains Mono", ui-monospace, monospace',
        fontSize: '10px',
        fontWeight: 700,
        letterSpacing: '0.14em',
      }}
    >
      {icon}
      <span>{label}</span>
      <Pencil size={10} className="text-on-surface/40 ml-0.5" />
    </button>
    <div className="mt-1.5">{children}</div>
  </div>
);

/* ── Body (shared between sheet + panel) ──────────────────────────────── */

const RestaurantPanelBody: React.FC<{
  snapshot: RestaurantPanelSnapshot;
  onClose: () => void;
  currentUserId: string | null;
}> = ({ snapshot, onClose, currentUserId }) => {
  const {
    getRating,
    isWishlisted,
    toggleWishlist,
    openRatingModal,
    openAddRestaurantModal,
    openAddToListModal,
    getListsForRestaurant,
  } = useLists();

  const myRating = getRating(snapshot.id);
  const wishlisted = isWishlisted(snapshot.id);
  const myLists = useMemo(() => getListsForRestaurant(snapshot.id), [snapshot.id, getListsForRestaurant]);

  // Lazy-fetch real place details (lat/lng, phone, website, hours) for the
  // hero map + action row + hours accordion. Cached server-side via the
  // places.ts in-memory cache so reopening the same place is instant.
  const [details, setDetails] = useState<PlaceDetails | null>(null);
  useEffect(() => {
    let cancelled = false;
    setDetails(null);
    getPlaceDetails(snapshot.id)
      .then((d) => { if (!cancelled) setDetails(d); })
      .catch(() => { /* falls back to snapshot fields */ });
    return () => { cancelled = true; };
  }, [snapshot.id]);

  const [community, setCommunity] = useState<{ avg: number; count: number; ratings: CommunityRating[] } | null>(null);
  const [friends, setFriends] = useState<{ avg: number; count: number; ratings: CommunityRating[] } | null>(null);
  const [experts, setExperts] = useState<ExpertRecommendation[]>([]);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setCommunity(null);
    setFriends(null);
    setExperts([]);
    setProfiles({});

    const load = async () => {
      const [c, f, e] = await Promise.all([
        getCommunityStats(snapshot.id),
        currentUserId ? getFriendsStats(currentUserId, snapshot.id) : Promise.resolve({ avgScore: 0, totalRatings: 0, ratings: [] }),
        getExpertRecommendations(snapshot.id),
      ]);
      if (cancelled) return;
      setCommunity({ avg: c.avgScore, count: c.totalRatings, ratings: c.ratings });
      setFriends({ avg: f.avgScore, count: f.totalRatings, ratings: f.ratings });
      setExperts(e);
      const ids = Array.from(new Set(f.ratings.map((r) => r.user_id))).slice(0, 6);
      if (ids.length > 0) {
        const profs = await getProfilesByIds(ids);
        if (!cancelled) setProfiles(profs);
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [snapshot.id, currentUserId]);

  const meta = useMemo(() => ({
    id: snapshot.id,
    name: snapshot.name,
    image: snapshot.image || '',
    cuisine: snapshot.cuisine,
    price: snapshot.price,
    address: snapshot.address,
  }), [snapshot]);

  const onRate = () => openRatingModal(meta);
  const onAddToList = () => openAddToListModal(snapshot.id, meta);
  const onWishlist = () => toggleWishlist(meta);
  /** Jump into the unified Add Restaurant modal at a specific page (notes /
   *  tags / photos / etc.) so each "edit" link in the expanded rating
   *  details opens the right step — same pattern as the detail page. */
  const openAt = (page: string) => openAddRestaurantModal(meta, page);

  const distance = snapshot.distanceMi != null ? `${snapshot.distanceMi.toFixed(1)} mi` : '';

  const topFriendReviews = useMemo(() => {
    if (!friends) return [];
    return [...friends.ratings].slice(0, 3);
  }, [friends]);

  /* ── Map: non-interactive Mapbox pinned to the place's lat/lng. The
        container uses key={snapshot.id} so swapping restaurants while
        the panel is open cleanly tears down the old map and inits a
        new one. The callback-ref pattern (mirroring useRestaurantDetail)
        works around a React 18 StrictMode batching pitfall that can
        leave the canvas blank in dev. */
  const mapInstanceRef = useRef<mapboxgl.Map | null>(null);
  const mapCleanupRef = useRef<(() => void) | null>(null);
  const lat = details && Number.isFinite(details.lat) ? details.lat : null;
  const lng = details && Number.isFinite(details.lng) ? details.lng : null;

  const mapContainerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      if (mapCleanupRef.current) {
        mapCleanupRef.current();
        mapCleanupRef.current = null;
      }
      return;
    }
    if (mapInstanceRef.current) return;
    if (!MAPBOX_TOKEN || lat == null || lng == null) return;

    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: el,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [lng, lat],
      zoom: 14.5,
      interactive: false,
      attributionControl: false,
    });
    mapInstanceRef.current = map;
    new mapboxgl.Marker({ color: '#9f3012' }).setLngLat([lng, lat]).addTo(map);

    const ro = new ResizeObserver(() => { try { map.resize(); } catch { /* noop */ } });
    ro.observe(el);
    const rafId = requestAnimationFrame(() => { try { map.resize(); } catch { /* noop */ } });

    mapCleanupRef.current = () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [lat, lng]);

  /* ── Hours + contact derived from the details fetch. */
  const phoneHref = details?.phone ? `tel:${details.phone}` : null;
  const websiteHref = details?.website || null;
  const directionsHref = useMemo(() => {
    const addr = details?.fullAddress || details?.address || snapshot.address;
    if (!addr) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr)}`;
  }, [details, snapshot.address]);

  const hours = details?.hours || [];
  const [hoursOpen, setHoursOpen] = useState(false);
  const todayHours = useMemo(() => (hours.length > 0 ? getTodayHours(hours) : ''), [hours]);
  const isOpenNow = details?.isOpen ?? null;

  /* ── Your-rating details accordion (mirrors the detail page section). */
  const [myRatingOpen, setMyRatingOpen] = useState(false);
  const hasNotes = !!myRating?.notes;
  const hasTags = !!myRating?.tags && myRating.tags.length > 0;
  const hasPhotos = !!myRating?.photos && myRating.photos.length > 0;
  const hasPrice = !!myRating?.price;

  return (
    <>
      {/* Header — map hero (or fallback gradient/photo) with name overlay */}
      <div className="relative flex-shrink-0">
        <div className="relative h-[200px] w-full bg-on-surface/5 overflow-hidden">
          {lat != null && lng != null ? (
            <div
              key={`${snapshot.id}-${lat}-${lng}`}
              ref={mapContainerRef}
              className="absolute inset-0"
            />
          ) : snapshot.image ? (
            <img
              src={snapshot.image}
              alt=""
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-clay/30 to-olive/20 flex items-center justify-center text-on-surface/30">
              <ImageOff size={32} />
            </div>
          )}
          {/* Bottom legibility wash. Slightly lighter over the map so the
              cartography stays visible behind the title. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-3 right-3 w-9 h-9 rounded-full bg-black/55 backdrop-blur text-white hover:bg-black/75 flex items-center justify-center transition-colors"
          >
            <X size={17} />
          </button>
          <button
            type="button"
            onClick={onWishlist}
            aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
            aria-pressed={wishlisted}
            className={cn(
              'absolute top-3 left-3 w-9 h-9 rounded-full backdrop-blur flex items-center justify-center transition-colors',
              wishlisted
                ? 'bg-rose-500 text-white hover:bg-rose-600 shadow-md shadow-rose-900/20'
                : 'bg-black/55 text-white hover:bg-black/75',
            )}
          >
            <Heart size={17} className={cn(wishlisted && 'fill-white')} />
          </button>
          <div className="absolute inset-x-0 bottom-0 px-5 pb-4 text-white">
            <h2 className="font-serif font-bold text-[22px] leading-[1.1] tracking-tight line-clamp-2">
              {snapshot.name}
            </h2>
            <p className="text-[12px] text-white/80 mt-1 truncate">
              {[snapshot.cuisine, snapshot.price, distance].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-5 pt-5 pb-6 space-y-6">
        {/* Action row — Directions / Call / Website */}
        <div className="grid grid-cols-3 gap-2">
          <ActionButton
            icon={<Navigation size={18} />}
            label="Directions"
            href={directionsHref}
            external
          />
          <ActionButton
            icon={<Phone size={18} />}
            label="Call"
            href={phoneHref}
          />
          <ActionButton
            icon={<Globe size={18} />}
            label="Website"
            href={websiteHref}
            external
          />
        </div>

        {/* Address + thin hours accordion */}
        <div className="space-y-2">
          {snapshot.address && (
            <div className="flex items-start gap-2.5 text-on-surface/75">
              <MapPin size={14} className="mt-0.5 flex-shrink-0 text-on-surface/50" />
              <p className="text-[13px] leading-snug">{snapshot.address}</p>
            </div>
          )}
          {hours.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setHoursOpen((o) => !o)}
                aria-expanded={hoursOpen}
                className="w-full flex items-center gap-2.5 text-on-surface/75 hover:text-on-surface transition-colors py-1.5"
              >
                <Clock size={14} className="flex-shrink-0 text-on-surface/50" />
                <div className="flex items-center gap-2 min-w-0 flex-1 text-left">
                  {isOpenNow !== null && (
                    <>
                      <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', isOpenNow ? 'bg-emerald-600' : 'bg-clay')} />
                      <span className={cn('text-[13px] font-semibold flex-shrink-0', isOpenNow ? 'text-emerald-700' : 'text-clay')}>
                        {isOpenNow ? 'Open' : 'Closed'}
                      </span>
                    </>
                  )}
                  {todayHours && (
                    <span className="text-[13px] text-on-surface/65 truncate">· {todayHours}</span>
                  )}
                </div>
                <ChevronDown size={14} className={cn('text-on-surface/45 flex-shrink-0 transition-transform duration-200', hoursOpen && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {hoursOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <ul className="mt-1.5 pl-[26px] space-y-1">
                      {hours.map((line, i) => {
                        const today = new Date().getDay();
                        // Google returns Mon-first; getDay returns Sun=0..Sat=6.
                        // Convert getDay → Mon=0..Sun=6 to match.
                        const idxMonFirst = (today + 6) % 7;
                        const isToday = i === idxMonFirst;
                        return (
                          <li
                            key={i}
                            className={cn(
                              'text-[12px] tabular-nums',
                              isToday ? 'text-on-surface font-semibold' : 'text-on-surface/65',
                            )}
                          >
                            {line}
                          </li>
                        );
                      })}
                    </ul>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Score grid */}
        <div className="grid grid-cols-3 gap-2">
          <ScorePill
            label="Community"
            score={community?.avg ?? 0}
            count={community?.count ?? 0}
            icon={<Users size={11} />}
          />
          <ScorePill
            label="Friends"
            score={friends?.avg ?? 0}
            count={friends?.count ?? 0}
            icon={<Heart size={11} />}
          />
          <ScorePill
            label="Experts"
            score={
              experts.length > 0
                ? experts.reduce((s, e) => s + (e.rating || 0), 0) / experts.length
                : 0
            }
            count={experts.length}
            icon={<Award size={11} />}
          />
        </div>

        {/* Your rating — chrome-free, divider-separated, with an expandable
            details accordion that mirrors the layout of the full detail page. */}
        {myRating ? (
          <section aria-label="Your rating">
            <div className="border-t border-on-surface/[0.09]" />
            <div className="py-4">
              <div className="flex items-baseline justify-between gap-3 mb-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-on-surface/55">Your rating</span>
                <button
                  type="button"
                  onClick={onRate}
                  className="inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
                >
                  <Pencil size={12} />
                  Edit
                </button>
              </div>
              <div className="flex items-baseline gap-2">
                <span className={cn('text-[32px] font-bold tabular-nums leading-none tracking-tight', scoreColor(myRating.score))}>
                  {myRating.score.toFixed(1)}
                </span>
                {myRating.visitDate && (
                  <span className="text-[11px] text-on-surface/50">
                    {formatRelativeDate(myRating.visitDate)}
                  </span>
                )}
              </div>
              {myRating.notes && (
                <p className="font-serif italic text-on-surface/80 text-[15px] leading-snug mt-2.5 line-clamp-3">
                  "{myRating.notes}"
                </p>
              )}
              {myRating.tags && myRating.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {myRating.tags.slice(0, 6).map((t) => (
                    <span key={t} className="px-2.5 py-1 rounded-full bg-cream-2 text-on-surface/80 text-[11px] font-medium">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => setMyRatingOpen((o) => !o)}
                aria-expanded={myRatingOpen}
                className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold text-on-surface/65 hover:text-on-surface transition-colors"
              >
                {myRatingOpen ? 'Hide details' : 'Show details'}
                <ChevronDown size={13} className={cn('transition-transform duration-200', myRatingOpen && 'rotate-180')} />
              </button>

              <AnimatePresence initial={false}>
                {myRatingOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="pt-4 space-y-4">
                      <RatingDetailRow icon={<StickyNote size={12} />} label="Notes" onEdit={() => openAt('notes')}>
                        {hasNotes ? (
                          <p className="font-serif italic text-on-surface/85 text-[14px] leading-relaxed">
                            "{myRating.notes}"
                          </p>
                        ) : (
                          <button onClick={() => openAt('notes')} className="italic text-on-surface/45 hover:text-on-surface/70 transition-colors text-[13px]">
                            Add notes…
                          </button>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow icon={<Tag size={12} />} label="Tags" onEdit={() => openAt('tags')}>
                        {hasTags ? (
                          <div className="flex flex-wrap gap-1.5">
                            {myRating.tags.map((t) => (
                              <span key={t} className="px-2.5 py-1 rounded-full bg-cream-2 text-on-surface/80 text-[11px] font-medium">
                                {t}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <button onClick={() => openAt('tags')} className="italic text-on-surface/45 hover:text-on-surface/70 transition-colors text-[13px]">
                            Add tags…
                          </button>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow icon={<ImageIcon size={12} />} label="Photos" onEdit={() => openAt('photos')}>
                        {hasPhotos ? (
                          <div className="flex gap-2 overflow-x-auto -mx-0.5 px-0.5 snap-x snap-mandatory scrollbar-hide" style={{ scrollbarWidth: 'none' }}>
                            {myRating.photos.map((p, i) => (
                              <img
                                key={i}
                                src={p.url}
                                alt=""
                                className="w-20 h-20 rounded-xl object-cover flex-shrink-0 snap-start"
                                referrerPolicy="no-referrer"
                              />
                            ))}
                          </div>
                        ) : (
                          <button onClick={() => openAt('photos')} className="italic text-on-surface/45 hover:text-on-surface/70 transition-colors text-[13px]">
                            Add photos…
                          </button>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow icon={<CalendarDays size={12} />} label="Visited" onEdit={() => openAt('date')}>
                        {myRating.visitDate ? (
                          <p className="text-on-surface/85 text-[13px] font-medium">
                            {formatVisitDate(myRating.visitDate)}
                          </p>
                        ) : (
                          <button onClick={() => openAt('date')} className="italic text-on-surface/45 hover:text-on-surface/70 transition-colors text-[13px]">
                            Add date…
                          </button>
                        )}
                      </RatingDetailRow>

                      <RatingDetailRow icon={<DollarSign size={12} />} label="Price" onEdit={() => openAt('price')}>
                        {hasPrice ? (
                          <p className="text-on-surface/85 text-[13px] font-medium tabular-nums">{myRating.price}</p>
                        ) : (
                          <button onClick={() => openAt('price')} className="italic text-on-surface/45 hover:text-on-surface/70 transition-colors text-[13px]">
                            Add price…
                          </button>
                        )}
                      </RatingDetailRow>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button
                type="button"
                onClick={onAddToList}
                className="mt-4 w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-on-surface/[0.05] text-on-surface text-[13px] font-semibold hover:bg-on-surface/[0.09] transition-colors"
              >
                <Plus size={14} />
                {myLists.length > 0
                  ? `In ${myLists.length} list${myLists.length === 1 ? '' : 's'}`
                  : 'Add to a list'}
              </button>
            </div>
            <div className="border-t border-on-surface/[0.09]" />
          </section>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={onRate}
              className="w-full inline-flex items-center justify-center gap-1.5 h-12 rounded-full bg-on-surface text-surface text-[14px] font-bold hover:bg-on-surface/90 transition-colors shadow-sm"
            >
              <Star size={15} className="fill-current" />
              Rate this restaurant
            </button>
            <button
              type="button"
              onClick={onAddToList}
              className="w-full inline-flex items-center justify-center gap-1.5 h-11 rounded-full bg-on-surface/[0.05] text-on-surface text-[13px] font-semibold hover:bg-on-surface/[0.09] transition-colors"
            >
              <Plus size={14} />
              {myLists.length > 0
                ? `In ${myLists.length} list${myLists.length === 1 ? '' : 's'} · Edit`
                : 'Add to a list'}
            </button>
          </div>
        )}

        {/* Featured-in strip */}
        <RestaurantFeaturedReels
          restaurantId={snapshot.id}
          restaurantName={snapshot.name}
          size="sm"
        />

        {/* Friend + expert reviews */}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-on-surface/45">
            <Loader2 size={18} className="animate-spin" />
          </div>
        ) : (
          <>
            {topFriendReviews.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between mb-1.5">
                  <h3 className="font-serif font-bold text-on-surface text-[15px]">From people you follow</h3>
                  {friends && friends.count > topFriendReviews.length && (
                    <span className="text-[11px] text-on-surface/45">{friends.count} total</span>
                  )}
                </div>
                <div className="divide-y divide-on-surface/[0.06] -mt-1">
                  {topFriendReviews.map((r) => {
                    const p = profiles[r.user_id];
                    const name = p?.display_name || p?.username || 'Friend';
                    const initials = (p?.display_name || p?.username || r.user_id).slice(0, 2).toUpperCase();
                    return (
                      <ReviewRow
                        key={r.id}
                        initials={initials}
                        name={name}
                        username={p?.username}
                        isExpert={p?.is_expert}
                        score={Number(r.score)}
                        body={r.notes}
                        date={formatRelativeDate(r.visit_date || r.created_at)}
                      />
                    );
                  })}
                </div>
              </section>
            )}

            {experts.length > 0 && (
              <section>
                <h3 className="font-serif font-bold text-on-surface text-[15px] mb-1.5">Expert picks</h3>
                <div className="divide-y divide-on-surface/[0.06] -mt-1">
                  {experts.slice(0, 3).map((e) => (
                    <ReviewRow
                      key={e.id}
                      initials={(e.expert_name || e.expert_username || 'EX').slice(0, 2).toUpperCase()}
                      name={e.expert_name || 'Expert'}
                      username={e.expert_username}
                      isExpert
                      score={Number(e.rating)}
                      body={e.recommendation_text}
                      date={formatRelativeDate(e.updated_at || e.created_at)}
                    />
                  ))}
                </div>
              </section>
            )}

            {(friends?.count ?? 0) === 0 && experts.length === 0 && (community?.count ?? 0) === 0 && !myRating && (
              <div className="rounded-2xl bg-on-surface/[0.04] px-4 py-5 text-center">
                <p className="text-[13px] text-on-surface/65 leading-snug">
                  No reviews yet. Be the first to share what you thought.
                </p>
              </div>
            )}
          </>
        )}

        {/* View full restaurant page — primary route to the detail page. */}
        <Link
          to={`/restaurant/${encodeURIComponent(snapshot.id)}`}
          onClick={onClose}
          className="group flex items-center justify-center gap-1.5 w-full h-12 rounded-full bg-primary text-white text-[14px] font-bold hover:bg-primary/90 transition-colors shadow-sm"
        >
          View full restaurant page
          <ArrowUpRight size={16} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </Link>
      </div>
    </>
  );
};

/* ── Desktop side panel + mobile sheet ───────────────────────────────── */

export const RestaurantPanel: React.FC<RestaurantPanelProps> = ({ snapshot, onClose, currentUserId, variant }) => {
  if (variant === 'sheet') {
    return (
      <AnimatePresence>
        {snapshot && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/55 backdrop-blur-sm flex items-end"
            onClick={onClose}
          >
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface w-full rounded-t-3xl flex flex-col ring-1 ring-on-surface/[0.16]"
              style={{ height: '85%' }}
            >
              <div className="pt-2 pb-1 flex justify-center flex-shrink-0">
                <span className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
              <RestaurantPanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <AnimatePresence>
      {snapshot && (
        <motion.div
          key={snapshot.id}
          initial={{ opacity: 0, x: 20, width: 0 }}
          animate={{ opacity: 1, x: 0, width: 380 }}
          exit={{ opacity: 0, x: 20, width: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 280 }}
          className="h-full bg-surface ring-1 ring-on-surface/[0.16] rounded-[24px] overflow-hidden flex flex-col flex-shrink-0 shadow-md"
        >
          <div className="w-[380px] h-full flex flex-col">
            <RestaurantPanelBody snapshot={snapshot} onClose={onClose} currentUserId={currentUserId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
