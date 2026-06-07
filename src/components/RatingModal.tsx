import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, ChevronLeft, ChevronRight, ChevronDown, DollarSign, CalendarDays, Tag, StickyNote, Image, Users, Search, Star, Sparkles, RotateCcw, ChefHat, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { useLists, type PhotoItem } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, EMOJI_OPTIONS, Calendar } from './RatingShared';
import { type H2HState, initH2HTieBreak } from '../lib/headToHeadRating';
import { MethodToggle, MethodChooser, InlineH2H, RankingContext } from './HeadToHeadRatingPages';

type Page = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends' | 'favorite-dishes';

export const RatingModal: React.FC = () => {
  const { ratingModalOpen, ratingModalRestaurant, closeRatingModal, rateRestaurant, getRating, lists, createList, ratings, getRestaurantInfo } = useLists();
  const { phoneMode } = useSettings();

  const existing = ratingModalRestaurant ? getRating(ratingModalRestaurant.id) : undefined;

  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldReturn, setWouldReturn] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [priceIndex, setPriceIndex] = useState(-1);
  const [priceAmount, setPriceAmount] = useState('');
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [favoriteDishes, setFavoriteDishes] = useState<string[]>([]);
  const [dishDraft, setDishDraft] = useState('');
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');

  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const [page, setPage] = useState<Page>('main');
  // Inline rating method choice. `null` means the user hasn't picked one yet
  // and the prominent chooser is shown.
  const [ratingMethod, setRatingMethod] = useState<'slider' | 'h2h' | null>(null);
  // Active head-to-head session state; null on the slider or before tier pick.
  const [h2hState, setH2hState] = useState<H2HState | null>(null);
  // H2H-computed score, set when the user accepts an H2H result. Drives the
  // "from head-to-head" pill and the revert button.
  const [h2hScore, setH2hScore] = useState<number | null>(null);
  // When true, the running H2H is a tie-break triggered by Save on the
  // slider — completing it auto-saves with the refined score.
  const [tieBreakActive, setTieBreakActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);

  const { dragProps } = useBottomSheet(ratingModalOpen, closeRatingModal);

  useEffect(() => {
    if (ratingModalOpen && ratingModalRestaurant) {
      const ex = getRating(ratingModalRestaurant.id);
      setScore(ex?.score ?? 7);
      setNotes(ex?.notes ?? '');
      setVisitDate(ex?.visitDate ?? '');
      setWouldReturn(ex?.wouldReturn ?? true);
      setSelectedTags(ex?.tags ?? []);
      setPhotos(ex?.photos ?? []);
      setFavoriteDishes(ex?.favoriteDishes ?? []);
      setDishDraft('');
      setSelectedListIds(ex?.listIds ?? []);
      setSelectedFriends([]);
      setPriceIndex(-1);
      setPriceAmount('');
      setPage('main');
      // Show the prominent chooser when there are other rated restaurants
      // to compare against; otherwise jump straight to the slider.
      const othersOnOpen = ratings.filter((r) => r.restaurantId !== ratingModalRestaurant.id);
      setRatingMethod(othersOnOpen.length > 0 ? null : 'slider');
      setH2hState(null);
      setH2hScore(null);
      setTieBreakActive(false);
      setCreatingList(false);
      setNewName('');
      setListDropdownOpen(false);
      setTagSearch('');
      setFriendSearch('');
      setSelectedPhotoIdx(null);
    }
  }, [ratingModalOpen, ratingModalRestaurant]);

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const toggleList = (listId: string) => setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);
  const toggleFriend = (name: string) => setSelectedFriends((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  const handlePriceSignClick = (idx: number) => { setPriceIndex(idx); setPriceAmount(''); };
  const handlePriceAmountChange = (val: string) => {
    setPriceAmount(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
  };

  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (ratingModalRestaurant?.price || '$$');

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const totalFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (totalFiles.length === 0) return;
    const newPhotos: PhotoItem[] = [];
    let loaded = 0;
    totalFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          newPhotos.push({ url: reader.result, caption: '', isFavorite: false });
        }
        loaded++;
        if (loaded === totalFiles.length) {
          setPhotos((prev) => {
            const updated = [...prev, ...newPhotos];
            setTimeout(() => setPage('photos'), 0);
            return updated;
          });
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setSelectedPhotoIdx((cur) => (cur === null ? null : cur === idx ? null : cur > idx ? cur - 1 : cur));
  };
  const updatePhotoCaption = (idx: number, caption: string) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, caption } : p));
  const togglePhotoFavorite = (idx: number) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, isFavorite: !p.isFavorite } : p));
  const movePhoto = (from: number, to: number) => {
    setPhotos((prev) => { const next = [...prev]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
  };

  const handlePhotosClick = () => {
    if (photos.length === 0) fileInputRef.current?.click();
    else setPage('photos');
  };

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName(''); setNewEmoji('📋'); setCreatingList(false);
  };

  const persistRating = (finalScore: number) => {
    if (!ratingModalRestaurant) return;
    rateRestaurant({
      restaurantId: ratingModalRestaurant.id, name: ratingModalRestaurant.name, image: ratingModalRestaurant.image,
      cuisine: ratingModalRestaurant.cuisine, price: resolvedPrice, address: ratingModalRestaurant.address,
      score: finalScore, notes, visitDate, wouldReturn, tags: selectedTags, photos,
      favoriteDishes: favoriteDishes.length > 0 ? favoriteDishes : undefined,
      listIds: selectedListIds, createdAt: Date.now(),
    });
    closeRatingModal();
  };

  const handleSave = () => {
    if (!ratingModalRestaurant) return;
    if (ratingMethod === 'slider' && h2hScore === null) {
      const tieBreakState = initH2HTieBreak(ratings, score, ratingModalRestaurant.id);
      if (tieBreakState) {
        setH2hState(tieBreakState);
        setRatingMethod('h2h');
        setTieBreakActive(true);
        return;
      }
    }
    persistRating(score);
  };

  const scoreClr = scoreColorLight(score);
  const scoreBg = scoreBgGradient(score);
  const scoreRing = scoreRingColor(score);

  const hasNotes = notes.trim().length > 0;
  const hasPrice = priceIndex >= 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasDishes = favoriteDishes.length > 0;
  const hasFriends = selectedFriends.length > 0;
  const hasDate = visitDate !== '';

  const addDish = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    setFavoriteDishes((prev) => prev.includes(v) ? prev : [...prev, v]);
    setDishDraft('');
  };
  const removeDish = (idx: number) => setFavoriteDishes((prev) => prev.filter((_, i) => i !== idx));
  const dateLabel = hasDate ? new Date(visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined;

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return ALL_TAGS;
    const q = tagSearch.toLowerCase();
    return ALL_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagSearch]);

  const MOCK_FRIENDS = useMemo(() => ['Alex Chen', 'Maria Garcia', 'James Wilson', 'Sarah Kim', 'David Park', 'Emma Davis', 'Chris Lee', 'Olivia Brown', 'Ryan Martinez', 'Sophie Taylor'], []);
  const filteredFriends = useMemo(() => {
    if (!friendSearch.trim()) return MOCK_FRIENDS;
    const q = friendSearch.toLowerCase();
    return MOCK_FRIENDS.filter((f) => f.toLowerCase().includes(q));
  }, [friendSearch, MOCK_FRIENDS]);

  const selectedListLabels = lists.filter((l) => selectedListIds.includes(l.id));

  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;

  return (
    <AnimatePresence>
      {ratingModalOpen && ratingModalRestaurant && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeRatingModal}>
          <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-full rounded-none"
                : "h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl"
            )}>
            {photoInput}
            <AnimatePresence mode="wait">
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col h-full">
                  <div className="px-5 pt-safe-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <div className="min-w-0">
                      <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Update Rating' : 'Rate Restaurant'}</h2>
                      <p className="text-xs text-on-surface/40 truncate">{ratingModalRestaurant.name}</p>
                    </div>
                    <button onClick={closeRatingModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                  </div>

                  <div className="px-5 pb-2 flex-shrink-0 relative z-20">
                    <button onClick={() => setListDropdownOpen(!listDropdownOpen)}
                      className={cn("inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                        selectedListLabels.length > 0
                          ? "bg-primary/10 text-primary"
                          : "bg-on-surface/5 text-on-surface/50"
                      )}>
                      {selectedListLabels.length > 0
                        ? selectedListLabels.map((l) => `${l.emoji} ${l.name}`).join(', ')
                        : 'All Restaurants'}
                      <ChevronDown size={12} className={cn("transition-transform", listDropdownOpen && "rotate-180")} />
                    </button>
                    <AnimatePresence>
                      {listDropdownOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setListDropdownOpen(false)} />
                          <motion.div initial={{ opacity: 0, y: -4, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.97 }} transition={{ duration: 0.12 }}
                            className="absolute top-full left-0 mt-1.5 bg-white rounded-2xl shadow-xl border border-on-surface/8 z-20 max-h-56 overflow-y-auto min-w-[220px]">
                            {lists.map((list) => {
                              const selected = selectedListIds.includes(list.id);
                              return (
                                <button key={list.id} onClick={() => toggleList(list.id)}
                                  className={cn("w-full flex items-center gap-2.5 px-4 py-3 transition-colors text-left",
                                    selected ? "bg-primary/5" : "hover:bg-on-surface/3"
                                  )}>
                                  <span className="text-base">{list.emoji}</span>
                                  <span className={cn("flex-1 text-sm font-medium truncate", selected ? "text-primary" : "text-on-surface/70")}>{list.name}</span>
                                  {selected && <Check size={14} className="text-primary flex-shrink-0" />}
                                </button>
                              );
                            })}
                            {creatingList ? (
                              <div className="p-3 border-t border-on-surface/6 space-y-2">
                                <div className="flex flex-wrap gap-1">
                                  {EMOJI_OPTIONS.map((e) => (
                                    <button key={e} onClick={() => setNewEmoji(e)}
                                      className={cn("w-7 h-7 rounded text-sm", newEmoji === e ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-on-surface/5")}>{e}</button>
                                  ))}
                                </div>
                                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="List name..." autoFocus
                                  className="w-full border border-on-surface/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/20"
                                  onKeyDown={(e) => e.key === 'Enter' && handleCreateList()} />
                                <div className="flex gap-2">
                                  <button onClick={() => { setCreatingList(false); setNewName(''); }} className="flex-1 py-1.5 rounded-lg border border-on-surface/10 text-[11px] font-medium text-on-surface/50">Cancel</button>
                                  <button onClick={handleCreateList} disabled={!newName.trim()} className="flex-1 py-1.5 rounded-lg bg-primary text-white text-[11px] font-semibold disabled:opacity-40">Create</button>
                                </div>
                              </div>
                            ) : (
                              <button onClick={() => setCreatingList(true)}
                                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 border-t border-on-surface/6 text-on-surface/35 hover:text-primary transition-colors">
                                <Plus size={14} /><span className="text-xs font-semibold">New List</span>
                              </button>
                            )}
                          </motion.div>
                        </>
                      )}
                    </AnimatePresence>
                  </div>

                  <div className="flex-1 overflow-y-auto overscroll-contain px-5">
                    {ratingMethod !== null && !tieBreakActive && ratings.filter((r) => r.restaurantId !== ratingModalRestaurant.id).length > 0 && (
                      <div className="pt-2 pb-3">
                        <MethodToggle
                          method={ratingMethod}
                          onChange={(m) => {
                            setRatingMethod(m);
                            if (m === 'slider') setH2hState(null);
                          }}
                        />
                      </div>
                    )}
                    {tieBreakActive && (
                      <div className="pt-3 pb-2 text-center">
                        <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/45 mb-1">Tie-break</p>
                        <p className="text-[12px] text-on-surface/55 max-w-[280px] mx-auto leading-snug">
                          You picked {score.toFixed(1)} — let's see how it compares to your other {score.toFixed(1)}s.
                        </p>
                      </div>
                    )}
                    <AnimatePresence mode="wait" initial={false}>
                      {ratingMethod === null ? (
                        <MethodChooser
                          key="chooser"
                          onPick={(m) => {
                            setRatingMethod(m);
                            if (m === 'slider') setH2hState(null);
                          }}
                        />
                      ) : ratingMethod === 'slider' ? (
                        <motion.div
                          key="slider"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.18 }}
                          className="flex flex-col items-center pt-1"
                        >
                          {h2hScore !== null && (
                            <AnimatePresence mode="wait" initial={false}>
                              {Math.abs(score - h2hScore) > 0.05 ? (
                                <motion.button
                                  key="revert"
                                  type="button"
                                  onClick={() => setScore(h2hScore)}
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.18 }}
                                  whileTap={{ scale: 0.96 }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary text-white text-[10px] font-bold uppercase tracking-widest mb-2 hover:bg-primary/90 transition-colors"
                                >
                                  <RotateCcw size={11} />
                                  Revert to {h2hScore.toFixed(1)}
                                </motion.button>
                              ) : (
                                <motion.div
                                  key="from-h2h"
                                  initial={{ opacity: 0, y: -4 }}
                                  animate={{ opacity: 1, y: 0 }}
                                  exit={{ opacity: 0, y: -4 }}
                                  transition={{ duration: 0.18 }}
                                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-2"
                                >
                                  <Sparkles size={11} />
                                  From head-to-head
                                </motion.div>
                              )}
                            </AnimatePresence>
                          )}
                          <div className={cn("relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center mb-3 bg-gradient-to-b ring-4", scoreBg, scoreRing)}>
                            <div className="text-center">
                              <div className={cn("text-[44px] sm:text-[56px] leading-none font-serif font-bold tabular-nums transition-colors duration-300", scoreClr)}>{score.toFixed(1)}</div>
                              <div className="text-[9px] font-bold uppercase tracking-widest text-on-surface/30 mt-1">out of 10</div>
                            </div>
                          </div>
                          <div className="w-full max-w-[260px] mb-1.5">
                            <input type="range" min="1" max="10" step="0.1" value={score} onChange={(e) => setScore(parseFloat(e.target.value))}
                              className="w-full h-2.5 bg-on-surface/8 rounded-full appearance-none cursor-pointer accent-primary" />
                            <div className="flex justify-between mt-1 text-[10px] text-on-surface/25 font-semibold px-0.5">
                              <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                            </div>
                          </div>
                          <p className="text-xs font-medium text-on-surface/40 mb-3">
                            {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                          </p>
                          <RankingContext score={score} ratings={ratings} excludeId={ratingModalRestaurant.id} />
                        </motion.div>
                      ) : (
                        <motion.div
                          key="h2h"
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          transition={{ duration: 0.18 }}
                        >
                          <InlineH2H
                            ratings={ratings}
                            excludeId={ratingModalRestaurant.id}
                            newRestaurant={{ ...ratingModalRestaurant, tags: selectedTags }}
                            resolveMeta={getRestaurantInfo}
                            state={h2hState}
                            setState={setH2hState}
                            skipTierSelect={tieBreakActive}
                            skipResult={tieBreakActive}
                            onCancelFromStart={tieBreakActive ? () => {
                              setTieBreakActive(false);
                              setH2hState(null);
                              setRatingMethod('slider');
                            } : undefined}
                            onComplete={(finalScore) => {
                              if (tieBreakActive) {
                                setTieBreakActive(false);
                                setH2hState(null);
                                persistRating(finalScore);
                                return;
                              }
                              setScore(finalScore);
                              setH2hScore(finalScore);
                              setH2hState(null);
                              setRatingMethod('slider');
                            }}
                          />
                        </motion.div>
                      )}
                    </AnimatePresence>
                    <div className="border-t border-on-surface/6 pt-3 mt-3 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-1">Add details</p>
                      <div>
                        <DetailRow icon={<StickyNote size={20} />} label="Notes" value={hasNotes ? notes : undefined} onClick={() => setPage('notes')} />
                        <DetailRow icon={<ChefHat size={20} />} label="Favorite dishes" value={hasDishes ? `${favoriteDishes.length} added` : undefined} onClick={() => setPage('favorite-dishes')} />
                        <DetailRow icon={<DollarSign size={20} />} label="Price" value={hasPrice ? PRICE_RANGES[priceIndex].signs : undefined} onClick={() => setPage('price')} />
                        <DetailRow icon={<CalendarDays size={20} />} label="Date" value={dateLabel} onClick={() => setPage('date')} />
                        <DetailRow icon={<Tag size={20} />} label="Tags" value={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
                        <DetailRow icon={<Image size={20} />} label="Photos" value={hasPhotos ? `${photos.length} added` : undefined} onClick={handlePhotosClick} />
                        <DetailRow icon={<Users size={20} />} label="Friends" value={hasFriends ? `${selectedFriends.length} friends` : undefined} onClick={() => setPage('friends')} />
                      </div>
                    </div>
                  </div>
                  <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
                    <button onClick={handleSave} className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                      {existing ? 'Update Rating' : 'Save Rating'}
                    </button>
                  </div>
                </motion.div>
              )}

              {page === 'notes' && (
                <SubPage key="notes" onBack={() => setPage('main')} title="Notes">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What did you enjoy? Any favorite dishes, standout moments, or things to remember?" rows={8} autoFocus
                      className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                  </div>
                  <BottomBtn label={hasNotes ? 'Update Notes' : 'Save Notes'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {page === 'favorite-dishes' && (
                <SubPage key="favorite-dishes" onBack={() => { addDish(dishDraft); setPage('main'); }} title="Favorite Dishes">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5" onTouchMove={(e) => e.stopPropagation()}>
                    <p className="text-xs text-on-surface/45 mb-4 leading-relaxed">
                      The dishes worth ordering here. These show up automatically when you add this restaurant to a guide.
                    </p>
                    <div className="relative mb-4">
                      <ChefHat size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input
                        type="text"
                        value={dishDraft}
                        onChange={(e) => setDishDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') { e.preventDefault(); addDish(dishDraft); }
                        }}
                        placeholder="Add a dish (press Enter)…"
                        autoFocus
                        className="w-full bg-white border border-on-surface/10 rounded-full pl-10 pr-20 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30"
                      />
                      {dishDraft.trim() && (
                        <button
                          type="button"
                          onClick={() => addDish(dishDraft)}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3 py-1 rounded-full bg-primary text-white text-[11px] font-bold"
                        >
                          Add
                        </button>
                      )}
                    </div>
                    {favoriteDishes.length === 0 ? (
                      <div className="px-5 py-12 flex flex-col items-center justify-center text-on-surface/30 text-center">
                        <ChefHat size={28} className="mb-2" />
                        <p className="text-sm font-semibold">No dishes added yet</p>
                        <p className="text-xs mt-1 max-w-[220px]">Type a dish above and press Enter to add it to the list.</p>
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {favoriteDishes.map((dish, idx) => (
                          <li key={`${dish}-${idx}`} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-on-surface/[0.06]">
                            <span className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                              <ChefHat size={14} />
                            </span>
                            <span className="flex-1 text-[14px] font-semibold text-on-surface/85 truncate">{dish}</span>
                            <button
                              type="button"
                              onClick={() => removeDish(idx)}
                              aria-label={`Remove ${dish}`}
                              className="w-8 h-8 rounded-full text-on-surface/35 hover:text-primary hover:bg-primary/[0.06] flex items-center justify-center transition-colors"
                            >
                              <Trash2 size={15} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <BottomBtn
                    label={hasDishes || dishDraft.trim() ? `Done (${favoriteDishes.length + (dishDraft.trim() && !favoriteDishes.includes(dishDraft.trim()) ? 1 : 0)})` : 'Done'}
                    onClick={() => { addDish(dishDraft); setPage('main'); }}
                  />
                </SubPage>
              )}

              {page === 'price' && (
                <SubPage key="price" onBack={() => setPage('main')} title="Price Range">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-6 flex flex-col items-center">
                    <p className="text-xs text-on-surface/40 mb-5 text-center">How much per person?</p>
                    <div className="flex gap-2.5 w-full max-w-xs mb-6">
                      {PRICE_RANGES.map((p, idx) => (
                        <button key={idx} onClick={() => handlePriceSignClick(idx)}
                          className={cn("flex-1 py-4 rounded-2xl border-2 transition-all text-center",
                            priceIndex === idx ? "bg-primary/10 border-primary/30 text-primary shadow-sm" : "bg-white border-on-surface/10 text-on-surface/40"
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
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {page === 'date' && (
                <SubPage key="date" onBack={() => setPage('main')} title="Date Visited">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5"><Calendar value={visitDate} onChange={setVisitDate} onClear={() => setVisitDate('')} /></div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {page === 'tags' && (
                <SubPage key="tags" onBack={() => { setPage('main'); setTagSearch(''); }} title="Tags">
                  <div className="px-5 pt-4 pb-3 flex-shrink-0">
                    <div className="relative">
                      <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Search tags..."
                        className="w-full bg-on-surface/[0.04] rounded-full pl-10 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3" onTouchMove={(e) => e.stopPropagation()}>
                    <div className="flex flex-wrap gap-2">
                      {filteredTags.map((tag) => {
                        const sel = selectedTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            onClick={() => toggleTag(tag)}
                            className={cn(
                              "rounded-full px-3 py-1 text-sm font-medium transition-colors",
                              sel
                                ? "bg-primary text-white"
                                : "border border-on-surface/15 text-on-surface/70 hover:border-on-surface/25"
                            )}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                    {filteredTags.length === 0 && <p className="text-center py-8 text-sm text-on-surface/30">No tags match "{tagSearch}"</p>}
                  </div>
                  <BottomBtn label={hasTags ? `Done (${selectedTags.length})` : 'Done'} onClick={() => { setPage('main'); setTagSearch(''); }} />
                </SubPage>
              )}

              {page === 'photos' && (
                <SubPage key="photos" onBack={() => { setPage('main'); setSelectedPhotoIdx(null); }} title="Photos" rightAction={
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-primary">Add More</button>
                }>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" onTouchMove={(e) => e.stopPropagation()}>
                    {photos.length === 0 ? (
                      <div className="px-5 py-16 flex flex-col items-center justify-center text-on-surface/30">
                        <Camera size={28} className="mb-2" /><p className="text-sm font-semibold">No photos yet</p>
                        <button onClick={() => fileInputRef.current?.click()} className="mt-3 text-primary text-sm font-semibold">Add Photos</button>
                      </div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-0.5">
                          {photos.map((photo, idx) => {
                            const isSelected = selectedPhotoIdx === idx;
                            return (
                              <div
                                key={idx}
                                onClick={() => setSelectedPhotoIdx(isSelected ? null : idx)}
                                className={cn(
                                  "group relative aspect-square overflow-hidden rounded-md cursor-pointer",
                                  isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-surface z-10"
                                )}
                              >
                                <img src={photo.url} alt="" className="w-full h-full object-cover pointer-events-none" />
                                {photo.isFavorite && (
                                  <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                                    <Star size={11} className="text-yellow-400 fill-yellow-400" />
                                  </div>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removePhoto(idx); }}
                                  aria-label="Delete photo"
                                  className={cn(
                                    "absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center transition-opacity hover:bg-red-500",
                                    isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                  )}
                                >
                                  <X size={12} className="text-white" strokeWidth={2.5} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        {selectedPhotoIdx !== null && photos[selectedPhotoIdx] && (
                          <div className="px-5 pt-4 pb-2 mt-0.5 border-t border-on-surface/[0.06] space-y-3">
                            <input
                              type="text"
                              value={photos[selectedPhotoIdx].caption}
                              onChange={(e) => updatePhotoCaption(selectedPhotoIdx, e.target.value)}
                              placeholder="Add a caption…"
                              className="w-full bg-on-surface/[0.04] rounded-full px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => togglePhotoFavorite(selectedPhotoIdx)}
                                className={cn(
                                  "flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-full text-xs font-semibold transition-colors",
                                  photos[selectedPhotoIdx].isFavorite
                                    ? "bg-primary text-white"
                                    : "bg-on-surface/[0.04] text-on-surface/65 hover:bg-on-surface/[0.08]"
                                )}
                              >
                                <Star size={13} className={photos[selectedPhotoIdx].isFavorite ? "fill-white" : ""} />
                                {photos[selectedPhotoIdx].isFavorite ? 'Favorite dish' : 'Mark as favorite'}
                              </button>
                              <button
                                onClick={() => {
                                  if (selectedPhotoIdx > 0) {
                                    movePhoto(selectedPhotoIdx, selectedPhotoIdx - 1);
                                    setSelectedPhotoIdx(selectedPhotoIdx - 1);
                                  }
                                }}
                                disabled={selectedPhotoIdx === 0}
                                aria-label="Move left"
                                className="w-9 h-9 rounded-full bg-on-surface/[0.04] flex items-center justify-center text-on-surface/60 disabled:opacity-30 hover:bg-on-surface/[0.08] transition-colors"
                              >
                                <ChevronLeft size={16} />
                              </button>
                              <button
                                onClick={() => {
                                  if (selectedPhotoIdx < photos.length - 1) {
                                    movePhoto(selectedPhotoIdx, selectedPhotoIdx + 1);
                                    setSelectedPhotoIdx(selectedPhotoIdx + 1);
                                  }
                                }}
                                disabled={selectedPhotoIdx === photos.length - 1}
                                aria-label="Move right"
                                className="w-9 h-9 rounded-full bg-on-surface/[0.04] flex items-center justify-center text-on-surface/60 disabled:opacity-30 hover:bg-on-surface/[0.08] transition-colors"
                              >
                                <ChevronRight size={16} />
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <BottomBtn label={hasPhotos ? `Done (${photos.length})` : 'Done'} onClick={() => { setPage('main'); setSelectedPhotoIdx(null); }} />
                </SubPage>
              )}

              {page === 'friends' && (
                <SubPage key="friends" onBack={() => { setPage('main'); setFriendSearch(''); }} title="Went With">
                  <div className="px-5 pt-4 pb-3 flex-shrink-0">
                    <div className="relative">
                      <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={friendSearch} onChange={(e) => setFriendSearch(e.target.value)} placeholder="Search friends..."
                        className="w-full bg-on-surface/[0.04] rounded-full pl-10 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3" onTouchMove={(e) => e.stopPropagation()}>
                    {filteredFriends.map((name) => {
                      const sel = selectedFriends.includes(name);
                      return (
                        <button key={name} onClick={() => toggleFriend(name)}
                          className="w-full flex items-center gap-3 py-3 border-b border-on-surface/[0.06] last:border-b-0 text-left transition-colors active:bg-on-surface/[0.02]">
                          <div className="w-8 h-8 rounded-full bg-on-surface/[0.08] flex items-center justify-center text-[11px] font-bold text-on-surface/55 flex-shrink-0">
                            {name.split(' ').map((n) => n[0]).join('')}
                          </div>
                          <span className={cn("flex-1 text-[15px] font-medium", sel ? "text-primary" : "text-on-surface/80")}>{name}</span>
                          {sel && <Check size={18} className="text-primary flex-shrink-0" strokeWidth={2.5} />}
                        </button>
                      );
                    })}
                    {filteredFriends.length === 0 && <p className="text-center py-8 text-sm text-on-surface/30">No friends match "{friendSearch}"</p>}
                  </div>
                  <BottomBtn label={hasFriends ? `Done (${selectedFriends.length})` : 'Done'} onClick={() => { setPage('main'); setFriendSearch(''); }} />
                </SubPage>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

const DetailRow: React.FC<{
  icon: React.ReactNode; label: string; value?: string; onClick: () => void;
}> = ({ icon, label, value, onClick }) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-3.5 py-3.5 border-b border-on-surface/[0.06] last:border-b-0 text-left active:bg-on-surface/[0.02] transition-colors"
  >
    <span className="text-on-surface/45 flex-shrink-0">{icon}</span>
    <span className="flex-1 text-[16px] font-medium text-on-surface/85">{label}</span>
    {value && <span className="text-[14px] text-on-surface/45 truncate max-w-[150px]">{value}</span>}
    <ChevronRight size={16} className="text-on-surface/25 flex-shrink-0" />
  </button>
);

const SubPage: React.FC<{
  children: React.ReactNode; onBack: () => void; title: string; rightAction?: React.ReactNode;
}> = ({ children, onBack, title, rightAction }) => (
  <motion.div initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col h-full" onTouchMove={(e) => e.stopPropagation()}>
    <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
      <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
        <ChevronLeft size={22} />
      </button>
      <h2 className="font-serif font-bold text-lg flex-1">{title}</h2>
      {rightAction}
    </div>
    {children}
  </motion.div>
);

const BottomBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
    <button onClick={onClick} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{label}</button>
  </div>
);

