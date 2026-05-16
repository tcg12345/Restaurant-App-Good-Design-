/**
 * GuideCreatorSheet — multi-step wizard to create or edit a guide.
 *
 * Steps (state machine via `step`):
 *   1. type     — Restaurants vs Recipes
 *   2. seed     — From a saved list / from your rated places / search
 *                (for restaurants only; recipes have list / your recipes)
 *   3. meta     — Title, subtitle, intro, tags, cover photo
 *   4. entries  — Reorderable list of entries with inline edit
 *   5. visibility — public vs private toggle (defaulted from account)
 *   6. review   — Renders GuideDetail-style preview inline; any field
 *                 click-jumps back to the appropriate step. Footer has
 *                 Save draft + Publish.
 *
 * The same component runs in `mode='create'` from /create and
 * `mode='edit'` from /guides/:id/edit (loads the existing guide first).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ChevronRight, Plus, Trash2, BookOpen, ChefHat, Check, GripVertical, ImagePlus, Loader2, Eye, Globe, Lock, Search, ArrowUpRight, MapPin, ListChecks, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type CustomList, type RestaurantRating, type Recipe as ListRecipe } from '../contexts/ListsContext';
import { useRecipes, type Recipe as DbRecipe } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { saveGuide, type GuideEntry, type GuideType, type GuideVisibility, type Guide } from '../lib/supabase-guides';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import { scoreColor } from '../lib/score';

type Step = 'type' | 'seed' | 'meta' | 'entries' | 'visibility' | 'review';
type SeedMode = 'list' | 'rated' | 'search' | 'recipes-list' | 'recipes-my';

interface GuideCreatorSheetProps {
  open: boolean;
  onClose: () => void;
  /** Optional initial guide to edit. When provided, the wizard skips
   *  the type/seed steps and starts in review mode. */
  initialGuide?: Guide | null;
}

