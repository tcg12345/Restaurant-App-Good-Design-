import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, ChevronLeft, ChevronRight, Tag, Image, UtensilsCrossed, Globe, Lock, Camera, Trash2, Search, Star, BookOpen, Clock, Flame, Users, Hash, FileText, ChevronDown, ClipboardPaste, Gauge, FileUp, Sparkles, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { scoreColorLight } from '../lib/score';
import { useLists, type PhotoItem, type HomeMealDish, type RecipeIngredient, type HomeMeal } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { TimeWheelPicker, NumberWheelPicker } from './WheelPicker';
import { ImportRecipesModal } from './ImportRecipesModal';
import { useBottomSheet } from '../lib/useBottomSheet';
import {
  UNITS,
  displayUnit,
  normalizeUnit,
  parseAmount,
  toFraction,
  displayAmount,
  parseIngredientLine,
  type BulkResult,
} from '../lib/ingredient-parsing';
import { AdvancedRecipeBuilder } from './AdvancedRecipeBuilder';
import { AiRecipeGenerator } from './AiRecipeGenerator';
import { RecipeDraftSheet } from './chat/RecipeDraftSheet';
import { refineRecipe } from '../lib/build-recipe-client';
import { generateRecipeImage } from '../lib/generate-recipe-image-client';
import { useAiChatHistory } from '../contexts/AiChatHistoryContext';
import { peekPendingResumeDraftId } from '../lib/recipe-drafts';

/* ── Tab-mode preference (sticky across sessions) ────────────── */
const MODE_KEY = 'gourmad-recipe-builder-mode';
const loadMode = (): 'basic' | 'advanced' => {
  try { return localStorage.getItem(MODE_KEY) === 'advanced' ? 'advanced' : 'basic'; }
  catch { return 'basic'; }
};
const saveMode = (m: 'basic' | 'advanced') => {
  try { localStorage.setItem(MODE_KEY, m); } catch { /* quota — skip */ }
};

type BuilderMode = 'basic' | 'advanced' | 'ai';

interface TabToggleProps {
  mode: BuilderMode;
  onChange: (m: BuilderMode) => void;
  forceAdvanced?: boolean;
  /** Show the AI segment. Only offered for brand-new recipes — editing
   *  an existing meal hides it. */
  showAi?: boolean;
}
const TabToggle: React.FC<TabToggleProps> = ({ mode, onChange, forceAdvanced, showAi }) => (
  <div className="arb-tab-toggle" role="tablist" aria-label="Recipe builder mode">
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'basic'}
      className={mode === 'basic' ? 'is-active' : ''}
      onClick={() => onChange('basic')}
      disabled={!!forceAdvanced}
      title={forceAdvanced ? 'This recipe was built with Advanced — it has fields Basic can\'t round-trip.' : undefined}
    >
      Basic
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={mode === 'advanced'}
      className={mode === 'advanced' ? 'is-active' : ''}
      onClick={() => onChange('advanced')}
    >
      Advanced
    </button>
    {showAi && (
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'ai'}
        className={cn('arb-tab-ai', mode === 'ai' ? 'is-active' : '')}
        onClick={() => onChange('ai')}
      >
        <Sparkles size={13} />
        AI
      </button>
    )}
  </div>
);

const HOME_COOKING_TAGS = [
  'Italian Night', 'Meal Prep', 'Holiday Meal', 'Grilling', 'Baking',
  'Quick Meal', 'Comfort Food', 'Date Night In', 'Family Recipe',
  'Healthy', 'Indulgent', 'Breakfast', 'Lunch', 'Dinner', 'Dessert',
  'Snack', 'Brunch', 'BBQ', 'One-Pot', 'Slow Cooker', 'Air Fryer',
];

// Standardized difficulty palette shared across all three recipe modals:
// Easy → green, Medium → amber, Hard → red.
const DIFFICULTY_COLORS: Record<'Easy' | 'Medium' | 'Hard', string> = {
  Easy: 'border-green-200 bg-green-50 text-green-700',
  Medium: 'border-amber-200 bg-amber-50 text-amber-700',
  Hard: 'border-red-200 bg-red-50 text-red-700',
};

// Short rationales shown next to each option in the difficulty sheet so the
// user understands what the three levels actually mean.
const DIFFICULTY_DESC: Record<'Easy' | 'Medium' | 'Hard', string> = {
  Easy: 'Quick to make, forgiving, weeknight-friendly',
  Medium: 'Needs some attention or a few techniques',
  Hard: 'Involved prep, timing, or advanced techniques',
};

// Solid text-only colors used when rendering the current difficulty in the
// Quick Info cell (no background — the cell itself already has a tinted wash).
const DIFFICULTY_TEXT: Record<'Easy' | 'Medium' | 'Hard', string> = {
  Easy: 'text-green-600',
  Medium: 'text-amber-600',
  Hard: 'text-red-500',
};

// Raw hex equivalents used by the desktop "Quick add" cards, which live in
// the .advanced-recipe-builder shell (warm palette, no Tailwind tokens).
const DIFFICULTY_HEX: Record<'Easy' | 'Medium' | 'Hard', string> = {
  Easy: '#2E7D5C',
  Medium: '#E8A33C',
  Hard: '#C0473A',
};

// Formats a minute total into a short, glanceable string like "1h 30m".
// Returns null for any zero/negative total so callers can render a placeholder.
const formatDuration = (totalMinutes: number): string | null => {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return null;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
};

type Page = 'main' | 'tags' | 'photos' | 'dishList' | 'dishes' | 'ingredients' | 'steps';

