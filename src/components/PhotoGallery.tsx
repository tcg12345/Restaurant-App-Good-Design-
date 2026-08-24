import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CommunityPhoto } from '../lib/supabase-community';
import { useBottomSheet } from '../lib/useBottomSheet';

interface GalleryPhoto {
  url: string;
  caption: string;
  isGoogle: boolean;
}

interface DishGroup {
  dish: string;
  photos: GalleryPhoto[];
}

export const PhotoGallery: React.FC<{
  photos: string[];
  communityPhotos: CommunityPhoto[];
  name: string;
  initialIndex: number;
  onClose: () => void;
}> = ({ photos, communityPhotos, name, initialIndex, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeDish, setActiveDish] = useState<string | null>(null);
  // Full-screen viewer: index into the CURRENT displayPhotos (the grid the
  // user tapped from) + slide direction for the swipe animation. `dir: 0`
  // marks the initial open (no slide).
  const [expanded, setExpanded] = useState<{ index: number; dir: 1 | -1 | 0 } | null>(null);

  const sheetScrollRef = useRef<HTMLDivElement | null>(null);
  const { dragProps, sheetRef } = useBottomSheet(true, onClose, sheetScrollRef);

  // Build unified photo list with captions
  const allPhotos: GalleryPhoto[] = React.useMemo(() => {
    const communityUrls = new Set(communityPhotos.map((p) => p.url));
    const googlePhotos = photos
      .filter((url) => !communityUrls.has(url))
      .map((url) => ({ url, caption: '', isGoogle: true }));
    const userPhotos = communityPhotos
      .filter((p) => !!p.url && (p.url.startsWith('blob:') || p.url.length < 12_000_000))
      .map((p) => ({ url: p.url, caption: p.caption || '', isGoogle: false }));
    return [...googlePhotos, ...userPhotos];
  }, [photos, communityPhotos]);

  // Group photos by dish name
  const dishGroups: DishGroup[] = React.useMemo(() => {
    const groups: Record<string, GalleryPhoto[]> = {};
    for (const p of allPhotos) {
      if (!p.caption) continue;
      const key = p.caption.trim().toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    return Object.entries(groups)
      .filter(([, arr]) => arr.length >= 2)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([, arr]) => ({ dish: arr[0].caption, photos: arr }));
  }, [allPhotos]);

  // Filter photos
  const displayPhotos = React.useMemo(() => {
    if (activeDish) {
      const key = activeDish.toLowerCase();
      return allPhotos.filter((p) => p.caption.toLowerCase() === key);
    }
    if (searchQuery.trim()) {
      return allPhotos.filter((p) => p.caption.toLowerCase().includes(searchQuery.toLowerCase()));
    }
    return allPhotos;
  }, [allPhotos, searchQuery, activeDish]);

  const expandedPhoto = expanded !== null ? displayPhotos[expanded.index] : null;

  // Step the full-screen viewer to the previous (-1) / next (+1) photo.
  // No-op at either end — the swipe just rubber-bands back.
  const paginate = useCallback((dir: 1 | -1) => {
    setExpanded((cur) => {
      if (cur === null) return cur;
      const next = cur.index + dir;
      if (next < 0 || next >= displayPhotos.length) return cur;
      return { index: next, dir };
    });
  }, [displayPhotos.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expanded) setExpanded(null);
        else onClose();
      } else if (expanded && e.key === 'ArrowRight') paginate(1);
      else if (expanded && e.key === 'ArrowLeft') paginate(-1);
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); };
  }, [onClose, expanded, paginate]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        ref={sheetRef as React.RefObject<HTMLDivElement>}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        {...dragProps}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 bg-surface flex flex-col kb-pad"
      >
        {/* Header */}
        <div className="flex-shrink-0 pt-safe-4 pb-2 px-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-serif font-bold">Photos</h2>
              <p className="text-[11px] text-on-surface/40 mt-0.5">{allPhotos.length} photo{allPhotos.length !== 1 ? 's' : ''}</p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-on-surface/5 transition-colors"
            >
              <X size={22} className="text-on-surface/50" />
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div className="flex-shrink-0 px-5 pb-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/35" />
            <input
              type="text"
              placeholder="Search by dish or description..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setActiveDish(null); }}
              className="w-full pl-9 pr-4 py-2.5 text-sm bg-on-surface/[0.04] border border-on-surface/8 rounded-xl text-on-surface placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 transition-all"
            />
          </div>
        </div>

        {/* Scrollable content */}
        <div ref={sheetScrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

          {/* Active dish filter chip */}
          {activeDish && (
            <div className="flex items-center gap-2 px-5 pb-3">
              <span className="text-xs font-semibold text-on-surface/50 uppercase tracking-wider">Showing:</span>
              <button onClick={() => setActiveDish(null)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-full text-xs font-bold">
                {activeDish}
                <X size={12} />
              </button>
            </div>
          )}

          {/* Popular Dishes section */}
          {!searchQuery.trim() && !activeDish && dishGroups.length > 0 && (
            <div className="pb-5">
              <h3 className="text-sm font-serif font-bold text-on-surface px-5 pb-3">Popular dishes</h3>
              <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 snap-x snap-mandatory">
                {dishGroups.map((group) => (
                  <button
                    key={group.dish}
                    onClick={() => setActiveDish(group.dish)}
                    className="flex-shrink-0 w-36 text-left snap-start"
                  >
                    <div className="rounded-xl overflow-hidden aspect-[4/3] mb-2">
                      <img
                        src={group.photos[0].url}
                        alt={group.dish}
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <p className="text-sm font-semibold text-on-surface truncate">{group.dish}</p>
                    <p className="text-[11px] text-on-surface/40">{group.photos.length} recommended</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Results info when searching */}
          {(searchQuery.trim() || activeDish) && (
            <div className="px-5 pb-2">
              <p className="text-[11px] text-on-surface/40">{displayPhotos.length} result{displayPhotos.length !== 1 ? 's' : ''}</p>
            </div>
          )}

          {displayPhotos.length === 0 ? (
            <div className="flex items-center justify-center py-16">
              <p className="text-sm text-on-surface/40">No photos match "{searchQuery}"</p>
            </div>
          ) : (
            <>
              {/* All Photos header */}
              {!searchQuery.trim() && !activeDish && (
                <h3 className="text-sm font-serif font-bold text-on-surface px-5 pb-3">Photos from members</h3>
              )}

              {/* Photo grid — 2 columns on phones, 4 across on desktop. */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-5">
                {displayPhotos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => setExpanded({ index: i, dir: 0 })}
                    className="relative aspect-square rounded-2xl overflow-hidden"
                  >
                    <img
                      src={photo.url}
                      alt={photo.caption || `${name} photo ${i + 1}`}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    {photo.caption && (
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 pb-2.5 pt-6">
                        <p className="text-[13px] text-white font-semibold truncate">{photo.caption}</p>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Expanded full-screen viewer — swipe (or arrow keys / desktop
            chevrons) moves through the photos of the grid the user tapped. */}
        <AnimatePresence>
          {expanded !== null && expandedPhoto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 bg-black/90 flex flex-col"
              onClick={() => setExpanded(null)}
            >
              <button
                onClick={() => setExpanded(null)}
                aria-label="Close photo"
                className="absolute top-[max(1.5rem,env(safe-area-inset-top))] right-5 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-20"
              >
                <X size={22} className="text-white" />
              </button>
              {displayPhotos.length > 1 && (
                <div className="absolute top-[max(1.75rem,calc(env(safe-area-inset-top)+0.25rem))] left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-white/10 text-white/85 text-[12px] font-semibold tabular-nums z-20 pointer-events-none">
                  {expanded.index + 1} of {displayPhotos.length}
                </div>
              )}

              {/* Slide track. Images are absolutely stacked so the exiting
                  one can slide out while the next slides in. */}
              <div className="relative flex-1 min-h-0 overflow-hidden">
                <AnimatePresence initial={false} custom={expanded.dir}>
                  <motion.img
                    key={expanded.index}
                    src={expandedPhoto.url}
                    alt={expandedPhoto.caption || name}
                    custom={expanded.dir}
                    variants={{
                      enter: (dir: number) => ({ x: dir === 0 ? 0 : dir > 0 ? '100%' : '-100%', opacity: dir === 0 ? 1 : 0.5 }),
                      center: { x: 0, opacity: 1 },
                      exit: (dir: number) => ({ x: dir > 0 ? '-100%' : '100%', opacity: 0.5 }),
                    }}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ x: { type: 'spring', stiffness: 340, damping: 34 }, opacity: { duration: 0.16 } }}
                    drag={displayPhotos.length > 1 ? 'x' : false}
                    dragConstraints={{ left: 0, right: 0 }}
                    dragElastic={0.9}
                    onDragEnd={(_e, info) => {
                      if (info.offset.x < -70 || info.velocity.x < -500) paginate(1);
                      else if (info.offset.x > 70 || info.velocity.x > 500) paginate(-1);
                    }}
                    className="absolute inset-0 w-full h-full object-contain px-2 py-4 touch-pan-y"
                    referrerPolicy="no-referrer"
                    draggable={false}
                    onClick={(e) => e.stopPropagation()}
                  />
                </AnimatePresence>

                {/* Desktop chevrons (touch swipes on phones) */}
                {displayPhotos.length > 1 && (
                  <>
                    {expanded.index > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); paginate(-1); }}
                        aria-label="Previous photo"
                        className="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center transition-colors z-20"
                      >
                        <ChevronLeft size={22} className="text-white" />
                      </button>
                    )}
                    {expanded.index < displayPhotos.length - 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); paginate(1); }}
                        aria-label="Next photo"
                        className="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 items-center justify-center transition-colors z-20"
                      >
                        <ChevronRight size={22} className="text-white" />
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="flex-shrink-0 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-1 min-h-[3.25rem]">
                {expandedPhoto.caption && (
                  <p className="text-white/80 text-sm font-medium px-8 text-center">{expandedPhoto.caption}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};