const newEntryId = () => `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const TAG_SUGGESTIONS = ['Date Night', 'Brunch', 'Quick', 'Cozy', 'Cocktails', 'Vegan', 'Family', 'Weeknight'];

/** Compress a File to a base64 JPEG (max 1200px, 0.7 quality). */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = document.createElement('img');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxSize = 1200;
        let { width, height } = img;
        if (width > maxSize || height > maxSize) {
          if (width > height) { height = (height / width) * maxSize; width = maxSize; }
          else { width = (width / height) * maxSize; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const GuideCreatorSheet: React.FC<GuideCreatorSheetProps> = ({ open, onClose, initialGuide }) => {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { lists, ratings, restaurantMeta, getRestaurantInfo } = useLists();
  const { myRecipes } = useRecipes();
  const { phoneMode } = useSettings();
  const { showToast } = useToast();

  // Account-privacy default — if the user's profile is public, default
  // the guide to public; otherwise private. User overrides at step 5.
  const accountIsPublic = profile?.is_public ?? true;

  const [step, setStep] = useState<Step>('type');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [type, setType] = useState<GuideType>('restaurants');
  const [seedMode, setSeedMode] = useState<SeedMode | null>(null);
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [intro, setIntro] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [coverPhoto, setCoverPhoto] = useState('');
  const [visibility, setVisibility] = useState<GuideVisibility>(accountIsPublic ? 'public' : 'private');
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dragRef = useRef<number | null>(null);

  // Reset when (re)opening.
  useEffect(() => {
    if (!open) return;
    if (initialGuide) {
      setEditingId(initialGuide.id);
      setType(initialGuide.type);
      setTitle(initialGuide.title);
      setSubtitle(initialGuide.subtitle);
      setIntro(initialGuide.intro);
      setTags(initialGuide.tags);
      setCoverPhoto(initialGuide.coverPhoto);
      setVisibility(initialGuide.visibility);
      setEntries(initialGuide.entries);
      setStep('review');
    } else {
      setEditingId(null);
      setType('restaurants');
      setSeedMode(null);
      setTitle('');
      setSubtitle('');
      setIntro('');
      setTags([]);
      setCoverPhoto('');
      setVisibility(accountIsPublic ? 'public' : 'private');
      setEntries([]);
      setStep('type');
    }
    setExpandedEntryId(null);
    setBusy(false);
  }, [open, initialGuide?.id]);

  /* ── Step helpers ─────────────────────────────────────────────── */

  const STEPS_ORDER: Step[] = ['type', 'seed', 'meta', 'entries', 'visibility', 'review'];
  const currentStepIdx = STEPS_ORDER.indexOf(step);
  const totalSteps = STEPS_ORDER.length;

  const canGoNext = () => {
    if (step === 'type') return true;
    if (step === 'seed') return seedMode !== null;
    if (step === 'meta') return title.trim().length > 0 && !!coverPhoto;
    if (step === 'entries') return entries.length > 0;
    if (step === 'visibility') return true;
    return true;
  };

  const goNext = () => {
    if (!canGoNext()) return;
    const next = STEPS_ORDER[Math.min(currentStepIdx + 1, STEPS_ORDER.length - 1)];
    setStep(next);
  };
  const goBack = () => {
    const prev = STEPS_ORDER[Math.max(currentStepIdx - 1, 0)];
    setStep(prev);
  };

  /* ── Entry assembly ───────────────────────────────────────────── */

  const addEntryFromRating = (r: RestaurantRating): GuideEntry => {
    const meta = getRestaurantInfo(r.restaurantId);
    const subtitleStr = [r.cuisine, r.price].filter(Boolean).join(' · ');
    return {
      id: newEntryId(),
      refId: r.restaurantId,
      name: r.name,
      subtitle: subtitleStr,
      image: r.photos?.[0]?.url || r.image || '',
      score: r.score,
      neighborhood: meta?.neighborhood,
      hours: meta?.hours?.[0]?.split(': ')[1],
    };
  };

  const addEntryFromPlace = (p: PlaceResult): GuideEntry => ({
    id: newEntryId(),
    refId: p.id,
    name: p.name,
    subtitle: [p.types?.[0]?.replace(/_/g, ' '), priceLevelToString(p.priceLevel)].filter(Boolean).join(' · '),
    image: p.photoUrl || '',
    score: undefined,
  });

  const addEntryFromListRecipe = (r: ListRecipe): GuideEntry => ({
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    image: r.coverPhoto || r.photos?.[0]?.url || '',
    score: r.score,
    totalTime: (r.prepTime || 0) + (r.cookTime || 0),
    difficulty: r.difficulty,
  });

  const addEntryFromDbRecipe = (r: DbRecipe): GuideEntry => ({
    id: newEntryId(),
    refId: r.id,
    name: r.title,
    subtitle: [r.cuisine, r.difficulty].filter(Boolean).join(' · '),
    image: r.photos?.[0] || '',
    score: undefined,
    totalTime: (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0),
    difficulty: r.difficulty,
  });

  /* ── Cover photo upload ───────────────────────────────────────── */

  const coverInputRef = useRef<HTMLInputElement>(null);
  const onPickCoverFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const b64 = await compressImage(file);
      setCoverPhoto(b64);
    } catch (err) {
      console.warn('[Guide] cover compress failed', err);
      showToast("Couldn't read that image");
    } finally {
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  /* ── Save / publish ───────────────────────────────────────────── */

  const persist = async (publish: boolean): Promise<Guide | null> => {
    if (!user?.id) return null;
    setBusy(true);
    const saved = await saveGuide(user.id, {
      ...(editingId ? { id: editingId } : {}),
      type,
      title: title.trim(),
      subtitle: subtitle.trim(),
      intro: intro.trim(),
      coverPhoto,
      tags,
      visibility,
      isPublished: publish,
      entries,
    });
    setBusy(false);
    if (!saved) {
      showToast("Couldn't save guide");
      return null;
    }
    setEditingId(saved.id);
    return saved;
  };

  const onSaveDraft = async () => {
    const saved = await persist(false);
    if (saved) showToast('Draft saved');
  };

  const onPublish = async () => {
    if (!title.trim()) { showToast('Add a title first'); setStep('meta'); return; }
    if (!coverPhoto) { showToast('Pick a cover photo'); setStep('meta'); return; }
    if (entries.length === 0) { showToast('Add at least one entry'); setStep('entries'); return; }
    const saved = await persist(true);
    if (saved) {
      showToast('Guide published');
      onClose();
      navigate(`/guides/${saved.id}`);
    }
  };

  /* ── Render ───────────────────────────────────────────────────── */

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="guide-creator-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className={cn(
          'fixed inset-0 bg-black/55 backdrop-blur-sm z-[120] flex justify-center',
          phoneMode ? 'items-end' : 'items-end sm:items-center',
        )}
        onClick={onClose}
      >
        <motion.div
          key="guide-creator-sheet"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'bg-[#f4f2ec] w-full overflow-hidden flex flex-col text-on-surface',
            phoneMode
              ? 'h-[94%] rounded-t-3xl'
              : 'h-[94%] sm:max-w-3xl sm:max-h-[94vh] sm:h-auto rounded-t-3xl sm:rounded-3xl',
          )}
        >
          {/* Header */}
          <div className="px-5 pt-4 pb-3 flex items-center justify-between gap-3 border-b border-on-surface/[0.08] flex-shrink-0 bg-[#fbfaf6]">
            <div className="flex items-center gap-2 min-w-0">
              {step !== 'type' && step !== 'review' && (
                <button
                  type="button"
                  onClick={() => {
                    // In a seed subpage, the header back returns to the
                    // source picker rather than jumping back a whole step.
                    if (step === 'seed' && seedMode !== null) setSeedMode(null);
                    else goBack();
                  }}
                  className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65 flex-shrink-0"
                  aria-label="Back"
                >
                  <ArrowLeft size={17} />
                </button>
              )}
              <div className="min-w-0">
                <h2 className="font-serif font-bold text-lg leading-tight truncate">
                  {editingId ? 'Edit guide' : 'New guide'}
                </h2>
                <p className="text-[11px] text-on-surface/45 mt-0.5">Step {currentStepIdx + 1} of {totalSteps} · {step.charAt(0).toUpperCase() + step.slice(1)}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 flex items-center justify-center text-on-surface/65 flex-shrink-0"
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </div>

          {/* Progress */}
          <div className="h-1 bg-on-surface/[0.06] flex-shrink-0">
            <div
              className="h-full bg-primary transition-all duration-300"
              style={{ width: `${((currentStepIdx + 1) / totalSteps) * 100}%` }}
            />
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className="px-5 sm:px-8 py-6"
              >
                {step === 'type' && (
                  <StepType type={type} onChange={setType} />
                )}
                {step === 'seed' && (
                  <StepSeed
                    type={type}
                    seedMode={seedMode}
                    onPick={setSeedMode}
                    lists={lists}
                    ratings={ratings}
                    myRecipes={myRecipes}
                    onAddRestaurants={(rs) => {
                      setEntries((prev) => {
                        const have = new Set(prev.map((e) => e.refId));
                        const additions = rs.filter((r) => !have.has(r.restaurantId)).map(addEntryFromRating);
                        return [...prev, ...additions];
                      });
                    }}
                    onAddRestaurantsFromList={(l) => {
                      const fromList = l.restaurantIds.map((rid) => {
                        const r = ratings.find((rr) => rr.restaurantId === rid);
                        const meta = restaurantMeta[rid];
                        if (r) return addEntryFromRating(r);
                        if (meta) {
                          return {
                            id: newEntryId(),
                            refId: rid,
                            name: meta.name,
                            subtitle: [meta.cuisine, meta.price].filter(Boolean).join(' · '),
                            image: meta.image || '',
                            neighborhood: meta.neighborhood,
                            score: l.listRatings?.[rid]?.score,
                          } as GuideEntry;
                        }
                        return null;
                      }).filter((e): e is GuideEntry => !!e);
                      setEntries((prev) => {
                        const have = new Set(prev.map((e) => e.refId));
                        return [...prev, ...fromList.filter((e) => !have.has(e.refId))];
                      });
                    }}
                    onAddPlaces={(ps) => {
                      setEntries((prev) => {
                        const have = new Set(prev.map((e) => e.refId));
                        return [...prev, ...ps.filter((p) => !have.has(p.id)).map(addEntryFromPlace)];
                      });
                    }}
                    onAddListRecipes={(rs) => {
                      setEntries((prev) => {
                        const have = new Set(prev.map((e) => e.refId));
                        return [...prev, ...rs.filter((r) => !have.has(r.id)).map(addEntryFromListRecipe)];
                      });
                    }}
                    onAddDbRecipes={(rs) => {
                      setEntries((prev) => {
                        const have = new Set(prev.map((e) => e.refId));
                        return [...prev, ...rs.filter((r) => !have.has(r.id)).map(addEntryFromDbRecipe)];
                      });
                    }}
                    onRemoveByRefId={(refId) => setEntries((prev) => prev.filter((e) => e.refId !== refId))}
                    addedRefIds={new Set(entries.map((e) => e.refId))}
                  />
                )}
                {step === 'meta' && (
                  <StepMeta
                    title={title}
                    subtitle={subtitle}
                    intro={intro}
                    tags={tags}
                    coverPhoto={coverPhoto}
                    entries={entries}
                    onTitle={setTitle}
                    onSubtitle={setSubtitle}
                    onIntro={setIntro}
                    onToggleTag={(t) => setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])}
                    onAddTag={(t) => setTags((prev) => prev.includes(t) ? prev : [...prev, t])}
                    onRemoveTag={(t) => setTags((prev) => prev.filter((x) => x !== t))}
                    onPickCoverFromFile={() => coverInputRef.current?.click()}
                    onPickCoverFromEntry={(img) => setCoverPhoto(img)}
                  />
                )}
                {step === 'entries' && (
                  <StepEntries
                    type={type}
                    entries={entries}
                    expandedId={expandedEntryId}
                    onToggleExpand={(id) => setExpandedEntryId((prev) => prev === id ? null : id)}
                    onRemove={(id) => setEntries((prev) => prev.filter((e) => e.id !== id))}
                    onPatch={(id, patch) => setEntries((prev) => prev.map((e) => e.id === id ? { ...e, ...patch } : e))}
                    onMove={(from, to) => setEntries((prev) => {
                      const next = [...prev];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      return next;
                    })}
                    onAddMore={() => setStep('seed')}
                    dragRef={dragRef}
                  />
                )}
                {step === 'visibility' && (
                  <StepVisibility
                    visibility={visibility}
                    onChange={setVisibility}
                    accountIsPublic={accountIsPublic}
                  />
                )}
                {step === 'review' && (
                  <StepReview
                    type={type}
                    title={title}
                    subtitle={subtitle}
                    intro={intro}
                    coverPhoto={coverPhoto}
                    tags={tags}
                    entries={entries}
                    visibility={visibility}
                    onEditField={(target) => {
                      if (target === 'cover' || target === 'title' || target === 'intro' || target === 'tags') setStep('meta');
                      else if (target === 'entries') setStep('entries');
                      else if (target === 'visibility') setStep('visibility');
                    }}
                    onEditEntry={(id) => { setExpandedEntryId(id); setStep('entries'); }}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Footer */}
          <div className="border-t border-on-surface/[0.08] px-5 sm:px-8 py-3 bg-[#fbfaf6] flex items-center gap-2 flex-shrink-0">
            {step === 'review' ? (
              <>
                <button
                  type="button"
                  onClick={onSaveDraft}
                  disabled={busy}
                  className="px-4 h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold inline-flex items-center justify-center gap-2 hover:bg-on-surface/10 disabled:opacity-50"
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Save draft
                </button>
                <button
                  type="button"
                  onClick={onPublish}
                  disabled={busy || entries.length === 0 || !title.trim() || !coverPhoto}
                  className={cn(
                    'flex-1 h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                    busy || entries.length === 0 || !title.trim() || !coverPhoto
                      ? 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed'
                      : 'bg-primary text-white hover:bg-primary/90',
                  )}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  Publish
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={goNext}
                disabled={!canGoNext()}
                className={cn(
                  'w-full h-11 rounded-full text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors',
                  canGoNext() ? 'bg-primary text-white hover:bg-primary/90' : 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed',
                )}
              >
                {step === 'visibility' ? 'Review' : 'Continue'}
                <ChevronRight size={14} />
              </button>
            )}
          </div>

          <input
            ref={coverInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickCoverFile}
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

/* ── Step: Type ───────────────────────────────────────────────────── */

const StepType: React.FC<{ type: GuideType; onChange: (t: GuideType) => void }> = ({ type, onChange }) => (
  <div className="max-w-xl mx-auto">
    <h3 className="font-serif font-bold text-[24px] leading-tight mb-1">What kind of guide?</h3>
    <p className="text-on-surface/55 text-sm mb-6">You can mix types in a future guide — for now, each guide focuses on one.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {([
        { key: 'restaurants' as const, label: 'Restaurants', icon: <BookOpen size={26} />, blurb: 'Curate places you love or want to share.' },
        { key: 'recipes' as const, label: 'Recipes', icon: <ChefHat size={26} />, blurb: 'Build a cookbook chapter from your saved recipes.' },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            'p-5 rounded-2xl text-left transition-all border-2',
            type === opt.key
              ? 'border-primary bg-primary/[0.04]'
              : 'border-on-surface/10 bg-[#fbfaf6] hover:border-on-surface/25',
          )}
        >
          <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center mb-3', type === opt.key ? 'bg-primary text-white' : 'bg-on-surface/[0.06] text-on-surface/65')}>
            {opt.icon}
          </div>
          <p className="font-serif font-bold text-[18px] mb-0.5">{opt.label}</p>
          <p className="text-[12.5px] text-on-surface/55 leading-snug">{opt.blurb}</p>
        </button>
      ))}
    </div>
  </div>
);

/* ── Step: Seed ───────────────────────────────────────────────────── */

const StepSeed: React.FC<{
  type: GuideType;
  seedMode: SeedMode | null;
  onPick: (m: SeedMode | null) => void;
  lists: CustomList[];
  ratings: RestaurantRating[];
  myRecipes: DbRecipe[];
  onAddRestaurants: (rs: RestaurantRating[]) => void;
  onAddRestaurantsFromList: (l: CustomList) => void;
  onAddPlaces: (ps: PlaceResult[]) => void;
  onAddListRecipes: (rs: ListRecipe[]) => void;
  onAddDbRecipes: (rs: DbRecipe[]) => void;
  onRemoveByRefId: (refId: string) => void;
  addedRefIds: Set<string>;
}> = ({ type, seedMode, onPick, lists, ratings, myRecipes, onAddRestaurants, onAddRestaurantsFromList, onAddPlaces, onAddListRecipes, onAddDbRecipes, onRemoveByRefId, addedRefIds }) => {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importedListIds, setImportedListIds] = useState<Set<string>>(new Set());

  // Filter lists that match the chosen type:
  // restaurants → default lists with restaurantIds
  // recipes → home-cooking lists with recipes
  const relevantLists = type === 'restaurants'
    ? lists.filter((l) => (l.restaurantIds?.length || 0) > 0)
    : lists.filter((l) => l.type === 'home-cooking' && (l.recipes?.length || 0) > 0);

  const runSearch = async () => {
    if (!searchQ.trim()) return;
    setSearching(true);
    try {
      // No precise location available inside the wizard — bias broadly
      // around NYC (consistent with the rest of the app's default).
      const results = await searchPlacesByText(searchQ.trim(), 40.7128, -74.0060);
      setSearchResults(results.slice(0, 10));
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const seedOptions: { key: SeedMode; label: string; blurb: string; icon: React.ReactNode }[] =
    type === 'restaurants'
      ? [
          { key: 'list', label: 'From an existing list', blurb: 'Import every place from one of your saved lists.', icon: <ListChecks size={20} /> },
          { key: 'rated', label: 'From your rated places', blurb: 'Hand-pick from restaurants you\'ve already scored.', icon: <Star size={20} /> },
          { key: 'search', label: 'Search the database', blurb: 'Add any restaurant by name.', icon: <Search size={20} /> },
        ]
      : [
          { key: 'recipes-list', label: 'From a home-cooking list', blurb: 'Import every recipe from one of your home-cooking lists.', icon: <ListChecks size={20} /> },
          { key: 'recipes-my', label: 'From your recipes', blurb: 'Hand-pick from recipes you\'ve created.', icon: <ChefHat size={20} /> },
        ];

  // ── Source picker ────────────────────────────────────────────────
  if (!seedMode) {
    return (
      <div className="max-w-2xl mx-auto">
        <h3 className="font-serif font-bold text-[24px] leading-tight mb-1">Add some entries</h3>
        <p className="text-on-surface/55 text-sm mb-5">Pick a source — you can keep adding from other sources later.</p>

        <div className="grid grid-cols-1 gap-2">
          {seedOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onPick(o.key)}
              className="flex items-center gap-3 p-3.5 rounded-2xl text-left transition-all border-2 border-on-surface/10 bg-[#fbfaf6] hover:border-on-surface/25"
            >
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-on-surface/[0.06] text-on-surface/65">
                {o.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-[14px]">{o.label}</p>
                <p className="text-[12px] text-on-surface/55 truncate">{o.blurb}</p>
              </div>
              <ChevronRight size={14} className="text-on-surface/30" />
            </button>
          ))}
        </div>

        {addedRefIds.size > 0 && (
          <p className="mt-5 text-[12px] text-on-surface/55 text-center">
            {addedRefIds.size} entr{addedRefIds.size === 1 ? 'y' : 'ies'} added so far · Continue to edit details.
          </p>
        )}
      </div>
    );
  }

  // ── Subpage header (shared) ──────────────────────────────────────
  const subpageHeader = (label: string) => (
    <div className="flex items-center gap-2 mb-4">
      <button
        type="button"
        onClick={() => onPick(null)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/10 text-on-surface/75 text-[12px] font-bold"
      >
        <ArrowLeft size={13} />
        Back
      </button>
      <h3 className="font-serif font-bold text-[20px] leading-tight">{label}</h3>
    </div>
  );

  // ── Subpage: From a list ─────────────────────────────────────────
  if (seedMode === 'list') {
    return (
      <div className="max-w-2xl mx-auto">
        {subpageHeader('Your lists')}
        {relevantLists.length === 0 ? (
          <p className="text-sm text-on-surface/55 px-1">You don't have any lists with places yet.</p>
        ) : (
          <ul className="space-y-2">
            {relevantLists.map((l) => {
              const isImported = importedListIds.has(l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onAddRestaurantsFromList(l);
                      setImportedListIds((prev) => {
                        const next = new Set(prev);
                        next.add(l.id);
                        return next;
                      });
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#fbfaf6] border border-on-surface/[0.08] hover:bg-on-surface/[0.04] text-left transition-colors"
                  >
                    <span className="text-2xl">{l.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{l.name}</span>
                      <span className="block text-[11px] text-on-surface/50">{l.restaurantIds.length} places</span>
                    </span>
                    {isImported ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                        <Check size={12} strokeWidth={3} />
                        Imported
                      </span>
                    ) : (
                      <Plus size={16} className="text-on-surface/40" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── Subpage: From your rated places ──────────────────────────────
  if (seedMode === 'rated') {
    return (
      <div className="max-w-2xl mx-auto">
        {subpageHeader('Your rated places')}
        {ratings.length === 0 ? (
          <p className="text-sm text-on-surface/55 px-1">You haven't rated any places yet.</p>
        ) : (
          <ul className="space-y-1">
            {ratings.map((r) => {
              const isAdded = addedRefIds.has(r.restaurantId);
              return (
                <li key={r.restaurantId}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdded) onRemoveByRefId(r.restaurantId);
                      else onAddRestaurants([r]);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors border',
                      isAdded
                        ? 'bg-primary/[0.06] border-primary/30'
                        : 'bg-[#fbfaf6] border-on-surface/[0.08] hover:bg-on-surface/[0.04]',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <p className="text-[11px] text-on-surface/50 truncate">{[r.cuisine, r.price].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span className={cn('text-[13px] font-bold tabular-nums flex-shrink-0', scoreColor(r.score))}>{r.score.toFixed(1)}</span>
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 transition-colors',
                        isAdded ? 'bg-primary text-white' : 'border border-on-surface/20 text-on-surface/40',
                      )}
                      aria-label={isAdded ? 'Added — tap to remove' : 'Add'}
                    >
                      {isAdded ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── Subpage: Search the database ─────────────────────────────────
  if (seedMode === 'search') {
    return (
      <div className="max-w-2xl mx-auto">
        {subpageHeader('Search restaurants')}
        <div className="flex items-center gap-2 rounded-full bg-[#fbfaf6] border border-on-surface/[0.1] px-3 h-11 mb-4">
          <Search size={15} className="text-on-surface/45" />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runSearch(); }}
            placeholder="Search any restaurant…"
            autoFocus
            className="flex-1 bg-transparent text-sm focus:outline-none"
          />
          <button
            type="button"
            onClick={runSearch}
            disabled={searching || !searchQ.trim()}
            className="px-3 py-1.5 rounded-full bg-primary text-white text-[12px] font-bold disabled:opacity-50"
          >
            {searching ? <Loader2 size={11} className="animate-spin" /> : 'Search'}
          </button>
        </div>
        <ul className="space-y-1">
          {searchResults.map((p) => {
            const isAdded = addedRefIds.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (isAdded) onRemoveByRefId(p.id);
                    else onAddPlaces([p]);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors border',
                    isAdded
                      ? 'bg-primary/[0.06] border-primary/30'
                      : 'bg-[#fbfaf6] border-on-surface/[0.08] hover:bg-on-surface/[0.04]',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{p.name}</p>
                    <p className="text-[11px] text-on-surface/50 truncate">{p.address}</p>
                  </div>
                  <span
                    className={cn(
                      'inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 transition-colors',
                      isAdded ? 'bg-primary text-white' : 'border border-on-surface/20 text-on-surface/40',
                    )}
                  >
                    {isAdded ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
                  </span>
                </button>
              </li>
            );
          })}
          {searchResults.length === 0 && !searching && searchQ.trim() && (
            <li className="text-sm text-on-surface/45 text-center py-6">No results — try a different query.</li>
          )}
          {searchResults.length === 0 && !searching && !searchQ.trim() && (
            <li className="text-sm text-on-surface/45 text-center py-10">Start typing to find restaurants.</li>
          )}
        </ul>
      </div>
    );
  }

  // ── Subpage: From a recipes list ─────────────────────────────────
  if (seedMode === 'recipes-list') {
    return (
      <div className="max-w-2xl mx-auto">
        {subpageHeader('Your home-cooking lists')}
        {relevantLists.length === 0 ? (
          <p className="text-sm text-on-surface/55 px-1">No home-cooking lists yet. Add recipes in Pantry first.</p>
        ) : (
          <ul className="space-y-2">
            {relevantLists.map((l) => {
              const isImported = importedListIds.has(l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (l.recipes) onAddListRecipes(l.recipes);
                      setImportedListIds((prev) => {
                        const next = new Set(prev);
                        next.add(l.id);
                        return next;
                      });
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl bg-[#fbfaf6] border border-on-surface/[0.08] hover:bg-on-surface/[0.04] text-left transition-colors"
                  >
                    <span className="text-2xl">{l.emoji}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{l.name}</span>
                      <span className="block text-[11px] text-on-surface/50">{l.recipes?.length || 0} recipes</span>
                    </span>
                    {isImported ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-primary">
                        <Check size={12} strokeWidth={3} />
                        Imported
                      </span>
                    ) : (
                      <Plus size={16} className="text-on-surface/40" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  // ── Subpage: From your recipes ───────────────────────────────────
  if (seedMode === 'recipes-my') {
    return (
      <div className="max-w-2xl mx-auto">
        {subpageHeader('Your recipes')}
        {myRecipes.length === 0 ? (
          <p className="text-sm text-on-surface/55 px-1">You haven't created any recipes yet.</p>
        ) : (
          <ul className="space-y-1">
            {myRecipes.map((r) => {
              const isAdded = addedRefIds.has(r.id);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isAdded) onRemoveByRefId(r.id);
                      else onAddDbRecipes([r]);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-left transition-colors border',
                      isAdded
                        ? 'bg-primary/[0.06] border-primary/30'
                        : 'bg-[#fbfaf6] border-on-surface/[0.08] hover:bg-on-surface/[0.04]',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{r.title}</p>
                      <p className="text-[11px] text-on-surface/50 truncate">{[r.cuisine, r.difficulty].filter(Boolean).join(' · ')}</p>
                    </div>
                    <span
                      className={cn(
                        'inline-flex items-center justify-center w-6 h-6 rounded-full flex-shrink-0 transition-colors',
                        isAdded ? 'bg-primary text-white' : 'border border-on-surface/20 text-on-surface/40',
                      )}
                    >
                      {isAdded ? <Check size={12} strokeWidth={3} /> : <Plus size={12} />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }

  return null;
};

/* ── Step: Meta (cover, title, intro, tags) ───────────────────────── */

const StepMeta: React.FC<{
  title: string;
  subtitle: string;
  intro: string;
  tags: string[];
  coverPhoto: string;
  entries: GuideEntry[];
  onTitle: (v: string) => void;
  onSubtitle: (v: string) => void;
  onIntro: (v: string) => void;
  onToggleTag: (t: string) => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
  onPickCoverFromFile: () => void;
  onPickCoverFromEntry: (img: string) => void;
}> = ({ title, subtitle, intro, tags, coverPhoto, entries, onTitle, onSubtitle, onIntro, onToggleTag, onAddTag, onRemoveTag, onPickCoverFromFile, onPickCoverFromEntry }) => {
  const [tagDraft, setTagDraft] = useState('');
  const entryThumbs = entries.filter((e) => !!e.image).slice(0, 8);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h3 className="font-serif font-bold text-[24px] leading-tight">The hero</h3>

      {/* Cover */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Cover photo <span className="text-primary normal-case tracking-normal">(required)</span></p>
        <div className="relative rounded-2xl overflow-hidden bg-on-surface/[0.05] aspect-[16/9]">
          {coverPhoto ? (
            <>
              <img src={coverPhoto} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
              <div className="absolute inset-x-0 bottom-0 p-3 flex gap-2 bg-gradient-to-t from-black/55 to-transparent">
                <button type="button" onClick={onPickCoverFromFile} className="px-3 py-1.5 rounded-full bg-white/95 text-on-surface text-[12px] font-bold">Replace</button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={onPickCoverFromFile}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-on-surface/55 hover:bg-on-surface/[0.04] transition-colors"
            >
              <ImagePlus size={28} />
              <span className="text-sm font-semibold">Upload from device</span>
            </button>
          )}
        </div>
        {entryThumbs.length > 0 && (
          <div className="mt-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1.5">Or pick from your entries</p>
            <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {entryThumbs.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPickCoverFromEntry(e.image)}
                  className={cn(
                    'flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden border-2 transition-colors',
                    coverPhoto === e.image ? 'border-primary' : 'border-on-surface/10 hover:border-on-surface/25',
                  )}
                >
                  <img src={e.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Title + subtitle + intro */}
      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Title <span className="text-primary normal-case tracking-normal">(required)</span></p>
        <input
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="e.g. Best Chinese Restaurants in NYC"
          maxLength={120}
          className="w-full rounded-2xl bg-[#fbfaf6] border border-on-surface/[0.1] focus:border-primary/50 outline-none px-4 py-3 text-[20px] font-serif font-bold leading-tight"
        />
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Subtitle</p>
        <input
          value={subtitle}
          onChange={(e) => onSubtitle(e.target.value)}
          placeholder="A one-line tease that sits under the title."
          maxLength={160}
          className="w-full rounded-xl bg-[#fbfaf6] border border-on-surface/[0.1] focus:border-primary/50 outline-none px-4 py-2.5 text-sm"
        />
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Intro paragraph</p>
        <textarea
          value={intro}
          onChange={(e) => onIntro(e.target.value)}
          placeholder="Set the scene — why this guide, who it's for."
          rows={4}
          maxLength={800}
          className="w-full rounded-xl bg-[#fbfaf6] border border-on-surface/[0.1] focus:border-primary/50 outline-none px-4 py-3 text-sm leading-relaxed resize-none"
        />
      </div>

      <div>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-2">Tags</p>
        <div className="flex flex-wrap gap-2 mb-2">
          {tags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onRemoveTag(t)}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 text-primary text-[12px] font-semibold"
            >
              {t}
              <X size={11} />
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const v = tagDraft.trim();
                if (v) { onAddTag(v); setTagDraft(''); }
              }
            }}
            placeholder="Add a tag (press Enter)"
            className="flex-1 rounded-full bg-[#fbfaf6] border border-on-surface/[0.1] px-4 py-2 text-[13px] focus:border-primary/50 outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {TAG_SUGGESTIONS.filter((t) => !tags.includes(t)).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onToggleTag(t)}
              className="px-2.5 py-0.5 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 text-[11px] font-semibold text-on-surface/60"
            >
              + {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Step: Entries (reorder + per-entry detail edit) ──────────────── */

const StepEntries: React.FC<{
  type: GuideType;
  entries: GuideEntry[];
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<GuideEntry>) => void;
  onMove: (from: number, to: number) => void;
  onAddMore: () => void;
  dragRef: React.MutableRefObject<number | null>;
}> = ({ type, entries, expandedId, onToggleExpand, onRemove, onPatch, onMove, onAddMore, dragRef }) => (
  <div className="max-w-2xl mx-auto">
    <div className="flex items-center justify-between mb-4">
      <div>
        <h3 className="font-serif font-bold text-[24px] leading-tight">Entries</h3>
        <p className="text-on-surface/55 text-sm mt-1">Reorder, edit details, or remove. Add more from another source if you need.</p>
      </div>
      <button
        type="button"
        onClick={onAddMore}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-on-surface/[0.06] text-on-surface text-[12px] font-bold hover:bg-on-surface/10"
      >
        <Plus size={13} />
        Add more
      </button>
    </div>

    {entries.length === 0 ? (
      <div className="rounded-2xl bg-[#fbfaf6] border border-dashed border-on-surface/15 py-10 px-6 text-center">
        <p className="text-sm text-on-surface/55">No entries yet — go back to add some.</p>
      </div>
    ) : (
      <ul className="space-y-2">
        {entries.map((entry, idx) => {
          const isExpanded = expandedId === entry.id;
          const orderedKey = type === 'restaurants' ? 'mustOrder' : 'keyIngredients';
          const orderedLabel = type === 'restaurants' ? 'Must Order' : 'Key Ingredients';
          const orderedVals = type === 'restaurants' ? entry.mustOrder : entry.keyIngredients;
          return (
            <li key={entry.id}>
              <div
                draggable
                onDragStart={() => { dragRef.current = idx; }}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={() => {
                  const from = dragRef.current;
                  if (from === null || from === idx) return;
                  onMove(from, idx);
                  dragRef.current = null;
                }}
                className={cn(
                  'rounded-2xl bg-[#fbfaf6] border border-on-surface/[0.08] overflow-hidden',
                  isExpanded && 'ring-2 ring-primary/30',
                )}
              >
                <div className="flex items-center gap-3 p-3">
                  <span className="cursor-grab text-on-surface/30 flex-shrink-0"><GripVertical size={16} /></span>
                  <span className="font-serif font-bold text-primary text-[20px] tabular-nums w-7 flex-shrink-0">{(idx + 1).toString().padStart(2, '0')}</span>
                  <div className="w-12 h-12 rounded-lg bg-on-surface/[0.05] overflow-hidden flex-shrink-0">
                    {entry.image && <img src={entry.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{entry.name}</p>
                    <p className="text-[11px] text-on-surface/50 truncate">{entry.subtitle}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleExpand(entry.id)}
                    className="px-2.5 py-1 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/10 text-[11px] font-bold"
                  >
                    {isExpanded ? 'Done' : 'Edit'}
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemove(entry.id)}
                    aria-label="Remove"
                    className="w-8 h-8 rounded-full hover:bg-red-500/10 flex items-center justify-center text-on-surface/40 hover:text-red-500"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 space-y-3 border-t border-on-surface/[0.06]">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">Score</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          max="10"
                          value={typeof entry.score === 'number' ? entry.score : ''}
                          onChange={(e) => {
                            const v = e.target.value === '' ? undefined : Math.max(0, Math.min(10, parseFloat(e.target.value)));
                            onPatch(entry.id, { score: typeof v === 'number' && Number.isFinite(v) ? v : undefined });
                          }}
                          placeholder="—"
                          className="w-20 rounded-xl bg-white border border-on-surface/[0.1] px-3 py-1.5 text-sm font-bold tabular-nums text-center"
                        />
                        <span className="text-[11px] text-on-surface/45">/ 10 · optional</span>
                      </div>
                    </div>

                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">{orderedLabel} <span className="text-on-surface/30 normal-case tracking-normal">· comma separated</span></p>
                      <input
                        value={(orderedVals || []).join(', ')}
                        onChange={(e) => onPatch(entry.id, { [orderedKey]: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } as Partial<GuideEntry>)}
                        placeholder="Cold sesame noodles, Twice-cooked pork belly"
                        className="w-full rounded-xl bg-white border border-on-surface/[0.1] px-3 py-2 text-sm focus:border-primary/50 outline-none"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">Best For</p>
                      <input
                        value={entry.bestFor || ''}
                        onChange={(e) => onPatch(entry.id, { bestFor: e.target.value })}
                        placeholder="A grown-up dinner. The room you bring your parents to."
                        className="w-full rounded-xl bg-white border border-on-surface/[0.1] px-3 py-2 text-sm focus:border-primary/50 outline-none"
                      />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-1">Insider Tip</p>
                      <input
                        value={entry.insiderTip || ''}
                        onChange={(e) => onPatch(entry.id, { insiderTip: e.target.value })}
                        placeholder="Sit upstairs by the window."
                        className="w-full rounded-xl bg-white border border-on-surface/[0.1] px-3 py-2 text-sm focus:border-primary/50 outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

/* ── Step: Visibility ─────────────────────────────────────────────── */

const StepVisibility: React.FC<{
  visibility: GuideVisibility;
  onChange: (v: GuideVisibility) => void;
  accountIsPublic: boolean;
}> = ({ visibility, onChange, accountIsPublic }) => (
  <div className="max-w-xl mx-auto">
    <h3 className="font-serif font-bold text-[24px] leading-tight mb-1">Who can see this?</h3>
    <p className="text-on-surface/55 text-sm mb-6">
      Defaults to your account setting ({accountIsPublic ? 'public' : 'private'}). You can change this anytime after publishing.
    </p>
    <div className="grid grid-cols-1 gap-3">
      {([
        { key: 'public' as const, label: 'Public', icon: <Globe size={22} />, blurb: 'Appears on Discover. Anyone with the link can read it.' },
        { key: 'private' as const, label: 'Private', icon: <Lock size={22} />, blurb: 'Only you can see it. Use this for drafts or personal lists.' },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={cn(
            'flex items-center gap-4 p-4 rounded-2xl text-left transition-all border-2',
            visibility === opt.key ? 'border-primary bg-primary/[0.04]' : 'border-on-surface/10 bg-[#fbfaf6] hover:border-on-surface/25',
          )}
        >
          <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', visibility === opt.key ? 'bg-primary text-white' : 'bg-on-surface/[0.06] text-on-surface/65')}>
            {opt.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-[15px]">{opt.label}</p>
            <p className="text-[12.5px] text-on-surface/55 leading-snug">{opt.blurb}</p>
          </div>
          <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0', visibility === opt.key ? 'bg-primary text-white' : 'border border-on-surface/20')}>
            {visibility === opt.key && <Check size={11} strokeWidth={3} />}
          </span>
        </button>
      ))}
    </div>
  </div>
);

/* ── Step: Review (mini-detail preview) ───────────────────────────── */

const StepReview: React.FC<{
  type: GuideType;
  title: string;
  subtitle: string;
  intro: string;
  coverPhoto: string;
  tags: string[];
  entries: GuideEntry[];
  visibility: GuideVisibility;
  onEditField: (target: 'cover' | 'title' | 'intro' | 'tags' | 'entries' | 'visibility') => void;
  onEditEntry: (id: string) => void;
}> = ({ type, title, subtitle, intro, coverPhoto, tags, entries, visibility, onEditField, onEditEntry }) => {
  const avg = (() => {
    const scored = entries.map((e) => e.score).filter((s): s is number => typeof s === 'number');
    if (scored.length === 0) return null;
    return (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1);
  })();

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif font-bold text-[24px] leading-tight">Review</h3>
        <p className="text-[11px] text-on-surface/45">Tap anything to edit · {visibility === 'public' ? 'Public' : 'Private'} · <button type="button" onClick={() => onEditField('visibility')} className="text-primary font-bold">Change</button></p>
      </div>

      {/* Hero preview */}
      <button
        type="button"
        onClick={() => onEditField('cover')}
        className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden bg-on-surface/[0.05] block text-left mb-4"
      >
        {coverPhoto ? (
          <img src={coverPhoto} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-on-surface/50">
            <ImagePlus size={28} />
            <span className="text-xs font-semibold mt-1">Add a cover photo</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-transparent" />
        <div className="absolute bottom-0 inset-x-0 p-4">
          <p className="text-white/75 text-[10px] font-bold uppercase tracking-[0.18em] mb-1">Guides / {type === 'recipes' ? 'Recipes' : 'Restaurants'}{tags[0] ? ` · ${tags[0]}` : ''}</p>
          <p className="text-white font-serif font-bold text-[24px] sm:text-[30px] leading-tight drop-shadow-sm">{title || 'Untitled guide'}</p>
          {subtitle && <p className="text-white/80 text-[13px] mt-1 line-clamp-2">{subtitle}</p>}
          <p className="text-white/70 text-[11px] mt-2">{entries.length} {type === 'recipes' ? 'recipes' : 'spots'}{avg ? ` · ${avg} avg` : ''}</p>
        </div>
      </button>

      <button type="button" onClick={() => onEditField('title')} className="block w-full text-left mb-4 text-[12px] text-primary font-bold">
        Edit title, subtitle, intro & tags →
      </button>

      {intro && (
        <button type="button" onClick={() => onEditField('intro')} className="block w-full text-left mb-6 rounded-xl p-3 hover:bg-on-surface/[0.04]">
          <p className="font-serif text-[16px] leading-snug text-on-surface/85 line-clamp-3">{intro}</p>
        </button>
      )}

      {tags.length > 0 && (
        <button type="button" onClick={() => onEditField('tags')} className="flex flex-wrap gap-2 mb-6 w-full text-left">
          {tags.map((t) => <span key={t} className="px-3 py-1 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/65">{t}</span>)}
        </button>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</p>
        <button type="button" onClick={() => onEditField('entries')} className="text-[12px] text-primary font-bold">Edit entries →</button>
      </div>
      <div className="space-y-4">
        {entries.map((e, idx) => (
          <button
            key={e.id}
            type="button"
            onClick={() => onEditEntry(e.id)}
            className="w-full text-left rounded-2xl bg-[#fbfaf6] border border-on-surface/[0.08] overflow-hidden hover:border-primary/30 transition-colors"
          >
            <div className="flex items-center gap-3 p-3">
              <span className="font-serif font-bold text-primary text-[24px] tabular-nums w-9 flex-shrink-0 text-center">{(idx + 1).toString().padStart(2, '0')}</span>
              <div className="w-14 h-14 rounded-lg bg-on-surface/[0.05] overflow-hidden flex-shrink-0">
                {e.image && <img src={e.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-serif font-bold text-[16px] truncate">{e.name}</p>
                <p className="text-[11px] text-on-surface/50 truncate">{e.subtitle}</p>
                {(e.bestFor || e.insiderTip || ((type === 'restaurants' ? e.mustOrder : e.keyIngredients)?.length)) && (
                  <p className="text-[11px] text-on-surface/40 mt-0.5 truncate">
                    {e.bestFor ? '· Best for · ' : ''}{(type === 'restaurants' ? e.mustOrder : e.keyIngredients)?.length ? `${(type === 'restaurants' ? e.mustOrder : e.keyIngredients)?.length} items · ` : ''}{e.insiderTip ? 'Tip ✓' : ''}
                  </p>
                )}
              </div>
              {typeof e.score === 'number' && e.score > 0 && (
                <span className={cn('font-bold tabular-nums text-[12px]', scoreColor(e.score))}>{e.score.toFixed(1)}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
