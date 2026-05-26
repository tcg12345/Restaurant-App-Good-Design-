// Advanced Recipe Builder — a six-step wizard mounted by AddHomeMealModal
// when the user picks the "Advanced" tab. Writes to the same home_meals
// store as the Basic tab via lists.createHomeMeal / updateHomeMeal so the
// rest of the app sees one unified recipe concept.
//
// Layout: desktop = left rail + scrolling step pane + sticky footer;
// phone = top progress strip + step pane + sticky footer.
// State: single useReducer so localStorage draft persistence is just a
// JSON snapshot; the reducer is rebuildable from any saved snapshot.

import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import {
  useLists,
  type HomeMeal,
  type RecipeIngredient,
  type RecipeIngredientGroup,
  type RecipeNote,
  type RecipeStepDetail,
} from '../contexts/ListsContext';
import { flattenIngredientGroups } from '../lib/ingredient-parsing';
import {
  saveDraft as saveExplicitDraft,
  removeDraft as removeExplicitDraft,
  getDraft,
  consumePendingResumeDraftId,
  deriveDraftTitle,
} from '../lib/recipe-drafts';
import { StepBasics } from './advanced-recipe-steps/StepBasics';
import { StepTiming } from './advanced-recipe-steps/StepTiming';
import { StepIngredients } from './advanced-recipe-steps/StepIngredients';
import { StepMethod } from './advanced-recipe-steps/StepMethod';
import { StepEquipmentNotes } from './advanced-recipe-steps/StepEquipmentNotes';
import { StepReview } from './advanced-recipe-steps/StepReview';
import './AdvancedRecipeBuilder.css';

/* ── Form state shape (also the localStorage draft shape) ───────── */

export interface AdvancedRecipeState {
  name: string;
  summary: string;
  cuisine: string;
  course: string[];
  difficulty: 'Easy' | 'Medium' | 'Hard';
  coverPhoto: string;            // base64 or URL
  prepTime: number;              // minutes
  cookTime: number;
  chillTime: number;
  servings: number;
  yieldDescription: string;
  ingredientGroups: RecipeIngredientGroup[];
  steps: RecipeStepDetail[];
  equipment: string[];
  tags: string[];
  notes: RecipeNote[];
  /** Author's personal score (0–10, 0.1 step). Surfaced on the
   *  author's own profile but never on the standalone recipe page —
   *  so it's "private from the public recipe view" while still
   *  appearing in author-profile listings of their own recipes. */
  score: number;
  isPublic: boolean;
}

/** Step rail / mobile-header label. The accent word renders italic +
 *  rust ("The *basics*.") inside the big serif title. */
const STEP_LABELS: Array<{ lead: string; accent: string }> = [
  { lead: 'The', accent: 'basics' },
  { lead: 'Timing &', accent: 'yield' },
  { lead: 'The', accent: 'ingredients' },
  { lead: 'The', accent: 'method' },
  { lead: 'Equipment &', accent: 'notes' },
  { lead: 'Review &', accent: 'publish' },
];
/** Short, plain title for places that don't render the accent word
 *  (rail step list, mobile header eyebrow, footer "NEXT UP" label). */
const STEP_TITLES = ['The basics', 'Timing & yield', 'Ingredients', 'Method', 'Equipment & notes', 'Review & publish'];
const STEP_DESCRIPTIONS = [
  'Name, cuisine, difficulty',
  'Prep, cook, servings',
  'Grouped or flat list',
  'Steps in order',
  'Tools & callouts',
  'Preview & publish',
];
const STEP_INTROS = [
  'Start with the essentials. You can change any of this later — readers care about clarity most.',
  'Be realistic about how long this takes. Tell the truth and your reviews will thank you.',
  'Group ingredients by stage when it makes sense (For the sauce, For the topping).',
  'Walk a reader through what you actually do. One action per step, named clearly.',
  'Tools you reach for, plus any tips, swaps, or make-ahead notes worth flagging.',
  'Skim it the way a reader will. Tweak anything that looks off, then publish.',
];
const NEXT_LABELS = ['Timing & yield', 'Ingredients', 'Method', 'Equipment & notes', 'Review & publish'];

