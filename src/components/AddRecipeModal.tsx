import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, Camera, ChevronLeft, ChevronRight, Tag, Image, Search, Hash, FileText, Lock, Clock, Flame, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColorLight, scoreRingColor, scoreBgGradient } from '../lib/score';
import { useLists, type Recipe, type RecipeIngredient, type PhotoItem } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';

// Standardized difficulty palette shared across all three recipe modals:
// Easy → green, Medium → amber, Hard → red.
const DIFFICULTY_COLORS: Record<Recipe['difficulty'], string> = {
  Easy: 'text-green-700 bg-green-50 border-green-200',
  Medium: 'text-amber-700 bg-amber-50 border-amber-200',
  Hard: 'text-red-700 bg-red-50 border-red-200',
};

const RECIPE_TAGS = [
  'Quick & Easy', 'Weeknight', 'Comfort Food', 'Vegetarian', 'Vegan',
  'Baking', 'Grilling', 'One-Pot', 'Slow Cooker', 'Air Fryer',
  'Gluten-Free', 'Dairy-Free', 'Keto', 'Paleo', 'Meal Prep',
  'Appetizer', 'Side Dish', 'Main Course', 'Dessert', 'Breakfast',
  'Lunch', 'Dinner', 'Snack', 'Beverage', 'Sauce',
  'Holiday', 'Summer', 'Fall', 'Winter', 'Spring',
  'Budget Friendly', 'Under 30 Min', 'Healthy', 'Spicy', 'Kid Friendly',
];

type Page = 'main' | 'ingredients' | 'steps' | 'photos' | 'tags';