export const AddHomeMealModal: React.FC = () => {
  const {
    homeMealModalOpen, homeMealModalData, homeMealModalBackToDraft, closeHomeMealModal,
    createHomeMeal, updateHomeMeal, deleteHomeMeal,
  } = useLists();
  const { phoneMode } = useSettings();
  const { myRecipes } = useRecipes();
  const { dragProps } = useBottomSheet(homeMealModalOpen, closeHomeMealModal);
  const { showToast } = useToast();
  const { addGeneratedRecipeChat } = useAiChatHistory();
  const navigate = useNavigate();
  const auth = useAuth();
  const userId = auth.user?.id || null;

  const existing = homeMealModalData;

  // Basic vs Advanced tab. Recipes published via the Advanced builder
  // carry `builderVersion: 'advanced'` so re-opening them forces the
  // Advanced tab — Basic doesn't have the fields to round-trip rich
  // data. Same forcing happens when the user resumed an Advanced
  // draft from Activity (pending-resume flag is set in localStorage).
  // When editing a Basic meal, open Basic. Otherwise (new recipe),
  // default to the user's last-used tab.
  const forceAdvanced = !!(existing && existing.builderVersion === 'advanced');
  const [mode, setMode] = useState<BuilderMode>(() => {
    if (forceAdvanced) return 'advanced';
    // Pending resume from Activity → Recipe drafts always lands the
    // user on Advanced (Basic can't render an Advanced draft anyway).
    if (peekPendingResumeDraftId()) return 'advanced';
    if (existing) return 'basic';
    return loadMode();
  });

  // ── Create-with-AI state ──
  // `aiDraft`  — the generated recipe shown in the RecipeDraftSheet
  //              preview (reuses the exact sheet from the main chat).
  // `aiSeed`   — set when the user taps Edit in that sheet; pre-fills
  //              the Advanced builder as a NEW recipe for fine-tuning.
  const [aiDraft, setAiDraft] = useState<HomeMeal | null>(null);
  const [aiSeed, setAiSeed] = useState<HomeMeal | null>(null);

  // Re-evaluate when the modal opens with a different `existing` meal
  // or a new pending-resume flag.
  useEffect(() => {
    if (forceAdvanced) setMode('advanced');
    else if (peekPendingResumeDraftId()) setMode('advanced');
    else if (existing) setMode('basic');
  }, [forceAdvanced, existing, homeMealModalOpen]);
  const handleModeChange = (m: BuilderMode) => {
    if (forceAdvanced && m === 'basic') return;
    setMode(m);
    // The AI tab is transient — never persist it as the sticky default.
    if (m !== 'ai') saveMode(m);
  };

  // Hand-off from the AI generator: stash the generated recipe and open
  // the preview sheet. Nothing is saved to the cookbook yet — the user
  // publishes (or edits) from the sheet. We also record the draft into the
  // assistant's chat history so a recipe generated here shows up there too,
  // exactly like one drafted in a conversation.
  const handleAiGenerated = (meal: HomeMeal, meta?: { prompt: string; rawInput: unknown }) => {
    setAiDraft(meal);
    if (meta) addGeneratedRecipeChat({ prompt: meta.prompt, draft: meal, rawInput: meta.rawInput });
  };

  // Publish straight from the AI preview sheet.
  const handleAiPublish = (meal: HomeMeal) => {
    const { id: _id, createdAt: _createdAt, ...payload } = meal;
    const created = createHomeMeal(payload);
    setAiDraft(null);
    closeHomeMealModal();
    showToast('Recipe published', { variant: 'success' });
    // Route to the saved recipe. Prefer the canonical
    // /recipe/<userId>/<id> when we have an id; fall back to the
    // userId-less alias so the user still lands on the page even if
    // the auth context is briefly out of sync.
    if (created?.id) {
      const target = userId
        ? `/recipe/${userId}/${created.id}`
        : `/recipe/${created.id}`;
      setTimeout(() => navigate(target), 80);
    }
  };

  // Refine the in-preview AI draft with a free-text instruction. The
  // AI returns the full revised recipe (merged over the current draft
  // so cover photo etc. survive); swap it into place.
  const handleAiRefine = async (instruction: string): Promise<{ ok: boolean; error?: string }> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to refine.' };
    const res = await refineRecipe(aiDraft, instruction);
    if (res.ok && res.meal) {
      setAiDraft(res.meal);
      return { ok: true };
    }
    return { ok: false, error: res.error };
  };

  // Edit from the AI preview sheet → seed the Advanced builder (as a
  // brand-new recipe) and switch to it so the user can fine-tune.
  const handleAiEdit = (meal: HomeMeal) => {
    setAiSeed(meal);
    setAiDraft(null);
    setMode('advanced');
  };

  // "Back to AI draft" from the Advanced builder. Two origins:
  //  • Modal "Create with AI" Edit → aiSeed is set; reopen the local
  //    draft sheet and drop back to the AI tab behind it.
  //  • Chat Edit → the chat passed a reopen callback via
  //    openHomeMealModal(..., { onBackToDraft }); close this modal and
  //    fire it to re-surface the chat's draft sheet.
  const backToDraft = aiSeed
    ? () => { setAiDraft(aiSeed); setAiSeed(null); setMode('ai'); }
    : homeMealModalBackToDraft
      ? () => { const cb = homeMealModalBackToDraft; closeHomeMealModal(); cb(); }
      : undefined;

  // Attach / clear a cover photo on the in-preview AI draft.
  const handleAiCoverChange = (dataUrl: string | null) => {
    setAiDraft((prev) =>
      prev
        ? {
            ...prev,
            coverPhoto: dataUrl || undefined,
            photos: dataUrl
              ? Array.from(new Set([dataUrl, ...(prev.photos || [])]))
              : (prev.photos || []).filter((p) => p !== prev.coverPhoto),
          }
        : prev,
    );
  };

  // Generate an AI hero photo of the finished dish. The sheet compresses
  // the result and applies it via handleAiCoverChange.
  const handleAiGenerateImage = async (): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
    if (!aiDraft) return { ok: false, error: 'No recipe to picture yet.' };
    return generateRecipeImage(aiDraft);
  };

  const [mealName, setMealName] = useState('');
  const [score, setScore] = useState(0);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldMakeAgain, setWouldMakeAgain] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [dishes, setDishes] = useState<HomeMealDish[]>([]);
  const [isPublic, setIsPublic] = useState(false);

  // Recipe-like fields. Prep / cook / servings are all stored as plain
  // numbers (minute totals and an integer count) because the wheel pickers
  // commit final numeric values directly — there's no text-field edit state
  // to preserve between keystrokes.
  const [coverPhoto, setCoverPhoto] = useState('');
  const [prepMinutesTotal, setPrepMinutesTotal] = useState(0);
  const [cookMinutesTotal, setCookMinutesTotal] = useState(0);
  const [servings, setServings] = useState<number | null>(null);
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<string[]>([]);

  // Quick Info picker open-state flags.
  const [prepPickerOpen, setPrepPickerOpen] = useState(false);
  const [cookPickerOpen, setCookPickerOpen] = useState(false);
  const [servingsPickerOpen, setServingsPickerOpen] = useState(false);
  const [difficultyPickerOpen, setDifficultyPickerOpen] = useState(false);
  const [importRecipesOpen, setImportRecipesOpen] = useState(false);

  // Ingredient/step form state
  const [newIngredientName, setNewIngredientName] = useState('');
  const [newIngredientAmount, setNewIngredientAmount] = useState('');
  const [newIngredientUnit, setNewIngredientUnit] = useState('');
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false);
  const [unitSearch, setUnitSearch] = useState('');
  const [ingredientMode, setIngredientMode] = useState<'single' | 'bulk'>('single');
  const [bulkIngredientsText, setBulkIngredientsText] = useState('');
  const [editingIngredientIdx, setEditingIngredientIdx] = useState<number | null>(null);
  const [ingredientError, setIngredientError] = useState<string | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkResult[]>([]);
  const [newStep, setNewStep] = useState('');

  // Dish editing state
  const [editingDishId, setEditingDishId] = useState<string | null>(null);
  const [dishName, setDishName] = useState('');
  const [dishDescription, setDishDescription] = useState('');
  const [dishPhoto, setDishPhoto] = useState('');
  const [confirmDishDelete, setConfirmDishDelete] = useState(false);
  const [recipePickerOpen, setRecipePickerOpen] = useState(false);
  const [recipeSearch, setRecipeSearch] = useState('');

  const [tagSearch, setTagSearch] = useState('');
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState<number | null>(null);

  const [page, setPage] = useState<Page>('main');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dishPhotoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  // Desktop "Quick add" rail acts as a table of contents that scrolls the
  // pane body to each section. Refs target the section wrappers; the active
  // entry highlights as the matching section is clicked / scrolled into view.
  const basicPaneRef = useRef<HTMLDivElement>(null);
  const basicSectionRefs = {
    cover: useRef<HTMLDivElement>(null),
    quick: useRef<HTMLDivElement>(null),
    rating: useRef<HTMLDivElement>(null),
    details: useRef<HTMLDivElement>(null),
  };
  const [activeBasicSection, setActiveBasicSection] = useState<'cover' | 'quick' | 'rating' | 'details'>('cover');
  const scrollToBasicSection = (key: 'cover' | 'quick' | 'rating' | 'details') => {
    setActiveBasicSection(key);
    basicSectionRefs[key].current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    if (homeMealModalOpen) {
      setMealName(existing?.name ?? '');
      setScore(existing?.score ?? 0);
      setNotes(existing?.description ?? '');
      setVisitDate(existing?.date ?? new Date().toISOString().slice(0, 10));
      setWouldMakeAgain(existing?.wouldMakeAgain ?? true);
      setSelectedTags(existing?.tags ?? []);
      setPhotos(existing?.photos ?? []);
      setDishes(existing?.dishes ?? []);
      setIsPublic(existing?.isPublic ?? false);
      setCoverPhoto(existing?.coverPhoto ?? '');
      setPrepMinutesTotal(existing?.prepTime ?? 0);
      setCookMinutesTotal(existing?.cookTime ?? 0);
      setServings(existing?.servings ?? null);
      setDifficulty(existing?.difficulty ?? 'Medium');
      setPrepPickerOpen(false);
      setCookPickerOpen(false);
      setServingsPickerOpen(false);
      setDifficultyPickerOpen(false);
      setIngredients(existing?.ingredients ? [...existing.ingredients] : []);
      setSteps(existing?.steps ? [...existing.steps] : []);
      setNewIngredientName('');
      setNewIngredientAmount('');
      setNewIngredientUnit('');
      setUnitDropdownOpen(false);
      setUnitSearch('');
      setIngredientMode('single');
      setBulkIngredientsText('');
      setEditingIngredientIdx(null);
      setIngredientError(null);
      setBulkResults([]);
      setNewStep('');
      setSelectedPhotoIdx(null);
      setEditingDishId(null);
      setDishName('');
      setDishDescription('');
      setDishPhoto('');
      setConfirmDishDelete(false);
      setTagSearch('');
      setPage('main');
      setConfirmDelete(false);
      // Clear any leftover AI draft / seed from a previous session.
      setAiDraft(null);
      setAiSeed(null);
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

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const compressed = await compressImage(file);
    setCoverPhoto(compressed);
    e.target.value = '';
  };

  // Builds a normalized RecipeIngredient from form state, returning either the
  // ingredient or a user-facing error message. Validates that amount (if given)
  // is numeric and converts it to a fraction; normalizes the unit label and
  // picks singular/plural based on the amount.
  const buildIngredient = (
    name: string,
    amountRaw: string,
    unitRaw: string,
  ): { ok: true; ingredient: RecipeIngredient } | { ok: false; error: string } => {
    if (!name.trim()) return { ok: false, error: 'Ingredient name is required.' };
    const amtTrim = amountRaw.trim();
    let amountNum: number | null = null;
    let finalAmount = '';
    if (amtTrim) {
      amountNum = parseAmount(amtTrim);
      if (amountNum === null) {
        return { ok: false, error: `"${amtTrim}" is not a valid number.` };
      }
      finalAmount = toFraction(amountNum);
    }
    const unitTrim = unitRaw.trim();
    let finalUnit = '';
    if (unitTrim) {
      const normalized = normalizeUnit(unitTrim);
      if (!normalized) {
        return { ok: false, error: `"${unitTrim}" is not a recognized unit.` };
      }
      finalUnit = displayUnit(normalized, amountNum);
    }
    return {
      ok: true,
      ingredient: { name: name.trim(), amount: finalAmount, unit: finalUnit },
    };
  };

  const saveIngredient = () => {
    const result = buildIngredient(newIngredientName, newIngredientAmount, newIngredientUnit);
    if (!result.ok) {
      setIngredientError(result.error);
      return;
    }
    setIngredients((prev) => {
      if (editingIngredientIdx !== null) {
        return prev.map((ing, i) => (i === editingIngredientIdx ? result.ingredient : ing));
      }
      return [...prev, result.ingredient];
    });
    setNewIngredientName('');
    setNewIngredientAmount('');
    setNewIngredientUnit('');
    setEditingIngredientIdx(null);
    setIngredientError(null);
  };

  const startEditIngredient = (idx: number) => {
    const ing = ingredients[idx];
    if (!ing) return;
    setNewIngredientName(ing.name);
    setNewIngredientAmount(ing.amount);
    // Normalize the stored unit back to its plural dropdown label so the
    // dropdown value is selectable; fall back to the raw string if unknown.
    setNewIngredientUnit(normalizeUnit(ing.unit) || '');
    setEditingIngredientIdx(idx);
    setIngredientError(null);
    setIngredientMode('single');
  };

  const cancelEditIngredient = () => {
    setNewIngredientName('');
    setNewIngredientAmount('');
    setNewIngredientUnit('');
    setEditingIngredientIdx(null);
    setIngredientError(null);
  };

  const addBulkIngredients = () => {
    const lines = bulkIngredientsText.split('\n');
    const parsedIngredients: RecipeIngredient[] = [];
    const remainingLines: string[] = [];
    const results: BulkResult[] = [];
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const parsed = parseIngredientLine(trimmed);
      if (!parsed || (!parsed.name && !parsed.amount)) {
        results.push({ line: trimmed, status: 'error', message: "Couldn't parse line." });
        remainingLines.push(line);
        return;
      }
      const built = buildIngredient(parsed.name, parsed.amount, parsed.unit);
      if (!built.ok) {
        results.push({ line: trimmed, status: 'error', message: built.error });
        remainingLines.push(line);
        return;
      }
      parsedIngredients.push(built.ingredient);
      results.push({ line: trimmed, status: 'success', ingredient: built.ingredient });
    });
    if (parsedIngredients.length > 0) {
      setIngredients((prev) => [...prev, ...parsedIngredients]);
    }
    setBulkIngredientsText(remainingLines.join('\n'));
    setBulkResults(results);
  };

  const removeIngredient = (idx: number) => {
    setIngredients((prev) => prev.filter((_, i) => i !== idx));
    // If we were editing this row, clear the form.
    if (editingIngredientIdx === idx) cancelEditIngredient();
    else if (editingIngredientIdx !== null && editingIngredientIdx > idx) {
      setEditingIngredientIdx(editingIngredientIdx - 1);
    }
  };

  const filteredUnits = useMemo(() => {
    const labels = ['', ...UNITS.map((u) => u.label)];
    if (!unitSearch.trim()) return labels;
    const q = unitSearch.toLowerCase();
    // Match on label, singular form, or any alias so search works for
    // "teaspoon" → tsp, "pound" → lbs, etc.
    return labels.filter((label) => {
      if (label === '') return '(none)'.includes(q);
      const def = UNITS.find((u) => u.label === label);
      if (!def) return label.toLowerCase().includes(q);
      if (def.label.toLowerCase().includes(q)) return true;
      if (def.singular.toLowerCase().includes(q)) return true;
      return def.aliases.some((a) => a.toLowerCase().includes(q));
    });
  }, [unitSearch]);

  const addStep = () => {
    if (!newStep.trim()) return;
    setSteps((prev) => [...prev, newStep.trim()]);
    setNewStep('');
  };

  const removeStep = (idx: number) => setSteps((prev) => prev.filter((_, i) => i !== idx));

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

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
    setSelectedPhotoIdx((cur) => (cur === null ? null : cur === idx ? null : cur > idx ? cur - 1 : cur));
  };
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
    setRecipePickerOpen(false);
    setRecipeSearch('');
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
    setPage('dishList');
  };

  const handleDeleteDish = () => {
    if (editingDishId) {
      setDishes((prev) => prev.filter((d) => d.id !== editingDishId));
    }
    setPage('dishList');
  };

  const handleSave = () => {
    if (!mealName.trim()) return;
    const mealData = {
      name: mealName.trim(),
      date: visitDate,
      score,
      wouldMakeAgain,
      description: notes,
      photos,
      tags: selectedTags,
      dishes,
      isPublic,
      coverPhoto,
      prepTime: prepMinutesTotal,
      cookTime: cookMinutesTotal,
      servings: servings != null && servings > 0 ? servings : 4,
      difficulty,
      ingredients,
      steps,
    };
    if (existing) {
      updateHomeMeal(existing.id, mealData);
    } else {
      createHomeMeal(mealData);
    }
    closeHomeMealModal();
  };

  const hasDishes = dishes.length > 0;
  const hasTags = selectedTags.length > 0;
  const hasPhotos = photos.length > 0;
  const hasIngredients = ingredients.length > 0;
  const hasSteps = steps.length > 0;

  const filteredTags = useMemo(() => {
    if (!tagSearch.trim()) return HOME_COOKING_TAGS;
    const q = tagSearch.toLowerCase();
    return HOME_COOKING_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagSearch]);

  const photoInput = <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />;

  // Picker sheets layer above the main modal at z-[200]. They're siblings of
  // the root modal so they stay mounted until their open-state goes false,
  // giving AnimatePresence a clean exit animation.
  const prepHours = Math.floor(prepMinutesTotal / 60);
  const prepMinutes = prepMinutesTotal % 60;
  const cookHours = Math.floor(cookMinutesTotal / 60);
  const cookMinutes = cookMinutesTotal % 60;

  return (
    <>
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
            {...((phoneMode && mode === 'basic' && page !== 'main') ? dragProps : {})}
            onClick={(e) => e.stopPropagation()}
            className={cn("bg-surface w-full overflow-hidden flex flex-col",
              phoneMode
                ? "h-full rounded-none"
                // The editorial rail layout needs a wide canvas. Advanced,
                // AI, and the Basic main page all use it on desktop; the
                // Basic sub-pages (dishes, ingredients, …) stay narrow.
                : (mode === 'advanced' || mode === 'ai' || (mode === 'basic' && page === 'main'))
                  ? "h-full sm:max-w-[1200px] sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl"
                  : "h-full sm:max-w-md sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl"
            )}
          >
            {mode === 'advanced' ? (
              <AdvancedRecipeBuilder
                key={aiSeed ? aiSeed.id : 'fresh'}
                existing={existing}
                seed={aiSeed}
                initialStep={aiSeed ? 6 : undefined}
                onClose={closeHomeMealModal}
                onBackToDraft={backToDraft}
                tabSlot={<TabToggle mode={mode} onChange={handleModeChange} forceAdvanced={forceAdvanced} showAi={!existing} />}
              />
            ) : mode === 'ai' ? (
              <AiRecipeGenerator
                onGenerated={handleAiGenerated}
                onClose={closeHomeMealModal}
                phoneMode={phoneMode}
                tabSlot={<TabToggle mode={mode} onChange={handleModeChange} forceAdvanced={forceAdvanced} showAi={!existing} />}
              />
            ) : (
              <>
            {photoInput}
            <input ref={dishPhotoInputRef} type="file" accept="image/*" onChange={handleDishPhotoUpload} className="hidden" />
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
            <AnimatePresence mode="wait">
              {/* ═══════════ MAIN PAGE (editorial rail + pane) ═══════════ */}
              {page === 'main' && (
                <motion.div key="main" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}
                  className="flex flex-col flex-1 min-h-0">
                  <div className={cn('advanced-recipe-builder', phoneMode && 'is-phone')}>
                    {!phoneMode && (
                      <button type="button" className="arb-pane-close" onClick={closeHomeMealModal} aria-label="Close">
                        <X size={18} />
                      </button>
                    )}

                    {/* Mobile sticky header — tab strip + title (replaces the rail). */}
                    {phoneMode && (
                      <header className="arb-m-header">
                        <div className="arb-m-tabs">
                          <TabToggle mode={mode} onChange={handleModeChange} forceAdvanced={forceAdvanced} showAi={!existing} />
                          <button type="button" className="arb-m-header-close" onClick={closeHomeMealModal} aria-label="Close">
                            <X size={16} />
                          </button>
                        </div>
                        <div className="arb-m-titleblock-left">
                          <div className="arb-m-header-eyebrow">{existing ? 'Edit recipe' : 'New recipe'}</div>
                          <div className="arb-m-header-title">{existing ? 'Update recipe' : 'Add a recipe'}</div>
                        </div>
                      </header>
                    )}

                    <div className="arb-shell">
                      {/* Left rail — table of contents (desktop only) */}
                      {!phoneMode && (
                      <nav className="arb-rail">
                        <div className="arb-rail-eyebrow">{existing ? 'Edit recipe' : 'New recipe'}</div>
                        <div className="arb-rail-title">The quick <em>way</em>.</div>
                        <div style={{ marginTop: 16 }}>
                          <TabToggle mode={mode} onChange={handleModeChange} forceAdvanced={forceAdvanced} showAi={!existing} />
                        </div>
                        {!existing && (
                          <button type="button" className="arb-rail-import" onClick={() => setImportRecipesOpen(true)}>
                            <FileUp size={13} /> Import recipes
                          </button>
                        )}
                        <ol className="arb-rail-steps is-toc">
                          {([
                            { key: 'cover', title: 'Cover & name', sub: 'Photo, title, description', icon: <Camera size={14} /> },
                            { key: 'quick', title: 'Quick info', sub: 'Time, servings, difficulty', icon: <Clock size={14} /> },
                            { key: 'rating', title: 'Your rating', sub: 'How it turned out', icon: <Star size={14} /> },
                            { key: 'details', title: 'Details', sub: 'Ingredients, steps, tags', icon: <Tag size={14} /> },
                          ] as const).map((s) => (
                            <button
                              key={s.key}
                              type="button"
                              className={`arb-rail-step is-toc${activeBasicSection === s.key ? ' is-current' : ''}`}
                              onClick={() => scrollToBasicSection(s.key)}
                            >
                              <span className="arb-rail-step-circle">{s.icon}</span>
                              <span className="arb-rail-step-text">
                                <span className="arb-rail-step-title">{s.title}</span>
                                <span className="arb-rail-step-sub">{s.sub}</span>
                              </span>
                            </button>
                          ))}
                        </ol>
                        <div className="arb-rail-foot">
                          <div className="arb-rail-foot-status">
                            <span className="dot" />
                            <span>{existing ? 'Editing recipe' : 'Draft saved'}</span>
                            <span style={{ marginLeft: 'auto' }}>Fill in what you know</span>
                          </div>
                        </div>
                      </nav>
                      )}

                      {/* Right pane */}
                      <div className="arb-pane">
                        <div className="arb-pane-head">
                          <div className="arb-pane-eyebrow">Quick add</div>
                          <h2 className="arb-pane-title">
                            {existing ? 'Update' : 'Add a'} <span className="arb-pane-title-accent">recipe</span>.
                          </h2>
                        </div>
                        <div className="arb-pane-body" ref={basicPaneRef}>
                          {/* Cover & name */}
                          <section className="arb-sec" ref={basicSectionRefs.cover}>
                            <button type="button" className="arb-cover-drop" onClick={() => coverInputRef.current?.click()}>
                              {coverPhoto ? (
                                <>
                                  <img src={coverPhoto} alt="Cover" />
                                  <span className="arb-cover-drop-edit"><Camera size={20} /></span>
                                </>
                              ) : (
                                <><Camera size={18} /> Add cover photo</>
                              )}
                            </button>
                            <input
                              type="text"
                              value={mealName}
                              onChange={(e) => setMealName(e.target.value)}
                              placeholder="Recipe name"
                              autoFocus={!phoneMode}
                              className="arb-input is-title"
                            />
                            <textarea
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              placeholder="A brief description…"
                              className="arb-textarea"
                              style={{ minHeight: 72 }}
                            />
                          </section>

                          {/* Quick info */}
                          <section className="arb-sec" ref={basicSectionRefs.quick}>
                            <div className="arb-sec-label">Quick info</div>
                            <div className="arb-qi-grid">
                              <QuickInfoCard icon={<Clock size={13} />} label="Prep time" value={formatDuration(prepMinutesTotal) ?? 'Not set'} empty={prepMinutesTotal <= 0} onClick={() => setPrepPickerOpen(true)} />
                              <QuickInfoCard icon={<Flame size={13} />} label="Cook time" value={formatDuration(cookMinutesTotal) ?? 'Not set'} empty={cookMinutesTotal <= 0} onClick={() => setCookPickerOpen(true)} />
                              <QuickInfoCard icon={<Users size={13} />} label="Servings" value={servings != null && servings > 0 ? String(servings) : 'Not set'} empty={servings == null || servings <= 0} onClick={() => setServingsPickerOpen(true)} />
                              <QuickInfoCard icon={<Gauge size={13} />} label="Difficulty" value={difficulty} valueColor={DIFFICULTY_HEX[difficulty]} onClick={() => setDifficultyPickerOpen(true)} />
                            </div>
                          </section>

                          {/* Your rating */}
                          <section className="arb-sec" ref={basicSectionRefs.rating}>
                            <div className="arb-sec-label">Your rating <span className="opt">optional</span></div>
                            <div className="arb-rating-card">
                              <div className="arb-rating-top">
                                <span className={cn('arb-rating-value', score <= 0 && 'is-empty')}>
                                  {score > 0 ? score.toFixed(1) : '—'}<span className="denom">/ 10</span>
                                </span>
                                <span className="arb-rating-hint">
                                  {score === 0 ? 'Slide to rate' : score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below average' : score >= 3 ? 'Poor' : 'Terrible'}
                                </span>
                              </div>
                              <input
                                type="range" min="0" max="10" step="0.1"
                                value={score}
                                onChange={(e) => setScore(parseFloat(e.target.value))}
                                className="arb-rating-slider"
                              />
                            </div>
                          </section>

                          {/* Details */}
                          <section className="arb-sec" ref={basicSectionRefs.details}>
                            <div className="arb-sec-label">Details</div>
                            <div className="arb-detail-list">
                              <DetailListRow icon={<UtensilsCrossed size={16} />} label="Dishes" active={hasDishes} sub={hasDishes ? `${dishes.length} ${dishes.length === 1 ? 'dish' : 'dishes'}` : 'None yet'} onClick={() => setPage('dishList')} />
                              <DetailListRow icon={<Hash size={16} />} label="Ingredients" active={hasIngredients} sub={hasIngredients ? `${ingredients.length} items` : 'None yet'} onClick={() => setPage('ingredients')} />
                              <DetailListRow icon={<FileText size={16} />} label="Steps" active={hasSteps} sub={hasSteps ? `${steps.length} steps` : 'None yet'} onClick={() => setPage('steps')} />
                              <DetailListRow icon={<Image size={16} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : 'None yet'} onClick={handlePhotosClick} />
                              <DetailListRow icon={<Tag size={16} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : 'None yet'} onClick={() => setPage('tags')} />
                            </div>
                          </section>

                          {/* Visibility */}
                          <section className="arb-sec">
                            <div className="arb-sec-label">Visibility</div>
                            <button type="button" className={cn('arb-visibility', isPublic && 'is-public')} onClick={() => setIsPublic(!isPublic)}>
                              <span className="arb-visibility-icon">{isPublic ? <Globe size={16} /> : <Lock size={16} />}</span>
                              <span className="arb-visibility-text">
                                <div className="arb-visibility-title">{isPublic ? 'Public' : 'Private'}</div>
                                <div className="arb-visibility-sub">{isPublic ? 'Friends can see this recipe' : 'Only you can see this recipe'}</div>
                              </span>
                              <span className="arb-visibility-side">{isPublic ? 'Friends' : 'Only you'}</span>
                            </button>
                          </section>

                          {existing && !confirmDelete && (
                            <button type="button" className="arb-basic-delete" onClick={() => setConfirmDelete(true)}>Delete recipe</button>
                          )}
                          {existing && confirmDelete && (
                            <div className="arb-basic-delete-confirm">
                              <p>Delete this recipe?</p>
                              <div className="row">
                                <button className="cancel" onClick={() => setConfirmDelete(false)}>Cancel</button>
                                <button className="confirm" onClick={() => { if (existing) { deleteHomeMeal(existing.id); } closeHomeMealModal(); }}>Delete</button>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Mobile footer dock — single primary action. */}
                        {phoneMode && (
                          <div className="arb-m-foot is-single">
                            <button type="button" className="arb-m-foot-primary" onClick={handleSave} disabled={!mealName.trim()}>
                              <Check size={16} /> {existing ? 'Update recipe' : 'Save recipe'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Desktop sticky footer */}
                    {!phoneMode && (
                      <div className="arb-foot">
                        <button type="button" className="arb-foot-back" onClick={closeHomeMealModal}>
                          <ArrowLeft size={16} /> Cancel
                        </button>
                        <div className="arb-foot-right">
                          <button type="button" className="arb-foot-publish" onClick={handleSave} disabled={!mealName.trim()}>
                            <Check size={16} /> {existing ? 'Update recipe' : 'Save recipe'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}

              {/* ═══════════ DISH LIST ═══════════ */}
              {page === 'dishList' && (
                <SubPage
                  key="dishList"
                  onBack={() => setPage('main')}
                  title="Dishes"
                  rightAction={
                    <button onClick={() => openDishPage()} className="inline-flex items-center gap-1 text-xs font-semibold text-primary">
                      <Plus size={14} />Add
                    </button>
                  }
                >
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-5" onTouchMove={(e) => e.stopPropagation()}>
                    {dishes.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-14 text-center">
                        <UtensilsCrossed size={28} className="text-on-surface/15 mb-3" />
                        <p className="text-sm text-on-surface/35 font-medium">No dishes yet</p>
                        <p className="text-[11px] text-on-surface/30 mt-1 mb-4">Add individual dishes to log what you made.</p>
                        <button
                          onClick={() => openDishPage()}
                          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary/10 text-primary text-xs font-semibold hover:bg-primary/15 transition-colors"
                        >
                          <Plus size={14} />Add First Dish
                        </button>
                      </div>
                    ) : (
                      <ul className="divide-y divide-on-surface/[0.06] border-y border-on-surface/[0.06]">
                        {dishes.map((dish) => (
                          <li key={dish.id}>
                            <button
                              onClick={() => openDishPage(dish)}
                              className="w-full flex items-center gap-3 py-3.5 text-left hover:bg-on-surface/[0.02] transition-colors"
                            >
                              {dish.photo ? (
                                <img src={dish.photo} alt="" className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-12 h-12 rounded-xl bg-on-surface/[0.04] flex items-center justify-center flex-shrink-0">
                                  <UtensilsCrossed size={16} className="text-on-surface/25" />
                                </div>
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-semibold text-on-surface/85 truncate">{dish.name}</p>
                                {dish.description && (
                                  <p className="text-[12px] text-on-surface/45 truncate mt-0.5">{dish.description}</p>
                                )}
                              </div>
                              <ChevronRight size={16} className="text-on-surface/25 flex-shrink-0" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <BottomBtn label="Done" onClick={() => setPage('main')} />
                </SubPage>
              )}

              {/* ═══════════ DISHES ═══════════ */}
              {page === 'dishes' && (
                <SubPage key="dishes" onBack={() => setPage('dishList')} title={editingDishId ? 'Edit Dish' : 'Add Dish'}>
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

                    {/* Link Recipe */}
                    <div>
                      {(() => {
                        const currentDish = editingDishId ? dishes.find((d) => d.id === editingDishId) : null;
                        const linkedRecipe = currentDish?.recipeLink ? myRecipes.find((r) => r.id === currentDish.recipeLink) : null;
                        return (
                          <>
                            <button onClick={() => setRecipePickerOpen(!recipePickerOpen)}
                              className={cn("w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl border transition-all text-left",
                                linkedRecipe ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15"
                              )}>
                              <BookOpen size={17} className={cn("flex-shrink-0", linkedRecipe ? "text-primary" : "text-on-surface/25")} />
                              <span className={cn("text-xs font-semibold flex-1", linkedRecipe ? "text-primary" : "text-on-surface/40")}>
                                {linkedRecipe ? linkedRecipe.title : 'Link Recipe'}
                              </span>
                              {linkedRecipe && (
                                <button onClick={(e) => {
                                  e.stopPropagation();
                                  setDishes((prev) => prev.map((d) => d.id === editingDishId ? { ...d, recipeLink: '' } : d));
                                }} className="text-primary/40 hover:text-primary">
                                  <X size={13} />
                                </button>
                              )}
                              <ChevronRight size={14} className="text-on-surface/20 flex-shrink-0" />
                            </button>
                            <AnimatePresence>
                              {recipePickerOpen && (
                                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2 }} className="overflow-hidden">
                                  <div className="mt-2 border border-on-surface/8 rounded-xl bg-white overflow-hidden">
                                    <div className="px-3 py-2 border-b border-on-surface/6">
                                      <div className="relative">
                                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                                        <input type="text" value={recipeSearch} onChange={(e) => setRecipeSearch(e.target.value)}
                                          placeholder="Search recipes..." autoFocus
                                          className="w-full bg-on-surface/3 rounded-lg pl-8 pr-3 py-2 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                                      </div>
                                    </div>
                                    <div className="max-h-40 overflow-y-auto">
                                      {myRecipes.length === 0 ? (
                                        <div className="px-3 py-4 text-center">
                                          <BookOpen size={20} className="mx-auto text-on-surface/15 mb-1" />
                                          <p className="text-[11px] text-on-surface/30">No recipes yet</p>
                                        </div>
                                      ) : (
                                        (() => {
                                          const filtered = recipeSearch.trim()
                                            ? myRecipes.filter((r) => r.title.toLowerCase().includes(recipeSearch.toLowerCase()))
                                            : myRecipes;
                                          return filtered.length === 0 ? (
                                            <p className="px-3 py-4 text-center text-[11px] text-on-surface/30">No matching recipes</p>
                                          ) : filtered.map((recipe) => {
                                            const isLinked = currentDish?.recipeLink === recipe.id;
                                            return (
                                              <button key={recipe.id} onClick={() => {
                                                if (editingDishId) {
                                                  setDishes((prev) => prev.map((d) => d.id === editingDishId ? { ...d, recipeLink: recipe.id } : d));
                                                }
                                                setRecipePickerOpen(false);
                                                setRecipeSearch('');
                                              }}
                                                className={cn("w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors border-b border-on-surface/4 last:border-0",
                                                  isLinked ? "bg-primary/5" : "hover:bg-on-surface/3"
                                                )}>
                                                {recipe.photos?.[0] ? (
                                                  <img src={recipe.photos[0]} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                                                ) : (
                                                  <div className="w-8 h-8 rounded-lg bg-primary/5 flex items-center justify-center flex-shrink-0">
                                                    <BookOpen size={12} className="text-primary/30" />
                                                  </div>
                                                )}
                                                <span className={cn("text-xs font-medium flex-1 truncate", isLinked ? "text-primary" : "text-on-surface/60")}>{recipe.title}</span>
                                                {isLinked && <Check size={14} className="text-primary flex-shrink-0" />}
                                              </button>
                                            );
                                          });
                                        })()
                                      )}
                                    </div>
                                  </div>
                                </motion.div>
                              )}
                            </AnimatePresence>
                          </>
                        );
                      })()}
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

              {/* ═══════════ INGREDIENTS ═══════════ */}
              {page === 'ingredients' && (
                <SubPage key="ingredients" onBack={() => setPage('main')} title="Ingredients">
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4" onTouchMove={(e) => e.stopPropagation()}>
                    {/* Mode toggle — hidden while editing an existing ingredient */}
                    {editingIngredientIdx === null && (
                      <div className="flex gap-2 mb-4 p-1 bg-on-surface/[0.04] rounded-xl">
                        <button onClick={() => { setIngredientMode('single'); setBulkResults([]); }}
                          className={cn("flex-1 py-2 rounded-lg text-xs font-semibold transition-all",
                            ingredientMode === 'single' ? "bg-white text-on-surface shadow-sm" : "text-on-surface/40"
                          )}>
                          <Plus size={13} className="inline mr-1" />Add One
                        </button>
                        <button onClick={() => { setIngredientMode('bulk'); setIngredientError(null); }}
                          className={cn("flex-1 py-2 rounded-lg text-xs font-semibold transition-all",
                            ingredientMode === 'bulk' ? "bg-white text-on-surface shadow-sm" : "text-on-surface/40"
                          )}>
                          <ClipboardPaste size={13} className="inline mr-1" />Paste List
                        </button>
                      </div>
                    )}

                    {ingredientMode === 'single' ? (
                      /* Single-ingredient form */
                      <div className={cn(
                        "border rounded-2xl p-4 mb-5",
                        editingIngredientIdx !== null
                          ? "bg-primary/5 border-primary/25"
                          : "bg-on-surface/[0.03] border-on-surface/8"
                      )}>
                        {editingIngredientIdx !== null && (
                          <p className="text-[10px] font-bold uppercase tracking-widest text-primary/70 mb-2">
                            Editing ingredient
                          </p>
                        )}
                        <input type="text" value={newIngredientName}
                          onChange={(e) => { setNewIngredientName(e.target.value); if (ingredientError) setIngredientError(null); }}
                          placeholder="Ingredient name" autoFocus
                          className="w-full bg-white border border-on-surface/10 rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 mb-2.5" />
                        <div className="flex gap-2.5 mb-3">
                          <input type="text" value={newIngredientAmount}
                            onChange={(e) => { setNewIngredientAmount(e.target.value); if (ingredientError) setIngredientError(null); }}
                            placeholder="Amount"
                            inputMode="decimal"
                            className="flex-1 min-w-0 bg-white border border-on-surface/10 rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20" />
                          {/* Unit combobox — the field itself becomes the search bar while open. */}
                          <div className={cn("flex-1 min-w-0 relative", unitDropdownOpen && "z-20")}>
                            <input
                              type="text"
                              value={unitDropdownOpen ? unitSearch : newIngredientUnit}
                              onFocus={() => { setUnitDropdownOpen(true); setUnitSearch(''); }}
                              onChange={(e) => { setUnitDropdownOpen(true); setUnitSearch(e.target.value); }}
                              placeholder="Unit"
                              className="w-full bg-white border border-on-surface/10 rounded-xl py-2.5 pl-4 pr-8 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/30 pointer-events-none" />
                            <AnimatePresence>
                              {unitDropdownOpen && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => { setUnitDropdownOpen(false); setUnitSearch(''); }} />
                                  <motion.div
                                    initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                                    transition={{ duration: 0.15 }}
                                    className="absolute left-0 right-0 top-full mt-1 bg-white border border-on-surface/10 rounded-xl shadow-lg z-20 overflow-hidden"
                                  >
                                    <div className="max-h-52 overflow-y-auto" onTouchMove={(e) => e.stopPropagation()}>
                                      {filteredUnits.length === 0 ? (
                                        <p className="px-3 py-4 text-center text-[11px] text-on-surface/30">No matches</p>
                                      ) : (
                                        filteredUnits.map((u) => (
                                          <button key={u || '_none'} type="button"
                                            onMouseDown={(e) => e.preventDefault()}
                                            onClick={() => { setNewIngredientUnit(u); setUnitDropdownOpen(false); setUnitSearch(''); if (ingredientError) setIngredientError(null); }}
                                            className={cn("w-full text-left px-3 py-2 text-xs font-medium transition-colors border-b border-on-surface/4 last:border-0",
                                              newIngredientUnit === u ? "bg-primary/5 text-primary" : "text-on-surface/70 hover:bg-on-surface/3"
                                            )}>
                                            {u || <span className="italic text-on-surface/35">(none)</span>}
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                        {ingredientError && (
                          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
                            <p className="text-[11px] text-red-600 font-medium">{ingredientError}</p>
                          </div>
                        )}
                        <div className="flex gap-2">
                          {editingIngredientIdx !== null && (
                            <button onClick={cancelEditIngredient}
                              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-on-surface/50 border border-on-surface/10 hover:text-on-surface hover:border-on-surface/20 transition-all">
                              Cancel
                            </button>
                          )}
                          <button onClick={saveIngredient} disabled={!newIngredientName.trim()}
                            className={cn("py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-30",
                              editingIngredientIdx !== null
                                ? "flex-1 bg-primary text-white hover:bg-primary/90"
                                : "w-full text-primary/50 border border-on-surface/10 hover:text-primary hover:border-primary/30"
                            )}>
                            {editingIngredientIdx !== null ? (
                              <><Check size={14} className="inline mr-1" />Update</>
                            ) : (
                              <><Plus size={14} className="inline mr-1" />Add Ingredient</>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Bulk paste form — flat, per-line feedback */
                      <div className="mb-5 space-y-3">
                        <p className="text-[11px] text-on-surface/45 leading-relaxed">
                          Paste one ingredient per line as <span className="font-semibold">amount unit name</span>.
                          Amounts must be numbers; units get auto-corrected.
                        </p>
                        <textarea value={bulkIngredientsText}
                          onChange={(e) => { setBulkIngredientsText(e.target.value); if (bulkResults.length) setBulkResults([]); }}
                          placeholder={'2 cups flour\n1 tsp salt\n3 eggs\n1/2 cup milk'}
                          rows={6} autoFocus
                          className="w-full bg-on-surface/[0.04] rounded-xl py-2.5 px-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none font-mono leading-relaxed placeholder:text-on-surface/30" />

                        {/* Per-line outcome: green check for success, red X for errors */}
                        {bulkResults.length > 0 && (() => {
                          const okCount = bulkResults.filter((r) => r.status === 'success').length;
                          const errCount = bulkResults.length - okCount;
                          return (
                            <div className="rounded-xl bg-on-surface/[0.03] border border-on-surface/[0.06] overflow-hidden">
                              <div className="px-3 py-2 flex items-center gap-3 border-b border-on-surface/[0.06]">
                                {okCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700">
                                    <Check size={12} strokeWidth={3} />{okCount} added
                                  </span>
                                )}
                                {errCount > 0 && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600">
                                    <X size={12} strokeWidth={3} />{errCount} need editing
                                  </span>
                                )}
                              </div>
                              <ul className="divide-y divide-on-surface/[0.06]">
                                {bulkResults.map((r, i) => (
                                  <li key={i} className="flex items-start gap-2.5 px-3 py-2">
                                    <span className={cn(
                                      "flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5",
                                      r.status === 'success' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600",
                                    )}>
                                      {r.status === 'success' ? <Check size={10} strokeWidth={3} /> : <X size={10} strokeWidth={3} />}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className={cn(
                                        "text-[12px] font-mono leading-snug break-words",
                                        r.status === 'success' ? "text-on-surface/70" : "text-red-600",
                                      )}>
                                        {r.line}
                                      </p>
                                      {r.status === 'error' && (
                                        <p className="text-[10px] text-red-500/80 leading-snug mt-0.5">{r.message}</p>
                                      )}
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })()}

                        <button onClick={addBulkIngredients} disabled={!bulkIngredientsText.trim()}
                          className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-full bg-primary/10 text-primary text-xs font-semibold disabled:opacity-40 transition-colors hover:bg-primary/15">
                          <Plus size={14} />Add All
                        </button>
                      </div>
                    )}

                    {/* Ingredient list — flat numbered rows, tap to edit */}
                    {ingredients.length === 0 ? (
                      <div className="text-center py-10">
                        <Hash size={28} className="mx-auto text-on-surface/15 mb-2" />
                        <p className="text-sm text-on-surface/30">No ingredients yet</p>
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-1.5">
                          Added ({ingredients.length}) · tap to edit
                        </p>
                        <ol className="divide-y divide-on-surface/[0.06] border-t border-on-surface/[0.06]">
                          {ingredients.map((ing, idx) => {
                            const amt = [displayAmount(ing.amount), ing.unit].filter(Boolean).join(' ');
                            const isEditing = editingIngredientIdx === idx;
                            return (
                              <li key={idx} className={cn(
                                "flex items-start gap-3 py-3 leading-[1.6] transition-colors",
                                isEditing && "bg-primary/[0.04]",
                              )}>
                                <span className="w-6 text-[13px] font-semibold text-on-surface/40 tabular-nums text-right flex-shrink-0 pt-[1px]">{idx + 1}.</span>
                                <button
                                  type="button"
                                  onClick={() => startEditIngredient(idx)}
                                  className="flex-1 min-w-0 text-left"
                                >
                                  <p className="text-[15px] text-on-surface/80">
                                    {amt && <span className="font-bold text-on-surface/90">{amt} </span>}
                                    <span className="font-normal">{ing.name}</span>
                                  </p>
                                </button>
                                <button
                                  onClick={() => removeIngredient(idx)}
                                  className="p-1 -mr-1 text-on-surface/25 hover:text-red-500 transition-colors flex-shrink-0"
                                  aria-label="Remove ingredient"
                                >
                                  <X size={14} />
                                </button>
                              </li>
                            );
                          })}
                        </ol>
                      </>
                    )}
                  </div>
                  <BottomBtn
                    label={editingIngredientIdx !== null ? 'Update' : 'Done'}
                    onClick={() => {
                      if (editingIngredientIdx !== null) {
                        saveIngredient();
                      } else {
                        setPage('main');
                      }
                    }}
                    disabled={editingIngredientIdx !== null && !newIngredientName.trim()}
                  />
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
                        rows={4} autoFocus
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
                                {photo.isFavorite && (
                                  <div className="absolute top-1 left-1 w-5 h-5 rounded-full bg-black/55 flex items-center justify-center">
                                    <Star size={10} className="text-white" fill="white" />
                                  </div>
                                )}
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
                            <div className="flex items-center justify-between gap-3">
                              <button
                                type="button"
                                onClick={() => togglePhotoFavorite(selectedPhotoIdx)}
                                className={cn(
                                  "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-colors",
                                  photos[selectedPhotoIdx].isFavorite
                                    ? "border-primary/30 bg-primary/10 text-primary"
                                    : "border-on-surface/10 bg-on-surface/[0.04] text-on-surface/50 hover:border-on-surface/20",
                                )}
                              >
                                <Star size={12} fill={photos[selectedPhotoIdx].isFavorite ? "currentColor" : "none"} />
                                {photos[selectedPhotoIdx].isFavorite ? 'Favorite' : 'Mark favorite'}
                              </button>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] text-on-surface/40 font-semibold mr-1">
                                  {selectedPhotoIdx + 1} / {photos.length}
                                </span>
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
            </AnimatePresence>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    {/* Quick Info pickers — mounted alongside the main modal so they can
         animate in above it when tapped. */}
    <TimeWheelPicker
      isOpen={prepPickerOpen}
      onClose={() => setPrepPickerOpen(false)}
      onConfirm={(h, m) => setPrepMinutesTotal(h * 60 + m)}
      initialHours={prepHours}
      initialMinutes={prepMinutes}
      title="Prep time"
    />
    <TimeWheelPicker
      isOpen={cookPickerOpen}
      onClose={() => setCookPickerOpen(false)}
      onConfirm={(h, m) => setCookMinutesTotal(h * 60 + m)}
      initialHours={cookHours}
      initialMinutes={cookMinutes}
      title="Cook time"
    />
    <NumberWheelPicker
      isOpen={servingsPickerOpen}
      onClose={() => setServingsPickerOpen(false)}
      onConfirm={(v) => setServings(v)}
      initialValue={servings ?? 4}
      min={1}
      max={24}
      title="Servings"
      unitLabel="People"
    />
    <DifficultySheet
      isOpen={difficultyPickerOpen}
      onClose={() => setDifficultyPickerOpen(false)}
      value={difficulty}
      onChange={setDifficulty}
    />
    <ImportRecipesModal
      open={importRecipesOpen}
      onClose={() => setImportRecipesOpen(false)}
    />
    {/* AI recipe preview — the SAME sheet the main chat uses. Layered
        above the modal (z-[210]) so Publish / Edit / cover-photo all
        work in place. Publish saves + closes; Edit hands off to the
        Advanced builder seeded with the draft. */}
    <RecipeDraftSheet
      open={aiDraft !== null}
      draft={aiDraft}
      publishedMealId={null}
      onClose={() => setAiDraft(null)}
      onPublish={handleAiPublish}
      onEdit={handleAiEdit}
      onDelete={() => setAiDraft(null)}
      onCoverPhotoChange={handleAiCoverChange}
      onRefine={handleAiRefine}
      onGenerateImage={handleAiGenerateImage}
      zClass="z-[210]"
      publishLabel="Publish recipe"
    />
    </>
  );
};

/* ── Shared sub-components ── */

// A single cell in the Quick Info 2×2 grid. Renders icon + small label + the
// current value in a serif display face. Tapping opens a dedicated picker.
/* "Quick add" cards/rows styled to match the Advanced builder's warm
   card language (.arb-* classes), shared by phone + desktop. */
const QuickInfoCard: React.FC<{
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  empty?: boolean;
  onClick: () => void;
}> = ({ icon, label, value, valueColor, empty, onClick }) => (
  <button type="button" onClick={onClick} className="arb-qi-card">
    <span className="arb-qi-head">
      {icon}
      {label}
    </span>
    <span className={cn('arb-qi-value', empty && 'is-empty')} style={!empty && valueColor ? { color: valueColor } : undefined}>
      {value}
    </span>
  </button>
);

const DetailListRow: React.FC<{
  icon: React.ReactNode; label: string; active: boolean; sub: string; onClick: () => void;
}> = ({ icon, label, active, sub, onClick }) => (
  <button type="button" onClick={onClick} className={cn('arb-detail-row', active && 'is-active')}>
    <span className="arb-detail-icon">{icon}</span>
    <span className="arb-detail-label">{label}</span>
    <span className="arb-detail-sub">{sub}</span>
    <ChevronRight size={16} className="arb-detail-chev" />
  </button>
);

// Bottom sheet for picking meal difficulty. Three large options, each with a
// short rationale and the matching color palette.
const DifficultySheet: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  value: 'Easy' | 'Medium' | 'Hard';
  onChange: (v: 'Easy' | 'Medium' | 'Hard') => void;
}> = ({ isOpen, onClose, value, onChange }) => (
  <AnimatePresence>
    {isOpen && (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[200] flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-surface w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl pt-3 pb-6 px-6"
        >
          <div className="flex items-center justify-center mb-3">
            <div className="w-10 h-1 rounded-full bg-on-surface/15" />
          </div>
          <p className="text-center font-serif font-bold text-lg mb-5">Difficulty</p>
          <div className="space-y-2.5">
            {(['Easy', 'Medium', 'Hard'] as const).map((d) => {
              const selected = value === d;
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => { onChange(d); onClose(); }}
                  className={cn(
                    'w-full flex items-center justify-between px-5 py-4 rounded-2xl border transition-all text-left',
                    selected
                      ? DIFFICULTY_COLORS[d]
                      : 'border-on-surface/[0.08] bg-on-surface/[0.02] hover:border-on-surface/[0.15]',
                  )}
                >
                  <div className="flex flex-col gap-1 min-w-0 pr-3">
                    <span className={cn(
                      'text-lg font-serif font-bold leading-none',
                      selected ? '' : 'text-on-surface/80',
                    )}>
                      {d}
                    </span>
                    <span className={cn(
                      'text-[11px] font-medium leading-snug',
                      selected ? 'opacity-75' : 'text-on-surface/45',
                    )}>
                      {DIFFICULTY_DESC[d]}
                    </span>
                  </div>
                  <div
                    className={cn(
                      'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 transition-all',
                      selected ? 'bg-current' : 'border-2 border-on-surface/20',
                    )}
                  >
                    {selected && <Check size={14} strokeWidth={3} style={{ color: 'white' }} />}
                  </div>
                </button>
              );
            })}
          </div>
        </motion.div>
      </motion.div>
    )}
  </AnimatePresence>
);

const SubPage: React.FC<{
  children: React.ReactNode; onBack: () => void; title: string; rightAction?: React.ReactNode;
}> = ({ children, onBack, title, rightAction }) => (
  <motion.div initial={{ x: '100%', opacity: 0.5 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0.5 }}
    transition={{ type: 'tween', duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
    className="flex flex-col flex-1 min-h-0" onTouchMove={(e) => e.stopPropagation()}>
    <div className="px-5 pt-safe-5 sm:pt-6 pb-3 flex items-center gap-3 flex-shrink-0">
      <button onClick={onBack} className="p-1.5 -ml-1.5 rounded-full hover:bg-on-surface/5 text-on-surface/45 hover:text-on-surface transition-colors">
        <ChevronLeft size={22} />
      </button>
      <h2 className="font-serif font-bold text-lg flex-1">{title}</h2>
      {rightAction}
    </div>
    {children}
  </motion.div>
);

const BottomBtn: React.FC<{ label: string; onClick: () => void; disabled?: boolean }> = ({ label, onClick, disabled }) => (
  <div className="px-5 pt-4 pb-safe-4 flex-shrink-0 bg-surface">
    <button onClick={onClick} disabled={disabled} className="w-full py-3.5 bg-primary text-white rounded-full font-semibold text-sm shadow-[0_6px_20px_-6px_rgba(188,108,97,0.55)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:shadow-none">{label}</button>
  </div>
);