/** Cuisine catalog — ~90 entries, matches the "Search 90+ cuisines…"
 *  placeholder in the mobile bottom-sheet picker. The basic modal still
 *  accepts free text; this list is just the picker's options. */
export const CUISINE_OPTIONS = [
  'Afghan', 'African', 'American', 'Argentinian', 'Australian', 'Austrian', 'Bakery', 'Bangladeshi',
  'Basque', 'BBQ', 'Belgian', 'Brazilian', 'Breakfast', 'British', 'Burmese', 'Cajun', 'Cambodian',
  'Cantonese', 'Caribbean', 'Chinese', 'Colombian', 'Creole', 'Cuban', 'Dessert', 'Dutch', 'Egyptian',
  'Ethiopian', 'Filipino', 'French', 'Fusion', 'Georgian', 'German', 'Greek', 'Hawaiian', 'Hungarian',
  'Indian', 'Indonesian', 'Iranian', 'Irish', 'Israeli', 'Italian', 'Jamaican', 'Japanese', 'Jewish',
  'Korean', 'Latin American', 'Lebanese', 'Malaysian', 'Mediterranean', 'Mexican', 'Middle Eastern',
  'Moroccan', 'Nepalese', 'Nigerian', 'Nordic', 'Pakistani', 'Peruvian', 'Polish', 'Portuguese',
  'Puerto Rican', 'Russian', 'Salvadoran', 'Scandinavian', 'Scottish', 'Seafood', 'Senegalese',
  'Sicilian', 'Singaporean', 'Soul Food', 'Southern', 'Spanish', 'Sri Lankan', 'Sushi', 'Swedish',
  'Swiss', 'Syrian', 'Taiwanese', 'Tex-Mex', 'Thai', 'Tibetan', 'Trinidadian', 'Tunisian', 'Turkish',
  'Ukrainian', 'Uyghur', 'Vegan', 'Vegetarian', 'Venezuelan', 'Vietnamese', 'Welsh', 'Yemeni', 'Other',
];

export const COURSE_OPTIONS = ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Dessert', 'Drinks', 'Appetizer', 'Side'];

/** Initial state for a brand-new draft. */
function emptyState(): AdvancedRecipeState {
  return {
    name: '',
    summary: '',
    cuisine: '',
    course: [],
    difficulty: 'Medium',
    coverPhoto: '',
    prepTime: 0,
    cookTime: 0,
    chillTime: 0,
    servings: 4,
    yieldDescription: '',
    ingredientGroups: [{ name: 'Ingredients', ingredients: [] }],
    steps: [{ title: '', body: '' }],
    equipment: [],
    tags: [],
    notes: [],
    score: 0,
    isPublic: false,
  };
}

/** Hydrate state from an existing HomeMeal — used when editing. The basic
 *  flat `ingredients` / `steps` fall back into a single group / step list
 *  when the rich fields aren't present. */
function fromHomeMeal(meal: HomeMeal): AdvancedRecipeState {
  const groups: RecipeIngredientGroup[] =
    meal.ingredientGroups && meal.ingredientGroups.length > 0
      ? meal.ingredientGroups
      : [{ name: 'Ingredients', ingredients: meal.ingredients || [] }];
  const steps: RecipeStepDetail[] =
    meal.stepDetails && meal.stepDetails.length > 0
      ? meal.stepDetails
      : (meal.steps || []).map((body) => ({ body }));
  return {
    name: meal.name || '',
    summary: meal.summary || meal.description || '',
    cuisine: meal.cuisine || '',
    course: meal.course || [],
    difficulty: meal.difficulty || 'Medium',
    coverPhoto: meal.coverPhoto || '',
    prepTime: meal.prepTime || 0,
    cookTime: meal.cookTime || 0,
    chillTime: meal.chillTime || 0,
    servings: meal.servings || 4,
    yieldDescription: meal.yieldDescription || '',
    ingredientGroups: groups.length > 0 ? groups : [{ name: 'Ingredients', ingredients: [] }],
    steps: steps.length > 0 ? steps : [{ title: '', body: '' }],
    equipment: meal.equipment || [],
    tags: meal.tags || [],
    notes: meal.notes || [],
    score: typeof meal.score === 'number' ? meal.score : 0,
    isPublic: meal.isPublic ?? false,
  };
}