export const AddRecipeModal: React.FC = () => {
  const { addRecipeModalOpen, addRecipeModalListId, addRecipeModalRecipe, closeAddRecipeModal, addRecipe, updateRecipe, removeRecipe } = useLists();
  const { phoneMode } = useSettings();

  const existing = addRecipeModalRecipe;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [coverPhoto, setCoverPhoto] = useState('');
  const [prepTime, setPrepTime] = useState(0);
  const [cookTime, setCookTime] = useState(0);
  const [servings, setServings] = useState(4);
  const [difficulty, setDifficulty] = useState<Recipe['difficulty']>('Medium');
  const [cuisine, setCuisine] = useState('');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [score, setScore] = useState(7);
  const [isPrivate, setIsPrivate] = useState(false);

  // Sub-page form state
  const [newIngredientName, setNewIngredientName] = useState('');
  const [newIngredientAmount, setNewIngredientAmount] = useState('');
  const [newIngredientUnit, setNewIngredientUnit] = useState('');
  const [newStep, setNewStep] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);

  const [page, setPage] = useState<Page>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const { dragProps } = useBottomSheet(addRecipeModalOpen, closeAddRecipeModal);

  useEffect(() => {
    if (addRecipeModalOpen) {
      if (existing) {
        setTitle(existing.title);
        setDescription(existing.description);
        setCoverPhoto(existing.coverPhoto);
        setPrepTime(existing.prepTime);
        setCookTime(existing.cookTime);
        setServings(existing.servings);
        setDifficulty(existing.difficulty);
        setCuisine(existing.cuisine);
        setIngredients([...existing.ingredients]);
        setSteps([...existing.steps]);
        setPhotos([...existing.photos]);
        setSelectedTags([...existing.tags]);
        setScore(existing.score);
        setIsPrivate(existing.isPrivate);
      } else {
        setTitle('');
        setDescription('');
        setCoverPhoto('');
        setPrepTime(0);
        setCookTime(0);
        setServings(4);
        setDifficulty('Medium');
        setCuisine('');
        setIngredients([]);
        setSteps([]);
        setPhotos([]);
        setSelectedTags([]);
        setScore(7);
        setIsPrivate(false);
      }
      setPage('main');
      setConfirmDelete(false);
      setNewIngredientName('');
      setNewIngredientAmount('');
      setNewIngredientUnit('');
      setNewStep('');
      setTagSearch('');
      setSelectedPhotoIdx(null);
    }
  }, [addRecipeModalOpen, existing]);

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
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const compressed = await compressImage(file);
    setCoverPhoto(compressed);
    e.target.value = '';
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
    const newPhotos: PhotoItem[] = [];
    for (const file of imageFiles) {
      try {
        const compressed = await compressImage(file);
        newPhotos.push({ url: compressed, caption: '', isFavorite: false });
      } catch { /* skip */ }
    }
    setPhotos((prev) => [...prev, ...newPhotos]);
    e.target.value = '';
  };

  const addIngredient = () => {
    if (!newIngredientName.trim()) return;
    setIngredients((prev) => [...prev, { name: newIngredientName.trim(), amount: newIngredientAmount.trim(), unit: newIngredientUnit.trim() }]);
    setNewIngredientName('');
    setNewIngredientAmount('');
    setNewIngredientUnit('');
  };

  const removeIngredient = (idx: number) => setIngredients((prev) => prev.filter((_, i) => i !== idx));

  const addStep = () => {
    if (!newStep.trim()) return;
    setSteps((prev) => [...prev, newStep.trim()]);
    setNewStep('');
  };

  const removeStep = (idx: number) => setSteps((prev) => prev.filter((_, i) => i !== idx));

  const toggleTag = (tag: string) => setSelectedTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]);

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

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return RECIPE_TAGS;
    const q = tagSearch.toLowerCase();
    return RECIPE_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagSearch]);

  const handleSave = () => {
    if (!title.trim() || !addRecipeModalListId) return;
    const recipeData: Recipe = {
      id: existing?.id || `recipe-${Date.now()}`,
      title: title.trim(),
      description: description.trim(),
      coverPhoto,
      prepTime,
      cookTime,
      servings,
      difficulty,
      cuisine: cuisine.trim(),
      ingredients,
      steps,
      photos,
      tags: selectedTags,
      score,
      isPrivate,
      createdAt: existing?.createdAt || Date.now(),
    };
    if (existing) {
      updateRecipe(addRecipeModalListId, existing.id, recipeData);
    } else {
      addRecipe(addRecipeModalListId, recipeData);
    }
    closeAddRecipeModal();
  };

  const handleDelete = () => {
    if (!existing || !addRecipeModalListId) return;
    removeRecipe(addRecipeModalListId, existing.id);
    closeAddRecipeModal();
  };

  const scoreClr = scoreColorLight(score);
  const scoreBg = scoreBgGradient(score);
  const scoreRing = scoreRingColor(score);

  const hasIngredients = ingredients.length > 0;
  const hasSteps = steps.length > 0;
  const hasPhotos = photos.length > 0;
  const hasTags = selectedTags.length > 0;

  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;
  const coverInput = <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />;

  return (
    <>
    <AnimatePresence>
      {addRecipeModalOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className={cn("fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex justify-center",
            phoneMode ? "items-end" : "items-end sm:items-center"
          )}
          onClick={closeAddRecipeModal}
        >
          <motion.div
            initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            {...dragProps}
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
                    <h2 className="font-serif font-bold text-lg">{existing ? 'Edit Recipe' : 'New Recipe'}</h2>
                    <button onClick={closeAddRecipeModal} className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"><X size={20} /></button>
                  </div>

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4">
                    {/* Cover photo */}
                    <button onClick={() => coverInputRef.current?.click()}
                      className="w-full h-36 rounded-2xl border-2 border-dashed border-on-surface/15 flex flex-col items-center justify-center gap-2 mb-5 overflow-hidden hover:border-primary/30 transition-colors relative">
                      {coverPhoto ? (
                        <>
                          <img src={coverPhoto} alt="Cover" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <Camera size={24} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <Camera size={24} className="text-on-surface/25" />
                          <span className="text-xs text-on-surface/35 font-medium">Add cover photo</span>
                        </>
                      )}
                    </button>

                    {/* Recipe title */}
                    <div className="mb-4">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Recipe Title</label>
                      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g. Grandma's Lasagna"
                        className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                    </div>

                    {/* Description */}
                    <div className="mb-4">
                      <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5 block">Description</label>
                      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                        placeholder="A brief description of this recipe..."
                        rows={3}
                        className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none" />
                    </div>

                    <div className="border-t border-on-surface/6 pt-4 mb-4">
                      {/* Quick info */}
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-3">Quick Info</p>
                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <Clock size={12} className="text-on-surface/35" />
                            <span className="text-[10px] font-semibold text-on-surface/45">Prep</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <input type="number" value={prepTime} onChange={(e) => setPrepTime(Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2 px-3 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-primary/20" />
                            <span className="text-[10px] text-on-surface/35 flex-shrink-0">min</span>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <Flame size={12} className="text-on-surface/35" />
                            <span className="text-[10px] font-semibold text-on-surface/45">Cook</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <input type="number" value={cookTime} onChange={(e) => setCookTime(Math.max(0, parseInt(e.target.value) || 0))}
                              className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2 px-3 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-primary/20" />
                            <span className="text-[10px] text-on-surface/35 flex-shrink-0">min</span>
                          </div>
                        </div>
                        <div>
                          <div className="flex items-center gap-1 mb-1.5">
                            <Users size={12} className="text-on-surface/35" />
                            <span className="text-[10px] font-semibold text-on-surface/45">Servings</span>
                          </div>
                          <input type="number" value={servings} onChange={(e) => setServings(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2 px-3 text-sm font-medium text-center focus:outline-none focus:ring-2 focus:ring-primary/20" />
                        </div>
                      </div>

                      {/* Difficulty — Easy/Medium/Hard → green/amber/red */}
                      <div className="mb-4">
                        <span className="text-[10px] font-semibold text-on-surface/45 mb-1.5 block">Difficulty</span>
                        <div className="flex gap-2">
                          {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
                            <button key={d} onClick={() => setDifficulty(d)}
                              className={cn("flex-1 py-2 rounded-xl text-xs font-bold border transition-all",
                                difficulty === d ? DIFFICULTY_COLORS[d] : "border-on-surface/10 text-on-surface/50 hover:border-on-surface/20"
                              )}>{d}</button>
                          ))}
                        </div>
                      </div>

                      {/* Cuisine */}
                      <div className="mb-4">
                        <span className="text-[10px] font-semibold text-on-surface/45 mb-1.5 block">Cuisine</span>
                        <input type="text" value={cuisine} onChange={(e) => setCuisine(e.target.value)}
                          placeholder="e.g. Italian, Mexican, Thai..."
                          className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                      </div>
                    </div>

                    {/* Rating slider */}
                    <div className="border-t border-on-surface/6 pt-4 mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-3">Rating</p>
                      <div className="flex flex-col items-center">
                        <div className={cn("relative w-24 h-24 rounded-full flex items-center justify-center mb-2 bg-gradient-to-b ring-4", scoreBg, scoreRing)}>
                          <div className="text-center">
                            <div className={cn("text-3xl font-serif font-bold tabular-nums transition-colors duration-300", scoreClr)}>{score.toFixed(1)}</div>
                            <div className="text-[7px] font-bold uppercase tracking-widest text-on-surface/30 mt-0.5">out of 10</div>
                          </div>
                        </div>
                        <div className="w-full max-w-[240px] mb-1">
                          <input type="range" min="1" max="10" step="0.1" value={score} onChange={(e) => setScore(parseFloat(e.target.value))}
                            className="w-full h-2 bg-on-surface/8 rounded-full appearance-none cursor-pointer accent-primary" />
                          <div className="flex justify-between mt-1 text-[10px] text-on-surface/25 font-semibold px-0.5">
                            <span>1</span><span>3</span><span>5</span><span>7</span><span>10</span>
                          </div>
                        </div>
                        <p className="text-xs font-medium text-on-surface/40 mb-2">
                          {score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                        </p>
                      </div>
                    </div>

                    {/* Recipe details navigation */}
                    <div className="border-t border-on-surface/6 pt-4 mb-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-2.5">Recipe Details</p>
                      <div className="space-y-2">
                        <DetailBtn icon={<Hash size={17} />} label="Ingredients" active={hasIngredients} sub={hasIngredients ? `${ingredients.length} items` : undefined} onClick={() => setPage('ingredients')} />
                        <DetailBtn icon={<FileText size={17} />} label="Steps" active={hasSteps} sub={hasSteps ? `${steps.length} steps` : undefined} onClick={() => setPage('steps')} />
                        <DetailBtn icon={<Image size={17} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={() => { if (photos.length === 0) fileInputRef.current?.click(); else setPage('photos'); }} />
                        <DetailBtn icon={<Tag size={17} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} />
                      </div>
                    </div>

                    {/* Private toggle */}
                    <div className="border-t border-on-surface/6 pt-4">
                      <button onClick={() => setIsPrivate(!isPrivate)}
                        className={cn("w-full flex items-center gap-3 px-3.5 py-3 rounded-xl border transition-all text-left",
                          isPrivate ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8"
                        )}>
                        <Lock size={17} className={isPrivate ? "text-primary" : "text-on-surface/30"} />
                        <span className={cn("text-xs font-semibold flex-1", isPrivate ? "text-primary" : "text-on-surface/50")}>Private</span>
                        <span className="text-[11px] text-on-surface/35">{isPrivate ? 'Only you can see this' : 'Visible to others'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Save button */}
                  <div className="px-5 py-4 flex-shrink-0 border-t border-on-surface/6 bg-surface space-y-2">
                    <button onClick={handleSave} disabled={!title.trim()}
                      className="w-full py-3.5 bg-accent text-white rounded-2xl font-semibold text-sm active:scale-[0.98] transition-transform disabled:opacity-40">
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
                    {/* Add ingredient form — flat inputs */}
                    <div className="mb-5 space-y-2">
                      <input type="text" value={newIngredientName} onChange={(e) => setNewIngredientName(e.target.value)}
                        placeholder="Ingredient name"
                        className="w-full bg-on-surface/[0.04] rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                      <div className="flex gap-2">
                        <input type="text" value={newIngredientAmount} onChange={(e) => setNewIngredientAmount(e.target.value)}
                          placeholder="Amount"
                          className="flex-1 bg-on-surface/[0.04] rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                        <input type="text" value={newIngredientUnit} onChange={(e) => setNewIngredientUnit(e.target.value)}
                          placeholder="Unit (cups, g…)"
                          className="flex-1 bg-on-surface/[0.04] rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30" />
                      </div>
                      <button onClick={addIngredient} disabled={!newIngredientName.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-primary/15">
                        <Plus size={14} />Add Ingredient
                      </button>
                    </div>

                    {/* Ingredient list — flat numbered rows with generous line-height */}
                    {ingredients.length === 0 ? (
                      <div className="text-center py-10">
                        <Hash size={28} className="mx-auto text-on-surface/15 mb-2" />
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
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ STEPS ═══════════ */}
              {page === 'steps' && (
                <SubPage key="steps" onBack={() => setPage('main')} title="Steps">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4" onTouchMove={(e) => e.stopPropagation()}>
                    {/* Add step form — flat */}
                    <div className="mb-6 space-y-2">
                      <textarea value={newStep} onChange={(e) => setNewStep(e.target.value)}
                        placeholder={`Step ${steps.length + 1} — What to do...`}
                        rows={4}
                        className="w-full bg-on-surface/[0.04] rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none placeholder:text-on-surface/30" />
                      <button onClick={addStep} disabled={!newStep.trim()}
                        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-primary/15">
                        <Plus size={14} />Add Step
                      </button>
                    </div>

                    {/* Steps list — editorial "Step N" labels, no card chrome */}
                    {steps.length === 0 ? (
                      <div className="text-center py-10">
                        <FileText size={28} className="mx-auto text-on-surface/15 mb-2" />
                        <p className="text-sm text-on-surface/30">No steps yet</p>
                      </div>
                    ) : (
                      <ol className="space-y-5">
                        {steps.map((step, idx) => (
                          <li key={idx} className="flex gap-3">
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-primary mb-1">Step {idx + 1}</p>
                              <p className="text-[15px] text-on-surface/80 leading-[1.6] whitespace-pre-wrap">{step}</p>
                            </div>
                            <button onClick={() => removeStep(idx)} className="p-1 -mr-1 text-on-surface/25 hover:text-red-500 transition-colors flex-shrink-0" aria-label="Remove step">
                              <X size={14} />
                            </button>
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ PHOTOS ═══════════ */}
              {page === 'photos' && (
                <SubPage key="photos" onBack={() => setPage('main')} title="Photos" rightAction={
                  <button onClick={() => fileInputRef.current?.click()} className="text-xs font-semibold text-primary">Add More</button>
                }>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" onTouchMove={(e) => e.stopPropagation()}>
                    {photos.length === 0 ? (
                      <div className="px-5 py-16 flex flex-col items-center justify-center text-on-surface/30">
                        <Camera size={28} className="mb-2" />
                        <p className="text-sm font-semibold">No photos yet</p>
                        <button onClick={() => fileInputRef.current?.click()} className="mt-3 text-primary text-sm font-semibold">Add Photos</button>
                      </div>
                    ) : (
                      <>
                        {/* Edge-to-edge 3-column grid */}
                        <div className="grid grid-cols-3 gap-0.5">
                          {photos.map((photo, idx) => {
                            const selected = selectedPhotoIdx === idx;
                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => setSelectedPhotoIdx(selected ? null : idx)}
                                className="group relative aspect-square overflow-hidden rounded-md bg-on-surface/5"
                              >
                                <img src={photo.url} alt="" className="w-full h-full object-cover" />
                                {selected && (
                                  <div className="absolute inset-0 ring-2 ring-inset ring-primary rounded-md pointer-events-none" />
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removePhoto(idx); }}
                                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/55 flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                                  aria-label="Remove photo"
                                >
                                  <X size={10} className="text-white" strokeWidth={2.5} />
                                </button>
                              </button>
                            );
                          })}
                        </div>

                        {/* Inline edit panel for the selected photo */}
                        {selectedPhotoIdx !== null && photos[selectedPhotoIdx] && (
                          <div className="px-5 py-4 border-t border-on-surface/6 mt-0.5 space-y-3">
                            <input
                              type="text"
                              value={photos[selectedPhotoIdx].caption}
                              onChange={(e) => updatePhotoCaption(selectedPhotoIdx, e.target.value)}
                              placeholder="Add a caption..."
                              className="w-full bg-on-surface/[0.04] rounded-xl px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface/30"
                            />
                            <div className="flex items-center justify-between">
                              <span className="text-[11px] text-on-surface/40 font-semibold">
                                Photo {selectedPhotoIdx + 1} of {photos.length}
                              </span>
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  disabled={selectedPhotoIdx === 0}
                                  onClick={() => { movePhoto(selectedPhotoIdx, selectedPhotoIdx - 1); setSelectedPhotoIdx(selectedPhotoIdx - 1); }}
                                  className="p-2 rounded-lg bg-on-surface/[0.04] text-on-surface/60 disabled:opacity-30 hover:bg-on-surface/[0.08] transition-colors"
                                  aria-label="Move left"
                                >
                                  <ChevronLeft size={15} />
                                </button>
                                <button
                                  type="button"
                                  disabled={selectedPhotoIdx === photos.length - 1}
                                  onClick={() => { movePhoto(selectedPhotoIdx, selectedPhotoIdx + 1); setSelectedPhotoIdx(selectedPhotoIdx + 1); }}
                                  className="p-2 rounded-lg bg-on-surface/[0.04] text-on-surface/60 disabled:opacity-30 hover:bg-on-surface/[0.08] transition-colors"
                                  aria-label="Move right"
                                >
                                  <ChevronRight size={15} />
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <BottomBtn label={hasPhotos ? `Done (${photos.length})` : 'Done'} onClick={() => setPage('main')} />
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
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3" onTouchMove={(e) => e.stopPropagation()}>
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
            </AnimatePresence>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
};

/* ── Helper components ── */

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
