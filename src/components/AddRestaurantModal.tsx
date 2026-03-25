import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, Trash2, ChevronRight, ChevronLeft } from 'lucide-react';
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

type Step = 'score' | 'details';

export const AddRestaurantModal: React.FC = () => {
  const {
    addRestaurantModalOpen, addRestaurantModalMeta, closeAddRestaurantModal,
    rateRestaurant, getRating,
    lists, createList,
  } = useLists();

  const restaurant = addRestaurantModalMeta;
  const existing = restaurant ? getRating(restaurant.id) : undefined;

  // Rate form state
  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [priceIndex, setPriceIndex] = useState(-1);
  const [priceAmount, setPriceAmount] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);

  // List creation
  const [creatingList, setCreatingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const [step, setStep] = useState<Step>('score');
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
      setSelectedListIds(ex?.listIds ?? []);
      setPriceIndex(-1);
      setPriceAmount('');
      setStep('score');
      setCreatingList(false);
      setNewName('');
    }
  }, [addRestaurantModalOpen, restaurant]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const toggleList = (listId: string) => {
    setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);
  };

  const handlePriceSignClick = (idx: number) => {
    setPriceIndex(idx);
    setPriceAmount('');
  };

  const handlePriceAmountChange = (val: string) => {
    setPriceAmount(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
  };

  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (restaurant?.price || '$$');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach((file) => {
      if (!file.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') setPhotos((prev) => [...prev, reader.result as string]);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));

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
      listIds: selectedListIds,
      createdAt: Date.now(),
    });
    closeAddRestaurantModal();
  };

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName('');
    setNewEmoji('📋');
    setCreatingList(false);
  };

  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

  return (
    <AnimatePresence>
      {addRestaurantModalOpen && restaurant && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          onClick={closeAddRestaurantModal}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl overflow-hidden flex flex-col"
            style={{ maxHeight: '92vh' }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1 sm:hidden">
              <div className="w-10 h-1 rounded-full bg-on-surface/15" />
            </div>

            {/* Header */}
            <div className="px-5 pt-2 sm:pt-5 pb-3 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                {step === 'details' && (
                  <button onClick={() => setStep('score')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
                    <ChevronLeft size={20} />
                  </button>
                )}
                <div className="min-w-0">
                  <h2 className="font-serif font-bold text-base sm:text-lg truncate">
                    {step === 'score' ? (existing ? 'Update Rating' : 'Rate Restaurant') : 'Details & Lists'}
                  </h2>
                  <p className="text-xs text-on-surface/40 truncate">{restaurant.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex gap-1.5 mr-1">
                  {[1, 2].map((s) => (
                    <div key={s} className={cn("w-1.5 h-1.5 rounded-full transition-all", (step === 'score' ? 1 : 2) === s ? "bg-primary w-4" : "bg-on-surface/15")} />
                  ))}
                </div>
                <button onClick={closeAddRestaurantModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <AnimatePresence mode="wait">
                {step === 'score' ? (
                  <motion.div
                    key="score"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.15 }}
                    className="px-5 pb-5 flex flex-col items-center"
                  >
                    {/* Big score circle */}
                    <div className={cn("relative w-36 h-36 sm:w-40 sm:h-40 rounded-full flex items-center justify-center mt-4 mb-5 bg-gradient-to-b ring-4", scoreBg, scoreRing)}>
                      <div className="text-center">
                        <div className={cn("text-5xl sm:text-6xl font-serif font-bold tabular-nums transition-colors duration-300", scoreColor)}>
                          {score.toFixed(1)}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mt-0.5">out of 10</div>
                      </div>
                    </div>

                    {/* Slider */}
                    <div className="w-full max-w-xs mb-3">
                      <input
                        type="range" min="1" max="10" step="0.1"
                        value={score}
                        onChange={(e) => setScore(parseFloat(e.target.value))}
                        className="w-full h-2.5 bg-on-surface/8 rounded-full appearance-none cursor-pointer accent-primary"
                      />
                      <div className="flex justify-between mt-1.5 text-[10px] text-on-surface/25 font-semibold px-0.5">
                        <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                      </div>
                    </div>

                    <p className="text-sm font-medium text-on-surface/40 mb-6">
                      {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                    </p>

                    {/* Would Return */}
                    <div className="w-full max-w-xs mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 text-center mb-2">Would you go back?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setWouldReturn(true)}
                          className={cn("flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                            wouldReturn ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-on-surface/10 text-on-surface/40"
                          )}
                        >Yes!</button>
                        <button
                          onClick={() => setWouldReturn(false)}
                          className={cn("flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                            !wouldReturn ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-on-surface/10 text-on-surface/40"
                          )}
                        >Nah</button>
                      </div>
                    </div>

                    <button
                      onClick={() => setStep('details')}
                      className="w-full max-w-xs py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mt-2"
                    >
                      Add Details <ChevronRight size={16} />
                    </button>
                    <button onClick={handleSaveRating} className="text-xs text-on-surface/35 font-medium mt-3 hover:text-primary transition-colors">
                      Skip &amp; save just the rating
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="details"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.15 }}
                    className="px-5 pb-5 space-y-4"
                  >
                    {/* Add to Lists */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Add to Lists</label>
                      <div className="space-y-1.5">
                        {lists.map((list) => {
                          const selected = selectedListIds.includes(list.id);
                          return (
                            <button
                              key={list.id}
                              onClick={() => toggleList(list.id)}
                              className={cn(
                                "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-left",
                                selected ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8"
                              )}
                            >
                              <span className="text-base">{list.emoji}</span>
                              <span className="flex-1 text-xs font-semibold truncate">{list.name}</span>
                              <div className={cn(
                                "w-5 h-5 rounded-full flex items-center justify-center border-2 transition-all",
                                selected ? "bg-primary border-primary text-white" : "border-on-surface/15"
                              )}>
                                {selected && <Check size={11} strokeWidth={3} />}
                              </div>
                            </button>
                          );
                        })}

                        {creatingList ? (
                          <div className="p-3 rounded-xl border border-primary/20 bg-primary/5 space-y-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {EMOJI_OPTIONS.map((e) => (
                                <button key={e} onClick={() => setNewEmoji(e)}
                                  className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-all", newEmoji === e ? "bg-primary/10 ring-2 ring-primary/30" : "hover:bg-on-surface/5")}
                                >{e}</button>
                              ))}
                            </div>
                            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name..." autoFocus
                              className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                              onKeyDown={(e) => e.key === 'Enter' && handleCreateList()} />
                            <div className="flex gap-2">
                              <button onClick={() => { setCreatingList(false); setNewName(''); }} className="flex-1 py-1.5 rounded-xl border border-on-surface/10 text-xs font-medium text-on-surface/50">Cancel</button>
                              <button onClick={handleCreateList} disabled={!newName.trim()} className="flex-1 py-1.5 rounded-xl bg-primary text-white text-xs font-semibold disabled:opacity-40">Create</button>
                            </div>
                          </div>
                        ) : (
                          <button onClick={() => setCreatingList(true)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-dashed border-on-surface/15 text-on-surface/35 hover:border-primary hover:text-primary transition-all"
                          >
                            <Plus size={14} />
                            <span className="text-xs font-semibold">New List</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Price */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Price Range</label>
                      <div className="flex gap-1.5 mb-1.5">
                        {PRICE_RANGES.map((p, idx) => (
                          <button key={idx} onClick={() => handlePriceSignClick(idx)}
                            className={cn("flex-1 py-2 rounded-lg text-xs font-bold border transition-all text-center",
                              priceIndex === idx ? "bg-primary/10 border-primary/30 text-primary" : "bg-white border-on-surface/10 text-on-surface/40"
                            )}>
                            <div className="text-sm">{p.signs}</div>
                            <div className="text-[8px] font-medium opacity-50 mt-0.5">{p.label}</div>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-on-surface/35">or per person:</span>
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-on-surface/25">$</span>
                          <input type="number" value={priceAmount} onChange={(e) => handlePriceAmountChange(e.target.value)} placeholder="0"
                            className="w-full bg-white border border-on-surface/10 rounded-lg pl-6 pr-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                      </div>
                    </div>

                    {/* Visit Date */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Date Visited</label>
                      <input type="date" value={visitDate} onChange={(e) => setVisitDate(e.target.value)}
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Tags</label>
                      <div className="flex flex-wrap gap-1.5">
                        {TAGS.map((tag) => (
                          <button key={tag} onClick={() => toggleTag(tag)}
                            className={cn("px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all",
                              selectedTags.includes(tag) ? "bg-primary/10 border-primary/30 text-primary" : "bg-white border-on-surface/10 text-on-surface/40"
                            )}>{tag}</button>
                        ))}
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Notes</label>
                      <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any favorite dishes or thoughts?" rows={2}
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
                    </div>

                    {/* Photos */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Photos</label>
                      <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                      <div className="flex gap-2 flex-wrap">
                        {photos.map((photo, idx) => (
                          <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden group/photo">
                            <img src={photo} alt="" className="w-full h-full object-cover" />
                            <button onClick={() => removePhoto(idx)} className="absolute inset-0 bg-black/40 opacity-0 group-hover/photo:opacity-100 transition-opacity flex items-center justify-center">
                              <Trash2 size={12} className="text-white" />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => fileInputRef.current?.click()}
                          className="w-14 h-14 rounded-xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-0.5 text-on-surface/30 hover:border-primary hover:text-primary transition-all">
                          <Camera size={14} /><span className="text-[8px] font-semibold">Add</span>
                        </button>
                      </div>
                    </div>

                    {/* Save */}
                    <button onClick={handleSaveRating}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                      {existing ? 'Update Rating' : 'Save Rating'}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