/* ── Reducer ──────────────────────────────────────────────────── */

export type Action =
  | { type: 'SET_FIELD'; field: keyof AdvancedRecipeState; value: AdvancedRecipeState[keyof AdvancedRecipeState] }
  | { type: 'TOGGLE_COURSE'; course: string }
  | { type: 'ADD_GROUP' }
  | { type: 'REMOVE_GROUP'; index: number }
  | { type: 'RENAME_GROUP'; index: number; name: string }
  | { type: 'ADD_INGREDIENT'; groupIndex: number; ingredient?: RecipeIngredient }
  | { type: 'ADD_INGREDIENTS_BULK'; groupIndex: number; ingredients: RecipeIngredient[] }
  | { type: 'UPDATE_INGREDIENT'; groupIndex: number; index: number; ingredient: RecipeIngredient }
  | { type: 'REMOVE_INGREDIENT'; groupIndex: number; index: number }
  | { type: 'ADD_STEP' }
  | { type: 'UPDATE_STEP'; index: number; step: RecipeStepDetail }
  | { type: 'MOVE_STEP'; index: number; direction: -1 | 1 }
  | { type: 'REMOVE_STEP'; index: number }
  | { type: 'ADD_NOTE'; noteType: RecipeNote['type'] }
  | { type: 'UPDATE_NOTE'; index: number; note: RecipeNote }
  | { type: 'REMOVE_NOTE'; index: number }
  | { type: 'HYDRATE'; state: AdvancedRecipeState }
  | { type: 'RESET' };

function reducer(state: AdvancedRecipeState, action: Action): AdvancedRecipeState {
  switch (action.type) {
    case 'SET_FIELD':
      return { ...state, [action.field]: action.value } as AdvancedRecipeState;
    case 'TOGGLE_COURSE': {
      const has = state.course.includes(action.course);
      return { ...state, course: has ? state.course.filter((c) => c !== action.course) : [...state.course, action.course] };
    }
    case 'ADD_GROUP':
      return { ...state, ingredientGroups: [...state.ingredientGroups, { name: 'New section', ingredients: [] }] };
    case 'REMOVE_GROUP': {
      // Never let the last group disappear — the empty UI is confusing.
      if (state.ingredientGroups.length <= 1) return state;
      return { ...state, ingredientGroups: state.ingredientGroups.filter((_, i) => i !== action.index) };
    }
    case 'RENAME_GROUP':
      return {
        ...state,
        ingredientGroups: state.ingredientGroups.map((g, i) =>
          i === action.index ? { ...g, name: action.name } : g,
        ),
      };
    case 'ADD_INGREDIENT':
      return {
        ...state,
        ingredientGroups: state.ingredientGroups.map((g, i) =>
          i === action.groupIndex
            ? { ...g, ingredients: [...g.ingredients, action.ingredient || { name: '', amount: '', unit: '' }] }
            : g,
        ),
      };
    case 'ADD_INGREDIENTS_BULK':
      return {
        ...state,
        ingredientGroups: state.ingredientGroups.map((g, i) =>
          i === action.groupIndex ? { ...g, ingredients: [...g.ingredients, ...action.ingredients] } : g,
        ),
      };
    case 'UPDATE_INGREDIENT':
      return {
        ...state,
        ingredientGroups: state.ingredientGroups.map((g, i) =>
          i === action.groupIndex
            ? { ...g, ingredients: g.ingredients.map((ing, j) => (j === action.index ? action.ingredient : ing)) }
            : g,
        ),
      };
    case 'REMOVE_INGREDIENT':
      return {
        ...state,
        ingredientGroups: state.ingredientGroups.map((g, i) =>
          i === action.groupIndex ? { ...g, ingredients: g.ingredients.filter((_, j) => j !== action.index) } : g,
        ),
      };
    case 'ADD_STEP':
      return { ...state, steps: [...state.steps, { title: '', body: '' }] };
    case 'UPDATE_STEP':
      return { ...state, steps: state.steps.map((s, i) => (i === action.index ? action.step : s)) };
    case 'MOVE_STEP': {
      const target = action.index + action.direction;
      if (target < 0 || target >= state.steps.length) return state;
      const next = [...state.steps];
      const [moved] = next.splice(action.index, 1);
      next.splice(target, 0, moved);
      return { ...state, steps: next };
    }
    case 'REMOVE_STEP': {
      // Same as groups — keep one step around so the UI doesn't go blank.
      if (state.steps.length <= 1) return state;
      return { ...state, steps: state.steps.filter((_, i) => i !== action.index) };
    }
    case 'ADD_NOTE':
      return { ...state, notes: [...state.notes, { type: action.noteType, text: '' }] };
    case 'UPDATE_NOTE':
      return { ...state, notes: state.notes.map((n, i) => (i === action.index ? action.note : n)) };
    case 'REMOVE_NOTE':
      return { ...state, notes: state.notes.filter((_, i) => i !== action.index) };
    case 'HYDRATE':
      return action.state;
    case 'RESET':
      return emptyState();
    default:
      return state;
  }
}

