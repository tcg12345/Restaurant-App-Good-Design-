import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronRight, ChevronLeft, Camera, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';

const TAGS = [
  'Great Service', 'Romantic', 'Good for Groups', 'Great Cocktails',
  'Cozy Atmosphere', 'Outdoor Seating', 'Live Music', 'Kid Friendly',
  'Late Night', 'Good Value', 'Special Occasion', 'Quick Bite',
];

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

export const RatingModal: React.FC = () => {
  const { ratingModalOpen, ratingModalRestaurant, closeRatingModal, rateRestaurant, getRating } = useLists();

  const existing = ratingModalRestaurant ? getRating(ratingModalRestaurant.id) : undefined;

  const [step, setStep] = useState(1);
  const [score, setScore] = useState(existing?.score ?? 7);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [visitDate, setVisitDate] = useState(existing?.visitDate ?? new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(existing?.wouldReturn ?? true);
  const [selectedTags, setSelectedTags] = useState<string[]>(existing?.tags ?? []);
  const [priceIndex, setPriceIndex] = useState(-1);
  const [priceAmount, setPriceAmount] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ratingModalOpen && ratingModalRestaurant) {
      const ex = getRating(ratingModalRestaurant.id);
      setStep(1);
      setScore(ex?.score ?? 7);
      setNotes(ex?.notes ?? '');
      setVisitDate(ex?.visitDate ?? new Date().toISOString().slice(0, 10));
      setWouldReturn(ex?.wouldReturn ?? true);
      setSelectedTags(ex?.tags ?? []);
      setPhotos(ex?.photos ?? []);
      setPriceIndex(-1);
      setPriceAmount('');
    }
  }, [ratingModalOpen, ratingModalRestaurant]);

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
    if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
  };

  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (ratingModalRestaurant?.price || '$$');

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

  const handleSave = () => {
    if (!ratingModalRestaurant) return;
    rateRestaurant({
      restaurantId: ratingModalRestaurant.id,
      name: ratingModalRestaurant.name,
      image: ratingModalRestaurant.image,
      cuisine: ratingModalRestaurant.cuisine,
      price: resolvedPrice,
      address: ratingModalRestaurant.address,
      score,
      notes,
      visitDate,
      wouldReturn,
      tags: selectedTags,
      photos,
      createdAt: Date.now(),
    });
    closeRatingModal();
  };

  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

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
                {step > 1 && (
                  <button onClick={() => setStep(step - 1)} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
                    <ChevronLeft size={20} />
                  </button>
                )}
                <div className="min-w-0">
                  <h2 className="font-serif font-bold text-base sm:text-lg truncate">
                    {step === 1 ? (existing ? 'Update Rating' : 'Rate Restaurant') : 'Details'}
                  </h2>
                  <p className="text-xs text-on-surface/40 truncate">{ratingModalRestaurant.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Step dots */}
                <div className="flex gap-1.5 mr-1">
                  {[1, 2].map((s) => (
                    <div key={s} className={cn("w-1.5 h-1.5 rounded-full transition-all", s === step ? "bg-primary w-4" : "bg-on-surface/15")} />
                  ))}
                </div>
                <button onClick={closeRatingModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <AnimatePresence mode="wait">
                {step === 1 ? (
                  <motion.div
                    key="step1"
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
                        type="range"
                        min="1"
                        max="10"
                        step="0.1"
                        value={score}
                        onChange={(e) => setScore(parseFloat(e.target.value))}
                        className="w-full h-2.5 bg-on-surface/8 rounded-full appearance-none cursor-pointer accent-primary"
                      />
                      <div className="flex justify-between mt-1.5 text-[10px] text-on-surface/25 font-semibold px-0.5">
                        <span>1</span>
                        <span>3</span>
                        <span>5</span>
                        <span>7</span>
                        <span>10</span>
                      </div>
                    </div>

                    {/* Score label */}
                    <p className="text-sm font-medium text-on-surface/40 mb-6">
                      {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                    </p>

                    {/* Would Return — compact inline */}
                    <div className="w-full max-w-xs mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 text-center mb-2">Would you go back?</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setWouldReturn(true)}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                            wouldReturn ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-on-surface/10 text-on-surface/40"
                          )}
                        >
                          Yes!
                        </button>
                        <button
                          onClick={() => setWouldReturn(false)}
                          className={cn(
                            "flex-1 py-2.5 rounded-xl text-sm font-semibold border transition-all",
                            !wouldReturn ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-on-surface/10 text-on-surface/40"
                          )}
                        >
                          Nah
                        </button>
                      </div>
                    </div>

                    {/* Next button */}
                    <button
                      onClick={() => setStep(2)}
                      className="w-full max-w-xs py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform mt-2"
                    >
                      Add Details
                      <ChevronRight size={16} />
                    </button>
                    <button
                      onClick={handleSave}
                      className="text-xs text-on-surface/35 font-medium mt-3 hover:text-primary transition-colors"
                    >
                      Skip &amp; save just the rating
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="step2"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.15 }}
                    className="px-5 pb-5 space-y-4"
                  >
                    {/* Price */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Price Range</label>
                      <div className="flex gap-1.5 mb-1.5">
                        {PRICE_RANGES.map((p, idx) => (
                          <button
                            key={idx}
                            onClick={() => handlePriceSignClick(idx)}
                            className={cn(
                              "flex-1 py-2 rounded-lg text-xs font-bold border transition-all text-center",
                              priceIndex === idx
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-white border-on-surface/10 text-on-surface/40"
                            )}
                          >
                            <div className="text-sm">{p.signs}</div>
                            <div className="text-[8px] font-medium opacity-50 mt-0.5">{p.label}</div>
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-on-surface/35">or per person:</span>
                        <div className="relative flex-1">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[11px] text-on-surface/25">$</span>
                          <input
                            type="number"
                            value={priceAmount}
                            onChange={(e) => handlePriceAmountChange(e.target.value)}
                            placeholder="0"
                            className="w-full bg-white border border-on-surface/10 rounded-lg pl-6 pr-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Visit Date */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Date Visited</label>
                      <input
                        type="date"
                        value={visitDate}
                        onChange={(e) => setVisitDate(e.target.value)}
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2 block">Tags</label>
                      <div className="flex flex-wrap gap-1.5">
                        {TAGS.map((tag) => (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            className={cn(
                              "px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all",
                              selectedTags.includes(tag)
                                ? "bg-primary/10 border-primary/30 text-primary"
                                : "bg-white border-on-surface/10 text-on-surface/40"
                            )}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Notes</label>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        placeholder="Any favorite dishes or thoughts?"
                        rows={2}
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                      />
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
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-14 h-14 rounded-xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-0.5 text-on-surface/30 hover:border-primary hover:text-primary transition-all"
                        >
                          <Camera size={14} />
                          <span className="text-[8px] font-semibold">Add</span>
                        </button>
                      </div>
                    </div>

                    {/* Save */}
                    <button
                      onClick={handleSave}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform"
                    >
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
