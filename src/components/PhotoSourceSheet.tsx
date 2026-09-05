// The photo picker for "Recreate a dish" — one sheet, four ways to a
// photo of a plate:
//
//   • Take a photo      — the native camera (UIImagePickerController via
//                         the PhotoLibrary plugin); a capture input on web.
//   • My library        — the in-app camera-roll grid on native (same one
//                         the post composer uses); a file input on web.
//   • My ratings        — every photo attached to the user's own ratings,
//                         grouped by restaurant, newest first.
//   • A restaurant      — pick a place (rated ones first, then a Places
//                         search), then one of its member photos.
//
// Every sub-view lives INSIDE this sheet. useBottomSheet lifts the sheet
// into the browser top layer, which paints above every z-index — so a
// separate portal (SearchPopup, a second sheet) opened from here would
// render underneath it. The picker resolves to a File + origin and closes;
// the generator compresses and holds the result.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Camera, ChevronLeft, ChevronRight, Image as ImageIcon, Loader2, Search, UtensilsCrossed, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { useLists, type PhotoItem, type RestaurantRating } from '../contexts/ListsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { PhotoLibrary, canUseNativePhotoLibrary, nativePathToFile, type MediaItem } from '../lib/native-photos';
import { PhotoLibraryGrid } from './PhotoLibraryGrid';
import { getCommunityPhotos, type CommunityPhoto } from '../lib/supabase-community';
import { useBlobPhotos } from '../lib/useBlobPhotos';
import { searchPlacesByText, type PlaceResult } from '../lib/places';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { loadLastSelectedLocation } from './HomeLocationBar';
import { displayCuisine } from '../lib/cuisine';
import { dishPhotoUrlToFile, type DishPhotoPick } from '../lib/dish-photo';
import './RecipeBuilder.css';

type View = 'menu' | 'library' | 'ratings' | 'restaurants' | 'restaurantPhotos';

interface Props {
  open: boolean;
  onClose: () => void;
  onPick: (pick: DishPhotoPick) => void;
}

const TITLES: Record<View, string> = {
  menu: 'Add a photo',
  library: 'My library',
  ratings: 'My ratings',
  restaurants: 'A restaurant',
  restaurantPhotos: 'Member photos',
};

// Manhattan, the same fallback the search popup uses when nothing about
// the user's location is known.
const DEFAULT_LAT = 40.735;
const DEFAULT_LNG = -73.99;

/** A photo that can actually be shown and fetched — skips empty slots
 *  and dead session blobs left over from an interrupted upload. */
const usable = (p: PhotoItem) => !!p.url && !p.url.startsWith('blob:');

