import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Star, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists } from '../contexts/ListsContext';

const TAGS = [
  'Great Service', 'Romantic', 'Good for Groups', 'Great Cocktails',
  'Cozy Atmosphere', 'Outdoor Seating', 'Live Music', 'Kid Friendly',
  'Late Night', 'Good Value', 'Special Occasion', 'Quick Bite',
];

export const RatingModal: React.FC = () => {
  const { ratingModalOpen, ratingModalRestaurant, closeRatingModal, rateRestaurant, getRating } = useLists();

  const existing = ratingModalRestaurant ? getRating(ratingModalRestaurant.id) : undefined;

  const [score, setScore] = useState(existing?.score ?? 7);
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [visitDate, setVisitDate] = useState(existing?.visitDate ?? new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(existing?.wouldReturn ?? true);
  const [selectedTags, setSelectedTags] = useState<string[]>(existing?.tags ?? []);

  // Reset when modal opens with new restaurant
  useEffect(() => {
    if (ratingModalOpen && ratingModalRestaurant) {
      const ex = getRating(ratingModalRestaurant.id);
      setScore(ex?.score ?? 7);
      setNotes(ex?.notes ?? '');
      setVisitDate(ex?.visitDate ?? new Date().toISOString().slice(0, 10));
      setWouldReturn(ex?.wouldReturn ?? true);
      setSelectedTags(ex?.tags ?? []);
    }
  }, [ratingModalOpen, ratingModalRestaurant]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  };

  const handleSave = () => {
    if (!ratingModalRestaurant) return;
    rateRestaurant({
      restaurantId: ratingModalRestaurant.id,
      name: ratingModalRestaurant.name,
      image: ratingModalRestaurant.image,
      cuisine: ratingModalRestaurant.cuisine,
      price: ratingModalRestaurant.price,
      address: ratingModalRestaurant.address,
      score,
      notes,
      visitDate,
      wouldReturn,
      tags: selectedTags,
      photos: existing?.photos ?? [],
      createdAt: Date.now(),
    });
    closeRatingModal();
  };

  const scoreColor = score >= 8 ? 'text-green-600' : score >= 5 ? 'text-yellow-600' : 'text-red-500';

  return (
    <AnimatePresence>
      {ratingModalOpen && ratingModalRestaurant && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100] flex items-end sm:items-center justify-center"
          onClick={closeRatingModal}
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
                <h2 className="font-serif font-bold text-lg">Rate Restaurant</h2>
                <button onClick={closeRatingModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-on-surface/50 mt-0.5">{ratingModalRestaurant.name}</p>
            </div>

            <div className="px-5 py-5 space-y-6">
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
                      min="0"
                      max="10"
                      step="0.5"
                      value={score}
                      onChange={(e) => setScore(parseFloat(e.target.value))}
                      className="w-full h-2 bg-on-surface/10 rounded-full appearance-none cursor-pointer accent-primary"
                    />
                    <div className="flex justify-between mt-1 text-[10px] text-on-surface/30 font-medium">
                      <span>0</span>
                      <span>5</span>
                      <span>10</span>
                    </div>
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
                  className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Would Return */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-3 block">Would you go back?</label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setWouldReturn(true)}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-sm font-semibold border transition-all",
                      wouldReturn
                        ? "bg-green-50 border-green-200 text-green-700"
                        : "bg-white border-on-surface/10 text-on-surface/40"
                    )}
                  >
                    Yes, definitely!
                  </button>
                  <button
                    onClick={() => setWouldReturn(false)}
                    className={cn(
                      "flex-1 py-3 rounded-xl text-sm font-semibold border transition-all",
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
                <label className="text-xs font-bold uppercase tracking-wider text-on-surface/50 mb-3 block">Tags</label>
                <div className="flex flex-wrap gap-2">
                  {TAGS.map((tag) => (
                    <button
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-semibold border transition-all",
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
                  rows={3}
                  className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                />
              </div>

              {/* Save Button */}
              <button
                onClick={handleSave}
                className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform"
              >
                {existing ? 'Update Rating' : 'Save Rating'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
