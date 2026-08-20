// Desktop share-a-restaurant picker (Messages composer).
// Two tabs: "Your rated" (the user's reviews from ListsContext) and
// "Restaurant DB" (live Google Places text search, reusing
// searchPlacesByText). Selecting a place + Send hands a SharedRestaurant
// back to the chat, which sends it into the current thread.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, Globe, Star, Send, Loader2, Navigation, Check } from 'lucide-react';
import { cn } from '../../lib/utils';
import { displayCuisine } from '../../lib/cuisine';
import { ScoreBadge } from '../ScoreBadge';
import { useLists, type RestaurantRating } from '../../contexts/ListsContext';
import { useSettings } from '../../contexts/SettingsContext';
import { type SharedRestaurant } from '../../contexts/ChatContext';
import { searchPlacesByText, priceLevelToString, formatLocationLabel, type PlaceResult } from '../../lib/places';
import { getCuisineLabel } from '../../pages/useRestaurantDetail';
import { loadLastSelectedLocation } from '../HomeLocationBar';

type Tab = 'rated' | 'db';

function ratingToShared(r: RestaurantRating): SharedRestaurant {
  return {
    restaurantId: r.restaurantId,
    name: r.name,
    image: r.image,
    cuisine: r.cuisine,
    price: r.price,
    address: r.address,
    score: r.score,
    notes: r.notes,
    tags: r.tags,
    isReview: true,
  };
}

function placeToShared(p: PlaceResult): SharedRestaurant {
  return {
    restaurantId: p.id,
    name: p.name,
    image: p.photoUrl || '',
    cuisine: getCuisineLabel(p),
    price: priceLevelToString(p.priceLevel) || '',
    address: p.address || '',
    isReview: false,
  };
}

