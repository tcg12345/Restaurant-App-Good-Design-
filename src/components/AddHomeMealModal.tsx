import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, ChevronLeft, ChevronRight, CalendarDays, Tag, StickyNote, Image, UtensilsCrossed, Globe, Lock, Camera, Trash2, Link as LinkIcon, Search, GripVertical, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type PhotoItem, type HomeMealDish } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { Calendar } from './RatingShared';

const HOME_COOKING_TAGS = [
  'Italian Night', 'Meal Prep', 'Holiday Meal', 'Grilling', 'Baking',
  'Quick Meal', 'Comfort Food', 'Date Night In', 'Family Recipe',
  'Healthy', 'Indulgent', 'Breakfast', 'Lunch', 'Dinner', 'Dessert',
  'Snack', 'Brunch', 'BBQ', 'One-Pot', 'Slow Cooker', 'Air Fryer',
];

type Page = 'main' | 'notes' | 'tags' | 'photos' | 'date' | 'dishes';

export const AddHomeMealModal: React.FC = () => {
  const {
    homeMealModalOpen, homeMealModalData, closeHomeMealModal,
    createHomeMeal, updateHomeMeal, deleteHomeMeal,
  } = useLists();
  const { phoneMode } = useSettings();

  const existing = homeMealModalData;

  const [mealName, setMealName] = useState('');
  const [score, setScore] = useState(7);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldMakeAgain, setWouldMakeAgain] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [dishes, setDishes] = useState<HomeMealDish[]>([]);
  const [isPublic, setIsPublic] = useState(false);

  // Dish editing state
  const [editingDishId, setEditingDishId] = useState<string | null>(null);
  const [dishName, setDishName] = useState('');
  const [dishDescription, setDishDescription] = useState('');
  const [dishPhoto, setDishPhoto] = useState('');
  const [confirmDishDelete, setConfirmDishDelete] = useState(false);

  const [tagSearch, setTagSearch] = useState('');
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const [page, setPage] = useState<Page>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dishPhotoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (homeMealModalOpen) {
      setMealName(existing?.name ?? '');
      setScore(existing?.score ?? 7);
      setNotes(existing?.description ?? '');
      setVisitDate(existing?.date ?? new Date().toISOString().slice(0, 10));
      setWouldMakeAgain(existing?.wouldMakeAgain ?? true);
      setSelectedTags(existing?.tags ?? []);
      setPhotos(existing?.photos ?? []);
      setDishes(existing?.dishes ?? []);
      setIsPublic(existing?.isPublic ?? false);
      setEditingDishId(null);
      setDishName('');
      setDishDescription('');
      setDishPhoto('');
      setConfirmDishDelete(false);
      setTagSearch('');
      setPage('main');
      setConfirmDelete(false);
    }
  }, [homeMealModalOpen, existing]);

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = document.createElement('img');
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 800;
          let { width, height } = img;
          if (width > maxSize || height > maxSize) {
            if (width > height) { height = (height / width) * maxSize; width = maxSize; }
            else { width = (width / height) * maxSize; height = maxSize; }
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const totalFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (totalFiles.length === 0) return;

    const newPhotos: PhotoItem[] = [];
    for (const file of totalFiles) {
      try {
        const compressed = await compressImage(file);
        newPhotos.push({ url: compressed, caption: '', isFavorite: false });
      } catch { /* skip failed photos */ }
    }
    setPhotos((prev) => {
      const updated = [...prev, ...newPhotos];
      setTimeout(() => setPage('photos'), 0);
      return updated;
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

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);

  const handlePhotosClick = () => {
    if (photos.length === 0) {
      fileInputRef.current?.click();
    } else {
      setPage('photos');
    }
  };

  const handleDishPhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = Array.from(files).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setDishPhoto(compressed);
    } catch { /* skip */ }
    e.target.value = '';
  };

  const openDishPage = (dish?: HomeMealDish) => {
    if (dish) {
      setEditingDishId(dish.id);
      setDishName(dish.name);
      setDishDescription(dish.description);
      setDishPhoto(dish.photo);
    } else {
      setEditingDishId(null);
      setDishName('');
      setDishDescription('');
      setDishPhoto('');
    }
    setConfirmDishDelete(false);
    setPage('dishes');
  };

  const handleSaveDish = () => {
    if (!dishName.trim()) return;
    if (editingDishId) {
      setDishes((prev) => prev.map((d) => d.id === editingDishId
        ? { ...d, name: dishName.trim(), description: dishDescription, photo: dishPhoto }
        : d
      ));
    } else {
      const newDish: HomeMealDish = {
        id: crypto.randomUUID(),
        name: dishName.trim(),
        description: dishDescription,
        photo: dishPhoto,
        recipeLink: '',
      };
      setDishes((prev) => [...prev, newDish]);
    }
    setPage('main');
  };

  const handleDeleteDish = () => {
    if (editingDishId) {
      setDishes((prev) => prev.filter((d) => d.id !== editingDishId));
    }
    setPage('main');
  };

  const handleSave = () => {
    if (!mealName.trim()) return;
    if (existing) {
      updateHomeMeal(existing.id, {
        name: mealName.trim(),
        date: visitDate,
        score,
        wouldMakeAgain,
        description: notes,
        photos,
        tags: selectedTags,
        dishes,
        isPublic,
      });
    } else {
      createHomeMeal({
        name: mealName.trim(),
        date: visitDate,
        score,
        wouldMakeAgain,
        description: notes,
        photos,
        tags: selectedTags,
        dishes,
        isPublic,
      });
    }
    closeHomeMealModal();
  };

  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

  const hasDishes = dishes.length > 0;
  const hasNotes = notes.trim().length > 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasDate = visitDate !== '';
  const dateLabel = hasDate ? new Date(visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined;

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return HOME_COOKING_TAGS;
    const q = tagSearch.toLowerCase();
    return HOME_COOKING_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagSearch]);

  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;

  return (
    <AnimatePresence>
      {homeMealModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeHomeMealModal}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-full rounded-none"
                : "h-full sm:max-w-md sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl"
            )}
          >
            {photoInput}
            <input ref={dishPhotoInputRef} type="file" accept="image/*" onChange={handleDishPhotoUpload} className="hidden" />
            <AnimatePresence mode="wait">
              {/* ═══════════ MAIN PAGE ═══════════ */}
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col flex-1 min-h-0">
                  <div className="px-5 pt-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <div className="min-w-0">
                      <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Update Meal' : 'Log Home Meal'}</h2>
                      {existing && <p className="text-xs text-on-surface/40 truncate">{existing.name}</p>}
                    </div>
                    <button onClick={closeHomeMealModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
                    {/* Meal name input */}
                    <div className="mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Meal Name</p>
                      <input
                        type="text"
                        value={mealName}
                        onChange={(e) => setMealName(e.target.value)}
                        placeholder="e.g. Sunday Pasta Night"
                        autoFocus
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    {/* Score circle + slider */}
                    <div className="flex flex-col items-center pt-1 sm:pt-3">
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

                      {/* Would make again toggle */}
                      <div className="w-full max-w-[260px] mb-5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 text-center mb-2">Would you make it again?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setWouldMakeAgain(true)} className={cn("flex-1 py-2 rounded-xl text-sm font-semibold border transition-all", wouldMakeAgain ? "bg-green-50 border-green-200 text-green-700" : "bg-white border-on-surface/10 text-on-surface/40")}>Yes!</button>
                          <button onClick={() => setWouldMakeAgain(false)} className={cn("flex-1 py-2 rounded-xl text-sm font-semibold border transition-all", !wouldMakeAgain ? "bg-red-50 border-red-200 text-red-600" : "bg-white border-on-surface/10 text-on-surface/40")}>Nah</button>
                        </div>
                      </div>
                    </div>

                    {/* Dishes section */}
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <div className="flex items-center justify-between mb-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35">Dishes</p>
                        <button
                          onClick={() => openDishPage()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                        >
                          <Plus size={14} />
                          Add Dish
                        </button>
                      </div>
                      {hasDishes ? (
                        <div className="space-y-1.5">
                          {dishes.map((dish) => (
                            <button key={dish.id} onClick={() => openDishPage(dish)}
                              className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-on-surface/8 bg-white hover:border-on-surface/15 transition-all text-left">
                              {dish.photo ? (
                                <img src={dish.photo} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-10 h-10 rounded-lg bg-on-surface/5 flex items-center justify-center flex-shrink-0">
                                  <UtensilsCrossed size={16} className="text-on-surface/20" />
                                </div>
                              )}
                              <span className="text-sm font-medium text-on-surface/70 flex-1 truncate">{dish.name}</span>
                              <ChevronRight size={14} className="text-on-surface/20 flex-shrink-0" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3 px-3.5 py-4 rounded-xl border border-dashed border-on-surface/10 bg-on-surface/2">
                          <UtensilsCrossed size={18} className="text-on-surface/20" />
                          <p className="text-xs text-on-surface/30">No dishes added</p>
                        </div>
                      )}
                    </div>

                    {/* Detail buttons */}
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2.5">Add details</p>
                      <div className="space-y-2">
                        <DetailBtn icon={<StickyNote size={17} />} label="Notes" active={hasNotes} sub={hasNotes ? notes.slice(0, 15) + '...' : undefined} onClick={() => setPage('notes')} />
                        <DetailBtn icon={<CalendarDays size={17} />} label="Date" active={hasDate} sub={dateLabel} onClick={() => setPage('date')} />
                        <DetailBtn icon={<Tag size={17} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
                        <DetailBtn icon={<Image size={17} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={handlePhotosClick} />
                      </div>
                    </div>

                    {/* Public/Private toggle */}
                    <div className="border-t border-on-surface/6 pt-3 pb-1">
                      <button
                        onClick={() => setIsPublic(!isPublic)}
                        className={cn("w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all text-left",
                          isPublic ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15"
                        )}
                      >
                        <span className={cn("flex-shrink-0", isPublic ? "text-primary" : "text-on-surface/30")}>
                          {isPublic ? <Globe size={17} /> : <Lock size={17} />}
                        </span>
                        <span className={cn("text-xs font-semibold flex-1", isPublic ? "text-primary" : "text-on-surface/50")}>
                          {isPublic ? 'Public' : 'Private'}
                        </span>
                        <span className="text-[11px] text-on-surface/30">
                          {isPublic ? 'Visible to friends' : 'Only you can see this'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface space-y-2">
                    <button
                      onClick={handleSave}
                      disabled={!mealName.trim()}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-40"
                    >
                      {existing ? 'Update Meal' : 'Save Meal'}
                    </button>
                    {existing && !confirmDelete && (
                      <button onClick={() => setConfirmDelete(true)}
                        className="w-full py-2.5 text-red-400 text-xs font-semibold hover:text-red-500 transition-colors">
                        Delete Meal
                      </button>
                    )}
                    {existing && confirmDelete && (
                      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 font-medium">Delete this meal?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                          <button onClick={() => { if (existing) { deleteHomeMeal(existing.id); } closeHomeMealModal(); }} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
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
                      placeholder="How did it turn out? Any changes you'd make next time?" rows={8} autoFocus
                      className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                  </div>
                  <BottomBtn label={hasNotes ? 'Update Notes' : 'Save Notes'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ DATE ═══════════ */}
              {page === 'date' && (
                <SubPage key="date" onBack={() => setPage('main')} title="Date Cooked">
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5">
                    <Calendar value={visitDate} onChange={setVisitDate} onClear={() => setVisitDate('')} />
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ DISHES ═══════════ */}
              {page === 'dishes' && (
                <SubPage key="dishes" onBack={() => setPage('main')} title={editingDishId ? 'Edit Dish' : 'Add Dish'}>
                  <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 space-y-4">
                    {/* Dish name */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Dish Name</p>
                      <input
                        type="text"
                        value={dishName}
                        onChange={(e) => setDishName(e.target.value)}
                        placeholder="e.g. Spaghetti Carbonara"
                        autoFocus
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>

                    {/* Description */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Description</p>
                      <textarea
                        value={dishDescription}
                        onChange={(e) => setDishDescription(e.target.value)}
                        placeholder="How did it turn out? What would you change next time?"
                        rows={4}
                        className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed"
                      />
                    </div>

                    {/* Photo */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Photo</p>
                      {dishPhoto ? (
                        <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-on-surface/10">
                          <img src={dishPhoto} alt="" className="w-full h-full object-cover" />
                          <div className="absolute top-2 right-2 flex gap-1.5">
                            <button onClick={() => dishPhotoInputRef.current?.click()}
                              className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                              <Camera size={14} className="text-white" />
                            </button>
                            <button onClick={() => setDishPhoto('')}
                              className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                              <X size={14} className="text-white" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => dishPhotoInputRef.current?.click()}
                          className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed border-on-surface/10 bg-on-surface/2 hover:border-on-surface/20 transition-colors">
                          <Camera size={24} className="text-on-surface/25" />
                          <span className="text-xs font-medium text-on-surface/35">Add a photo</span>
                        </button>
                      )}
                    </div>

                    {/* Link Recipe (coming soon) */}
                    <div>
                      <button disabled
                        className="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-on-surface/8 bg-on-surface/3 text-left opacity-50 cursor-not-allowed">
                        <LinkIcon size={17} className="text-on-surface/25 flex-shrink-0" />
                        <span className="text-xs font-semibold text-on-surface/40 flex-1">Link Recipe (coming soon)</span>
                      </button>
                    </div>

                    {/* Delete dish */}
                    {editingDishId && !confirmDishDelete && (
                      <button onClick={() => setConfirmDishDelete(true)}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-red-400 text-xs font-semibold hover:text-red-500 transition-colors">
                        <Trash2 size={14} />
                        Delete Dish
                      </button>
                    )}
                    {editingDishId && confirmDishDelete && (
                      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 font-medium">Delete this dish?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmDishDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                          <button onClick={handleDeleteDish} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                  <BottomBtn label={editingDishId ? 'Update Dish' : 'Add Dish'} onClick={handleSaveDish} disabled={!dishName.trim()} />
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
                    {filteredTags.length === 0 && <p className="text-center py-8 text-sm text-on-surface/30">No tags match &ldquo;{tagSearch}&rdquo;</p>}
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
                                <span className="text-on-surface/40">Mark as favorite:</span>
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
    className={cn("w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all text-left",
      active ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15"
    )}>
    <span className={cn("flex-shrink-0", active ? "text-primary" : "text-on-surface/30")}>{icon}</span>
    <span className={cn("text-xs font-semibold flex-1", active ? "text-primary" : "text-on-surface/50")}>{label}</span>
    {sub && <span className="text-[11px] text-primary/60 flex-shrink-0">{sub}</span>}
    <ChevronRight size={14} className="text-on-surface/20 flex-shrink-0" />
  </button>
);

const SubPage: React.FC<{
  children: React.ReactNode; onBack: () => void; title: string; rightAction?: React.ReactNode;
}> = ({ children, onBack, title, rightAction }) => (
  <motion.div initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col flex-1 min-h-0" onTouchMove={(e) => e.stopPropagation()}>
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

const BottomBtn: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({ label, onClick, disabled }) => (
  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
    <button onClick={onClick} disabled={disabled} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-40">{label}</button>
  </div>
);
