import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, ChevronLeft, ChevronRight, Camera, Search, Clock, Users, Globe, Lock, Tag, Image, StickyNote, Timer, Hash } from 'lucide-react';
import { cn } from '../lib/utils';
import { useRecipes, type Recipe, type RecipeIngredient, type RecipeStep } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import type { PhotoItem } from '../contexts/ListsContext';

const RECIPE_TAGS = [
  'Quick & Easy', 'Weeknight', 'Comfort Food', 'Vegetarian', 'Vegan',
  'Baking', 'Grilling', 'One-Pot', 'Slow Cooker', 'Air Fryer',
  'Gluten-Free', 'Dairy-Free', 'Low-Carb', 'High-Protein', 'Keto',
  'Meal Prep', 'Budget-Friendly', 'Fancy', 'Kid-Friendly', 'Dessert',
  'Appetizer', 'Side Dish', 'Soup', 'Salad', 'Sauce',
];

const DIFFICULTIES: Recipe['difficulty'][] = ['easy', 'medium', 'hard'];
const DIFFICULTY_LABELS: Record<Recipe['difficulty'], string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
// Standardized difficulty palette shared across all three recipe modals:
// Easy → green, Medium → amber, Hard → red.
const DIFFICULTY_COLORS: Record<Recipe['difficulty'], string> = {
  easy: 'text-green-700 bg-green-50 border-green-200',
  medium: 'text-amber-700 bg-amber-50 border-amber-200',
  hard: 'text-red-700 bg-red-50 border-red-200',
};

type Page = 'main' | 'ingredients' | 'steps' | 'photos' | 'tags';

