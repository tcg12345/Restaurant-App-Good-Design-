import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Bookmark, Star, Camera, Image, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type RestaurantMeta } from '../contexts/ListsContext';

const TAGS = [
  'Great Service', 'Romantic', 'Good for Groups', 'Great Cocktails',
  'Cozy Atmosphere', 'Outdoor Seating', 'Live Music', 'Kid Friendly',
  'Late Night', 'Good Value', 'Special Occasion', 'Quick Bite',
];

const EMOJI_OPTIONS = ['📋', '🍕', '🍣', '🥂', '🕯️', '💎', '⚡', '🌮', '🍜', '☕', '🎉', '🌿', '🔥', '👨‍🍳', '🏖️', '🌃'];

const PRICE_RANGES: { signs: string; label: string; min: number; max: number | null }[] = [
  { signs: '$', label: '$1–20', min: 1, max: 20 },
  { signs: '$$', label: '$20–50', min: 20, max: 50 },
  { signs: '$$$', label: '$50–100', min: 50, max: 100 },
  { signs: '$$$$', label: '$100+', min: 100, max: null },
];

function priceIndexFromAmount(amount: number): number {
  if (amount <= 20) return 0;
  if (amount <= 50) return 1;
  if (amount <= 100) return 2;
  return 3;
}

type Mode = 'choose' | 'rate' | 'lists' | 'wishlist-done';