/* ── Validation ───────────────────────────────────────────────── */

interface ValidationResult {
  ok: boolean;
  errors: { step: number; message: string }[];
}

function validate(state: AdvancedRecipeState): ValidationResult {
  const errors: ValidationResult['errors'] = [];
  if (!state.name.trim()) errors.push({ step: 0, message: 'Recipe name is required.' });
  if (!state.summary.trim()) errors.push({ step: 0, message: 'One-line summary is required.' });
  if (!state.coverPhoto) errors.push({ step: 0, message: 'Hero image is required.' });
  const ingredientCount = state.ingredientGroups.reduce(
    (sum, g) => sum + g.ingredients.filter((i) => i.name.trim()).length,
    0,
  );
  if (ingredientCount === 0) errors.push({ step: 2, message: 'Add at least one ingredient.' });
  const stepCount = state.steps.filter((s) => (s.body || s.title || '').trim()).length;
  if (stepCount === 0) errors.push({ step: 3, message: 'Add at least one method step.' });
  return { ok: errors.length === 0, errors };
}

/** Per-step gate for the "Next" button. Today only Steps 3 (Ingredients)
 *  and 4 (Method) hard-block — the user must add at least one real
 *  ingredient / step before moving on. Other steps' missing-required
 *  warnings still surface on Publish via `validate`. */
function canLeaveStep(state: AdvancedRecipeState, step: number): { ok: boolean; reason?: string } {
  if (step === 2) {
    const count = state.ingredientGroups.reduce(
      (sum, g) => sum + g.ingredients.filter((i) => i.name.trim()).length,
      0,
    );
    if (count === 0) {
      return { ok: false, reason: 'Add at least one ingredient before moving on.' };
    }
  }
  if (step === 3) {
    const count = state.steps.filter((s) => (s.body || s.title || '').trim()).length;
    if (count === 0) {
      return { ok: false, reason: 'Add at least one method step before moving on.' };
    }
  }
  return { ok: true };
}

/* ── Draft persistence ───────────────────────────────────────── */

/* ── Auto-resume slot (single, transient — used by the "Resume your
     draft?" prompt on next modal open). Not exposed in Activity. ─ */
function resumeSlotKey(userId: string | null, mealId: string | null): string {
  const u = userId || 'anon';
  return mealId ? `gourmad-recipe-draft-${u}-edit-${mealId}` : `gourmad-recipe-draft-${u}`;
}

interface ResumeSlot {
  state: AdvancedRecipeState;
  currentStep: number;
  savedAt: number;
}

function loadResumeSlot(key: string): ResumeSlot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.state) return null;
    return parsed as ResumeSlot;
  } catch { return null; }
}

function saveResumeSlot(key: string, slot: ResumeSlot): void {
  try { localStorage.setItem(key, JSON.stringify(slot)); } catch { /* quota — skip */ }
}

