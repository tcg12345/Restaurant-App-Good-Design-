import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search } from 'lucide-react';
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
  const [expandedPhoto, setExpandedPhoto] = useState<GalleryPhoto | null>(null);

  const { dragProps } = useBottomSheet(true, onClose);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expandedPhoto) setExpandedPhoto(null);
        else onClose();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => { window.removeEventListener('keydown', handleKey); };
  }, [onClose, expandedPhoto]);

  // Build unified photo list with captions
  const allPhotos: GalleryPhoto[] = React.useMemo(() => {
    const communityUrls = new Set(communityPhotos.map((p) => p.url));
    const googlePhotos = photos
      .filter((url) => !communityUrls.has(url))
      .map((url) => ({ url, caption: '', isGoogle: true }));
    const userPhotos = communityPhotos
      .filter((p) => p.url && p.url.length < 500000)
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
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 30, stiffness: 300 }}
        {...dragProps}
        onClick={(e) => e.stopPropagation()}
        className="absolute inset-0 bg-surface flex flex-col"
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
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-8" style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}>

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

              {/* Photo grid — 2 columns */}
              <div className="grid grid-cols-2 gap-2 px-5">
                {displayPhotos.map((photo, i) => (
                  <button
                    key={i}
                    onClick={() => setExpandedPhoto(photo)}
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

        {/* Expanded single photo overlay */}
        <AnimatePresence>
          {expandedPhoto && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-10 bg-black/90 flex flex-col items-center justify-center"
              onClick={() => setExpandedPhoto(null)}
            >
              <button
                onClick={() => setExpandedPhoto(null)}
                className="absolute top-6 right-5 p-2 rounded-full bg-white/10 hover:bg-white/20 transition-colors z-20"
              >
                <X size={22} className="text-white" />
              </button>
              <img
                src={expandedPhoto.url}
                alt={expandedPhoto.caption || name}
                className="max-w-full max-h-[75vh] object-contain rounded-xl"
                referrerPolicy="no-referrer"
                onClick={(e) => e.stopPropagation()}
              />
              {expandedPhoto.caption && (
                <p className="text-white/80 text-sm font-medium mt-3 px-8 text-center">{expandedPhoto.caption}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};