export const RecipeModal: React.FC = () => {
  const { recipeModalOpen, recipeModalData, closeRecipeModal, createRecipe, updateRecipe } = useRecipes();
  const { phoneMode } = useSettings();
  const { user } = useAuth();

  const existing = recipeModalData;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverPhoto, setCoverPhoto] = useState('');
  const [prepTime, setPrepTime] = useState('');
  const [cookTime, setCookTime] = useState('');
  const [servings, setServings] = useState('');
  const [difficulty, setDifficulty] = useState<Recipe['difficulty']>('medium');
  const [cuisine, setCuisine] = useState('');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<RecipeStep[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isPublic, setIsPublic] = useState(false);

  // Sub-page editing state
  const [ingName, setIngName] = useState('');
  const [ingAmount, setIngAmount] = useState('');
  const [ingUnit, setIngUnit] = useState('');
  const [stepText, setStepText] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);

  const [page, setPage] = useState<Page>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (recipeModalOpen) {
      setTitle(existing?.title ?? '');
      setDescription(existing?.description ?? '');
      setCoverPhoto(existing?.photos?.[0] ?? '');
      setPrepTime(existing?.prepTimeMinutes?.toString() ?? '');
      setCookTime(existing?.cookTimeMinutes?.toString() ?? '');
      setServings(existing?.servings?.toString() ?? '');
      setDifficulty(existing?.difficulty ?? 'medium');
      setCuisine(existing?.cuisine ?? '');
      setIngredients(existing?.ingredients ?? []);
      setSteps(existing?.steps ?? []);
      setPhotos(existing?.photos?.slice(1)?.map((url) => ({ url, caption: '', isFavorite: false })) ?? []);
      setSelectedTags(existing?.tags ?? []);
      setIsPublic(existing?.isPublic ?? false);
      setIngName(''); setIngAmount(''); setIngUnit('');
      setStepText('');
      setTagSearch('');
      setSelectedPhotoIdx(null);
      setPage('main');
      setConfirmDelete(false);
    }
  }, [recipeModalOpen, existing]);

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

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = Array.from(files).find((f) => f.type.startsWith('image/'));
    if (!file) return;
    try { setCoverPhoto(await compressImage(file)); } catch { /* skip */ }
    e.target.value = '';
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
      } catch { /* skip */ }
    }
    setPhotos((prev) => {
      const updated = [...prev, ...newPhotos];
      setTimeout(() => setPage('photos'), 0);
      return updated;
    });
    e.target.value = '';
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setSelectedPhotoIdx((cur) => (cur === null ? null : cur === idx ? null : cur > idx ? cur - 1 : cur));
  };
  const updatePhotoCaption = (idx: number, caption: string) => setPhotos((prev) => prev.map((p, i) => i === idx ? { ...p, caption } : p));
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
    if (photos.length === 0) { fileInputRef.current?.click(); } else { setPage('photos'); }
  };

  const addIngredient = () => {
    if (!ingName.trim()) return;
    setIngredients((prev) => [...prev, { name: ingName.trim(), amount: ingAmount.trim(), unit: ingUnit.trim() }]);
    setIngName(''); setIngAmount(''); setIngUnit('');
  };

  const removeIngredient = (idx: number) => setIngredients((prev) => prev.filter((_, i) => i !== idx));

  const addStep = () => {
    if (!stepText.trim()) return;
    setSteps((prev) => [...prev, { order: prev.length + 1, text: stepText.trim() }]);
    setStepText('');
  };

  const removeStep = (idx: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== idx).map((s, i) => ({ ...s, order: i + 1 })));
  };

  const handleSave = async () => {
    if (!title.trim() || !user?.id) return;
    const allPhotos = [coverPhoto, ...photos.map((p) => p.url)].filter(Boolean);
    const recipeData = {
      userId: user.id,
      title: title.trim(),
      description: description.trim(),
      ingredients,
      steps,
      prepTimeMinutes: prepTime ? parseInt(prepTime, 10) : null,
      cookTimeMinutes: cookTime ? parseInt(cookTime, 10) : null,
      servings: servings ? parseInt(servings, 10) : null,
      difficulty,
      cuisine: cuisine.trim(),
      tags: selectedTags,
      photos: allPhotos,
      isPublic,
      sourceType: 'user' as const,
      linkedRestaurantId: existing?.linkedRestaurantId ?? null,
      linkedMealId: existing?.linkedMealId ?? null,
    };

    if (existing) {
      await updateRecipe(existing.id, recipeData);
    } else {
      await createRecipe(recipeData);
    }
    closeRecipeModal();
  };

  const handleDelete = async () => {
    // Delete handled through context if needed
    closeRecipeModal();
  };

  const hasIngredients = ingredients.length > 0;
  const hasSteps = steps.length > 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return RECIPE_TAGS;
    const q = tagSearch.toLowerCase();
    return RECIPE_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagSearch]);

  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;
  const coverInput = <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />;

  return (
    <AnimatePresence>
      {recipeModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeRecipeModal}
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
            {coverInput}
            <AnimatePresence mode="wait">
              {/* ═══════════ MAIN PAGE ═══════════ */}
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -30 }} transition={{ duration: 0.15 }}
                  className="flex flex-col flex-1 min-h-0">
                  <div className="px-5 pt-safe-4 sm:pt-5 pb-2 flex items-center justify-between flex-shrink-0">
                    <div className="min-w-0">
                      <h2 className="font-serif font-bold text-lg truncate">{existing ? 'Edit Recipe' : 'New Recipe'}</h2>
                      {existing && <p className="text-xs text-on-surface/40 truncate">{existing.title}</p>}
                    </div>
                    <button onClick={closeRecipeModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
                    {/* Cover photo */}
                    <div className="mb-4">
                      {coverPhoto ? (
                        <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-on-surface/10">
                          <img src={coverPhoto} alt="" className="w-full h-full object-cover" />
                          <div className="absolute top-2 right-2 flex gap-1.5">
                            <button onClick={() => coverInputRef.current?.click()}
                              className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                              <Camera size={14} className="text-white" />
                            </button>
                            <button onClick={() => setCoverPhoto('')}
                              className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center backdrop-blur-sm">
                              <X size={14} className="text-white" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button onClick={() => coverInputRef.current?.click()}
                          className="w-full flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border-2 border-dashed border-on-surface/10 bg-on-surface/2 hover:border-on-surface/20 transition-colors">
                          <Camera size={24} className="text-on-surface/25" />
                          <span className="text-xs font-medium text-on-surface/35">Add cover photo</span>
                        </button>
                      )}
                    </div>

                    {/* Title */}
                    <div className="mb-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Recipe Title</p>
                      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Grandma's Lasagna" autoFocus
                        className="w-full bg-white border border-on-surface/10 rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>

                    {/* Description */}
                    <div className="mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Description</p>
                      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="A brief description of this recipe..." rows={3}
                        className="w-full bg-white border border-on-surface/10 rounded-2xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed" />
                    </div>

                    {/* Quick info row */}
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2.5">Quick Info</p>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <div>
                          <p className="text-[10px] font-semibold text-on-surface/30 mb-1 flex items-center gap-1"><Clock size={10} />Prep</p>
                          <div className="relative">
                            <input type="number" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} placeholder="0"
                              className="w-full bg-white border border-on-surface/10 rounded-lg px-3 py-2 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-primary/20" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-on-surface/25">min</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-on-surface/30 mb-1 flex items-center gap-1"><Timer size={10} />Cook</p>
                          <div className="relative">
                            <input type="number" value={cookTime} onChange={(e) => setCookTime(e.target.value)} placeholder="0"
                              className="w-full bg-white border border-on-surface/10 rounded-lg px-3 py-2 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-primary/20" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-on-surface/25">min</span>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-on-surface/30 mb-1 flex items-center gap-1"><Users size={10} />Servings</p>
                          <input type="number" value={servings} onChange={(e) => setServings(e.target.value)} placeholder="4"
                            className="w-full bg-white border border-on-surface/10 rounded-lg px-3 py-2 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                      </div>

                      {/* Difficulty */}
                      <div className="mb-3">
                        <p className="text-[10px] font-semibold text-on-surface/30 mb-1.5">Difficulty</p>
                        <div className="flex gap-2">
                          {DIFFICULTIES.map((d) => (
                            <button key={d} onClick={() => setDifficulty(d)}
                              className={cn("flex-1 py-2 rounded-xl text-xs font-semibold border transition-all",
                                difficulty === d ? DIFFICULTY_COLORS[d] : "bg-white border-on-surface/10 text-on-surface/40"
                              )}>
                              {DIFFICULTY_LABELS[d]}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Cuisine */}
                      <div>
                        <p className="text-[10px] font-semibold text-on-surface/30 mb-1.5">Cuisine</p>
                        <input type="text" value={cuisine} onChange={(e) => setCuisine(e.target.value)}
                          placeholder="e.g. Italian, Mexican, Thai..."
                          className="w-full bg-white border border-on-surface/10 rounded-lg px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                    </div>

                    {/* Detail buttons */}
                    <div className="border-t border-on-surface/6 pt-3 pb-2">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-2.5">Recipe Details</p>
                      <div className="space-y-2">
                        <DetailBtn icon={<Hash size={17} />} label="Ingredients" active={hasIngredients} sub={hasIngredients ? `${ingredients.length} items` : undefined} onClick={() => setPage('ingredients')} />
                        <DetailBtn icon={<StickyNote size={17} />} label="Steps" active={hasSteps} sub={hasSteps ? `${steps.length} steps` : undefined} onClick={() => setPage('steps')} />
                        <DetailBtn icon={<Image size={17} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={handlePhotosClick} />
                        <DetailBtn icon={<Tag size={17} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
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
                          {isPublic ? 'Visible to everyone' : 'Only you can see this'}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface space-y-2">
                    <button onClick={handleSave} disabled={!title.trim()}
                      className="w-full py-3.5 bg-primary text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-40">
                      {existing ? 'Update Recipe' : 'Save Recipe'}
                    </button>
                    {existing && !confirmDelete && (
                      <button onClick={() => setConfirmDelete(true)}
                        className="w-full py-2.5 text-red-400 text-xs font-semibold hover:text-red-500 transition-colors">
                        Delete Recipe
                      </button>
                    )}
                    {existing && confirmDelete && (
                      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
                        <p className="text-xs text-red-600 font-medium">Delete this recipe?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmDelete(false)} className="px-3 py-1.5 text-xs font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                          <button onClick={handleDelete} className="px-3 py-1.5 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ═══════════ INGREDIENTS ═══════════ */}
              {/* TODO: This modal does not support bulk-paste parsing (amount unit name per line)
                  — AddHomeMealModal has that feature and this one should eventually share it. */}
              {page === 'ingredients' && (
                <SubPage key="ingredients" onBack={() => setPage('main')} title="Ingredients">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4" onTouchMove={(e) => e.stopPropagation()}>
                    {/* Add ingredient form — flat inputs, no card chrome */}
                    <div className="mb-5 space-y-2">
                      <input type="text" value={ingName} onChange={(e) => setIngName(e.target.value)}
                        placeholder="Ingredient name" autoFocus
                        className="w-full bg-on-surface/[0.04] rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30"
                        onKeyDown={(e) => e.key === 'Enter' && addIngredient()} />
                      <div className="flex gap-2">
                        <input type="text" value={ingAmount} onChange={(e) => setIngAmount(e.target.value)}
                          placeholder="Amount" className="flex-1 bg-on-surface/[0.04] rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                        <input type="text" value={ingUnit} onChange={(e) => setIngUnit(e.target.value)}
                          placeholder="Unit (cups, g…)" className="flex-1 bg-on-surface/[0.04] rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                      </div>
                      <button onClick={addIngredient} disabled={!ingName.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-primary/15">
                        <Plus size={14} /> Add Ingredient
                      </button>
                    </div>

                    {/* Ingredient list — flat numbered rows with generous line-height */}
                    {ingredients.length === 0 ? (
                      <div className="text-center py-8">
                        <Hash size={24} className="mx-auto text-on-surface/15 mb-2" />
                        <p className="text-sm text-on-surface/30">No ingredients yet</p>
                      </div>
                    ) : (
                      <ol className="divide-y divide-on-surface/[0.06] border-t border-on-surface/[0.06]">
                        {ingredients.map((ing, idx) => {
                          const amt = [ing.amount, ing.unit].filter(Boolean).join(' ');
                          return (
                            <li key={idx} className="flex items-start gap-3 py-3 leading-[1.6]">
                              <span className="w-6 text-[13px] font-semibold text-on-surface/40 tabular-nums text-right flex-shrink-0 pt-[1px]">{idx + 1}.</span>
                              <p className="flex-1 min-w-0 text-[15px] text-on-surface/80">
                                {amt && <span className="font-bold text-on-surface/90">{amt} </span>}
                                <span className="font-normal">{ing.name}</span>
                              </p>
                              <button onClick={() => removeIngredient(idx)} className="p-1 -mr-1 text-on-surface/25 hover:text-red-500 transition-colors flex-shrink-0" aria-label="Remove ingredient">
                                <X size={14} />
                              </button>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </div>
                  <BottomBtn label={hasIngredients ? `Done (${ingredients.length})` : 'Done'} onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ STEPS ═══════════ */}
              {page === 'steps' && (
                <SubPage key="steps" onBack={() => setPage('main')} title="Steps">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4" onTouchMove={(e) => e.stopPropagation()}>
                    {/* Add step form — flat inputs, no card chrome */}
                    <div className="mb-5 space-y-2">
                      <textarea value={stepText} onChange={(e) => setStepText(e.target.value)}
                        placeholder={`Step ${steps.length + 1}: What to do…`} rows={3}
                        className="w-full bg-on-surface/[0.04] rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed placeholder:text-on-surface/30" />
                      <button onClick={addStep} disabled={!stepText.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-primary/15">
                        <Plus size={14} /> Add Step
                      </button>
                    </div>

                    {/* Step list — editorial "Step N" labels, no card chrome */}
                    {steps.length === 0 ? (
                      <div className="text-center py-8">
                        <StickyNote size={24} className="mx-auto text-on-surface/15 mb-2" />
                        <p className="text-sm text-on-surface/30">No steps yet</p>
                      </div>
                    ) : (
                      <ol className="space-y-5">
                        {steps.map((step, idx) => (
                          <li key={idx} className="flex gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary mb-1">Step {step.order}</p>
                              <p className="text-[15px] text-on-surface/80 leading-[1.6] whitespace-pre-wrap">{step.text}</p>
                            </div>
                            <button onClick={() => removeStep(idx)} className="p-1 -mr-1 text-on-surface/25 hover:text-red-500 transition-colors flex-shrink-0" aria-label="Remove step">
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <BottomBtn label={hasSteps ? `Done (${steps.length})` : 'Done'} onClick={() => setPage('main')} />
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
                <SubPage key="photos" onBack={() => { setPage('main'); setSelectedPhotoIdx(null); }} title="Photos" rightAction={
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
                            <div className="flex items-center justify-end gap-2">
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
