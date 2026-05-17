import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, ChevronLeft, Check, Loader2, MapPin, Building2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { searchPlacesByText, type PlaceResult } from '../lib/places';
import { addHotelDining, type DiningType } from '../lib/supabase-community';

const DINING_TYPES: { value: DiningType; label: string; emoji: string }[] = [
  { value: 'restaurant', label: 'Restaurant', emoji: '🍽️' },
  { value: 'breakfast', label: 'Breakfast', emoji: '🥐' },
  { value: 'bar', label: 'Bar', emoji: '🍸' },
  { value: 'room_service', label: 'Room Service', emoji: '🛎️' },
  { value: 'pool_bar', label: 'Pool Bar', emoji: '🏊' },
  { value: 'rooftop', label: 'Rooftop', emoji: '🌇' },
];

interface Props {
  open: boolean;
  onClose: () => void;
  hotelPlaceId: string;
  hotelName: string;
  hotelAddress: string;
  userId: string;
  onSaved: () => void;
}

type Step = 'search' | 'type';

export const AddHotelDiningModal: React.FC<Props> = ({
  open, onClose, hotelPlaceId, hotelName, hotelAddress, userId, onSaved,
}) => {
  const { phoneMode } = useSettings();
  const [step, setStep] = useState<Step>('search');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPlace, setSelectedPlace] = useState<PlaceResult | null>(null);
  const [selectedType, setSelectedType] = useState<DiningType>('restaurant');
  const [saving, setSaving] = useState(false);

  const { dragProps } = useBottomSheet(open, onClose);

  const reset = () => {
    setStep('search');
    setQuery('');
    setResults([]);
    setSelectedPlace(null);
    setSelectedType('restaurant');
    setSaving(false);
    setSearching(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) return;
    setSearching(true);
    try {
      const res = await searchPlacesByText(q, 0, 0);
      setResults(res);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSelectPlace = (place: PlaceResult) => {
    setSelectedPlace(place);
    setStep('type');
  };

  const handleSave = async () => {
    if (!selectedPlace) return;
    setSaving(true);
    const ok = await addHotelDining(userId, {
      hotelPlaceId,
      hotelName,
      hotelAddress,
      restaurantPlaceId: selectedPlace.id,
      restaurantName: selectedPlace.name,
      diningType: selectedType,
    });
    setSaving(false);
    if (ok) {
      onSaved();
      handleClose();
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn(
            "fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-[85vh] rounded-t-3xl"
                : "sm:max-w-md sm:max-h-[80vh] rounded-t-3xl sm:rounded-3xl"
            )}
          >
            <AnimatePresence mode="wait">
              {/* ═══════════ STEP 1: SEARCH ═══════════ */}
              {step === 'search' && (
                <motion.div key="search" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col flex-1 min-h-0">
                  <div className="px-5 pt-5 pb-3 flex items-center justify-between flex-shrink-0">
                    <div>
                      <h2 className="font-serif font-bold text-lg">Add Dining Option</h2>
                      <p className="text-xs text-on-surface/40">Search for a restaurant or dining venue</p>
                    </div>
                    <button onClick={handleClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors">
                      <X size={20} />
                    </button>
                  </div>

                  <form className="px-5 pb-3 flex-shrink-0" onSubmit={(e) => { e.preventDefault(); handleSearch(query); }}>
                    <div className="relative">
                      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search restaurants, bars, cafes..."
                        autoFocus
                        className="w-full bg-white border border-on-surface/10 rounded-xl pl-10 pr-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      {searching && <Loader2 size={16} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-primary animate-spin" />}
                    </div>
                  </form>

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">
                    {results.length === 0 && !searching && query.trim() && (
                      <p className="text-center py-8 text-sm text-on-surface/30">No results found</p>
                    )}
                    {results.length === 0 && !searching && !query.trim() && (
                      <p className="text-center py-8 text-sm text-on-surface/30">Type a name to search</p>
                    )}
                    <div className="space-y-1.5">
                      {results.map((place) => (
                        <button
                          key={place.id}
                          onClick={() => handleSelectPlace(place)}
                          className="w-full flex items-center gap-3 p-3 rounded-xl border border-on-surface/8 bg-white hover:border-primary/30 active:bg-primary/5 transition-all text-left"
                        >
                          <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                            {place.photoUrl ? (
                              <img src={place.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-on-surface/5">
                                <MapPin size={16} className="text-on-surface/20" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold truncate">{place.name}</p>
                            <p className="text-[11px] text-on-surface/40 truncate">{place.address}</p>
                            {place.rating > 0 && (
                              <p className="text-[10px] text-on-surface/30 mt-0.5">
                                ★ {place.rating.toFixed(1)} ({place.userRatingCount})
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {/* ═══════════ STEP 2: DINING TYPE ═══════════ */}
              {step === 'type' && selectedPlace && (
                <motion.div key="type" initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
                  transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
                  className="flex flex-col flex-1 min-h-0">
                  <div className="px-5 pt-4 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
                    <button onClick={() => setStep('search')} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
                      <ChevronLeft size={22} />
                    </button>
                    <h2 className="font-serif font-bold text-lg flex-1">Select Type</h2>
                  </div>

                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    {/* Selected restaurant preview */}
                    <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/15 mb-6">
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                        {selectedPlace.photoUrl ? (
                          <img src={selectedPlace.photoUrl} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center bg-primary/10">
                            <MapPin size={14} className="text-primary/40" />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-primary truncate">{selectedPlace.name}</p>
                        <p className="text-[11px] text-primary/50 truncate">{selectedPlace.address}</p>
                      </div>
                      <Check size={16} className="text-primary flex-shrink-0" />
                    </div>

                    <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-3">Dining Type</p>
                    <div className="space-y-2">
                      {DINING_TYPES.map((dt) => (
                        <button
                          key={dt.value}
                          onClick={() => setSelectedType(dt.value)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3.5 rounded-xl border-2 transition-all text-left",
                            selectedType === dt.value
                              ? "border-primary bg-primary/5"
                              : "border-on-surface/10 hover:border-on-surface/20"
                          )}
                        >
                          <span className="text-lg">{dt.emoji}</span>
                          <span className={cn("text-sm font-medium flex-1", selectedType === dt.value ? "text-primary" : "text-on-surface/70")}>
                            {dt.label}
                          </span>
                          {selectedType === dt.value && <Check size={16} className="text-primary" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {saving && <Loader2 size={16} className="animate-spin" />}
                      {saving ? 'Saving...' : 'Add Dining Option'}
                    </button>
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