export const ShareRestaurantPicker: React.FC<{
  open: boolean;
  recipientName?: string;
  onClose: () => void;
  onShare: (restaurant: SharedRestaurant) => void;
}> = ({ open, recipientName, onClose, onShare }) => {
  const { ratings } = useLists();
  const { phoneMode } = useSettings();
  const [tab, setTab] = useState<Tab>('rated');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<SharedRestaurant | null>(null);
  const [dbResults, setDbResults] = useState<PlaceResult[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number; label?: string } | null>(null);
  const searchSeq = useRef(0);

  // Reset transient state whenever the modal (re)opens.
  useEffect(() => {
    if (!open) return;
    setTab('rated');
    setQuery('');
    setPicked(null);
    setDbResults([]);
    const last = loadLastSelectedLocation();
    if (last) setCoords({ lat: last.lat, lng: last.lng, label: last.label });
  }, [open]);

  const ratedFiltered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ratings;
    return ratings.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q));
  }, [ratings, query]);

  // Debounced DB search (only on the DB tab, with a location + query).
  useEffect(() => {
    if (!open || tab !== 'db') return;
    const q = query.trim();
    if (!q || !coords) { setDbResults([]); setDbLoading(false); return; }
    const seq = ++searchSeq.current;
    setDbLoading(true);
    const t = setTimeout(async () => {
      const res = await searchPlacesByText(q, coords.lat, coords.lng);
      if (seq !== searchSeq.current) return; // a newer search superseded this
      setDbResults(res);
      setDbLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [open, tab, query, coords]);

  const useMyLocation = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: 'Current location' }),
      () => { /* permission denied — keep saved location */ },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
    );
  };

  const tabsMeta: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'rated', label: 'Your rated', icon: <Star size={14} />, count: ratings.length },
    { key: 'db', label: 'Restaurant DB', icon: <Globe size={14} /> },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm" onClick={onClose}
          />
          <div className={cn('fixed inset-0 z-[90] pointer-events-none', phoneMode ? 'flex' : 'grid place-items-center p-6')}>
            <motion.div
              initial={phoneMode ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.985 }}
              animate={phoneMode ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
              exit={phoneMode ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.985 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'pointer-events-auto flex flex-col bg-surface border-on-surface/10 shadow-2xl overflow-hidden',
                phoneMode
                  ? 'absolute inset-x-0 bottom-0 top-[max(env(safe-area-inset-top),28px)] rounded-t-3xl border-t'
                  : 'w-full max-w-3xl max-h-[86vh] rounded-3xl border',
              )}
            >
              {phoneMode && (
                <div className="flex justify-center pt-2.5 pb-1 flex-shrink-0"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>
              )}
              {/* Header */}
              <div className={phoneMode ? 'px-5 pt-2' : 'px-7 pt-6'}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif font-bold text-2xl tracking-tight">Share a restaurant</h2>
                    <p className="text-[13.5px] text-on-surface/55 mt-1">Pick from your reviews or search the entire restaurant database.</p>
                    {recipientName && (
                      <span className="inline-flex items-center gap-1.5 mt-3 pl-2.5 pr-3 py-1 rounded-full bg-on-surface/[0.05] border border-on-surface/10 text-[12px] font-medium">
                        <span className="text-on-surface/45">To</span>
                        <span className="text-on-surface">{recipientName}</span>
                      </span>
                    )}
                  </div>
                  <button onClick={onClose} className="w-9 h-9 rounded-full bg-on-surface/[0.05] border border-on-surface/10 grid place-items-center text-on-surface/55 hover:text-on-surface hover:bg-on-surface/10 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                {/* Tabs */}
                <div className="flex gap-1 mt-5 border-b border-on-surface/10">
                  {tabsMeta.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => { setTab(t.key); setPicked(null); }}
                      className={cn(
                        'relative inline-flex items-center gap-2 px-3.5 pb-3 pt-1 text-[13px] transition-colors',
                        tab === t.key ? 'text-on-surface font-semibold' : 'text-on-surface/50 hover:text-on-surface/75 font-medium',
                      )}
                    >
                      {t.icon}{t.label}
                      {t.count !== undefined && (
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', tab === t.key ? 'bg-primary/12 text-primary' : 'bg-on-surface/[0.06] text-on-surface/45')}>{t.count}</span>
                      )}
                      {tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search row */}
              <div className="flex items-center gap-2 px-7 pt-4 pb-3">
                <div className="flex-1 flex items-center gap-2.5 h-11 px-3.5 rounded-2xl bg-on-surface/[0.04] border border-on-surface/10 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                  <Search size={16} className="text-on-surface/40 flex-shrink-0" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={tab === 'rated' ? 'Search your rated restaurants…' : 'Search every restaurant…'}
                    className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface/35 focus:outline-none"
                  />
                </div>
                {tab === 'db' && (
                  <button
                    onClick={useMyLocation}
                    className="inline-flex items-center gap-1.5 h-11 px-3.5 rounded-2xl bg-on-surface/[0.04] border border-on-surface/10 text-[12.5px] font-semibold text-on-surface/70 hover:text-on-surface hover:border-on-surface/20 transition-colors"
                    title="Search near my current location"
                  >
                    <Navigation size={13} /> Near me
                  </button>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-7 pb-4 min-h-0">
                {tab === 'rated' ? (
                  ratedFiltered.length === 0 ? (
                    <EmptyState icon={<Star size={26} />} text={query ? `No matches for “${query}”.` : 'No rated restaurants yet.'} />
                  ) : (
                    <>
                      <SectionLabel text={`${ratedFiltered.length} place${ratedFiltered.length === 1 ? '' : 's'} you've rated`} />
                      <div className="flex flex-col -mx-1">
                        {ratedFiltered.map((r) => {
                          const shared = ratingToShared(r);
                          const sel = picked?.restaurantId === r.restaurantId && picked?.isReview === true;
                          return (
                            <RestaurantRow
                              key={r.restaurantId}
                              name={r.name}
                              meta={<>{displayCuisine(r.cuisine)}{r.price ? <span className="text-on-surface/30"> · {r.price}</span> : null}{r.address ? <span className="text-on-surface/30"> · {r.address}</span> : null}</>}
                              right={<ScoreBadge rating={r.score} size="sm" />}
                              selected={sel}
                              onClick={() => setPicked(shared)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )
                ) : (
                  !coords ? (
                    <EmptyState icon={<Globe size={26} />} text="Set a location or tap “Near me” to search the database." />
                  ) : dbLoading ? (
                    <div className="flex items-center justify-center py-16 text-on-surface/40"><Loader2 size={22} className="animate-spin" /></div>
                  ) : !query.trim() ? (
                    <EmptyState icon={<Search size={26} />} text={`Search restaurants near ${coords.label || 'you'}…`} />
                  ) : dbResults.length === 0 ? (
                    <EmptyState icon={<Globe size={26} />} text={`No matches for “${query}”.`} />
                  ) : (
                    <>
                      <SectionLabel text={`${dbResults.length} result${dbResults.length === 1 ? '' : 's'} near ${coords.label || 'you'}`} />
                      {/* Single-column rows, mirroring the header search results. */}
                      <div className="flex flex-col -mx-1">
                        {dbResults.map((p) => {
                          const shared = placeToShared(p);
                          const location = formatLocationLabel(p.addressComponents, p.fullAddress || p.address);
                          const sel = picked?.restaurantId === p.id && picked?.isReview === false;
                          return (
                            <RestaurantRow
                              key={p.id}
                              name={p.name}
                              meta={<>{displayCuisine(shared.cuisine)}{shared.price ? <span className="text-on-surface/30"> · {shared.price}</span> : null}{location ? <span className="text-on-surface/30"> · {location}</span> : null}</>}
                              right={sel ? <span className="w-6 h-6 rounded-full bg-primary text-white grid place-items-center"><Check size={14} strokeWidth={3} /></span> : null}
                              selected={sel}
                              onClick={() => setPicked(shared)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )
                )}
              </div>

              {/* Footer */}
              <div className={cn('flex items-center gap-3 border-t border-on-surface/10 bg-surface', phoneMode ? 'px-5 pt-4 pb-safe-5' : 'px-7 py-4')}>
                <p className="flex-1 text-[13px] text-on-surface/55 truncate">
                  {picked ? <>Sending <b className="text-on-surface font-semibold">{picked.name}</b>{recipientName ? <> to <b className="text-on-surface font-semibold">{recipientName}</b></> : ''}.</> : 'Pick a place to share.'}
                </p>
                <button onClick={onClose} className="px-4 py-2 rounded-full text-[13px] font-semibold text-on-surface/60 hover:text-on-surface hover:bg-on-surface/[0.06] transition-colors">Cancel</button>
                <button
                  onClick={() => { if (picked) { onShare(picked); onClose(); } }}
                  disabled={!picked}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-semibold bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                >
                  <Send size={14} /> Send
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── shared bits ── */

const SectionLabel: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-3 pt-3 pb-2.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/40 whitespace-nowrap">{text}</span>
    <span className="flex-1 h-px bg-on-surface/8" />
  </div>
);

const EmptyState: React.FC<{ icon: React.ReactNode; text: string }> = ({ icon, text }) => (
  <div className="flex flex-col items-center justify-center text-center py-16 text-on-surface/35">
    <div className="mb-3 text-on-surface/20">{icon}</div>
    <p className="font-serif italic text-[17px]">{text}</p>
  </div>
);

/** Single-column result row — shared by the rated + DB tabs, mirroring the
 *  header search results (serif name + dimmed "cuisine · price · location"). */
const RestaurantRow: React.FC<{
  name: string;
  meta: React.ReactNode;
  right?: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}> = ({ name, meta, right, selected, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
      selected ? 'bg-primary/[0.07] ring-1 ring-primary/30' : 'hover:bg-on-surface/[0.04]',
    )}
  >
    <div className="min-w-0 flex-1">
      <p className="font-serif font-bold text-[15px] text-on-surface leading-tight truncate">{name}</p>
      <p className="text-[12px] text-on-surface/50 leading-tight truncate mt-0.5">{meta}</p>
    </div>
    {right && <div className="flex-shrink-0">{right}</div>}
  </button>
);
