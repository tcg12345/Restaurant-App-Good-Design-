import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, ChevronLeft, ChevronRight, ChevronDown, DollarSign, CalendarDays, Tag, StickyNote, Image, Users, Search, Star, Sliders, Swords, Sparkles, RotateCcw } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColor, scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { useLists, type PhotoItem } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, EMOJI_OPTIONS, Calendar } from './RatingShared';
import {
  type H2HState,
  type Tier,
  TIER_LABELS,
  TIER_EMOJI,
  TIER_BLURB,
  initH2H,
  pickComparison,
  applyChoice,
  applyTie,
  undoLastChoice,
  isComplete,
  computeFinalScore,
  totalEstimatedComparisons,
} from '../lib/headToHeadRating';

type Page = 'mode-select' | 'h2h-tier' | 'h2h-compare' | 'h2h-result' | 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';

export const RatingModal: React.FC = () => {
  const { ratingModalOpen, ratingModalRestaurant, closeRatingModal, rateRestaurant, getRating, lists, createList, ratings } = useLists();
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
  const [selectedListIds, setSelectedListIds] = useState<string[]>([]);
  const [selectedFriends, setSelectedFriends] = useState<string[]>([]);
  const [friendSearch, setFriendSearch] = useState('');
  const [tagSearch, setTagSearch] = useState('');

  const [listDropdownOpen, setListDropdownOpen] = useState(false);
  const [creatingList, setCreatingList] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('📋');

  const [page, setPage] = useState<Page>('main');
  const [h2hState, setH2hState] = useState<H2HState | null>(null);
  const [cameFromH2H, setCameFromH2H] = useState(false);
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
      setSelectedListIds(ex?.listIds ?? []);
      setSelectedFriends([]);
      setPriceIndex(-1);
      setPriceAmount('');
      // If the user has any other rated restaurants, show the mode-select
      // entry; otherwise fall through to the slider as before.
      const others = ratings.filter((r) => r.restaurantId !== ratingModalRestaurant.id);
      setPage(others.length === 0 ? 'main' : 'mode-select');
      setH2hState(null);
      setCameFromH2H(false);
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

  const handleSave = () => {
    if (!ratingModalRestaurant) return;
    rateRestaurant({
      restaurantId: ratingModalRestaurant.id, name: ratingModalRestaurant.name, image: ratingModalRestaurant.image,
      cuisine: ratingModalRestaurant.cuisine, price: resolvedPrice, address: ratingModalRestaurant.address,
      score, notes, visitDate, wouldReturn, tags: selectedTags, photos,
      listIds: selectedListIds, createdAt: Date.now(),
    });
    closeRatingModal();
  };

  const scoreClr = scoreColorLight(score);
  const scoreBg = scoreBgGradient(score);
  const scoreRing = scoreRingColor(score);

  const hasNotes = notes.trim().length > 0;
  const hasPrice = priceIndex >= 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasFriends = selectedFriends.length > 0;
  const hasDate = visitDate !== '';
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
              {page === 'mode-select' && (
                <ModeSelectPage
                  key="mode-select"
                  restaurantName={ratingModalRestaurant.name}
                  isEdit={!!existing}
                  onClose={closeRatingModal}
                  onPickSlider={() => { setCameFromH2H(false); setPage('main'); }}
                  onPickH2H={() => setPage('h2h-tier')}
                />
              )}

              {page === 'h2h-tier' && (
                <TierSelectPage
                  key="h2h-tier"
                  onBack={() => setPage('mode-select')}
                  onPick={(tier) => {
                    const fresh = initH2H(ratings, tier, ratingModalRestaurant.id);
                    setH2hState(fresh);
                    setPage(isComplete(fresh) ? 'h2h-result' : 'h2h-compare');
                  }}
                />
              )}

              {page === 'h2h-compare' && h2hState && (() => {
                const comparison = pickComparison(h2hState);
                if (!comparison) {
                  // Defensive: shouldn't happen, but if we land here, jump to result.
                  setTimeout(() => setPage('h2h-result'), 0);
                  return null;
                }
                return (
                  <ComparePage
                    key="h2h-compare"
                    state={h2hState}
                    comparison={comparison}
                    newRestaurant={ratingModalRestaurant}
                    onBack={() => {
                      if (h2hState.history.length > 0) {
                        setH2hState((s) => (s ? undoLastChoice(s) : s));
                      } else {
                        setPage('h2h-tier');
                      }
                    }}
                    onPick={(pickedNew) => {
                      const next = applyChoice(h2hState, pickedNew);
                      setH2hState(next);
                      if (isComplete(next)) setPage('h2h-result');
                    }}
                    onTie={() => {
                      const next = applyTie(h2hState);
                      setH2hState(next);
                      setPage('h2h-result');
                    }}
                  />
                );
              })()}

              {page === 'h2h-result' && h2hState && (
                <ResultPage
                  key="h2h-result"
                  state={h2hState}
                  onRedo={() => { setH2hState(null); setPage('h2h-tier'); }}
                  onContinue={() => {
                    const final = computeFinalScore(h2hState);
                    setScore(final);
                    setCameFromH2H(true);
                    setPage('main');
                  }}
                />
              )}

              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col h-full">
                  <div className="px-5 pt-safe-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-1 min-w-0">
                      {ratings.filter((r) => r.restaurantId !== ratingModalRestaurant.id).length > 0 && (
                        <button onClick={() => { setCameFromH2H(false); setPage('mode-select'); }} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors flex-shrink-0">
                          <ChevronLeft size={20} />
                        </button>
                      )}
                      <div className="min-w-0">
                        <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Update Rating' : 'Rate Restaurant'}</h2>
                        <p className="text-xs text-on-surface/40 truncate">{ratingModalRestaurant.name}</p>
                      </div>
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
                    <div className="flex flex-col items-center pt-3 sm:pt-5">
                      {cameFromH2H && (
                        <motion.div
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.25 }}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-2"
                        >
                          <Sparkles size={11} />
                          From head-to-head
                        </motion.div>
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
                      <p className="text-xs font-medium text-on-surface/40 mb-4">
                        {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                      </p>
                    </div>
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-1">Add details</p>
                      <div>
                        <DetailRow icon={<StickyNote size={20} />} label="Notes" value={hasNotes ? notes : undefined} onClick={() => setPage('notes')} />
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

/* ── Head-to-head sub-pages ───────────────────────────────────────── */

const ModeSelectPage: React.FC<{
  restaurantName: string;
  isEdit: boolean;
  onClose: () => void;
  onPickSlider: () => void;
  onPickH2H: () => void;
}> = ({ restaurantName, isEdit, onClose, onPickSlider, onPickH2H }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0, x: -30 }}
    transition={{ duration: 0.18 }}
    className="flex flex-col h-full"
  >
    <div className="px-5 pt-safe-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
      <div className="min-w-0">
        <h2 className="font-serif font-bold text-lg truncate">{isEdit ? 'Update Rating' : 'Rate Restaurant'}</h2>
        <p className="text-xs text-on-surface/40 truncate">{restaurantName}</p>
      </div>
      <button onClick={onClose} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
    </div>
    <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-6">
      <p className="text-[11px] font-bold uppercase tracking-widest text-on-surface/35 mb-4 text-center">Choose a way to rate</p>
      <div className="space-y-3 max-w-md mx-auto">
        <motion.button
          onClick={onPickSlider}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-white border border-on-surface/8 text-left shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center flex-shrink-0 text-primary">
            <Sliders size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-serif font-bold text-[16px] mb-0.5">Quick rate</div>
            <div className="text-[12px] text-on-surface/55">Pick a score from 1–10 with the slider</div>
          </div>
          <ChevronRight size={18} className="text-on-surface/30 flex-shrink-0" />
        </motion.button>
        <motion.button
          onClick={onPickH2H}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
          className="w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br from-primary/8 to-primary/3 border border-primary/20 text-left shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center flex-shrink-0 text-white shadow-sm">
            <Swords size={22} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="font-serif font-bold text-[16px]">Head-to-head</span>
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary text-white">New</span>
            </div>
            <div className="text-[12px] text-on-surface/60">Compare to restaurants you've already rated</div>
          </div>
          <ChevronRight size={18} className="text-primary/50 flex-shrink-0" />
        </motion.button>
      </div>
      <p className="text-[11px] text-on-surface/35 text-center mt-6 leading-relaxed max-w-[280px] mx-auto">
        Head-to-head asks a few quick A-vs-B questions, then places this restaurant in the right spot on your list.
      </p>
    </div>
  </motion.div>
);

