import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, ChevronLeft, ChevronDown, DollarSign, CalendarDays, Tag, StickyNote, Image, Users, Search, GripVertical, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type PhotoItem } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { ALL_TAGS, PRICE_RANGES, priceIndexFromAmount, EMOJI_OPTIONS, Calendar } from './RatingShared';

type Page = 'main' | 'notes' | 'tags' | 'photos' | 'price' | 'date' | 'friends';

export const AddRestaurantModal: React.FC = () => {
  const {
    addRestaurantModalOpen, addRestaurantModalMeta, closeAddRestaurantModal,
    rateRestaurant, getRating, removeRating,
    lists, createList,
  } = useLists();
  const { phoneMode } = useSettings();

  const restaurant = addRestaurantModalMeta;
  const existing = restaurant ? getRating(restaurant.id) : undefined;

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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  useEffect(() => {
    if (addRestaurantModalOpen && restaurant) {
      const ex = getRating(restaurant.id);
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
      setPage('main');
      setConfirmDelete(false);
      setCreatingList(false);
      setNewName('');
      setListDropdownOpen(false);
      setTagSearch('');
      setFriendSearch('');
    }
  }, [addRestaurantModalOpen, restaurant]);

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);
  const toggleList = (listId: string) => setSelectedListIds((prev) => prev.includes(listId) ? prev.filter((id) => id !== listId) : [...prev, listId]);
  const toggleFriend = (name: string) => setSelectedFriends((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]);

  const handlePriceSignClick = (idx: number) => { setPriceIndex(idx); setPriceAmount(''); };
  const handlePriceAmountChange = (val: string) => {
    setPriceAmount(val);
    const num = parseInt(val, 10);
    if (!isNaN(num) && num > 0) setPriceIndex(priceIndexFromAmount(num));
  };

  const resolvedPrice = priceIndex >= 0 ? PRICE_RANGES[priceIndex].signs : (restaurant?.price || '$$');

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
            // Use setTimeout to let React process the state update before page change
            setTimeout(() => setPage('photos'), 0);
            return updated;
          });
        }
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const removePhoto = (idx: number) => setPhotos((prev) => prev.filter((_, i) => i !== idx));
  const updatePhotoCaption = (idx: number, caption: string) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, caption } : p));
  const togglePhotoFavorite = (idx: number) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, isFavorite: !p.isFavorite } : p));
  const movePhoto = (from: number, to: number) => {
    setPhotos((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  };

  // Photo button: if no photos, open picker. If photos exist, go to edit page.
  const handlePhotosClick = () => {
    if (photos.length === 0) {
      fileInputRef.current?.click();
    } else {
      setPage('photos');
    }
  };

  const handleSaveRating = () => {
    if (!restaurant) return;
    rateRestaurant({
      restaurantId: restaurant.id, name: restaurant.name, image: restaurant.image,
      cuisine: restaurant.cuisine, price: resolvedPrice, address: restaurant.address,
      score, notes, visitDate, wouldReturn, tags: selectedTags, photos,
      listIds: selectedListIds, createdAt: Date.now(),
    });
    closeAddRestaurantModal();
  };

  const handleCreateList = () => {
    if (!newName.trim()) return;
    createList(newName.trim(), newEmoji);
    setNewName(''); setNewEmoji('📋'); setCreatingList(false);
  };

  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

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

  // Hidden file input for photos
  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;

  return (
    <AnimatePresence>
      {addRestaurantModalOpen && restaurant && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeAddRestaurantModal}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-full rounded-none"
                : "h-full sm:h-auto sm:max-w-md sm:max-h-[92vh] rounded-none sm:rounded-3xl"
            )}
          >
            {photoInput}
            <AnimatePresence mode="wait">
              {/* ═══════════ MAIN PAGE ═══════════ */}
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col h-full">
                  <div className="px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <div className="min-w-0">
                      <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Update Rating' : 'Rate Restaurant'}</h2>
                      <p className="text-xs text-on-surface/40 truncate">{restaurant.name}</p>
                    </div>
                    <button onClick={closeAddRestaurantModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                  </div>

                  {/* List selector */}
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
                      <div className={cn("relative w-28 h-28 sm:w-32 sm:h-32 rounded-full flex items-center justify-center mb-3 bg-gradient-to-b ring-4", scoreBg, scoreRing)}>
                        <div className="text-center">
                          <div className={cn("text-4xl sm:text-5xl font-serif font-bold tabular-nums transition-colors duration-300", scoreColor)}>{score.toFixed(1)}</div>
                          <div className="text-[8px] font-bold uppercase tracking-widest text-on-surface/30 mt-0.5">out of 10</div>
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
                      <div className="w-full max-w-[260px] mb-5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 text-center mb-2">Would you go back?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setWouldReturn(true)} className={cn("flex-1 py-2 rounded-xl text-sm font-semibold border transition-all", wouldReturn ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-on-surface/10 text-on-surface/40")}>Yes!</button>
                          <button onClick={() => setWouldReturn(false)} className={cn("flex-1 py-2 rounded-xl text-sm font-semibold border transition-all", !wouldReturn ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-on-surface/10 text-on-surface/40")}>Nah</button>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2.5">Add details</p>
                      <div className="grid grid-cols-3 gap-2">
                        <DetailBtn icon={<StickyNote size={17} />} label="Notes" active={hasNotes} sub={hasNotes ? notes.slice(0, 15) + '...' : undefined} onClick={() => setPage('notes')} />
                        <DetailBtn icon={<DollarSign size={17} />} label="Price" active={hasPrice} sub={hasPrice ? PRICE_RANGES[priceIndex].signs : undefined} onClick={() => setPage('price')} />
                        <DetailBtn icon={<CalendarDays size={17} />} label="Date" active={hasDate} sub={dateLabel} onClick={() => setPage('date')} />
                        <DetailBtn icon={<Tag size={17} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
                        <DetailBtn icon={<Image size={17} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={handlePhotosClick} />
                        <DetailBtn icon={<Users size={17} />} label="Friends" active={hasFriends} sub={hasFriends ? `${selectedFriends.length} friends` : undefined} onClick={() => setPage('friends')} />
                      </div>
                    </div>
                  </div>
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface space-y-2">
                    <button onClick={handleSaveRating} className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">
                      {existing ? 'Update Rating' : 'Save Rating'}
                    </button>
                    {existing && !confirmDelete && (
                      <button onClick={() => setConfirmDelete(true)}
                        className="w-full py-2.5 text-red-400 text-xs font-semibold hover:text-red-500 transition-colors">
                        Delete Rating
                      </button>
                    )}
                    {existing && confirmDelete && (
                      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 font-medium">Delete this rating?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                          <button onClick={() => { if (restaurant) { removeRating(restaurant.id); closeAddRestaurantModal(); } }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ═══════════ NOTES ═══════════ */}
              {page === 'notes' && (
                <SubPage key="notes" onBack={() => setPage('main')} title="Notes">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                      placeholder="What did you enjoy? Any favorite dishes, standout moments, or things to remember?" rows={8} autoFocus
                      className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                  </div>
                  <BottomBtn label={hasNotes ? 'Update Notes' : 'Save Notes'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ PRICE ═══════════ */}
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

              {/* ═══════════ DATE ═══════════ */}
              {page === 'date' && (
                <SubPage key="date" onBack={() => setPage('main')} title="Date Visited">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    <Calendar value={visitDate} onChange={setVisitDate} onClear={() => setVisitDate('')} />
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ TAGS ═══════════ */}
              {page === 'tags' && (
                <SubPage key="tags" onBack={() => { setPage('main'); setTagSearch(''); }} title="Tags">
                  <div className="px-5 pt-4 pb-2 flex-shrink-0">
                    <div className="relative">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={tagSearch} onChange={(e) => setTagSearch(e.target.value)} placeholder="Search tags..."
                        className="w-full bg-white border border-on-surface/10 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    {hasTags && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {selectedTags.map((tag) => (
                          <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                            {tag}<button onClick={() => toggleTag(tag)} className="text-primary/40 hover:text-primary"><X size={11} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3"
                    onTouchMove={(e) => e.stopPropagation()}>
                    {filteredTags.map((tag) => {
                      const sel = selectedTags.includes(tag);
                      return (
                        <button key={tag} onClick={() => toggleTag(tag)}
                          className={cn("w-full flex items-center gap-3 px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                            sel ? "bg-primary/3" : "hover:bg-on-surface/3"
                          )}>
                          <div className={cn("w-5 h-5 rounded flex items-center justify-center border-2 transition-all flex-shrink-0",
                            sel ? "bg-primary border-primary text-white" : "border-on-surface/20"
                          )}>{sel && <Check size={12} strokeWidth={3} />}</div>
                          <span className={cn("text-sm font-medium", sel ? "text-primary" : "text-on-surface/70")}>{tag}</span>
                        </button>
                      );
                    })}
                    {filteredTags.length === 0 && <p className="text-center py-8 text-sm text-on-surface/30">No tags match "{tagSearch}"</p>}
                  </div>
                  <BottomBtn label={hasTags ? `Done (${selectedTags.length})` : 'Done'} onClick={() => { setPage('main'); setTagSearch(''); }} />
                </SubPage>
              )}

              {/* ═══════════ PHOTOS ═══════════ */}
              {page === 'photos' && (
                <SubPage key="photos" onBack={() => setPage('main')} title="Photos" rightAction={
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-primary">
                    Add More
                  </button>
                }>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
                    onTouchMove={(e) => e.stopPropagation()}>
                    {photos.length === 0 ? (
                      <div className="px-5 py-16 flex flex-col items-center justify-center text-on-surface/30">
                        <Camera size={28} className="mb-2" />
                        <p className="text-sm font-semibold">No photos yet</p>
                        <button onClick={() => fileInputRef.current?.click()} className="mt-3 text-primary text-sm font-semibold">Add Photos</button>
                      </div>
                    ) : (
                      <div className="divide-y divide-on-surface/8">
                        {photos.map((photo, idx) => (
                          <div key={idx} className="flex gap-3 px-5 py-4">
                            <div className="w-24 h-24 rounded-xl overflow-hidden flex-shrink-0 relative">
                              <img src={photo.url} alt="" className="w-full h-full object-cover" />
                              <button onClick={() => removePhoto(idx)}
                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center">
                                <X size={10} className="text-white" />
                              </button>
                            </div>
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                              <input
                                type="text"
                                value={photo.caption}
                                onChange={(e) => updatePhotoCaption(idx, e.target.value)}
                                placeholder="What's this?"
                                className="text-sm font-medium text-on-surface/70 placeholder:text-on-surface/30 border-none outline-none bg-transparent w-full"
                              />
                              <button onClick={() => togglePhotoFavorite(idx)}
                                className={cn("flex items-center gap-2 mt-2 text-xs font-medium transition-colors",
                                  photo.isFavorite ? "text-primary" : "text-on-surface/35"
                                )}>
                                <span className="text-on-surface/40">Mark as a favorite dish:</span>
                                <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all",
                                  photo.isFavorite ? "bg-primary border-primary text-white" : "border-on-surface/20"
                                )}>
                                  {photo.isFavorite && <Star size={10} fill="white" />}
                                </div>
                              </button>
                            </div>
                            <div className="flex items-start pt-1 flex-shrink-0">
                              <div className="text-on-surface/20 cursor-grab active:cursor-grabbing p-1"
                                onPointerDown={() => setDragIdx(idx)}
                                onPointerUp={() => {
                                  if (dragIdx !== null && dragIdx !== idx) movePhoto(dragIdx, idx);
                                  setDragIdx(null);
                                }}>
                                <GripVertical size={18} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <BottomBtn label={hasPhotos ? `Done (${photos.length})` : 'Done'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ FRIENDS ═══════════ */}
              {page === 'friends' && (
                <SubPage key="friends" onBack={() => { setPage('main'); setFriendSearch(''); }} title="Went With">
                  <div className="px-5 pt-4 pb-2 flex-shrink-0">
                    <div className="relative">
                      <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface/30" />
                      <input type="text" value={friendSearch} onChange={(e) => setFriendSearch(e.target.value)} placeholder="Search friends..."
                        className="w-full bg-white border border-on-surface/10 rounded-xl pl-10 pr-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>
                    {hasFriends && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">
                        {selectedFriends.map((name) => (
                          <span key={name} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                            {name}<button onClick={() => toggleFriend(name)} className="text-primary/40 hover:text-primary"><X size={11} /></button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3"
                    onTouchMove={(e) => e.stopPropagation()}>
                    <p className="text-[10px] text-on-surface/30 mb-3 px-1">Select friends who joined you</p>
                    {filteredFriends.map((name) => {
                      const sel = selectedFriends.includes(name);
                      return (
                        <button key={name} onClick={() => toggleFriend(name)}
                          className={cn("w-full flex items-center gap-3 px-3 py-3 border-b border-on-surface/5 text-left transition-colors",
                            sel ? "bg-primary/3" : "hover:bg-on-surface/3"
                          )}>
                          <div className="w-8 h-8 rounded-full bg-on-surface/8 flex items-center justify-center text-xs font-bold text-on-surface/40 flex-shrink-0">
                            {name.split(' ').map((n) => n[0]).join('')}
                          </div>
                          <span className={cn("flex-1 text-sm font-medium", sel ? "text-primary" : "text-on-surface/70")}>{name}</span>
                          {sel && <Check size={16} className="text-primary flex-shrink-0" />}
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

/* ── Shared sub-components ── */

const DetailBtn: React.FC<{
  icon: React.ReactNode; label: string; active: boolean; sub?: string; onClick: () => void;
}> = ({ icon, label, active, sub, onClick }) => (
  <button onClick={onClick}
    className={cn("flex flex-col items-center gap-1 p-2.5 rounded-2xl border transition-all",
      active ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15"
    )}>
    <span className={active ? "text-primary" : "text-on-surface/30"}>{icon}</span>
    <span className={cn("text-[10px] font-semibold", active ? "text-primary" : "text-on-surface/40")}>{label}</span>
    {sub && <span className="text-[9px] text-primary/60 line-clamp-1 w-full text-center">{sub}</span>}
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
  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
    <button onClick={onClick} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{label}</button>
  </div>
);
