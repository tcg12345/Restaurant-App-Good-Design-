import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, Trash2, ChevronLeft, DollarSign, CalendarDays, Tag, StickyNote, Image, ListPlus } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';

const TAGS = [
  'Great Service', 'Romantic', 'Good for Groups', 'Great Cocktails',
  'Cozy Atmosphere', 'Outdoor Seating', 'Live Music', 'Kid Friendly',
  'Late Night', 'Good Value', 'Special Occasion', 'Quick Bite',
];

const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

const PRICE_RANGES: { signs: string; label: string }[] = [
  { signs: '$', label: '$1–20' },
  { signs: '$$', label: '$20–50' },
  { signs: '$$$', label: '$50–100' },
  { signs: '$$$$', label: '$100+' },
];

function priceIndexFromAmount(amount: number): number {
  if (amount <= 20) return 0;
  if (amount <= 50) return 1;
  if (amount <= 100) return 2;
  return 3;
}

type Page = 'main' | 'notes' | 'tags' | 'photos' | 'lists' | 'price' | 'date';

export const RatingModal: React.FC = () => {
  const { ratingModalOpen, ratingModalRestaurant, closeRatingModal, rateRestaurant, getRating, lists, createList } = useLists();

  const existing = ratingModalRestaurant ? getRating(ratingModalRestaurant.id) : undefined;

  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [priceIndex, setPriceIndex] = useState(-1);
  const [priceAmount, setPriceAmount] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);

  const [creatingList, setCreatingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const [page, setPage] = useState<Page>('main');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ratingModalOpen && ratingModalRestaurant) {
      const ex = getRating(ratingModalRestaurant.id);
      setScore(ex?.score ?? 7);
      setNotes(ex?.notes ?? '');
      setVisitDate(ex?.visitDate ?? new Date().toISOString().slice(0, 10));
      setWouldReturn(ex?.wouldReturn ?? true);
      setSelectedTags(ex?.tags ?? []);
      setPhotos(ex?.photos ?? []);
      setSelectedListIds(ex?.listIds ?? []);
      setPriceIndex(-1);
      setPriceAmount('');
      setPage('main');
      setCreatingList(false);
      setNewName('');
    }
  }, [ratingModalOpen, ratingModalRestaurant]);

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const toggleList = (listId: string) => setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);

  const handlePriceSignClick = (idx: number) => { setPriceIndex(idx); setPriceAmount(''); };
  const handlePriceAmountChange = (val: string) => {
    setPriceAmount(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
  };

  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (ratingModalRestaurant?.price || '$$');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => { if (typeof reader.result === 'string') setPhotos((prev) => [...prev, reader.result as string]); };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName('');
    setNewEmoji('📋');
    setCreatingList(false);
  };

  const handleSave = () => {
    if (!ratingModalRestaurant) return;
    rateRestaurant({
      restaurantId: ratingModalRestaurant.id,
      name: ratingModalRestaurant.name,
      image: ratingModalRestaurant.image,
      cuisine: ratingModalRestaurant.cuisine,
      price: resolvedPrice,
      address: ratingModalRestaurant.address,
      score, notes, visitDate, wouldReturn,
      tags: selectedTags, photos,
      listIds: selectedListIds,
      createdAt: Date.now(),
    });
    closeRatingModal();
  };

  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

  const hasNotes = notes.trim().length > 0;
  const hasPrice = priceIndex >= 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasLists = selectedListIds.length > 0;
  const dateLabel = new Date(visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const SubHeader: React.FC<{ title: string }> = ({ title }) => (
    <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
      <button onClick={() => setPage('main')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
        <ChevronLeft size={22} />
      </button>
      <h2 className="font-serif font-bold text-lg">{title}</h2>
    </div>
  );

  return (
    <AnimatePresence>
      {ratingModalOpen && ratingModalRestaurant && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          onClick={closeRatingModal}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "bg-surface w-full sm:max-w-md sm:rounded-3xl overflow-hidden flex flex-col",
              "h-[100dvh] sm:h-auto sm:max-h-[92vh] rounded-none sm:rounded-3xl"
            )}
          >
            <AnimatePresence mode="wait">
              {/* ═══════════ MAIN PAGE ═══════════ */}
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col h-full">
                  <div className="px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <div className="min-w-0">
                      <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Update Rating' : 'Rate Restaurant'}</h2>
                      <p className="text-xs text-on-surface/40 truncate">{ratingModalRestaurant.name}</p>
                    </div>
                    <button onClick={closeRatingModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                      <X size={20} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto overscroll-contain px-5">
                    <div className="flex flex-col items-center pt-4 sm:pt-6">
                      <div className={cn("relative w-32 h-32 sm:w-36 sm:h-36 rounded-full flex items-center justify-center mb-4 bg-gradient-to-b ring-4", scoreBg, scoreRing)}>
                        <div className="text-center">
                          <div className={cn("text-5xl font-serif font-bold tabular-nums transition-colors duration-300", scoreColor)}>{score.toFixed(1)}</div>
                          <div className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30 mt-0.5">out of 10</div>
                        </div>
                      </div>

                      <div className="w-full max-w-[280px] mb-2">
                        <input type="range" min="1" max="10" step="0.1" value={score} onChange={(e) => setScore(parseFloat(e.target.value))}
                          className="w-full h-2.5 bg-on-surface/8 rounded-full appearance-none cursor-pointer accent-primary" />
                        <div className="flex justify-between mt-1 text-[10px] text-on-surface/25 font-semibold px-0.5">
                          <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                        </div>
                      </div>

                      <p className="text-sm font-medium text-on-surface/40 mb-5">
                        {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                      </p>

                      <div className="w-full max-w-[280px] mb-6">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 text-center mb-2">Would you go back?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setWouldReturn(true)}
                            className={cn("flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                              wouldReturn ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-on-surface/10 text-on-surface/40"
                            )}>Yes!</button>
                          <button onClick={() => setWouldReturn(false)}
                            className={cn("flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                              !wouldReturn ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-on-surface/10 text-on-surface/40"
                            )}>Nah</button>
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-on-surface/6 pt-4 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-3">Add details to your review</p>
                      <div className="grid grid-cols-3 gap-2">
                        <button onClick={() => setPage('notes')} className={cn("flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all", hasNotes ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                          <StickyNote size={18} className={hasNotes ? "text-primary" : "text-on-surface/30"} />
                          <span className={cn("text-[10px] font-semibold", hasNotes ? "text-primary" : "text-on-surface/40")}>Notes</span>
                          {hasNotes && <span className="text-[9px] text-primary/60 line-clamp-1 w-full text-center">{notes.slice(0, 20)}...</span>}
                        </button>
                        <button onClick={() => setPage('price')} className={cn("flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all", hasPrice ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                          <DollarSign size={18} className={hasPrice ? "text-primary" : "text-on-surface/30"} />
                          <span className={cn("text-[10px] font-semibold", hasPrice ? "text-primary" : "text-on-surface/40")}>Price</span>
                          {hasPrice && <span className="text-[9px] text-primary/60 font-bold">{PRICE_RANGES[priceIndex].signs}</span>}
                        </button>
                        <button onClick={() => setPage('date')} className="flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all bg-primary/5 border-primary/20">
                          <CalendarDays size={18} className="text-primary" />
                          <span className="text-[10px] font-semibold text-primary">Date</span>
                          <span className="text-[9px] text-primary/60">{dateLabel}</span>
                        </button>
                        <button onClick={() => setPage('tags')} className={cn("flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all", hasTags ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                          <Tag size={18} className={hasTags ? "text-primary" : "text-on-surface/30"} />
                          <span className={cn("text-[10px] font-semibold", hasTags ? "text-primary" : "text-on-surface/40")}>Tags</span>
                          {hasTags && <span className="text-[9px] text-primary/60">{selectedTags.length} selected</span>}
                        </button>
                        <button onClick={() => setPage('photos')} className={cn("flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all", hasPhotos ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                          <Image size={18} className={hasPhotos ? "text-primary" : "text-on-surface/30"} />
                          <span className={cn("text-[10px] font-semibold", hasPhotos ? "text-primary" : "text-on-surface/40")}>Photos</span>
                          {hasPhotos && <span className="text-[9px] text-primary/60">{photos.length} added</span>}
                        </button>
                        <button onClick={() => setPage('lists')} className={cn("flex flex-col items-center gap-1.5 p-3 rounded-2xl border transition-all", hasLists ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15")}>
                          <ListPlus size={18} className={hasLists ? "text-primary" : "text-on-surface/30"} />
                          <span className={cn("text-[10px] font-semibold", hasLists ? "text-primary" : "text-on-surface/40")}>Lists</span>
                          {hasLists && <span className="text-[9px] text-primary/60">{selectedListIds.length} lists</span>}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={handleSave} className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                      {existing ? 'Update Rating' : 'Save Rating'}
                    </button>
                  </div>
                </motion.div>
              )}

              {page === 'notes' && (
                <motion.div key="notes" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="flex flex-col h-full">
                  <SubHeader title="Notes" />
                  <div className="flex-1 overflow-y-auto px-5 py-5">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you enjoy? Any favorite dishes, standout moments, or things to remember?" rows={8} autoFocus
                      className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={() => setPage('main')} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{hasNotes ? 'Update Notes' : 'Save Notes'}</button>
                  </div>
                </motion.div>
              )}

              {page === 'price' && (
                <motion.div key="price" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="flex flex-col h-full">
                  <SubHeader title="Price Range" />
                  <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col items-center">
                    <p className="text-xs text-on-surface/40 mb-5 text-center">How much per person?</p>
                    <div className="flex gap-2.5 w-full max-w-xs mb-6">
                      {PRICE_RANGES.map((p, idx) => (
                        <button key={idx} onClick={() => handlePriceSignClick(idx)}
                          className={cn("flex-1 py-4 rounded-2xl border-2 transition-all text-center",
                            priceIndex === idx ? "bg-primary/10 border-primary/30 text-primary shadow-sm" : "bg-white border-on-surface/10 text-on-surface/40 hover:border-on-surface/20"
                          )}>
                          <div className="text-xl font-bold">{p.signs}</div>
                          <div className="text-[10px] font-medium opacity-60 mt-1">{p.label}</div>
                        </button>
                      ))}
                    </div>
                    <div className="w-full max-w-xs">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2 text-center">Or enter exact amount</p>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-on-surface/30 font-medium">$</span>
                        <input type="number" value={priceAmount} onChange={(e) => handlePriceAmountChange(e.target.value)} placeholder="0"
                          className="w-full bg-white border border-on-surface/10 rounded-2xl pl-8 pr-4 py-3.5 text-center text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-on-surface/30">per person</span>
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={() => setPage('main')} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">Done</button>
                  </div>
                </motion.div>
              )}

              {page === 'date' && (
                <motion.div key="date" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="flex flex-col h-full">
                  <SubHeader title="Date Visited" />
                  <div className="flex-1 overflow-y-auto px-5 py-6 flex flex-col items-center">
                    <p className="text-xs text-on-surface/40 mb-5 text-center">When did you visit?</p>
                    <div className="w-full max-w-xs">
                      <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)}
                        className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-base font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 text-center" />
                    </div>
                    <p className="text-sm font-semibold text-on-surface/60 mt-4">{dateLabel}</p>
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={() => setPage('main')} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">Done</button>
                  </div>
                </motion.div>
              )}

              {page === 'tags' && (
                <motion.div key="tags" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="flex flex-col h-full">
                  <SubHeader title="Tags" />
                  <div className="flex-1 overflow-y-auto px-5 py-5">
                    <p className="text-xs text-on-surface/40 mb-4">What best describes this restaurant?</p>
                    <div className="flex flex-wrap gap-2.5">
                      {TAGS.map((tag) => (
                        <button key={tag} onClick={() => toggleTag(tag)}
                          className={cn("px-4 py-2.5 rounded-2xl text-sm font-semibold border-2 transition-all",
                            selectedTags.includes(tag) ? "bg-primary/10 border-primary/25 text-primary" : "bg-white border-on-surface/10 text-on-surface/40 hover:border-on-surface/20"
                          )}>{tag}</button>
                      ))}
                    </div>
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={() => setPage('main')} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{hasTags ? `Done (${selectedTags.length})` : 'Done'}</button>
                  </div>
                </motion.div>
              )}

              {page === 'photos' && (
                <motion.div key="photos" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="flex flex-col h-full">
                  <SubHeader title="Photos" />
                  <div className="flex-1 overflow-y-auto px-5 py-5">
                    <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                    {photos.length === 0 ? (
                      <button onClick={() => fileInputRef.current?.click()}
                        className="w-full py-16 rounded-2xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-2 text-on-surface/30 hover:border-primary hover:text-primary transition-all">
                        <Camera size={28} /><span className="text-sm font-semibold">Tap to add photos</span><span className="text-[11px] opacity-60">Share your experience</span>
                      </button>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        {photos.map((photo, idx) => (
                          <div key={idx} className="relative aspect-square rounded-2xl overflow-hidden group/photo">
                            <img src={photo} alt="" className="w-full h-full object-cover" />
                            <button onClick={() => removePhoto(idx)} className="absolute top-1.5 right-1.5 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover/photo:opacity-100 transition-opacity">
                              <Trash2 size={13} className="text-white" />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => fileInputRef.current?.click()}
                          className="aspect-square rounded-2xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-1 text-on-surface/30 hover:border-primary hover:text-primary transition-all">
                          <Plus size={20} /><span className="text-[10px] font-semibold">Add more</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={() => setPage('main')} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{hasPhotos ? `Done (${photos.length})` : 'Done'}</button>
                  </div>
                </motion.div>
              )}

              {page === 'lists' && (
                <motion.div key="lists" initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 300 }} className="flex flex-col h-full">
                  <SubHeader title="Add to Lists" />
                  <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
                    {lists.map((list) => {
                      const selected = selectedListIds.includes(list.id);
                      return (
                        <button key={list.id} onClick={() => toggleList(list.id)}
                          className={cn("w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all text-left",
                            selected ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15"
                          )}>
                          <span className="text-xl">{list.emoji}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{list.name}</p>
                            <p className="text-[11px] text-on-surface/40">{list.restaurantIds.length + (list.wishlistIds?.length || 0)} restaurants</p>
                          </div>
                          <div className={cn("w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all",
                            selected ? "bg-primary border-primary text-white" : "border-on-surface/15"
                          )}>{selected && <Check size={14} strokeWidth={3} />}</div>
                        </button>
                      );
                    })}
                    {creatingList ? (
                      <div className="p-4 rounded-2xl border border-primary/20 bg-primary/5 space-y-3">
                        <div className="flex flex-wrap gap-1.5">
                          {EMOJI_OPTIONS.map((e) => (
                            <button key={e} onClick={() => setNewEmoji(e)}
                              className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all",
                                newEmoji === e ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-on-surface/5"
                              )}>{e}</button>
                          ))}
                        </div>
                        <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name..." autoFocus
                          className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          onKeyDown={(e) => e.key === 'Enter' && handleCreateList()} />
                        <div className="flex gap-2">
                          <button onClick={() => { setCreatingList(false); setNewName(''); }} className="flex-1 py-2 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50">Cancel</button>
                          <button onClick={handleCreateList} disabled={!newName.trim()} className="flex-1 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40">Create</button>
                        </div>
                      </div>
                    ) : (
                      <button onClick={() => setCreatingList(true)}
                        className="w-full flex items-center gap-3 p-3.5 rounded-2xl border border-dashed border-on-surface/15 text-on-surface/35 hover:border-primary hover:text-primary transition-all">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center bg-on-surface/5"><Plus size={16} /></div>
                        <span className="text-sm font-semibold">Create New List</span>
                      </button>
                    )}
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={() => setPage('main')} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{hasLists ? `Done (${selectedListIds.length})` : 'Done'}</button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