const TIER_ORDER: Tier[] = ['loved', 'fine', 'disliked'];

const TIER_STYLES: Record<Tier, { gradient: string; ring: string; iconBg: string; text: string }> = {
  loved: {
    gradient: 'from-green-500/15 to-green-600/5',
    ring: 'ring-green-400/30',
    iconBg: 'bg-green-500/20',
    text: 'text-green-600',
  },
  fine: {
    gradient: 'from-yellow-500/15 to-yellow-600/5',
    ring: 'ring-yellow-400/30',
    iconBg: 'bg-yellow-500/20',
    text: 'text-yellow-600',
  },
  disliked: {
    gradient: 'from-red-500/15 to-red-600/5',
    ring: 'ring-red-400/30',
    iconBg: 'bg-red-500/20',
    text: 'text-red-500',
  },
};

const TierSelectPage: React.FC<{
  onBack: () => void;
  onPick: (tier: Tier) => void;
}> = ({ onBack, onPick }) => (
  <motion.div
    initial={{ x: '100%', opacity: 0.5 }}
    animate={{ x: 0, opacity: 1 }}
    exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col h-full"
  >
    <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0 border-b border-on-surface/6">
      <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
        <ChevronLeft size={22} />
      </button>
      <h2 className="font-serif font-bold text-lg flex-1">Head-to-head</h2>
    </div>
    <div className="flex-1 overflow-y-auto overscroll-contain px-5 pt-6 pb-6">
      <p className="text-center text-[13px] text-on-surface/55 mb-5 leading-relaxed max-w-[280px] mx-auto">
        First, how did you feel overall?
      </p>
      <div className="space-y-2.5 max-w-md mx-auto">
        {TIER_ORDER.map((tier, idx) => {
          const s = TIER_STYLES[tier];
          return (
            <motion.button
              key={tier}
              onClick={() => onPick(tier)}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.06, type: 'spring', stiffness: 400, damping: 26 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={cn(
                "w-full flex items-center gap-4 p-4 rounded-2xl bg-gradient-to-br border border-on-surface/8 ring-1 ring-inset text-left shadow-sm hover:shadow-md transition-shadow",
                s.gradient,
                s.ring,
              )}
            >
              <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center text-2xl flex-shrink-0", s.iconBg)}>
                {TIER_EMOJI[tier]}
              </div>
              <div className="flex-1 min-w-0">
                <div className={cn("font-serif font-bold text-[16px] mb-0.5", s.text)}>{TIER_LABELS[tier]}</div>
                <div className="text-[12px] text-on-surface/55">{TIER_BLURB[tier]}</div>
              </div>
              <ChevronRight size={18} className="text-on-surface/30 flex-shrink-0" />
            </motion.button>
          );
        })}
      </div>
    </div>
  </motion.div>
);