function clearResumeSlot(key: string): void {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

/* ── Time-ago formatter for the resume prompt. ───────────────── */

function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return 'just now';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/* ── Component ───────────────────────────────────────────────── */

export interface AdvancedRecipeBuilderProps {
  existing: HomeMeal | null;
  onClose: () => void;
  tabSlot?: React.ReactNode; // Basic/Advanced toggle injected by parent
}

export const AdvancedRecipeBuilder: React.FC<AdvancedRecipeBuilderProps> = ({ existing, onClose, tabSlot }) => {
  const navigate = useNavigate();
  const auth = useAuth();
  const { phoneMode } = useSettings();
  const lists = useLists();
  const userId = auth.user?.id || null;

  const initial = useMemo(() => (existing ? fromHomeMeal(existing) : emptyState()), [existing]);
  const [state, dispatch] = useReducer(reducer, initial);
  const [currentStep, setCurrentStep] = useState(0);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [showResume, setShowResume] = useState(false);
  const [resumeSlot, setResumeSlot] = useState<ResumeSlot | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  /** Once the user explicitly clicks Save draft (or resumes a draft
   *  from Activity), we remember that draft's id so further saves
   *  update the same row rather than spawning a new one. */
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  const toast = useToast();

  const key = useMemo(() => resumeSlotKey(userId, existing?.id || null), [userId, existing?.id]);
  const saveTimerRef = useRef<number | null>(null);
  const hasUserInputRef = useRef(false);
  const initialHydratedRef = useRef(false);

  // On mount: prefer a pending Activity-resume draft over the
  // single-slot autoresume. Otherwise fall back to the "Resume your
  // draft?" prompt as before. Skip both when editing — that path is
  // already prefilled from the existing meal.
  useEffect(() => {
    if (initialHydratedRef.current) return;
    initialHydratedRef.current = true;
    if (existing) return;
    const pendingId = consumePendingResumeDraftId();
    if (pendingId) {
      const draft = getDraft(userId, pendingId);
      if (draft) {
        dispatch({ type: 'HYDRATE', state: draft.state });
        setCurrentStep(Math.max(0, Math.min(5, draft.currentStep)));
        setCurrentDraftId(draft.id);
        setDraftSavedAt(draft.savedAt);
        return;
      }
    }
    const slot = loadResumeSlot(key);
    if (slot && (slot.state.name || slot.state.summary || slot.state.ingredientGroups.some((g) => g.ingredients.length > 0))) {
      setResumeSlot(slot);
      setShowResume(true);
    }
  }, [existing, key, userId]);

  // Autosave: debounce 400ms after any state change. Any keystroke
  // flips hasUserInputRef so we don't write a draft for a no-op
  // mount. Writes the resume slot AND — if there's already an
  // explicit saved-draft row for this session — updates that too so
  // Activity stays in sync without requiring a Save-draft tap on
  // every change.
  useEffect(() => {
    if (!hasUserInputRef.current) {
      hasUserInputRef.current = true;
      return;
    }
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      const now = Date.now();
      saveResumeSlot(key, { state, currentStep, savedAt: now });
      setDraftSavedAt(now);
      if (currentDraftId) {
        saveExplicitDraft(userId, {
          id: currentDraftId,
          title: deriveDraftTitle(state),
          coverPhoto: state.coverPhoto || undefined,
          currentStep,
          state,
          editingMealId: existing?.id,
        });
      }
    }, 400);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [state, currentStep, key, currentDraftId, userId, existing]);

  const handleResumeAccept = useCallback(() => {
    if (!resumeSlot) return;
    dispatch({ type: 'HYDRATE', state: resumeSlot.state });
    setCurrentStep(Math.max(0, Math.min(5, resumeSlot.currentStep)));
    setDraftSavedAt(resumeSlot.savedAt);
    setShowResume(false);
  }, [resumeSlot]);

  const handleResumeDiscard = useCallback(() => {
    clearResumeSlot(key);
    setShowResume(false);
    setResumeSlot(null);
  }, [key]);

  const validation = useMemo(() => validate(state), [state]);
  // Per-step gate. When the current step blocks (Ingredients with
  // nothing in it, Method with nothing in it) the Next button goes
  // disabled and an inline note explains why.
  const gate = useMemo(() => canLeaveStep(state, currentStep), [state, currentStep]);

  const handleNext = useCallback(() => {
    // Belt-and-suspenders: the Next button is also disabled by `gate`
    // in the render, but block here too in case it's clicked via the
    // keyboard while still focused.
    if (!canLeaveStep(state, currentStep).ok) return;
    if (currentStep < 5) setCurrentStep(currentStep + 1);
  }, [currentStep, state]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  }, [currentStep]);

  const handleJumpTo = useCallback((step: number) => {
    if (step >= 0 && step <= 5) setCurrentStep(step);
  }, []);

  const handleSaveDraft = useCallback(() => {
    // Two things happen on an explicit Save:
    //   1. Force the autoresume snapshot immediately (bypass debounce)
    //   2. Persist or update the row in the user's saved-drafts list
    //      so it surfaces on Activity → Recipe drafts.
    const now = Date.now();
    saveResumeSlot(key, { state, currentStep, savedAt: now });
    setDraftSavedAt(now);
    const saved = saveExplicitDraft(userId, {
      id: currentDraftId || undefined,
      title: deriveDraftTitle(state),
      coverPhoto: state.coverPhoto || undefined,
      currentStep,
      state,
      editingMealId: existing?.id,
    });
    if (!currentDraftId) setCurrentDraftId(saved.id);
    toast.showToast(currentDraftId ? 'Draft updated' : 'Draft saved', {
      subtitle: 'Find it in Activity → Recipe drafts.',
      variant: 'success',
    });
  }, [key, state, currentStep, currentDraftId, userId, existing, toast]);

  const handlePublish = useCallback(() => {
    const v = validate(state);
    if (!v.ok) {
      setShowValidation(true);
      // Jump to the first failing step so the user sees what's missing.
      const firstStep = Math.min(...v.errors.map((e) => e.step));
      if (Number.isFinite(firstStep)) setCurrentStep(firstStep);
      return;
    }
    // Build the HomeMeal payload. Dual-write the legacy flat
    // `ingredients` and `steps` arrays so older renderers (SocialFeed,
    // Discover) keep working without an update.
    const flatIngredients: RecipeIngredient[] = flattenIngredientGroups(state.ingredientGroups)
      .filter((i) => i.name.trim());
    const flatSteps = state.steps
      .filter((s) => (s.body || s.title || '').trim())
      .map((s) => (s.title ? `${s.title}: ${s.body}` : s.body));
    const cleanIngredientGroups = state.ingredientGroups.map((g) => ({
      name: g.name,
      ingredients: g.ingredients.filter((i) => i.name.trim()),
    }));
    const cleanSteps = state.steps.filter((s) => (s.body || s.title || '').trim());
    const cleanNotes = state.notes.filter((n) => n.text.trim());

    const today = new Date().toISOString().slice(0, 10);
    const payload: Omit<HomeMeal, 'id' | 'createdAt'> = {
      name: state.name.trim(),
      date: existing?.date || today,
      score: state.score,
      wouldMakeAgain: existing?.wouldMakeAgain ?? true,
      description: state.summary.trim(),
      photos: existing?.photos || [],
      tags: state.tags,
      dishes: existing?.dishes || [],
      isPublic: state.isPublic,
      coverPhoto: state.coverPhoto,
      prepTime: state.prepTime,
      cookTime: state.cookTime,
      servings: state.servings,
      difficulty: state.difficulty,
      cuisine: state.cuisine,
      ingredients: flatIngredients,
      steps: flatSteps,
      // Advanced-only fields
      summary: state.summary.trim(),
      course: state.course,
      chillTime: state.chillTime,
      yieldDescription: state.yieldDescription.trim() || undefined,
      ingredientGroups: cleanIngredientGroups,
      equipment: state.equipment.filter(Boolean),
      notes: cleanNotes,
      stepDetails: cleanSteps,
      builderVersion: 'advanced',
    };

    // Clear both the autoresume slot AND the explicit Activity draft
    // (if any). Publishing means the recipe lives in the user's pantry
    // now — no need to keep the draft hanging around.
    const cleanup = () => {
      clearResumeSlot(key);
      if (currentDraftId) removeExplicitDraft(userId, currentDraftId);
    };

    if (existing) {
      lists.updateHomeMeal(existing.id, payload);
      cleanup();
      onClose();
      if (userId) setTimeout(() => navigate(`/recipe/${userId}/${existing.id}`), 80);
    } else {
      const created = lists.createHomeMeal(payload);
      cleanup();
      onClose();
      if (userId && created?.id) setTimeout(() => navigate(`/recipe/${userId}/${created.id}`), 80);
    }
  }, [state, existing, key, lists, onClose, userId, navigate, currentDraftId]);

  // Progress bar fill: 5/6 when on step 5, etc. Step 6 (index 5) at
  // full bar (100%) is reached only when the user actually publishes,
  // so cap at 5/6 = 83% while inside the wizard. Tweak as desired.
  const progress = Math.round(((currentStep + 1) / 6) * 100);

  const isPhone = phoneMode;

  const renderStep = () => {
    switch (currentStep) {
      case 0: return <StepBasics state={state} dispatch={dispatch} />;
      case 1: return <StepTiming state={state} dispatch={dispatch} />;
      case 2: return <StepIngredients state={state} dispatch={dispatch} />;
      case 3: return <StepMethod state={state} dispatch={dispatch} />;
      case 4: return <StepEquipmentNotes state={state} dispatch={dispatch} />;
      case 5: return <StepReview state={state} dispatch={dispatch} validation={validation} />;
      default: return null;
    }
  };

  return (
    <div className={`advanced-recipe-builder${isPhone ? ' is-phone' : ''}`}>
      {/* Resume-draft prompt overlay. */}
      {showResume && resumeSlot && (
        <div className="arb-draft-overlay">
          <div className="arb-draft-card">
            <h3>Resume your draft?</h3>
            <p>You have an unsaved recipe from {formatTimeAgo(resumeSlot.savedAt)}. Pick up where you left off, or start fresh.</p>
            <div className="arb-draft-actions">
              <button type="button" className="discard" onClick={handleResumeDiscard}>Start over</button>
              <button type="button" className="resume" onClick={handleResumeAccept}>Resume</button>
            </div>
          </div>
        </div>
      )}

      {!isPhone && (
        <button type="button" className="arb-pane-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      )}

      {/* Mobile sticky header — replaces the desktop rail. */}
      {isPhone && (
        <header className="arb-m-header">
          <div className="arb-m-header-row">
            <button
              type="button"
              className="arb-m-header-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <div className="arb-m-header-titleblock">
              <div className="arb-m-header-eyebrow">{existing ? 'Edit recipe' : 'New recipe'}</div>
              <div className="arb-m-header-title">{STEP_TITLES[currentStep]}</div>
            </div>
            <div className="arb-m-header-saveblock">
              <div className="arb-m-saved-pill">
                <span className="dot" />
                <span>{draftSavedAt ? 'Saved' : 'Unsaved'}</span>
              </div>
              <button
                type="button"
                className="arb-m-save-link"
                onClick={handleSaveDraft}
              >
                Save to drafts
              </button>
            </div>
          </div>
          <div className="arb-m-header-sub">
            <span className="arb-m-header-desc">{STEP_DESCRIPTIONS[currentStep]}</span>
            <span className="arb-m-header-counter">
              Step <span className="strong">{currentStep + 1}</span> / 6
            </span>
          </div>
          <div className="arb-m-progress-row">
            {STEP_TITLES.map((_, i) => {
              const isDone = i < currentStep;
              const isCurrent = i === currentStep;
              return (
                <button
                  key={i}
                  type="button"
                  className={`arb-m-progress-seg${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                  onClick={() => handleJumpTo(i)}
                  aria-label={`Step ${i + 1}: ${STEP_TITLES[i]}`}
                />
              );
            })}
          </div>
        </header>
      )}

      <div className="arb-shell">
        {/* Desktop left rail. */}
        {!isPhone && (
          <nav className="arb-rail">
            <div className="arb-rail-eyebrow">New recipe</div>
            <div className="arb-rail-title">Let's build a <em>recipe</em>.</div>
            {tabSlot && <div style={{ marginTop: 16 }}>{tabSlot}</div>}
            <ol className="arb-rail-steps">
              {STEP_TITLES.map((t, i) => {
                const isDone = i < currentStep;
                const isCurrent = i === currentStep;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`arb-rail-step${isDone ? ' is-done' : ''}${isCurrent ? ' is-current' : ''}`}
                    onClick={() => handleJumpTo(i)}
                  >
                    <span className="arb-rail-step-circle">
                      {isDone ? <Check size={14} strokeWidth={3} /> : i + 1}
                    </span>
                    <span className="arb-rail-step-text">
                      <span className="arb-rail-step-title">{t}</span>
                    </span>
                  </button>
                );
              })}
            </ol>
            <div className="arb-rail-foot">
              <div className="arb-rail-foot-status">
                <span className="dot" />
                <span>{draftSavedAt ? 'Draft saved' : 'Not saved yet'}</span>
                <span style={{ marginLeft: 'auto' }}>Step {currentStep + 1} of 6</span>
              </div>
              <div className="arb-rail-foot-bar">
                <div className="arb-rail-foot-bar-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          </nav>
        )}

        {/* Step pane. */}
        <div className="arb-pane">
          <div className="arb-pane-head">
            <div className="arb-pane-eyebrow">
              Step <span className="strong">{currentStep + 1}</span> of 6
            </div>
            <h2 className="arb-pane-title">
              {STEP_LABELS[currentStep].lead}{' '}
              <span className="arb-pane-title-accent">{STEP_LABELS[currentStep].accent}</span>.
            </h2>
            <p className="arb-pane-intro">{STEP_INTROS[currentStep]}</p>
          </div>
          <div className="arb-pane-body">
            {renderStep()}
            {!gate.ok && gate.reason && (
              <div className="arb-step-gate" style={{ marginTop: 14 }}>
                {gate.reason}
              </div>
            )}
            {showValidation && !validation.ok && (
              <div className="arb-review-validation" style={{ marginTop: 16 }}>
                Fix these before publishing:
                <ul>
                  {validation.errors.map((e, i) => (
                    <li key={i}>{e.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Mobile floating footer dock — replaces the desktop sticky footer. */}
          {isPhone && (
            <div className="arb-m-foot">
              <button
                type="button"
                className="arb-m-foot-back"
                onClick={handleBack}
                disabled={currentStep === 0}
                aria-label="Back"
              >
                <ArrowLeft size={18} />
              </button>
              {currentStep < 5 ? (
                <button
                  type="button"
                  className="arb-m-foot-next"
                  onClick={handleNext}
                  disabled={!gate.ok}
                  title={gate.ok ? undefined : gate.reason}
                >
                  <span className="arb-m-foot-next-eyebrow">Next up</span>
                  <span className="arb-m-foot-next-label">
                    {NEXT_LABELS[currentStep]} <ArrowRight size={16} />
                  </span>
                </button>
              ) : (
                <button
                  type="button"
                  className="arb-m-foot-publish"
                  onClick={handlePublish}
                >
                  <span className="arb-m-foot-next-eyebrow">{existing ? 'Save' : 'Publish'}</span>
                  <span className="arb-m-foot-next-label">
                    {existing ? 'Publish changes' : 'Publish recipe'} <Check size={16} />
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Desktop sticky footer. */}
      {!isPhone && (
        <div className="arb-foot">
          <button type="button" className="arb-foot-back" onClick={handleBack} disabled={currentStep === 0}>
            <ArrowLeft size={16} /> Back
          </button>
          <div className="arb-foot-right">
            <button type="button" className="arb-foot-save" onClick={handleSaveDraft}>
              Save draft
            </button>
            {currentStep < 5 ? (
              <button
                type="button"
                className="arb-foot-next"
                onClick={handleNext}
                disabled={!gate.ok}
                title={gate.ok ? undefined : gate.reason}
              >
                Next: {NEXT_LABELS[currentStep]} <ArrowRight size={16} />
              </button>
            ) : (
              <button type="button" className="arb-foot-publish" onClick={handlePublish}>
                {existing ? 'Save changes' : 'Publish recipe'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