export const PhotoSourceSheet: React.FC<Props> = ({ open, onClose, onPick }) => {
  const { phoneMode } = useSettings();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { ratings } = useLists();
  const [view, setView] = useState<View>('menu');
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, scrollRef);
  const native = canUseNativePhotoLibrary();

  // Every open starts on the menu.
  useEffect(() => {
    if (open) { setView('menu'); setBusy(false); setTarget(null); }
  }, [open]);

  const deliver = (pick: DishPhotoPick) => {
    setBusy(false);
    onPick(pick);
  };

  const fail = () => {
    setBusy(false);
    showToast("Couldn't load that photo");
  };

  /* ── Camera ── */
  const takePhoto = async () => {
    if (!native) { cameraInputRef.current?.click(); return; }
    try {
      const res = await PhotoLibrary.pickCamera({ mediaType: 'photo' });
      if (res.cancelled || !res.path || !res.mimeType) return;
      const ext = res.mimeType.split('/')[1] || 'jpg';
      const file = await nativePathToFile(res.path, `camera-${Date.now()}.${ext}`, res.mimeType);
      deliver({ file, origin: { kind: 'camera' } });
    } catch (err) {
      console.warn('[PhotoSourceSheet] camera failed:', err);
      fail();
    }
  };

  /* ── Library ── */
  const openLibrary = () => {
    if (native) setView('library');
    else libraryInputRef.current?.click();
  };

  const pickNative = async (item: MediaItem) => {
    if (busy) return;
    setBusy(true);
    try {
      const { path, mimeType } = await PhotoLibrary.getMedia({ id: item.id });
      const ext = mimeType.split('/')[1] || 'jpg';
      const file = await nativePathToFile(path, `dish-${item.id}.${ext}`, mimeType);
      deliver({ file, origin: { kind: 'library' } });
    } catch (err) {
      console.warn('[PhotoSourceSheet] library read failed:', err);
      fail();
    }
  };

  const onFileInput = (kind: 'camera' | 'library') => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !file.type.startsWith('image/')) return;
    deliver({ file, origin: { kind } });
  };

  /* ── My ratings ── */
  const ratingGroups = useMemo(() => {
    return ratings
      .map((r) => ({ rating: r, photos: (r.photos || []).filter(usable) }))
      .filter((g) => g.photos.length > 0)
      .sort((a, b) => Math.max(b.rating.updatedAt ?? 0, b.rating.createdAt) - Math.max(a.rating.updatedAt ?? 0, a.rating.createdAt));
  }, [ratings]);

  const pickRatingPhoto = async (r: RestaurantRating, p: PhotoItem) => {
    if (busy) return;
    setBusy(true);
    const file = await dishPhotoUrlToFile(p.url);
    if (!file) { fail(); return; }
    deliver({ file, origin: { kind: 'rating', restaurantId: r.restaurantId, restaurantName: r.name, caption: p.caption || undefined, url: p.url } });
  };

  /* ── A restaurant ── */
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const requestIdRef = useRef(0);
  const homeCtx = useHomeLocation();
  const storedHome = useMemo(() => (homeCtx ? null : loadLastSelectedLocation()), [homeCtx]);
  const homeLoc = homeCtx ? homeCtx.location : storedHome;
  const biasLat = homeLoc && Number.isFinite(homeLoc.lat) ? homeLoc.lat : DEFAULT_LAT;
  const biasLng = homeLoc && Number.isFinite(homeLoc.lng) ? homeLoc.lng : DEFAULT_LNG;

  useEffect(() => {
    if (view !== 'restaurants') return;
    const trimmed = query.trim();
    if (!trimmed) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const reqId = ++requestIdRef.current;
    const t = setTimeout(async () => {
      try {
        const found = await searchPlacesByText(trimmed, biasLat, biasLng);
        if (reqId === requestIdRef.current) setResults(found);
      } catch {
        if (reqId === requestIdRef.current) setResults([]);
      } finally {
        if (reqId === requestIdRef.current) setSearching(false);
      }
    }, 240);
    return () => clearTimeout(t);
  }, [query, view, biasLat, biasLng]);

  const ratedMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const seen = new Set<string>();
    const rows: RestaurantRating[] = [];
    for (const r of [...ratings].sort((a, b) => Math.max(b.updatedAt ?? 0, b.createdAt) - Math.max(a.updatedAt ?? 0, a.createdAt))) {
      if (seen.has(r.restaurantId)) continue;
      if (q && !r.name.toLowerCase().includes(q)) continue;
      seen.add(r.restaurantId);
      rows.push(r);
    }
    return rows.slice(0, q ? 8 : 30);
  }, [ratings, query]);
  const ratedIds = useMemo(() => new Set(ratedMatches.map((r) => r.restaurantId)), [ratedMatches]);

  const openRestaurant = (id: string, name: string) => {
    setTarget({ id, name });
    setView('restaurantPhotos');
  };

  /* ── Member photos of the chosen restaurant ── */
  const [communityPhotos, setCommunityPhotos] = useState<CommunityPhoto[] | null>(null);
  useEffect(() => {
    if (view !== 'restaurantPhotos' || !target) return;
    let cancelled = false;
    setCommunityPhotos(null);
    getCommunityPhotos(target.id, 60)
      .then((rows) => { if (!cancelled) setCommunityPhotos(rows); })
      .catch(() => { if (!cancelled) setCommunityPhotos([]); });
    return () => { cancelled = true; };
  }, [view, target]);
  const blobMap = useBlobPhotos(communityPhotos ?? []);

  const pickCommunityPhoto = async (p: CommunityPhoto) => {
    if (busy || !target) return;
    setBusy(true);
    // The raw stored URL (never the blob: the grid renders) is what the
    // provenance keeps; both are fetchable for the bytes.
    const file = await dishPhotoUrlToFile(blobMap[p.url] ?? p.url);
    if (!file) { fail(); return; }
    deliver({
      file,
      origin: { kind: 'community', restaurantId: target.id, restaurantName: target.name, caption: p.caption || undefined, url: p.url, ownerUserId: p.user_id },
    });
  };

  /* ── Navigation ── */
  const back = () => {
    if (view === 'restaurantPhotos') { setView('restaurants'); return; }
    setView('menu');
  };
  const title = view === 'restaurantPhotos' && target ? target.name : TITLES[view];

  /* ── Tiles ── */
  const Tile: React.FC<{ src: string; caption?: string; tag?: string; onClick: () => void }> = ({ src, caption, tag, onClick }) => (
    <button type="button" onClick={onClick} disabled={busy} className="relative aspect-square rounded-2xl overflow-hidden bg-on-surface/[0.05] active:opacity-85 transition-opacity">
      <img src={src} alt={caption || 'Dish photo'} className="w-full h-full object-cover" loading="lazy" referrerPolicy="no-referrer" />
      {caption && (
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-2 pb-2 pt-6 text-left">
          <p className="text-[12px] text-white font-semibold truncate">{caption}</p>
        </div>
      )}
      {tag && (
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full bg-white/90 text-[10px] font-bold text-on-surface">{tag}</span>
      )}
    </button>
  );

  const body = (() => {
    switch (view) {
      case 'menu':
        return (
          <div className="rcx-choose-list px-5 pb-4">
            {[
              { key: 'camera', icon: <Camera size={17} strokeWidth={2} />, title: 'Take a photo', sub: 'Point the camera at the plate', onClick: () => void takePhoto() },
              { key: 'library', icon: <ImageIcon size={17} strokeWidth={2} />, title: 'My library', sub: 'A photo already on your phone', onClick: openLibrary },
              { key: 'ratings', icon: <UtensilsCrossed size={17} strokeWidth={2} />, title: 'My ratings', sub: 'Photos from places you’ve rated', onClick: () => setView('ratings') },
              { key: 'restaurant', icon: <Search size={17} strokeWidth={2} />, title: 'A restaurant', sub: 'Photos members added to a place', onClick: () => setView('restaurants') },
            ].map((row) => (
              <button key={row.key} type="button" className="rcx-choose-row" onClick={row.onClick}>
                <span className="rcx-choose-icon">{row.icon}</span>
                <span className="rcx-choose-text">
                  <span className="rcx-choose-name">{row.title}</span>
                  <span className="rcx-choose-hint">{row.sub}</span>
                </span>
                <ChevronRight size={15} className="rcx-choose-chev" />
              </button>
            ))}
          </div>
        );
      case 'library':
        return (
          <div className="pb-6">
            <PhotoLibraryGrid mediaType="photo" selectionMode="single" columns={4} onSelect={(item) => void pickNative(item)} onCameraTap={() => void takePhoto()} />
          </div>
        );
      case 'ratings':
        return ratingGroups.length === 0 ? (
          <Empty text="Photos you add to a rating will show up here." />
        ) : (
          <div className="px-5 pb-6 space-y-5">
            {ratingGroups.map(({ rating: r, photos }) => (
              <section key={r.restaurantId}>
                <h3 className="text-[13px] font-bold text-on-surface truncate mb-2">{r.name}</h3>
                <div className="grid grid-cols-3 gap-1.5">
                  {photos.map((p, i) => (
                    <Tile key={`${p.url}-${i}`} src={p.url} caption={p.caption} onClick={() => void pickRatingPhoto(r, p)} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        );
      case 'restaurants':
        return (
          <div className="px-5 pb-6">
            <div className="relative mb-3">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search restaurants…"
                autoCapitalize="words"
                className="w-full pl-9 pr-9 py-2.5 text-[15px] bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
              />
              {searching ? (
                <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 animate-spin" />
              ) : query ? (
                <button type="button" onClick={() => setQuery('')} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 text-on-surface/40">
                  <X size={14} />
                </button>
              ) : null}
            </div>
            {ratedMatches.length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-on-surface/40 mb-1">{query.trim() ? 'Your ratings' : 'Places you’ve rated'}</p>
                <ul className="mb-3">
                  {ratedMatches.map((r) => (
                    <li key={r.restaurantId}>
                      <RestaurantRow name={r.name} sub={[displayCuisine(r.cuisine), r.address].filter(Boolean).join(' · ')} onClick={() => openRestaurant(r.restaurantId, r.name)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {results.filter((p) => !ratedIds.has(p.id)).length > 0 && (
              <>
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-on-surface/40 mb-1">Search results</p>
                <ul>
                  {results.filter((p) => !ratedIds.has(p.id)).map((p) => (
                    <li key={p.id}>
                      <RestaurantRow name={p.name} sub={p.address} onClick={() => openRestaurant(p.id, p.name)} />
                    </li>
                  ))}
                </ul>
              </>
            )}
            {!searching && query.trim() && ratedMatches.length === 0 && results.length === 0 && (
              <Empty text={`Nothing found for "${query.trim()}".`} />
            )}
            {!query.trim() && ratedMatches.length === 0 && (
              <Empty text="Search for a restaurant to browse its member photos." />
            )}
          </div>
        );
      case 'restaurantPhotos':
        return communityPhotos === null ? (
          <div className="px-5 pb-6 grid grid-cols-3 gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="aspect-square rounded-2xl animate-pulse bg-on-surface/[0.06]" />)}
          </div>
        ) : communityPhotos.length === 0 ? (
          <Empty text="No member photos for this place yet." />
        ) : (
          <div className="px-5 pb-6 grid grid-cols-3 gap-1.5">
            {communityPhotos.map((p) => (
              <Tile key={p.id} src={blobMap[p.url] ?? p.url} caption={p.caption} tag={user?.id && p.user_id === user.id ? 'Yours' : undefined} onClick={() => void pickCommunityPhoto(p)} />
            ))}
          </div>
        );
    }
  })();

  return createPortal(
    <>
      {/* Web fallbacks — the native side never renders these. */}
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={onFileInput('camera')} />
      <input ref={libraryInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFileInput('library')} />
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn('fixed inset-0 z-[150] bg-black/50 backdrop-blur-[2px] flex justify-center', phoneMode ? 'items-end' : 'items-end sm:items-center')}
            onClick={onClose}
          >
            <motion.div
              ref={sheetRef as React.RefObject<HTMLDivElement>}
              initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 10 }}
              animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
              exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.97, y: 8 }}
              transition={phoneMode ? { duration: 0.42, ease: [0.32, 0.72, 0, 1] } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              {...(phoneMode ? dragProps : {})}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'relative w-full bg-surface flex flex-col overflow-hidden',
                phoneMode ? 'rounded-t-3xl max-h-[86dvh] pb-safe-2' : 'sm:max-w-[540px] rounded-t-3xl sm:rounded-3xl max-h-[86dvh] sm:max-h-[80vh]',
                view === 'menu' ? '' : 'h-[86dvh] sm:h-[80vh]',
              )}
            >
              {/* Header */}
              <div className="flex-shrink-0 px-4 pt-2 pb-2">
                {phoneMode && <div className="rcx-choose-handle" aria-hidden />}
                <div className="flex items-center gap-2 min-h-[40px]">
                  {view !== 'menu' ? (
                    <button type="button" onClick={back} aria-label="Back" className="hit-44 w-9 h-9 -ml-1 rounded-full flex items-center justify-center text-on-surface/70 active:bg-on-surface/[0.06]">
                      <ChevronLeft size={20} strokeWidth={2.2} />
                    </button>
                  ) : <span className="w-8" />}
                  <h2 className="flex-1 text-center font-serif text-[17px] font-bold text-on-surface truncate">{title}</h2>
                  <button type="button" onClick={onClose} aria-label="Close" className="hit-44 w-9 h-9 -mr-1 rounded-full flex items-center justify-center text-on-surface/60 active:bg-on-surface/[0.06]">
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Body */}
              <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>
                {body}
              </div>

              {busy && (
                <div className="absolute inset-0 z-10 bg-surface/60 flex items-center justify-center" aria-live="polite">
                  <Loader2 size={22} className="animate-spin text-on-surface/60" />
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
};

const Empty: React.FC<{ text: string }> = ({ text }) => (
  <div className="px-8 py-14 text-center">
    <p className="text-[13.5px] text-on-surface/50 leading-relaxed">{text}</p>
  </div>
);

const RestaurantRow: React.FC<{ name: string; sub: string; onClick: () => void }> = ({ name, sub, onClick }) => (
  <button type="button" onClick={onClick} className="w-full flex items-center gap-3 py-2.5 text-left border-b border-on-surface/[0.06] last:border-0 active:bg-on-surface/[0.03] transition-colors">
    <span className="min-w-0 flex-1">
      <span className="block text-[14.5px] font-semibold text-on-surface truncate">{name}</span>
      {sub && <span className="block text-[12px] text-on-surface/50 truncate">{sub}</span>}
    </span>
    <ChevronRight size={15} className="text-on-surface/30 flex-shrink-0" />
  </button>
);