const ComparePage: React.FC<{
  state: H2HState;
  comparison: import('../lib/headToHeadRating').H2HCandidate;
  newRestaurant: { name: string; image: string; cuisine: string; price: string };
  onBack: () => void;
  onPick: (pickedNew: boolean) => void;
  onTie: () => void;
}> = ({ state, comparison, newRestaurant, onBack, onPick, onTie }) => {
  const total = totalEstimatedComparisons(state);
  const done = state.history.length;
  const progress = total === 0 ? 1 : Math.min(1, done / total);
  return (
    <motion.div
      initial={{ x: '100%', opacity: 0.5 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.5 }}
      transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="flex flex-col h-full"
    >
      <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0">
        <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/40 hover:text-on-surface transition-colors">
          <ChevronLeft size={22} />
        </button>
        <h2 className="font-serif font-bold text-lg flex-1">Head-to-head</h2>
        <span className="text-[11px] font-semibold text-on-surface/40 tabular-nums">{done + 1} / {total || done + 1}</span>
      </div>
      <div className="px-5 pb-3 flex-shrink-0">
        <div className="h-1 bg-on-surface/8 rounded-full overflow-hidden">
          <motion.div
            className="h-full bg-primary rounded-full"
            initial={false}
            animate={{ width: `${progress * 100}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 28 }}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-3 flex flex-col">
        <p className="text-center text-[15px] font-semibold text-on-surface/85 mt-2 mb-1">Which did you enjoy more?</p>
        <p className="text-center text-[11px] text-on-surface/40 mb-5">Tap your pick</p>
        <AnimatePresence mode="wait">
          <motion.div
            key={comparison.restaurantId + ':' + state.history.length}
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -30 }}
            transition={{ type: 'tween', duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            className="flex-1 flex flex-col sm:flex-row items-stretch gap-3 sm:gap-4"
          >
            <CompareCard
              label="Rating now"
              labelTone="primary"
              name={newRestaurant.name}
              image={newRestaurant.image}
              cuisine={newRestaurant.cuisine}
              price={newRestaurant.price}
              onPick={() => onPick(true)}
            />
            <div className="hidden sm:flex flex-col items-center justify-center text-on-surface/30 font-serif font-bold text-sm tracking-widest">VS</div>
            <div className="sm:hidden flex items-center justify-center -my-1">
              <span className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-on-surface/35 bg-on-surface/5 rounded-full">VS</span>
            </div>
            <CompareCard
              label="Already rated"
              labelTone="neutral"
              name={comparison.name}
              image={comparison.image}
              cuisine={comparison.cuisine}
              price={comparison.price}
              score={comparison.score}
              onPick={() => onPick(false)}
            />
          </motion.div>
        </AnimatePresence>
        <button
          onClick={onTie}
          className="mt-4 self-center text-[12px] font-semibold text-on-surface/45 hover:text-on-surface/70 transition-colors py-2 px-4"
        >
          Too close to call
        </button>
      </div>
    </motion.div>
  );
};

const CompareCard: React.FC<{
  label: string;
  labelTone: 'primary' | 'neutral';
  name: string;
  image: string;
  cuisine: string;
  price: string;
  score?: number;
  onPick: () => void;
}> = ({ label, labelTone, name, image, cuisine, price, score, onPick }) => (
  <motion.button
    onClick={onPick}
    whileHover={{ y: -3 }}
    whileTap={{ scale: 0.97 }}
    transition={{ type: 'spring', stiffness: 400, damping: 22 }}
    className="group relative flex-1 min-h-[140px] sm:min-h-0 rounded-2xl overflow-hidden bg-white border border-on-surface/8 shadow-sm hover:shadow-lg transition-shadow text-left"
  >
    <div className="relative h-32 sm:h-44 w-full bg-on-surface/5 overflow-hidden">
      {image ? (
        <img src={image} alt="" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-on-surface/20">
          <Image size={28} />
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/0 to-black/0" />
      <div className="absolute top-2 left-2">
        <span className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider backdrop-blur-sm",
          labelTone === 'primary' ? "bg-primary text-white" : "bg-white/85 text-on-surface/75"
        )}>
          {label}
        </span>
      </div>
      {typeof score === 'number' && (
        <div className="absolute top-2 right-2">
          <span className={cn(
            "inline-flex items-center justify-center min-w-[34px] h-7 px-2 rounded-full bg-white shadow-sm text-[13px] font-serif font-bold tabular-nums",
            scoreColor(score)
          )}>
            {score.toFixed(1)}
          </span>
        </div>
      )}
    </div>
    <div className="px-3 py-2.5">
      <div className="font-serif font-bold text-[14px] leading-tight line-clamp-2">{name}</div>
      <div className="mt-1 text-[11px] text-on-surface/50 truncate">{cuisine}{price ? ` · ${price}` : ''}</div>
    </div>
  </motion.button>
);

const ResultPage: React.FC<{
  state: H2HState;
  onRedo: () => void;
  onContinue: () => void;
}> = ({ state, onRedo, onContinue }) => {
  const target = computeFinalScore(state);
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const duration = 800;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);

  const scoreClr = scoreColorLight(target);
  const scoreBg = scoreBgGradient(target);
  const scoreRing = scoreRingColor(target);

  return (
    <motion.div
      initial={{ x: '100%', opacity: 0.5 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0.5 }}
      transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
      className="flex flex-col h-full"
    >
      <div className="px-5 pt-4 sm:pt-5 pb-3 flex items-center gap-3 flex-shrink-0">
        <h2 className="font-serif font-bold text-lg flex-1">Your placement</h2>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 flex flex-col items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-widest mb-4"
        >
          <Sparkles size={11} />
          We ranked it at
        </motion.div>
        <motion.div
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          className={cn(
            "relative w-40 h-40 sm:w-44 sm:h-44 rounded-full flex items-center justify-center bg-gradient-to-b ring-4",
            scoreBg, scoreRing
          )}
        >
          <div className="text-center">
            <div className={cn("text-[64px] sm:text-[72px] leading-none font-serif font-bold tabular-nums", scoreClr)}>
              {display.toFixed(1)}
            </div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-on-surface/30 mt-1.5">out of 10</div>
          </div>
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-center text-[13px] text-on-surface/55 mt-5 max-w-[280px] leading-relaxed"
        >
          {state.history.length === 0
            ? "We didn't have other restaurants to compare to — you can tweak the score next."
            : `Based on ${state.history.length} comparison${state.history.length === 1 ? '' : 's'}. You can fine-tune the score next.`}
        </motion.p>
        <button
          onClick={onRedo}
          className="mt-5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-on-surface/50 hover:text-on-surface/80 transition-colors py-2 px-3"
        >
          <RotateCcw size={13} />
          Redo
        </button>
      </div>
      <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
        <button onClick={onContinue} className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
          Continue
        </button>
      </div>
    </motion.div>
  );
};
