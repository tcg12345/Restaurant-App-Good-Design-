import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, ChevronLeft, ChevronRight, CalendarDays, Tag, StickyNote, Image, UtensilsCrossed, Globe, Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type PhotoItem } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { Calendar } from './RatingShared';

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
  const [isPublic, setIsPublic] = useState(false);

  const [page, setPage] = useState<Page>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (homeMealModalOpen) {
      setMealName(existing?.name ?? '');
      setScore(existing?.score ?? 7);
      setNotes(existing?.description ?? '');
      setVisitDate(existing?.date ?? new Date().toISOString().slice(0, 10));
      setWouldMakeAgain(existing?.wouldMakeAgain ?? true);
      setSelectedTags(existing?.tags ?? []);
      setPhotos(existing?.photos ?? []);
      setIsPublic(existing?.isPublic ?? false);
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
    setPhotos((prev) => [...prev, ...newPhotos]);
    e.target.value = '';
  };

  const handlePhotosClick = () => {
    if (photos.length === 0) {
      fileInputRef.current?.click();
    } else {
      // Sub-page coming soon — for now just open file picker
      fileInputRef.current?.click();
    }
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
        dishes: [],
        isPublic,
      });
    }
    closeHomeMealModal();
  };

  const scoreColor = score >= 8 ? 'text-green-400' : score >= 5 ? 'text-yellow-400' : 'text-red-400';
  const scoreBg = score >= 8 ? 'from-green-500/20 to-green-600/5' : score >= 5 ? 'from-yellow-500/20 to-yellow-600/5' : 'from-red-500/20 to-red-600/5';
  const scoreRing = score >= 8 ? 'ring-green-400/30' : score >= 5 ? 'ring-yellow-400/30' : 'ring-red-400/30';

  const hasNotes = notes.trim().length > 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasDate = visitDate !== '';
  const dateLabel = hasDate ? new Date(visitDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : undefined;

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

                    {/* Dishes section (placeholder) */}
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <div className="flex items-center justify-between mb-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35">Dishes</p>
                        <button
                          onClick={() => {
                            // Coming soon toast
                            const toast = document.createElement('div');
                            toast.textContent = 'Dish logging coming soon!';
                            toast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 bg-on-surface text-surface px-4 py-2 rounded-full text-sm font-medium z-[200] shadow-lg';
                            document.body.appendChild(toast);
                            setTimeout(() => toast.remove(), 2000);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
                        >
                          <Plus size={14} />
                          Add Dish
                        </button>
                      </div>
                      <div className="flex items-center gap-3 px-3.5 py-4 rounded-xl border border-dashed border-on-surface/10 bg-on-surface/2">
                        <UtensilsCrossed size={18} className="text-on-surface/20" />
                        <p className="text-xs text-on-surface/30">Add dishes you prepared — coming soon</p>
                      </div>
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

              {/* ═══════════ TAGS (placeholder — sub-page coming soon) ═══════════ */}
              {page === 'tags' && (
                <SubPage key="tags" onBack={() => setPage('main')} title="Tags">
                  <div className="px-5 py-16 flex flex-col items-center justify-center text-on-surface/30">
                    <Tag size={28} className="mb-2" />
                    <p className="text-sm font-semibold">Tags sub-page coming soon</p>
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
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

const BottomBtn: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface">
    <button onClick={onClick} className="w-full py-3 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform">{label}</button>
  </div>
);
