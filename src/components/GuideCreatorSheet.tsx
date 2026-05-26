/**
 * GuideCreatorSheet — multi-step wizard to create or edit a guide.
 *
 * Visual chrome mirrors the Advanced Recipe Builder: left rail (desktop)
 * with numbered step list and progress meter, or top progress strip
 * (phone), plus a sticky footer with Back / Save draft / Next or Publish.
 *
 * Steps:
 *   1. type        — Restaurants vs Recipes
 *   2. seed        — pick a source (saved list / rated places / search /
 *                    recipes-list / recipes-my). Each option opens a
 *                    sub-page (back-to-picker) to pick individual items.
 *   3. meta        — Cover, title, subtitle, intro, tags.
 *   4. entries     — Reorderable list of entries with inline detail edit.
 *   5. visibility  — Public / Private.
 *   6. review      — Mini-detail preview with click-to-edit jumps.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, ArrowRight, Plus, Trash2, BookOpen, ChefHat, Check, GripVertical, ImagePlus, Loader2, Globe, Lock, Search, ListChecks, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type CustomList, type RestaurantRating, type Recipe as ListRecipe } from '../contexts/ListsContext';
import { useRecipes, type Recipe as DbRecipe } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { saveGuide, type GuideEntry, type GuideType, type GuideVisibility, type Guide } from '../lib/supabase-guides';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../lib/places';
import './GuideCreatorSheet.css';

type Step = 'type' | 'seed' | 'meta' | 'entries' | 'visibility' | 'review';
type SeedMode = 'list' | 'rated' | 'search' | 'recipes-list' | 'recipes-my';

interface GuideCreatorSheetProps {
  open: boolean;
  onClose: () => void;
  initialGuide?: Guide | null;
}

const STEPS_ORDER: Step[] = ['type', 'seed', 'meta', 'entries', 'visibility', 'review'];
const STEP_LABELS: Record<Step, string> = {
  type: 'Type',
  seed: 'Add entries',
  meta: 'Cover & details',
  entries: 'Arrange entries',
  visibility: 'Visibility',
  review: 'Review & publish',
};
const NEXT_LABELS: Record<Exclude<Step, 'review'>, string> = {
  type: 'Add entries',
  seed: 'Cover & details',
  meta: 'Arrange entries',
  entries: 'Visibility',
  visibility: 'Review & publish',
};

const TAG_SUGGESTIONS = ['Date Night', 'Brunch', 'Quick', 'Cozy', 'Cocktails', 'Vegan', 'Family', 'Weeknight'];

const newEntryId = () => `e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

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
  const [includePhotos, setIncludePhotos] = useState(true);
  const [entries, setEntries] = useState<GuideEntry[]>([]);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { dragProps } = useBottomSheet(open, onClose);
  const dragRef = useRef<number | null>(null);

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
      setIncludePhotos(initialGuide.includePhotos);
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
      setIncludePhotos(true);
      setEntries([]);
      setStep('type');
    }
    setExpandedEntryId(null);
    setBusy(false);
  }, [open, initialGuide?.id]);

  const currentStepIdx = STEPS_ORDER.indexOf(step);
  const totalSteps = STEPS_ORDER.length;
  const progress = Math.round(((currentStepIdx + 1) / totalSteps) * 100);

  /* ── Per-step gate ────────────────────────────────────────────── */
  const gate: { ok: boolean; reason?: string } = (() => {
    if (step === 'seed' && entries.length === 0) {
      return { ok: false, reason: 'Add at least one entry from a source before moving on.' };
    }
    if (step === 'meta') {
      if (!title.trim()) return { ok: false, reason: 'Give your guide a title before moving on.' };
      if (!coverPhoto) return { ok: false, reason: 'Pick a cover photo before moving on.' };
    }
    if (step === 'entries' && entries.length === 0) {
      return { ok: false, reason: 'Add at least one entry before moving on.' };
    }
    return { ok: true };
  })();

  const goNext = () => {
    if (!gate.ok) return;
    const next = STEPS_ORDER[Math.min(currentStepIdx + 1, STEPS_ORDER.length - 1)];
    setStep(next);
  };
  const goBack = () => {
    const prev = STEPS_ORDER[Math.max(currentStepIdx - 1, 0)];
    setStep(prev);
  };
  const jumpTo = (target: Step) => {
    setStep(target);
    setSeedMode(null);
  };

  /* ── Entry assembly ───────────────────────────────────────────── */

  const addEntryFromRating = (r: RestaurantRating): GuideEntry => {
    const meta = getRestaurantInfo(r.restaurantId);
    const subtitleStr = [r.cuisine, r.price].filter(Boolean).join(' · ');
    const favoriteDishes = (r.photos || [])
      .filter((p) => p.isFavorite && p.caption?.trim())
      .map((p) => p.caption.trim());
    return {
      id: newEntryId(),
      refId: r.restaurantId,
      name: r.name,
      subtitle: subtitleStr,
      image: r.photos?.[0]?.url || r.image || '',
      score: r.score,
      notes: r.notes?.trim() || undefined,
      mustOrder: favoriteDishes.length > 0 ? favoriteDishes : undefined,
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
    authorId: user?.id,
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
    authorId: r.userId,
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
      includePhotos,
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

  const isPhone = phoneMode;

  const renderStep = () => {
    switch (step) {
      case 'type':
        return <StepType type={type} onChange={setType} />;
      case 'seed':
        return (
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
                const listOverride = l.listRatings?.[rid];
                const baseRating = ratings.find((rr) => rr.restaurantId === rid);
                const r = listOverride || baseRating;
                if (r) return addEntryFromRating(r);
                const meta = restaurantMeta[rid];
                if (meta) {
                  return {
                    id: newEntryId(),
                    refId: rid,
                    name: meta.name,
                    subtitle: [meta.cuisine, meta.price].filter(Boolean).join(' · '),
                    image: meta.image || '',
                    neighborhood: meta.neighborhood,
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
        );
      case 'meta':
        return (
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
            onClearCover={() => setCoverPhoto('')}
          />
        );
      case 'entries':
        return (
          <StepEntries
            type={type}
            entries={entries}
            includePhotos={includePhotos}
            onTogglePhotos={setIncludePhotos}
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
            onAddMore={() => { setSeedMode(null); setStep('seed'); }}
            dragRef={dragRef}
          />
        );
      case 'visibility':
        return (
          <StepVisibility
            visibility={visibility}
            onChange={setVisibility}
            accountIsPublic={accountIsPublic}
          />
        );
      case 'review':
        return (
          <StepReview
            type={type}
            title={title}
            subtitle={subtitle}
            intro={intro}
            coverPhoto={coverPhoto}
            tags={tags}
            entries={entries}
            includePhotos={includePhotos}
            visibility={visibility}
            onEditField={(target) => {
              if (target === 'cover' || target === 'title' || target === 'intro' || target === 'tags') setStep('meta');
              else if (target === 'entries') setStep('entries');
              else if (target === 'visibility') setStep('visibility');
            }}
            onEditEntry={(id) => { setExpandedEntryId(id); setStep('entries'); }}
          />
        );
    }
  };

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
          phoneMode ? 'items-end' : 'items-center',
        )}
        onClick={onClose}
      >
        <motion.div
          key="guide-creator-sheet"
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          {...dragProps}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            'w-full overflow-hidden flex flex-col',
            phoneMode
              ? 'h-[94%] rounded-t-3xl'
              : 'h-[94%] sm:max-w-[1080px] sm:max-h-[94vh] sm:h-[860px] rounded-3xl',
          )}
          style={{ backgroundColor: 'var(--cream, #EDE7D9)' }}
        >
          <div className={`guide-creator${isPhone ? ' is-phone' : ''}`}>
            {!isPhone && (
              <button type="button" className="gc-pane-close" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            )}

            <div className="gc-shell">
              {/* Desktop rail */}
              {!isPhone && (
                <nav className="gc-rail">
                  <div className="gc-rail-eyebrow">{editingId ? 'Edit guide' : 'New guide'}</div>
                  <div className="gc-rail-title">Let's build a <em>guide</em>.</div>
                  <ol className="gc-rail-steps">
                    {STEPS_ORDER.map((s, i) => {
                      const isDone = i < currentStepIdx;
                      const isCurrent = i === currentStepIdx;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`gc-rail-step${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                          onClick={() => jumpTo(s)}
                        >
                          <span className="gc-rail-step-circle">
                            {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                          </span>
                          <span className="gc-rail-step-text">
                            <span className="gc-rail-step-title">{STEP_LABELS[s]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </ol>
                  <div className="gc-rail-foot">
                    <div className="gc-rail-foot-status">
                      <span className="dot" />
                      <span>{editingId ? 'Editing existing guide' : 'New guide'}</span>
                      <span style={{ marginLeft: 'auto' }}>Step {currentStepIdx + 1} of {totalSteps}</span>
                    </div>
                    <div className="gc-rail-foot-bar">
                      <div className="gc-rail-foot-bar-fill" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                </nav>
              )}

              {/* Phone progress strip + close */}
              {isPhone && (
                <div className="gc-phone-strip">
                  <div className="gc-phone-strip-progress">
                    {STEPS_ORDER.map((s, i) => {
                      const isDone = i < currentStepIdx;
                      const isCurrent = i === currentStepIdx;
                      return (
                        <button
                          key={s}
                          type="button"
                          className={`gc-phone-strip-dot${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                          onClick={() => jumpTo(s)}
                          aria-label={`Step ${i + 1}: ${STEP_LABELS[s]}`}
                        >
                          {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                        </button>
                      );
                    })}
                    <span className="gc-phone-strip-label">{STEP_LABELS[step]}</span>
                  </div>
                  <button type="button" className="gc-phone-strip-close" onClick={onClose} aria-label="Close">
                    <X size={18} />
                  </button>
                </div>
              )}

              {/* Step pane */}
              <div className="gc-pane">
                <div className="gc-pane-head">
                  <div className="gc-pane-eyebrow">
                    Step <span className="strong">{currentStepIdx + 1}</span> of {totalSteps}
                  </div>
                  <h2 className="gc-pane-title">{STEP_LABELS[step]}</h2>
                </div>
                <div className="gc-pane-body">
                  {renderStep()}
                  {!gate.ok && gate.reason && (
                    <div className="gc-step-gate">{gate.reason}</div>
                  )}
                </div>
              </div>
            </div>

            {/* Sticky footer */}
            <div className="gc-foot">
              <button
                type="button"
                className="gc-foot-back"
                onClick={goBack}
                disabled={currentStepIdx === 0}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <div className="gc-foot-right">
                <button
                  type="button"
                  className="gc-foot-save"
                  onClick={onSaveDraft}
                  disabled={busy}
                >
                  {busy ? <Loader2 size={14} className="animate-spin" /> : null}
                  Save draft
                </button>
                {step !== 'review' ? (
                  <button
                    type="button"
                    className="gc-foot-next"
                    onClick={goNext}
                    disabled={!gate.ok}
                    title={gate.ok ? undefined : gate.reason}
                  >
                    Next: {NEXT_LABELS[step]} <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="gc-foot-publish"
                    onClick={onPublish}
                    disabled={busy || entries.length === 0 || !title.trim() || !coverPhoto}
                  >
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={16} />}
                    {editingId ? 'Save changes' : 'Publish guide'}
                  </button>
                )}
              </div>
            </div>
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
  <>
    <p className="gc-pane-intro">You can mix types in a future guide — for now, each guide focuses on one.</p>
    <div className="gc-type-row">
      {([
        { key: 'restaurants' as const, label: 'Restaurants', icon: <BookOpen size={22} />, blurb: 'Curate places you love or want to share.' },
        { key: 'recipes' as const, label: 'Recipes', icon: <ChefHat size={22} />, blurb: 'Build a cookbook chapter from your saved recipes.' },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`gc-type-card${type === opt.key ? ' is-active' : ''}`}
        >
          <div className="gc-type-card-icon">{opt.icon}</div>
          <div>
            <div className="gc-type-card-title">{opt.label}</div>
            <div className="gc-type-card-sub">{opt.blurb}</div>
          </div>
        </button>
      ))}
    </div>
  </>
);