export const AddRestaurantModal: React.FC = () => {
  const {
    addRestaurantModalOpen, addRestaurantModalMeta, closeAddRestaurantModal,
    rateRestaurant, getRating,
    lists, addToList, removeFromList, createList,
    addToWishlist, isWishlisted, removeFromWishlist,
  } = useLists();

  const restaurant = addRestaurantModalMeta;
  const existing = restaurant ? getRating(restaurant.id) : undefined;
  const wishlisted = restaurant ? isWishlisted(restaurant.id) : false;

  // Rate form state
  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [priceIndex, setPriceIndex] = useState(-1); // -1 = use restaurant default
  const [priceAmount, setPriceAmount] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);

  // List form state
  const [creatingList, setCreatingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const [mode, setMode] = useState<Mode>('choose');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset when modal opens
  useEffect(() => {
    if (addRestaurantModalOpen && restaurant) {
      const ex = getRating(restaurant.id);
      setScore(ex?.score ?? 7);
      setNotes(ex?.notes ?? '');
      setVisitDate(ex?.visitDate ?? new Date().toISOString().slice(0, 10));
      setWouldReturn(ex?.wouldReturn ?? true);
      setSelectedTags(ex?.tags ?? []);
      setPhotos(ex?.photos ?? []);
      setPriceIndex(-1);
      setPriceAmount('');
      setMode('choose');
      setCreatingList(false);
      setNewName('');
    }
  }, [addRestaurantModalOpen, restaurant]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const handlePriceSignClick = (idx: number) => {
    setPriceIndex(idx);
    setPriceAmount('');
  };

  const handlePriceAmountChange = (val: string) => {
    setPriceAmount(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) {
      setPriceIndex(priceIndexFromAmount(num));
    }
  };

  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (restaurant?.price || '$$');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          setPhotos((prev) => [...prev, reader.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSaveRating = () => {
    if (!restaurant) return;
    rateRestaurant({
      restaurantId: restaurant.id,
      name: restaurant.name,
      image: restaurant.image,
      cuisine: restaurant.cuisine,
      price: resolvedPrice,
      address: restaurant.address,
      score,
      notes,
      visitDate,
      wouldReturn,
      tags: selectedTags,
      photos,
      createdAt: Date.now(),
    });
    closeAddRestaurantModal();
  };

  const handleAddWishlist = () => {
    if (!restaurant) return;
    if (wishlisted) {
      removeFromWishlist(restaurant.id);
    } else {
      addToWishlist({
        restaurantId: restaurant.id,
        name: restaurant.name,
        image: restaurant.image,
        cuisine: restaurant.cuisine,
        price: restaurant.price,
        address: restaurant.address,
        addedAt: Date.now(),
      });
    }
    setMode('wishlist-done');
    setTimeout(() => closeAddRestaurantModal(), 800);
  };

  const handleListToggle = (listId: string, isIn: boolean) => {
    if (!restaurant) return;
    if (isIn) removeFromList(listId, restaurant.id);
    else addToList(listId, restaurant.id);
  };

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName('');
    setNewEmoji('📋');
    setCreatingList(false);
  };

  const scoreColor = score >= 8 ? 'text-green-600' : score >= 5 ? 'text-yellow-600' : 'text-red-500';

  const handleClose = () => {
    setCreatingList(false);
    setNewName('');
    closeAddRestaurantModal();
  };

  return (
    <AnimatePresence>
      {addRestaurantModalOpen && restaurant && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="sticky top-0 bg-surface/95 backdrop-blur-sm px-5 pt-5 pb-3 border-b border-on-surface/8 z-10">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  {mode !== 'choose' && mode !== 'wishlist-done' && (
                    <button onClick={() => setMode('choose')} className="p-1 text-on-surface/40 hover:text-on-surface transition-colors">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                    </button>
                  )}
                  <h2 className="font-serif font-bold text-lg truncate">
                    {mode === 'choose' ? 'Add Restaurant' : mode === 'rate' ? (existing ? 'Edit Rating' : 'Rate & Save') : mode === 'lists' ? 'Add to List' : 'Done'}
                  </h2>
                </div>
                <button onClick={handleClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-on-surface/50 mt-0.5 truncate">{restaurant.name}</p>
            </div>

            <div className="px-5 py-5">
              {/* ── Choose Mode ── */}
              {mode === 'choose' && (
                <div className="space-y-2.5">
                  <button
                    onClick={() => setMode('rate')}
                    className="w-full flex items-center gap-3.5 p-4 bg-white rounded-2xl border border-on-surface/8 shadow-sm hover:shadow-md transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <Star size={18} className="text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{existing ? 'Edit Rating' : 'Rate Restaurant'}</p>
                      <p className="text-[11px] text-on-surface/40 mt-0.5">Add your score, notes, photos & more</p>
                    </div>
                    {existing && (
                      <span className={cn("text-lg font-serif font-bold", existing.score >= 8 ? 'text-green-600' : existing.score >= 5 ? 'text-yellow-600' : 'text-red-500')}>
                        {existing.score.toFixed(1)}
                      </span>
                    )}
                  </button>

                  <button
                    onClick={() => setMode('lists')}
                    className="w-full flex items-center gap-3.5 p-4 bg-white rounded-2xl border border-on-surface/8 shadow-sm hover:shadow-md transition-all text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-secondary/10 flex items-center justify-center flex-shrink-0">
                      <Plus size={18} className="text-secondary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">Add to List</p>
                      <p className="text-[11px] text-on-surface/40 mt-0.5">Organize into your custom lists</p>
                    </div>
                  </button>

                  <button
                    onClick={handleAddWishlist}
                    className={cn(
                      "w-full flex items-center gap-3.5 p-4 bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all text-left",
                      wishlisted ? "border-accent/30" : "border-on-surface/8"
                    )}
                  >
                    <div className={cn("w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0", wishlisted ? "bg-accent/15" : "bg-accent/10")}>
                      <Bookmark size={18} className={cn(wishlisted ? "text-accent fill-accent" : "text-accent")} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold">{wishlisted ? 'On Wishlist' : 'Add to Wishlist'}</p>
                      <p className="text-[11px] text-on-surface/40 mt-0.5">{wishlisted ? 'Tap to remove from wishlist' : 'Save to try later (no rating needed)'}</p>
                    </div>
                    {wishlisted && <Check size={18} className="text-accent flex-shrink-0" />}
                  </button>
                </div>
              )}

              {/* ── Wishlist Done ── */}
              {mode === 'wishlist-done' && (
                <div className="text-center py-8">
                  <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 12 }}>
                    <Bookmark size={40} className="mx-auto text-accent fill-accent mb-3" />
                  </motion.div>
                  <p className="text-sm font-medium text-on-surface/60">{wishlisted ? 'Removed from wishlist' : 'Added to wishlist!'}</p>
                </div>
              )}

              {/* ── Rate Mode ── */}
              {mode === 'rate' && (
                <div className="space-y-5">
                  {/* Score Slider */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-3 block">Your Rating</label>
                    <div className="flex items-center gap-4">
                      <div className={cn("text-4xl font-serif font-bold tabular-nums min-w-[3rem] text-center", scoreColor)}>
                        {score.toFixed(1)}
                      </div>
                      <div className="flex-1">
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="0.1"
                          value={score}
                          onChange={(e) => setScore(parseFloat(e.target.value))}
                          className="w-full h-2 bg-on-surface/10 rounded-full appearance-none cursor-pointer accent-primary"
                        />
                        <div className="flex justify-between mt-1 text-[10px] text-on-surface/30 font-medium">
                          <span>1</span>
                          <span>5</span>
                          <span>10</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Price */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2.5 block">Price Range</label>
                    <div className="flex gap-2 mb-2">
                      {PRICE_RANGES.map((p, idx) => (
                        <button
                          key={idx}
                          onClick={() => handlePriceSignClick(idx)}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all text-center",
                            priceIndex === idx
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-white border-on-surface/10 text-on-surface/40 hover:border-on-surface/20"
                          )}
                        >
                          <div>{p.signs}</div>
                          <div className="text-[9px] font-medium mt-0.5 opacity-60">{p.label}</div>
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-on-surface/40">or enter per person:</span>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface/30">$</span>
                        <input
                          type="number"
                          value={priceAmount}
                          onChange={(e) => handlePriceAmountChange(e.target.value)}
                          placeholder="0"
                          className="w-full bg-white border border-on-surface/10 rounded-xl pl-7 pr-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Visit Date */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Date Visited</label>
                    <input
                      type="date"
                      value={visitDate}
                      onChange={(e) => setVisitDate(e.target.value)}
                      className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                  </div>

                  {/* Would Return */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2.5 block">Would you go back?</label>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setWouldReturn(true)}
                        className={cn(
                          "flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                          wouldReturn
                            ? "bg-green-50 border-green-200 text-green-700"
                            : "bg-white border-on-surface/10 text-on-surface/40"
                        )}
                      >
                        Yes!
                      </button>
                      <button
                        onClick={() => setWouldReturn(false)}
                        className={cn(
                          "flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                          !wouldReturn
                            ? "bg-red-50 border-red-200 text-red-600"
                            : "bg-white border-on-surface/10 text-on-surface/40"
                        )}
                      >
                        Probably not
                      </button>
                    </div>
                  </div>

                  {/* Tags */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2.5 block">Tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {TAGS.map((tag) => (
                        <button
                          key={tag}
                          onClick={() => toggleTag(tag)}
                          className={cn(
                            "px-2.5 py-1.5 rounded-full text-[11px] font-semibold border transition-all",
                            selectedTags.includes(tag)
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "bg-white border-on-surface/10 text-on-surface/40 hover:border-on-surface/20"
                          )}
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2 block">Notes</label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="What did you enjoy? Any favorite dishes?"
                      rows={2}
                      className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                    />
                  </div>

                  {/* Photos */}
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-2.5 block">Photos</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePhotoUpload}
                      className="hidden"
                    />
                    <div className="flex gap-2 flex-wrap">
                      {photos.map((photo, idx) => (
                        <div key={idx} className="relative w-16 h-16 rounded-xl overflow-hidden group/photo">
                          <img src={photo} alt="" className="w-full h-full object-cover" />
                          <button
                            onClick={() => removePhoto(idx)}
                            className="absolute inset-0 bg-black/40 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center"
                          >
                            <Trash2 size={14} className="text-white" />
                          </button>
                        </div>
                      ))}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-16 h-16 rounded-xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-0.5 text-on-surface/30 hover:border-primary hover:text-primary transition-all"
                      >
                        <Camera size={16} />
                        <span className="text-[9px] font-semibold">Add</span>
                      </button>
                    </div>
                  </div>

                  {/* Save */}
                  <button
                    onClick={handleSaveRating}
                    className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform"
                  >
                    {existing ? 'Update Rating' : 'Save Rating'}
                  </button>
                </div>
              )}

              {/* ── Lists Mode ── */}
              {mode === 'lists' && (
                <div className="space-y-2">
                  {lists.map((list) => {
                    const isIn = list.restaurantIds.includes(restaurant.id);
                    return (
                      <button
                        key={list.id}
                        onClick={() => handleListToggle(list.id, isIn)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left",
                          isIn
                            ? "bg-primary/5 border-primary/20"
                            : "bg-white border-on-surface/8 hover:border-on-surface/15"
                        )}
                      >
                        <span className="text-xl">{list.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{list.name}</p>
                          <p className="text-[11px] text-on-surface/40">{list.restaurantIds.length} restaurant{list.restaurantIds.length !== 1 ? 's' : ''}</p>
                        </div>
                        <div className={cn(
                          "w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all",
                          isIn ? "bg-primary border-primary text-white" : "border-on-surface/15"
                        )}>
                          {isIn && <Check size={14} strokeWidth={3} />}
                        </div>
                      </button>
                    );
                  })}

                  {/* Create new list */}
                  {creatingList ? (
                    <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
                      <div className="flex flex-wrap gap-1.5">
                        {EMOJI_OPTIONS.map((e) => (
                          <button
                            key={e}
                            onClick={() => setNewEmoji(e)}
                            className={cn(
                              "w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all",
                              newEmoji === e ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-on-surface/5"
                            )}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="List name..."
                        autoFocus
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                        onKeyDown={(e) => e.key === 'Enter' && handleCreateList()}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setCreatingList(false); setNewName(''); }}
                          className="flex-1 py-2 rounded-xl border border-on-surface/10 text-sm font-medium text-on-surface/50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleCreateList}
                          disabled={!newName.trim()}
                          className="flex-1 py-2 rounded-xl bg-primary text-white text-sm font-semibold disabled:opacity-40"
                        >
                          Create
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setCreatingList(true)}
                      className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-on-surface/15 text-on-surface/40 hover:border-primary hover:text-primary transition-all"
                    >
                      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-on-surface/5">
                        <Plus size={16} />
                      </div>
                      <span className="text-sm font-semibold">Create New List</span>
                    </button>
                  )}

                  <button
                    onClick={handleClose}
                    className="w-full py-3 mt-2 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