/* ── Step: Seed ───────────────────────────────────────────────────── */

interface StepSeedProps {
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
}

const StepSeed: React.FC<StepSeedProps> = ({ type, seedMode, onPick, lists, ratings, myRecipes, onAddRestaurants, onAddRestaurantsFromList, onAddPlaces, onAddListRecipes, onAddDbRecipes, onRemoveByRefId, addedRefIds }) => {
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [importedListIds, setImportedListIds] = useState<Set<string>>(new Set());
  const [ratedFilter, setRatedFilter] = useState('');
  const [recipesFilter, setRecipesFilter] = useState('');
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchReqIdRef = useRef(0);

  const relevantLists = type === 'restaurants'
    ? lists.filter((l) => (l.restaurantIds?.length || 0) > 0)
    : lists.filter((l) => l.type === 'home-cooking' && (l.recipes?.length || 0) > 0);

  const trimmedSearch = searchQ.trim();
  useEffect(() => {
    if (seedMode !== 'search') return;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!trimmedSearch) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const reqId = ++searchReqIdRef.current;
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const found = await searchPlacesByText(trimmedSearch, 40.7128, -74.0060);
        if (reqId !== searchReqIdRef.current) return;
        setSearchResults(found.slice(0, 10));
      } catch {
        if (reqId === searchReqIdRef.current) setSearchResults([]);
      } finally {
        if (reqId === searchReqIdRef.current) setSearching(false);
      }
    }, 240);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [trimmedSearch, seedMode]);

  const seedOptions: { key: SeedMode; label: string; blurb: string; icon: React.ReactNode }[] =
    type === 'restaurants'
      ? [
          { key: 'list', label: 'From an existing list', blurb: 'Import every place from one of your saved lists.', icon: <ListChecks size={18} /> },
          { key: 'rated', label: 'From your rated places', blurb: 'Hand-pick from restaurants you\'ve already scored.', icon: <Star size={18} /> },
          { key: 'search', label: 'Search the database', blurb: 'Add any restaurant by name.', icon: <Search size={18} /> },
        ]
      : [
          { key: 'recipes-list', label: 'From a home-cooking list', blurb: 'Import every recipe from one of your home-cooking lists.', icon: <ListChecks size={18} /> },
          { key: 'recipes-my', label: 'From your recipes', blurb: 'Hand-pick from recipes you\'ve created.', icon: <ChefHat size={18} /> },
        ];

  if (!seedMode) {
    return (
      <>
        <p className="gc-pane-intro">Pick a source — you can keep adding from other sources later.</p>
        <div className="gc-source-row">
          {seedOptions.map((o) => (
            <button
              key={o.key}
              type="button"
              onClick={() => onPick(o.key)}
              className="gc-source-card"
            >
              <span className="gc-source-card-icon">{o.icon}</span>
              <span className="gc-source-card-text">
                <span className="gc-source-card-title">{o.label}</span>
                <span className="gc-source-card-sub">{o.blurb}</span>
              </span>
              <ArrowRight size={16} className="gc-source-card-chev" />
            </button>
          ))}
        </div>
        {addedRefIds.size > 0 && (
          <div className="gc-review-meta-strip" style={{ marginTop: 18 }}>
            <Check size={14} />
            {addedRefIds.size} entr{addedRefIds.size === 1 ? 'y' : 'ies'} added so far
            <span className="gc-review-meta-strip-spacer" />
            Continue to arrange entries
          </div>
        )}
      </>
    );
  }

  // ── Subpage: From a list (restaurants) ────────────────────────
  if (seedMode === 'list') {
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {relevantLists.length === 0 ? (
          <div className="gc-empty">You don't have any lists with places yet.</div>
        ) : (
          <div>
            {relevantLists.map((l) => {
              const isImported = importedListIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    onAddRestaurantsFromList(l);
                    setImportedListIds((prev) => {
                      const next = new Set(prev);
                      next.add(l.id);
                      return next;
                    });
                  }}
                  className={`gc-pick-row${isImported ? ' is-added' : ''}`}
                >
                  <span className="gc-pick-row-emoji">{l.emoji}</span>
                  <span className="gc-pick-row-text">
                    <span className="gc-pick-row-title">{l.name}</span>
                    <span className="gc-pick-row-sub">{l.restaurantIds.length} places</span>
                  </span>
                  <span className="gc-pick-row-add">
                    {isImported ? <Check size={13} strokeWidth={3} /> : <Plus size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ── Subpage: Rated places ─────────────────────────────────────
  if (seedMode === 'rated') {
    const ratedQ = ratedFilter.trim().toLowerCase();
    const filteredRatings = ratedQ
      ? ratings.filter((r) =>
          r.name.toLowerCase().includes(ratedQ)
          || (r.cuisine || '').toLowerCase().includes(ratedQ)
          || (r.address || '').toLowerCase().includes(ratedQ)
        )
      : ratings;
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {ratings.length === 0 ? (
          <div className="gc-empty">You haven't rated any places yet.</div>
        ) : (
          <>
            <div className="gc-search-row">
              <Search size={15} />
              <input
                value={ratedFilter}
                onChange={(e) => setRatedFilter(e.target.value)}
                placeholder="Filter your rated places…"
              />
              {ratedFilter && (
                <button type="button" onClick={() => setRatedFilter('')} aria-label="Clear filter">
                  <X size={13} />
                </button>
              )}
            </div>
            {filteredRatings.length === 0 ? (
              <div className="gc-empty">No matches.</div>
            ) : (
              <div>
                {filteredRatings.map((r) => {
                  const isAdded = addedRefIds.has(r.restaurantId);
                  return (
                    <button
                      key={r.restaurantId}
                      type="button"
                      onClick={() => {
                        if (isAdded) onRemoveByRefId(r.restaurantId);
                        else onAddRestaurants([r]);
                      }}
                      className={`gc-pick-row${isAdded ? ' is-added' : ''}`}
                    >
                      <span className="gc-pick-row-text">
                        <span className="gc-pick-row-title">{r.name}</span>
                        <span className="gc-pick-row-sub">{[r.cuisine, r.price].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="gc-pick-row-score">{r.score.toFixed(1)}</span>
                      <span className="gc-pick-row-add">
                        {isAdded ? <Check size={13} strokeWidth={3} /> : <Plus size={13} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  // ── Subpage: Search ───────────────────────────────────────────
  if (seedMode === 'search') {
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        <div className="gc-search-row">
          <Search size={15} />
          <input
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            placeholder="Search any restaurant…"
            autoFocus
          />
          {searching && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--muted, #8C8278)' }} />}
          {!searching && searchQ && (
            <button type="button" onClick={() => setSearchQ('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>
        <div>
          {searchResults.map((p) => {
            const isAdded = addedRefIds.has(p.id);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  if (isAdded) onRemoveByRefId(p.id);
                  else onAddPlaces([p]);
                }}
                className={`gc-pick-row${isAdded ? ' is-added' : ''}`}
              >
                <span className="gc-pick-row-text">
                  <span className="gc-pick-row-title">{p.name}</span>
                  <span className="gc-pick-row-sub">{p.address}</span>
                </span>
                <span className="gc-pick-row-add">
                  {isAdded ? <Check size={13} strokeWidth={3} /> : <Plus size={13} />}
                </span>
              </button>
            );
          })}
          {searchResults.length === 0 && !searching && searchQ.trim() && (
            <div className="gc-empty">No results — try a different query.</div>
          )}
          {searchResults.length === 0 && !searching && !searchQ.trim() && (
            <div className="gc-empty">Start typing to find restaurants.</div>
          )}
        </div>
      </>
    );
  }

  // ── Subpage: Recipes from list ────────────────────────────────
  if (seedMode === 'recipes-list') {
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {relevantLists.length === 0 ? (
          <div className="gc-empty">No home-cooking lists yet. Add recipes in Pantry first.</div>
        ) : (
          <div>
            {relevantLists.map((l) => {
              const isImported = importedListIds.has(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => {
                    if (l.recipes) onAddListRecipes(l.recipes);
                    setImportedListIds((prev) => {
                      const next = new Set(prev);
                      next.add(l.id);
                      return next;
                    });
                  }}
                  className={`gc-pick-row${isImported ? ' is-added' : ''}`}
                >
                  <span className="gc-pick-row-emoji">{l.emoji}</span>
                  <span className="gc-pick-row-text">
                    <span className="gc-pick-row-title">{l.name}</span>
                    <span className="gc-pick-row-sub">{l.recipes?.length || 0} recipes</span>
                  </span>
                  <span className="gc-pick-row-add">
                    {isImported ? <Check size={13} strokeWidth={3} /> : <Plus size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </>
    );
  }

  // ── Subpage: My recipes ───────────────────────────────────────
  if (seedMode === 'recipes-my') {
    const recipesQ = recipesFilter.trim().toLowerCase();
    const filteredRecipes = recipesQ
      ? myRecipes.filter((r) =>
          r.title.toLowerCase().includes(recipesQ)
          || (r.cuisine || '').toLowerCase().includes(recipesQ)
          || (r.tags || []).some((t) => t.toLowerCase().includes(recipesQ))
        )
      : myRecipes;
    return (
      <>
        <button type="button" className="gc-subpage-back" onClick={() => onPick(null)}>
          <ArrowLeft size={13} /> Back to sources
        </button>
        {myRecipes.length === 0 ? (
          <div className="gc-empty">You haven't created any recipes yet.</div>
        ) : (
          <>
            <div className="gc-search-row">
              <Search size={15} />
              <input
                value={recipesFilter}
                onChange={(e) => setRecipesFilter(e.target.value)}
                placeholder="Filter your recipes…"
              />
              {recipesFilter && (
                <button type="button" onClick={() => setRecipesFilter('')} aria-label="Clear filter">
                  <X size={13} />
                </button>
              )}
            </div>
            {filteredRecipes.length === 0 ? (
              <div className="gc-empty">No matches.</div>
            ) : (
              <div>
                {filteredRecipes.map((r) => {
                  const isAdded = addedRefIds.has(r.id);
                  return (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => {
                        if (isAdded) onRemoveByRefId(r.id);
                        else onAddDbRecipes([r]);
                      }}
                      className={`gc-pick-row${isAdded ? ' is-added' : ''}`}
                    >
                      <span className="gc-pick-row-text">
                        <span className="gc-pick-row-title">{r.title}</span>
                        <span className="gc-pick-row-sub">{[r.cuisine, r.difficulty].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span className="gc-pick-row-add">
                        {isAdded ? <Check size={13} strokeWidth={3} /> : <Plus size={13} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </>
    );
  }

  return null;
};

/* ── Step: Meta (cover + title + intro + tags) ────────────────────── */

interface StepMetaProps {
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
  onClearCover: () => void;
}

const StepMeta: React.FC<StepMetaProps> = ({ title, subtitle, intro, tags, coverPhoto, entries, onTitle, onSubtitle, onIntro, onToggleTag, onAddTag, onRemoveTag, onPickCoverFromFile, onPickCoverFromEntry, onClearCover }) => {
  const [tagDraft, setTagDraft] = useState('');
  const entryThumbs = entries.filter((e) => !!e.image).slice(0, 8);

  return (
    <>
      <div className="gc-field">
        <div className="gc-label">
          Cover photo <span className="req">required</span>
        </div>
        {coverPhoto ? (
          <div className="gc-dropzone-preview" style={{ backgroundImage: `url(${coverPhoto})` }}>
            <div className="gc-dropzone-preview-actions">
              <button type="button" onClick={onPickCoverFromFile}>Replace</button>
              <button type="button" onClick={onClearCover}>Remove</button>
            </div>
          </div>
        ) : (
          <button type="button" className="gc-dropzone" onClick={onPickCoverFromFile}>
            <span className="gc-dropzone-icon"><ImagePlus size={22} /></span>
            <span>
              <span className="gc-dropzone-text">
                Drop an image or <span className="accent">click to browse</span>
              </span>
              <span className="gc-dropzone-sub">JPG or PNG · sets the tone for the whole guide</span>
            </span>
          </button>
        )}
        {entryThumbs.length > 0 && (
          <div className="gc-thumb-row">
            <div className="gc-thumb-row-label">Or pick from your entries</div>
            <div className="gc-thumb-strip">
              {entryThumbs.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => onPickCoverFromEntry(e.image)}
                  className={`gc-thumb${coverPhoto === e.image ? ' is-active' : ''}`}
                >
                  <img src={e.image} alt="" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="gc-field">
        <div className="gc-label">
          Title <span className="req">required</span>
        </div>
        <input
          className="gc-input is-title"
          value={title}
          onChange={(e) => onTitle(e.target.value)}
          placeholder="e.g. Best Chinese Restaurants in NYC"
          maxLength={120}
        />
      </div>

      <div className="gc-field">
        <div className="gc-label">Subtitle <span className="opt">optional</span></div>
        <input
          className="gc-input"
          value={subtitle}
          onChange={(e) => onSubtitle(e.target.value)}
          placeholder="A one-line tease that sits under the title."
          maxLength={160}
        />
      </div>

      <div className="gc-field">
        <div className="gc-label">Intro paragraph <span className="opt">optional</span></div>
        <textarea
          className="gc-textarea"
          value={intro}
          onChange={(e) => onIntro(e.target.value)}
          placeholder="Set the scene — why this guide, who it's for."
          rows={4}
          maxLength={800}
        />
      </div>

      <div className="gc-field">
        <div className="gc-label">Tags <span className="opt">optional</span></div>
        {tags.length > 0 && (
          <div className="gc-chip-row">
            {tags.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onRemoveTag(t)}
                className="gc-chip is-removable"
              >
                {t}
                <X size={11} />
              </button>
            ))}
          </div>
        )}
        <div className="gc-chip-row">
          <input
            className="gc-chip-add"
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
            style={{ minWidth: 180 }}
          />
        </div>
        <div className="gc-chip-row">
          {TAG_SUGGESTIONS.filter((t) => !tags.includes(t)).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onToggleTag(t)}
              className="gc-chip"
            >
              + {t}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

/* ── Step: Entries (reorder + per-entry edit) ─────────────────────── */

interface StepEntriesProps {
  type: GuideType;
  entries: GuideEntry[];
  includePhotos: boolean;
  onTogglePhotos: (next: boolean) => void;
  expandedId: string | null;
  onToggleExpand: (id: string) => void;
  onRemove: (id: string) => void;
  onPatch: (id: string, patch: Partial<GuideEntry>) => void;
  onMove: (from: number, to: number) => void;
  onAddMore: () => void;
  dragRef: React.MutableRefObject<number | null>;
}

const StepEntries: React.FC<StepEntriesProps> = ({ type, entries, includePhotos, onTogglePhotos, expandedId, onToggleExpand, onRemove, onPatch, onMove, onAddMore, dragRef }) => {
  const orderedKey = type === 'restaurants' ? 'mustOrder' : 'keyIngredients';
  const orderedLabel = type === 'restaurants' ? 'Favorite Dishes' : 'Key Ingredients';

  return (
    <>
      <p className="gc-pane-intro">Drag to reorder, edit each entry's details, or remove. Add more from another source if you need.</p>

      <div className="gc-photo-toggle">
        <div className="gc-photo-toggle-icon"><ImagePlus size={16} /></div>
        <div className="gc-photo-toggle-text">
          <div className="gc-photo-toggle-title">Include photos on entries</div>
          <div className="gc-photo-toggle-sub">When off, entry cards render text-only on the published guide.</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={includePhotos}
          onClick={() => onTogglePhotos(!includePhotos)}
          className={`gc-switch${includePhotos ? ' is-on' : ''}`}
        >
          <span className="gc-switch-knob" />
        </button>
      </div>

      <div className="gc-entries-head">
        <div className="gc-pane-eyebrow">
          <span className="strong">{entries.length}</span> entr{entries.length === 1 ? 'y' : 'ies'}
        </div>
        <button type="button" onClick={onAddMore} className="gc-entries-add-more">
          <Plus size={14} /> Add more
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="gc-empty">No entries yet — go back and add some from a source.</div>
      ) : (
        <div className="gc-entry-list">
          {entries.map((entry, idx) => {
            const isExpanded = expandedId === entry.id;
            const orderedVals = type === 'restaurants' ? entry.mustOrder : entry.keyIngredients;
            return (
              <div
                key={entry.id}
                draggable
                onDragStart={() => { dragRef.current = idx; }}
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={() => {
                  const from = dragRef.current;
                  if (from === null || from === idx) return;
                  onMove(from, idx);
                  dragRef.current = null;
                }}
                className={`gc-entry-card${isExpanded ? ' is-expanded' : ''}`}
              >
                <div className="gc-entry-row">
                  <span className="gc-entry-grip"><GripVertical size={16} /></span>
                  <span className="gc-entry-num">{(idx + 1).toString().padStart(2, '0')}</span>
                  <span className="gc-entry-img">
                    {entry.image && <img src={entry.image} alt="" referrerPolicy="no-referrer" />}
                  </span>
                  <div className="gc-entry-text">
                    <div className="gc-entry-name">{entry.name}</div>
                    <div className="gc-entry-sub">{entry.subtitle}</div>
                  </div>
                  <div className="gc-entry-actions">
                    <button
                      type="button"
                      onClick={() => onToggleExpand(entry.id)}
                      className={`gc-entry-edit-pill${isExpanded ? ' is-active' : ''}`}
                    >
                      {isExpanded ? 'Done' : 'Edit'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemove(entry.id)}
                      aria-label="Remove"
                      className="gc-entry-action"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="gc-entry-detail">
                    <div className="gc-entry-detail-field">
                      <div className="gc-entry-detail-label">Score <span className="hint">· 0–10 · optional</span></div>
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
                        className="gc-entry-detail-input"
                        style={{ width: 100 }}
                      />
                    </div>
                    <div className="gc-entry-detail-field">
                      <div className="gc-entry-detail-label">Notes <span className="hint">· pre-filled from your rating</span></div>
                      <textarea
                        value={entry.notes || ''}
                        onChange={(e) => onPatch(entry.id, { notes: e.target.value })}
                        placeholder="What makes this special? Why are you sending people here?"
                        rows={3}
                        className="gc-entry-detail-textarea"
                      />
                    </div>
                    <div className="gc-entry-detail-field">
                      <div className="gc-entry-detail-label">{orderedLabel} <span className="hint">· comma separated</span></div>
                      <input
                        value={(orderedVals || []).join(', ')}
                        onChange={(e) => onPatch(entry.id, { [orderedKey]: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) } as Partial<GuideEntry>)}
                        placeholder={type === 'restaurants' ? 'Cold sesame noodles, Twice-cooked pork belly' : 'Saffron, Bomba rice'}
                        className="gc-entry-detail-input"
                      />
                    </div>
                    {type === 'restaurants' && (
                      <>
                        <div className="gc-entry-detail-field">
                          <div className="gc-entry-detail-label">Best for</div>
                          <input
                            value={entry.bestFor || ''}
                            onChange={(e) => onPatch(entry.id, { bestFor: e.target.value })}
                            placeholder="A grown-up dinner. The room you bring your parents to."
                            className="gc-entry-detail-input"
                          />
                        </div>
                        <div className="gc-entry-detail-field">
                          <div className="gc-entry-detail-label">Insider tip</div>
                          <input
                            value={entry.insiderTip || ''}
                            onChange={(e) => onPatch(entry.id, { insiderTip: e.target.value })}
                            placeholder="Sit upstairs by the window."
                            className="gc-entry-detail-input"
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

/* ── Step: Visibility ─────────────────────────────────────────────── */

const StepVisibility: React.FC<{
  visibility: GuideVisibility;
  onChange: (v: GuideVisibility) => void;
  accountIsPublic: boolean;
}> = ({ visibility, onChange, accountIsPublic }) => (
  <>
    <p className="gc-pane-intro">
      Defaults to your account setting ({accountIsPublic ? 'public' : 'private'}). You can change this anytime after publishing.
    </p>
    <div className="gc-visibility-row">
      {([
        { key: 'public' as const, label: 'Public', icon: <Globe size={20} />, blurb: 'Appears on Discover. Anyone with the link can read it.' },
        { key: 'private' as const, label: 'Private', icon: <Lock size={20} />, blurb: 'Only you can see it. Use this for drafts or personal lists.' },
      ]).map((opt) => (
        <button
          key={opt.key}
          type="button"
          onClick={() => onChange(opt.key)}
          className={`gc-visibility-card${visibility === opt.key ? ' is-active' : ''}`}
        >
          <div className="gc-visibility-icon">{opt.icon}</div>
          <div>
            <div className="gc-visibility-title">{opt.label}</div>
            <div className="gc-visibility-sub">{opt.blurb}</div>
          </div>
        </button>
      ))}
    </div>
  </>
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
  includePhotos: boolean;
  visibility: GuideVisibility;
  onEditField: (target: 'cover' | 'title' | 'intro' | 'tags' | 'entries' | 'visibility') => void;
  onEditEntry: (id: string) => void;
}> = ({ type, title, subtitle, intro, coverPhoto, tags, entries, includePhotos, visibility, onEditField, onEditEntry }) => {
  const avg = (() => {
    const scored = entries.map((e) => e.score).filter((s): s is number => typeof s === 'number');
    if (scored.length === 0) return null;
    return (scored.reduce((a, b) => a + b, 0) / scored.length).toFixed(1);
  })();

  return (
    <>
      <p className="gc-pane-intro">Tap anything to jump back and edit. When it looks right, hit Publish.</p>

      <div className="gc-review">
        <button type="button" onClick={() => onEditField('cover')} className="gc-review-hero">
          {coverPhoto ? (
            <>
              <img src={coverPhoto} alt="" referrerPolicy="no-referrer" />
              <div className="gc-review-hero-overlay" />
              <div className="gc-review-hero-text">
                <div className="gc-review-hero-eyebrow">
                  Guides / {type === 'recipes' ? 'Recipes' : 'Restaurants'}{tags[0] ? ` · ${tags[0]}` : ''}
                </div>
                <div className="gc-review-hero-title">{title || 'Untitled guide'}</div>
                {subtitle && <div className="gc-review-hero-sub">{subtitle}</div>}
                <div className="gc-review-hero-meta">
                  {entries.length} {type === 'recipes' ? 'recipes' : 'spots'}{avg ? ` · ${avg} avg` : ''}
                </div>
              </div>
            </>
          ) : (
            <div className="gc-review-hero-empty">
              <ImagePlus size={26} />
              Add a cover photo
            </div>
          )}
        </button>

        <div className="gc-review-body">
          <button type="button" onClick={() => onEditField('title')} className="gc-review-edit-link" style={{ alignSelf: 'flex-start' }}>
            Edit title, subtitle, intro & tags →
          </button>

          {intro && (
            <p className="gc-review-intro">{intro}</p>
          )}

          {tags.length > 0 && (
            <div className="gc-review-tags">
              {tags.map((t) => <span key={t} className="gc-review-tag">{t}</span>)}
            </div>
          )}

          <div className="gc-review-meta-strip">
            {visibility === 'public' ? <Globe size={14} /> : <Lock size={14} />}
            {visibility === 'public' ? 'Public' : 'Private'}
            <span className="gc-review-meta-strip-spacer" />
            <button type="button" onClick={() => onEditField('visibility')} className="gc-review-edit-link" style={{ color: 'inherit' }}>
              Change
            </button>
          </div>

          <div className="gc-review-entries-head">
            <h4>{entries.length} entr{entries.length === 1 ? 'y' : 'ies'}</h4>
            <button type="button" onClick={() => onEditField('entries')} className="gc-review-edit-link">
              Edit entries →
            </button>
          </div>
          <div className="gc-review-entries">
            {entries.map((e, idx) => (
              <button
                key={e.id}
                type="button"
                onClick={() => onEditEntry(e.id)}
                className="gc-review-entry"
              >
                <span className="gc-review-entry-num">{(idx + 1).toString().padStart(2, '0')}</span>
                {includePhotos && (
                  <span className="gc-review-entry-img">
                    {e.image && <img src={e.image} alt="" referrerPolicy="no-referrer" />}
                  </span>
                )}
                <div className="gc-review-entry-text">
                  <div className="gc-review-entry-name">{e.name}</div>
                  <div className="gc-review-entry-sub">{e.subtitle}</div>
                </div>
                {typeof e.score === 'number' && e.score > 0 && (
                  <span className="gc-review-entry-score">{e.score.toFixed(1)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};
