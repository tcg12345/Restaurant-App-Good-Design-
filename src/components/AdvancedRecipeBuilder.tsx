// Advanced Recipe Builder — a five-step wizard mounted by AddHomeMealModal
// when the user picks the "Advanced" tab. Writes to the same home_meals
// store as the Basic tab via lists.createHomeMeal / updateHomeMeal so the
// rest of the app sees one unified recipe concept.
//
// Layout (phone AND desktop — one warm, serif-forward single column):
// header with the mode switcher, saved state, serif step title and a
// segmented progress bar; a scrolling step pane; a floating footer with
// a back circle and a gate-reason CTA pill; an animated success overlay
// after publish.
//
// State: single useReducer so localStorage draft persistence is just a
// JSON snapshot; the reducer is rebuildable from any saved snapshot.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { GlassButton } from '../lib/glass-buttons';
import { localISODate } from '../lib/utils';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowLeft, Check, X, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import {
  useLists,
  type HomeMeal,
  type LinkedRecipeRef,
  type RecipeIngredient,
  type RecipeIngredientGroup,
  type RecipeNote,
  type RecipeStepDetail,
  type RecipeStepGroup,
} from '../contexts/ListsContext';
import { flattenIngredientGroups } from '../lib/ingredient-parsing';
import { refineRecipe } from '../lib/build-recipe-client';
import {
  saveDraft as saveExplicitDraft,
  removeDraft as removeExplicitDraft,
  getDraft,
  consumePendingResumeDraftId,
  deriveDraftTitle,
} from '../lib/recipe-drafts';
import { StepBasics } from './advanced-recipe-steps/StepBasics';
import { StepDetails } from './advanced-recipe-steps/StepDetails';
import { StepIngredients } from './advanced-recipe-steps/StepIngredients';
import { StepMethod } from './advanced-recipe-steps/StepMethod';
import { StepReview } from './advanced-recipe-steps/StepReview';
import './AdvancedRecipeBuilder.css';
import './RecipeBuilder.css';

/* ── Form state shape (also the localStorage draft shape) ───────── */

export interface AdvancedRecipeState {
  name: string;
  summary: string;
  /** Legacy longer "story" paragraph. No longer collected or rendered —
   *  kept in the model so editing an older recipe (or an AI/import seed
   *  that set it) round-trips the data without loss. */
  introParagraph: string;
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
  /** Method sections. Always at least one group; a single unnamed group
   *  renders as a plain flat step list (no section header). Naming it or
   *  adding a second group turns on the section subheadings everywhere. */
  stepGroups: RecipeStepGroup[];
  equipment: string[];
  tags: string[];
  notes: RecipeNote[];
  /** Other recipes attached as components (sauce / dough / side). Each
   *  ref carries placement flags deciding whether it renders with the
   *  ingredients card, the method, or both on the recipe page. */
  linkedRecipes: LinkedRecipeRef[];
  /** Author's personal score (0–10, 0.1 step). Surfaced on the
   *  author's own profile but never on the standalone recipe page —
   *  so it's "private from the public recipe view" while still
   *  appearing in author-profile listings of their own recipes. */
  score: number;
  isPublic: boolean;
  /** Carried through from an AI-generated seed / existing AI recipe so the
   *  "Created with AI" note survives editing + publishing. Not user-editable. */
  createdWithAi: boolean;
  /** Import provenance (source URL, or 'photo' / 'text') — carried through
   *  from an imported seed so the "Imported from …" note survives editing
   *  + publishing. Not user-editable. */
  importedFrom: string;
}

/** Serif step titles for the header. Five steps: the old Basics+Timing
 *  merged into "The basics", and Equipment & notes folded into the
 *  Extras section on Review. */
const STEP_TITLES = ['The basics', 'Details', 'Ingredients', 'Method', 'Review & publish'];
const STEP_COUNT = STEP_TITLES.length;
const LAST_STEP = STEP_COUNT - 1;

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

/** One-tap prompts for the "Edit with AI" composer. */
const AI_EDIT_SUGGESTIONS = [
  'Make it spicier',
  'Make it healthier',
  'Scale to 8 servings',
  'Simplify the steps',
  'Add a make-ahead tip',
];

/* ── Method-section helpers ───────────────────────────────────── */

/** Every non-empty step across all sections, in order. */
function flattenStepGroups(groups: RecipeStepGroup[]): RecipeStepDetail[] {
  return groups.flatMap((g) => g.steps.filter((s) => (s.body || s.title || '').trim()));
}

/** Drop empty steps + empty sections; trim section names. */
function cleanStepGroups(groups: RecipeStepGroup[]): RecipeStepGroup[] {
  return groups
    .map((g) => ({ name: g.name.trim(), steps: g.steps.filter((s) => (s.body || s.title || '').trim()) }))
    .filter((g) => g.steps.length > 0);
}

/** True when the sections are a real grouping worth persisting +
 *  rendering as subheadings (2+ sections, or a single *named* one). A
 *  lone unnamed section is just a flat method. */
function hasMeaningfulSections(groups: RecipeStepGroup[]): boolean {
  return groups.length > 1 || (groups.length === 1 && !!groups[0].name);
}

/** Snapshot the method as { stepGroups?, stepDetails, steps } for a
 *  HomeMeal payload — section info preserved only when meaningful, flat
 *  fallbacks always dual-written so legacy consumers keep rendering. */
function methodToPayload(groups: RecipeStepGroup[]): {
  stepGroups?: RecipeStepGroup[];
  stepDetails: RecipeStepDetail[];
  steps: string[];
} {
  const clean = cleanStepGroups(groups);
  const flat = clean.flatMap((g) => g.steps);
  return {
    stepGroups: hasMeaningfulSections(clean) ? clean : undefined,
    stepDetails: flat,
    steps: flat.map((s) => (s.title ? `${s.title}: ${s.body}` : s.body)),
  };
}

/** Backfill `stepGroups` on a persisted draft that predates sections
 *  (it only had a flat `steps` array), and `linkedRecipes` on drafts
 *  saved before recipe linking existed. Keeps old localStorage drafts
 *  from crashing the steps when hydrated. */
function coerceState(s: AdvancedRecipeState): AdvancedRecipeState {
  let next = s;
  if (!Array.isArray(next.linkedRecipes)) next = { ...next, linkedRecipes: [] };
  if (Array.isArray(next.stepGroups) && next.stepGroups.length > 0) return next;
  const legacy = (next as unknown as { steps?: RecipeStepDetail[] }).steps;
  const steps = Array.isArray(legacy) && legacy.length > 0 ? legacy : [{ title: '', body: '' }];
  return { ...next, stepGroups: [{ name: '', steps }] };
}

/** Initial state for a brand-new draft. */
function emptyState(): AdvancedRecipeState {
  return {
    name: '',
    summary: '',
    introParagraph: '',
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
    stepGroups: [{ name: '', steps: [{ title: '', body: '' }] }],
    equipment: [],
    tags: [],
    notes: [],
    linkedRecipes: [],
    score: 0,
    isPublic: false,
    createdWithAi: false,
    importedFrom: '',
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
  // Method: prefer rich sections, then flat stepDetails, then legacy
  // string steps — collapsing the last two into one unnamed section.
  let stepGroups: RecipeStepGroup[];
  if (meal.stepGroups && meal.stepGroups.length > 0) {
    stepGroups = meal.stepGroups.map((g) => ({
      name: g.name || '',
      steps: g.steps && g.steps.length > 0 ? g.steps : [{ title: '', body: '' }],
    }));
  } else {
    const flat: RecipeStepDetail[] =
      meal.stepDetails && meal.stepDetails.length > 0
        ? meal.stepDetails
        : (meal.steps || []).map((body) => ({ body }));
    stepGroups = [{ name: '', steps: flat.length > 0 ? flat : [{ title: '', body: '' }] }];
  }
  return {
    name: meal.name || '',
    summary: meal.summary || meal.description || '',
    introParagraph: meal.introParagraph || '',
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
    stepGroups,
    equipment: meal.equipment || [],
    tags: meal.tags || [],
    notes: meal.notes || [],
    linkedRecipes: meal.linkedRecipes || [],
    score: typeof meal.score === 'number' ? meal.score : 0,
    isPublic: meal.isPublic ?? false,
    createdWithAi: !!meal.createdWithAi,
    importedFrom: meal.importedFrom || '',
  };
}

/** Snapshot the current builder state as a HomeMeal — the inverse of
 *  fromHomeMeal. Used to hand the in-progress recipe to the AI refine
 *  call so it edits ON TOP of exactly what the user is looking at
 *  (rich groups + step details included), not a stale version. Identity
 *  fields (id / createdAt / photos / date) come from `base` when editing
 *  an existing recipe so they survive the round-trip. */
function stateToHomeMeal(state: AdvancedRecipeState, base?: HomeMeal | null): HomeMeal {
  const cleanIngredientGroups = state.ingredientGroups
    .map((g) => ({ name: g.name, ingredients: g.ingredients.filter((i) => i.name.trim()) }))
    .filter((g) => g.ingredients.length > 0);
  const flatIngredients = cleanIngredientGroups.flatMap((g) => g.ingredients);
  const method = methodToPayload(state.stepGroups);
  const summary = state.summary.trim();
  return {
    id: base?.id || `ai-edit-${Date.now()}`,
    createdAt: base?.createdAt ?? Date.now(),
    name: state.name.trim(),
    date: base?.date || localISODate(),
    score: state.score,
    wouldMakeAgain: base?.wouldMakeAgain ?? true,
    description: summary,
    photos: base?.photos || [],
    tags: state.tags,
    dishes: base?.dishes || [],
    isPublic: state.isPublic,
    coverPhoto: state.coverPhoto || undefined,
    prepTime: state.prepTime,
    cookTime: state.cookTime,
    chillTime: state.chillTime,
    servings: state.servings,
    difficulty: state.difficulty,
    cuisine: state.cuisine || undefined,
    yieldDescription: state.yieldDescription.trim() || undefined,
    course: state.course,
    summary: summary || undefined,
    introParagraph: state.introParagraph.trim() || undefined,
    ingredients: flatIngredients,
    ingredientGroups: cleanIngredientGroups,
    steps: method.steps,
    stepDetails: method.stepDetails,
    stepGroups: method.stepGroups,
    equipment: state.equipment.filter(Boolean),
    notes: state.notes.filter((n) => n.text.trim()),
    linkedRecipes: state.linkedRecipes.length > 0 ? state.linkedRecipes : undefined,
    builderVersion: 'advanced',
    createdWithAi: state.createdWithAi || undefined,
    importedFrom: state.importedFrom || undefined,
    // Preserve source attribution if somehow present (defensive — saved
    // copies aren't editable, so this is normally undefined).
    sourceAuthorId: base?.sourceAuthorId,
    sourceAuthorName: base?.sourceAuthorName,
    sourceAuthorUsername: base?.sourceAuthorUsername,
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
  | { type: 'ADD_STEP'; groupIndex: number }
  | { type: 'UPDATE_STEP'; groupIndex: number; index: number; step: RecipeStepDetail }
  | { type: 'MOVE_STEP'; groupIndex: number; index: number; direction: -1 | 1 }
  | { type: 'REMOVE_STEP'; groupIndex: number; index: number }
  | { type: 'ADD_STEP_GROUP' }
  | { type: 'REMOVE_STEP_GROUP'; index: number }
  | { type: 'RENAME_STEP_GROUP'; index: number; name: string }
  | { type: 'MOVE_STEP_GROUP'; index: number; direction: -1 | 1 }
  | { type: 'ADD_NOTE'; noteType: RecipeNote['type'] }
  | { type: 'UPDATE_NOTE'; index: number; note: RecipeNote }
  | { type: 'REMOVE_NOTE'; index: number }
  | { type: 'ADD_LINKED_RECIPE'; recipe: LinkedRecipeRef }
  | { type: 'REMOVE_LINKED_RECIPE'; id: string }
  | { type: 'TOGGLE_LINKED_PLACEMENT'; id: string; field: 'inIngredients' | 'inMethod' }
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
      return {
        ...state,
        stepGroups: state.stepGroups.map((g, i) =>
          i === action.groupIndex ? { ...g, steps: [...g.steps, { title: '', body: '' }] } : g,
        ),
      };
    case 'UPDATE_STEP':
      return {
        ...state,
        stepGroups: state.stepGroups.map((g, i) =>
          i === action.groupIndex
            ? { ...g, steps: g.steps.map((s, j) => (j === action.index ? action.step : s)) }
            : g,
        ),
      };
    case 'MOVE_STEP': {
      const group = state.stepGroups[action.groupIndex];
      if (!group) return state;
      const target = action.index + action.direction;
      if (target < 0 || target >= group.steps.length) return state;
      const nextSteps = [...group.steps];
      const [moved] = nextSteps.splice(action.index, 1);
      nextSteps.splice(target, 0, moved);
      return {
        ...state,
        stepGroups: state.stepGroups.map((g, i) =>
          i === action.groupIndex ? { ...g, steps: nextSteps } : g,
        ),
      };
    }
    case 'REMOVE_STEP': {
      const group = state.stepGroups[action.groupIndex];
      if (!group) return state;
      // Keep the last step of the last remaining section so the UI never
      // goes fully blank; otherwise just drop the step.
      if (group.steps.length <= 1 && state.stepGroups.length <= 1) return state;
      const nextSteps = group.steps.filter((_, j) => j !== action.index);
      // A section emptied of its last step disappears (unless it's the
      // only section left).
      if (nextSteps.length === 0 && state.stepGroups.length > 1) {
        return { ...state, stepGroups: state.stepGroups.filter((_, i) => i !== action.groupIndex) };
      }
      return {
        ...state,
        stepGroups: state.stepGroups.map((g, i) =>
          i === action.groupIndex ? { ...g, steps: nextSteps.length > 0 ? nextSteps : [{ title: '', body: '' }] } : g,
        ),
      };
    }
    case 'ADD_STEP_GROUP':
      return {
        ...state,
        stepGroups: [...state.stepGroups, { name: 'New section', steps: [{ title: '', body: '' }] }],
      };
    case 'REMOVE_STEP_GROUP': {
      if (state.stepGroups.length <= 1) return state;
      return { ...state, stepGroups: state.stepGroups.filter((_, i) => i !== action.index) };
    }
    case 'RENAME_STEP_GROUP':
      return {
        ...state,
        stepGroups: state.stepGroups.map((g, i) =>
          i === action.index ? { ...g, name: action.name } : g,
        ),
      };
    case 'MOVE_STEP_GROUP': {
      const target = action.index + action.direction;
      if (target < 0 || target >= state.stepGroups.length) return state;
      const next = [...state.stepGroups];
      const [moved] = next.splice(action.index, 1);
      next.splice(target, 0, moved);
      return { ...state, stepGroups: next };
    }
    case 'ADD_NOTE':
      return { ...state, notes: [...state.notes, { type: action.noteType, text: '' }] };
    case 'UPDATE_NOTE':
      return { ...state, notes: state.notes.map((n, i) => (i === action.index ? action.note : n)) };
    case 'REMOVE_NOTE':
      return { ...state, notes: state.notes.filter((_, i) => i !== action.index) };
    case 'ADD_LINKED_RECIPE': {
      if (state.linkedRecipes.some((r) => r.id === action.recipe.id)) return state;
      return { ...state, linkedRecipes: [...state.linkedRecipes, action.recipe] };
    }
    case 'REMOVE_LINKED_RECIPE':
      return { ...state, linkedRecipes: state.linkedRecipes.filter((r) => r.id !== action.id) };
    case 'TOGGLE_LINKED_PLACEMENT':
      return {
        ...state,
        linkedRecipes: state.linkedRecipes.map((r) => {
          if (r.id !== action.id) return r;
          const next = { ...r, [action.field]: !r[action.field] };
          // A link must surface somewhere — refuse to turn off the
          // last active placement (remove the link instead).
          if (!next.inIngredients && !next.inMethod) return r;
          return next;
        }),
      };
    case 'HYDRATE':
      return coerceState(action.state);
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
  // A cover photo is only required to publish *publicly*. Private recipes can
  // be saved to your cookbook without one.
  if (state.isPublic && !state.coverPhoto) errors.push({ step: 1, message: 'Add a cover photo to publish this recipe publicly.' });
  const ingredientCount = state.ingredientGroups.reduce(
    (sum, g) => sum + g.ingredients.filter((i) => i.name.trim()).length,
    0,
  );
  if (ingredientCount === 0) errors.push({ step: 2, message: 'Add at least one ingredient.' });
  const stepCount = flattenStepGroups(state.stepGroups).length;
  if (stepCount === 0) errors.push({ step: 3, message: 'Add at least one method step.' });
  return { ok: errors.length === 0, errors };
}

/** Per-step gate for the footer CTA. The basics (name only — the summary
 *  is optional), Ingredients, and Method hard-block until they have real
 *  content; everything else stays passable — remaining publish
 *  requirements surface via `validate` on the Publish click. */
function canLeaveStep(state: AdvancedRecipeState, step: number): { ok: boolean } {
  if (step === 0) {
    return { ok: !!state.name.trim() };
  }
  if (step === 2) {
    const count = state.ingredientGroups.reduce(
      (sum, g) => sum + g.ingredients.filter((i) => i.name.trim()).length,
      0,
    );
    return { ok: count > 0 };
  }
  if (step === 3) {
    return { ok: flattenStepGroups(state.stepGroups).length > 0 };
  }
  return { ok: true };
}

/* ── Draft persistence ───────────────────────────────────────── */

/* ── Auto-resume slot (single, transient — used by the "Resume your
     draft?" prompt on next modal open). Not exposed in Activity.

     Seeded sessions (AI generation / import) get their OWN slot: they
     share every write path with manual sessions (autosave, Save draft,
     publish cleanup), so keying them to the plain slot silently
     overwrote — or on publish, deleted — the user's in-progress manual
     recipe. Nothing ever READS the seed slot (a seeded open shows the
     seed, never a resume prompt), so it's write-only by design; a
     seeded session the user wants to keep goes through Save draft into
     the Activity drafts list. ─ */
function resumeSlotKey(userId: string | null, mealId: string | null, seeded = false): string {
  const u = userId || 'anon';
  if (mealId) return `gourmad-recipe-draft-${u}-edit-${mealId}`;
  return seeded ? `gourmad-recipe-draft-${u}-seed` : `gourmad-recipe-draft-${u}`;
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
  tabSlot?: React.ReactNode; // Basic/Advanced/AI toggle injected by parent
  /** Pre-fill the builder with this recipe but treat it as a NEW recipe
   *  (saves via createHomeMeal, never updateHomeMeal). Used by the
   *  "Create with AI" flow and the Import tab to hand off a draft for
   *  review. Ignored when `existing` is set. */
  seed?: HomeMeal | null;
  /** Where the seed came from — drives the Review step's banner copy. */
  seedKind?: 'ai' | 'import';
  /** Step index (0–4) to open on. Defaults to 0. The AI flow passes 4
   *  (Review) so the user lands on a skim of the finished recipe. */
  initialStep?: number;
  /** When the builder was opened to fine-tune an AI draft, a callback
   *  to discard these edits and return to the draft preview. Renders a
   *  "Back to AI draft" button when provided. */
  onBackToDraft?: () => void;
}

export const AdvancedRecipeBuilder: React.FC<AdvancedRecipeBuilderProps> = ({ existing, onClose, tabSlot, seed, seedKind, initialStep, onBackToDraft }) => {
  const navigate = useNavigate();
  const auth = useAuth();
  const { phoneMode } = useSettings();
  const lists = useLists();
  const userId = auth.user?.id || null;

  const initial = useMemo(
    () => (existing ? fromHomeMeal(existing) : seed ? fromHomeMeal(seed) : emptyState()),
    [existing, seed],
  );
  const [state, dispatch] = useReducer(reducer, initial);
  const [currentStep, setCurrentStep] = useState(() =>
    typeof initialStep === 'number' ? Math.max(0, Math.min(LAST_STEP, initialStep)) : 0,
  );
  // Per-step scroll offsets for the wizard body — saved as the user scrolls,
  // restored when a step is revisited. Matters most for the failed-publish
  // jump (setCurrentStep(firstStep) below), which used to land the user at
  // the top of the step with the offending field somewhere out of view.
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const stepScrollsRef = useRef<Record<number, number>>({});
  useLayoutEffect(() => {
    const el = bodyScrollRef.current;
    if (el) el.scrollTop = stepScrollsRef.current[currentStep] ?? 0;
  }, [currentStep]);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [showResume, setShowResume] = useState(false);
  const [resumeSlot, setResumeSlot] = useState<ResumeSlot | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  /** Post-publish success overlay: the saved meal's identity. */
  const [published, setPublished] = useState<{ id: string | null; name: string } | null>(null);
  /** Once the user explicitly clicks Save draft (or resumes a draft
   *  from Activity), we remember that draft's id so further saves
   *  update the same row rather than spawning a new one. */
  const [currentDraftId, setCurrentDraftId] = useState<string | null>(null);
  // "Edit with AI" composer — lets the user revise the recipe they're
  // editing with a free-text instruction. The AI builds on top of the
  // current draft (refineRecipe) rather than generating something new.
  const [aiEditOpen, setAiEditOpen] = useState(false);
  const [aiEditText, setAiEditText] = useState('');
  const [aiEditBusy, setAiEditBusy] = useState(false);
  const [aiEditError, setAiEditError] = useState<string | null>(null);
  const aiEditInputRef = useRef<HTMLTextAreaElement>(null);
  const aiEditAbortRef = useRef<AbortController | null>(null);
  const toast = useToast();

  const key = useMemo(() => resumeSlotKey(userId, existing?.id || null, !!seed), [userId, existing?.id, seed]);
  const saveTimerRef = useRef<number | null>(null);
  const hasUserInputRef = useRef(false);
  const initialHydratedRef = useRef(false);

  // On mount: prefer a pending Activity-resume draft over the
  // single-slot autoresume. Otherwise fall back to the "Resume your
  // draft?" prompt as before. Skip both when editing (already prefilled
  // from the existing meal) OR when seeded by the AI flow (the seed IS
  // the content — we must not clobber it with a stale autoresume).
  useEffect(() => {
    if (initialHydratedRef.current) return;
    initialHydratedRef.current = true;
    if (seed) return;
    // Consume the pending id even in edit mode — leaving it dangling would
    // hijack the next plain open of the builder.
    const pendingId = consumePendingResumeDraftId();
    if (existing) {
      // Resuming a draft OF THIS EDIT (Activity passes the meal so publish
      // routes through updateHomeMeal instead of creating a duplicate):
      // hydrate the draft state over the prefill — the draft session is
      // newer than the stored meal.
      if (pendingId) {
        const draft = getDraft(userId, pendingId);
        if (draft && draft.editingMealId === existing.id) {
          dispatch({ type: 'HYDRATE', state: draft.state });
          setCurrentStep(Math.max(0, Math.min(LAST_STEP, draft.currentStep)));
          setCurrentDraftId(draft.id);
          setDraftSavedAt(draft.savedAt);
        }
      }
      return;
    }
    if (pendingId) {
      const draft = getDraft(userId, pendingId);
      if (draft) {
        dispatch({ type: 'HYDRATE', state: draft.state });
        setCurrentStep(Math.max(0, Math.min(LAST_STEP, draft.currentStep)));
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
  }, [existing, seed, key, userId]);

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
    setCurrentStep(Math.max(0, Math.min(LAST_STEP, resumeSlot.currentStep)));
    setDraftSavedAt(resumeSlot.savedAt);
    setShowResume(false);
  }, [resumeSlot]);

  const handleResumeDiscard = useCallback(() => {
    clearResumeSlot(key);
    setShowResume(false);
    setResumeSlot(null);
  }, [key]);

  const validation = useMemo(() => validate(state), [state]);
  // Per-step gate. When the current step blocks (no name, Ingredients
  // with nothing in it, Method with nothing in it) the CTA goes
  // disabled and its label explains why.
  const gate = useMemo(() => canLeaveStep(state, currentStep), [state, currentStep]);

  const handleNext = useCallback(() => {
    // Belt-and-suspenders: the CTA is also disabled by `gate` in the
    // render, but block here too in case it's clicked via the keyboard
    // while still focused.
    if (!canLeaveStep(state, currentStep).ok) return;
    if (currentStep < LAST_STEP) setCurrentStep(currentStep + 1);
  }, [currentStep, state]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  }, [currentStep]);

  const handleJumpTo = useCallback((step: number) => {
    if (step >= 0 && step <= LAST_STEP) setCurrentStep(step);
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

  // Apply a free-text AI instruction to the recipe being edited. We send
  // the CURRENT builder state (not the original) so the AI revises exactly
  // what's on screen, then hydrate the builder with its merged result —
  // identity-bearing fields (id, photos) are preserved by refineRecipe.
  const handleApplyAiEdit = useCallback(async (override?: string): Promise<void> => {
    const instruction = (override ?? aiEditText).trim();
    if (!instruction || aiEditBusy) return;
    if (!state.name.trim()) {
      setAiEditError('Add a recipe name first so the AI knows what it’s editing.');
      return;
    }
    setAiEditBusy(true);
    setAiEditError(null);
    aiEditAbortRef.current?.abort();
    const controller = new AbortController();
    aiEditAbortRef.current = controller;
    const current = stateToHomeMeal(state, existing || seed || null);
    const res = await refineRecipe(current, instruction, controller.signal);
    if (controller.signal.aborted) return;
    setAiEditBusy(false);
    if (res.ok && res.meal) {
      // The AI round-trip may drop fields it doesn't know about —
      // re-attach the linked recipes so an AI edit can't sever them.
      dispatch({ type: 'HYDRATE', state: { ...fromHomeMeal(res.meal), linkedRecipes: state.linkedRecipes } });
      hasUserInputRef.current = true;
      setAiEditText('');
      setAiEditOpen(false);
      toast.showToast('Recipe updated with AI', {
        subtitle: 'Review the changes, then publish when you’re happy.',
        variant: 'success',
      });
    } else {
      setAiEditError(res.error || 'Couldn’t apply that. Try rephrasing.');
    }
  }, [aiEditText, aiEditBusy, state, existing, seed, toast]);

  // Focus the composer when it opens; abort any in-flight refine on unmount.
  useEffect(() => {
    if (aiEditOpen) {
      const t = setTimeout(() => aiEditInputRef.current?.focus(), 120);
      return () => clearTimeout(t);
    }
  }, [aiEditOpen]);
  useEffect(() => () => aiEditAbortRef.current?.abort(), []);

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
    const method = methodToPayload(state.stepGroups);
    const cleanIngredientGroups = state.ingredientGroups.map((g) => ({
      name: g.name,
      ingredients: g.ingredients.filter((i) => i.name.trim()),
    }));
    const cleanNotes = state.notes.filter((n) => n.text.trim());

    const today = localISODate();
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
      steps: method.steps,
      // Advanced-only fields
      summary: state.summary.trim(),
      introParagraph: state.introParagraph.trim() || undefined,
      course: state.course,
      chillTime: state.chillTime,
      yieldDescription: state.yieldDescription.trim() || undefined,
      ingredientGroups: cleanIngredientGroups,
      equipment: state.equipment.filter(Boolean),
      notes: cleanNotes,
      stepDetails: method.stepDetails,
      stepGroups: method.stepGroups,
      linkedRecipes: state.linkedRecipes.length > 0 ? state.linkedRecipes : undefined,
      builderVersion: 'advanced',
      createdWithAi: state.createdWithAi || undefined,
      importedFrom: state.importedFrom || undefined,
    };

    // Clear both the autoresume slot AND the explicit Activity draft
    // (if any). Publishing means the recipe lives in the user's pantry
    // now — no need to keep the draft hanging around.
    const cleanup = () => {
      clearResumeSlot(key);
      if (currentDraftId) removeExplicitDraft(userId, currentDraftId);
    };

    // Save, then hand off to the success overlay — the user chooses
    // between viewing the recipe page and just closing the modal.
    if (existing) {
      lists.updateHomeMeal(existing.id, payload);
      cleanup();
      setPublished({ id: existing.id, name: state.name.trim() });
    } else {
      const created = lists.createHomeMeal(payload);
      // Opened from a specific recipe list ("Add recipe" on a list page):
      // the new recipe also lands in that list, not just the cookbook.
      if (created && lists.homeMealModalTargetListId) lists.addRecipeToList(lists.homeMealModalTargetListId, created);
      cleanup();
      setPublished({ id: created?.id || null, name: state.name.trim() });
    }
  }, [state, existing, key, lists, userId, currentDraftId]);

  const handleViewPublished = useCallback(() => {
    const id = published?.id;
    onClose();
    if (userId && id) setTimeout(() => navigate(`/recipe/${userId}/${id}`), 80);
  }, [published, onClose, userId, navigate]);

  /* ── CTA label: the gate reason IS the label ──────────────────── */

  const ctaLabel =
    currentStep === 0 ? (gate.ok ? 'Details' : 'Name your recipe to continue') :
    currentStep === 1 ? 'Ingredients' :
    currentStep === 2 ? (gate.ok ? 'Method' : 'Add at least one ingredient') :
    currentStep === 3 ? (gate.ok ? 'Review & publish' : 'Write at least one step') :
    (existing ? 'Save changes' : 'Publish recipe');

  const renderStep = () => {
    switch (currentStep) {
      case 0: return <StepBasics state={state} dispatch={dispatch} />;
      case 1: return <StepDetails state={state} dispatch={dispatch} />;
      case 2: return <StepIngredients state={state} dispatch={dispatch} existingId={existing?.id} />;
      case 3: return <StepMethod state={state} dispatch={dispatch} existingId={existing?.id} />;
      case 4: return <StepReview state={state} dispatch={dispatch} draftKind={seed && !existing ? (seedKind || 'ai') : undefined} />;
      default: return null;
    }
  };

  return (
    <div className={`rcx${phoneMode ? ' is-phone' : ''}`}>
      {/* ── Header ── */}
      <div className="rcx-head">
        <div className="rcx-head-row">
          {tabSlot ?? (
            <span className="rcx-head-eyebrow">{existing ? 'Edit recipe' : 'New recipe'}</span>
          )}
          <div className="rcx-head-actions">
            <span className={`rcx-saved${draftSavedAt ? ' is-saved' : ''}`}>
              <span className="rcx-saved-dot" />
              <span className="rcx-saved-label">{draftSavedAt ? 'Saved' : 'Unsaved'}</span>
            </span>
            <button type="button" className="rcx-head-link" onClick={handleSaveDraft}>
              Save draft
            </button>
            <GlassButton
              id="recipe-builder-close"
              symbol="xmark"
              label="Close"
              onClick={onClose}
              className="rcx-head-close"
            >
              <X size={14} />
            </GlassButton>
          </div>
        </div>

        {(onBackToDraft || existing) && (
          <div className="rcx-subrow">
            {onBackToDraft && (
              <button type="button" className="rcx-sub-chip" onClick={onBackToDraft}>
                <ArrowLeft size={12} strokeWidth={2.4} />
                <Sparkles size={11} />
                Back to AI draft
              </button>
            )}
            {existing && (
              <button
                type="button"
                className="rcx-sub-chip"
                onClick={() => { setAiEditError(null); setAiEditOpen(true); }}
              >
                <Sparkles size={11} />
                Edit with AI
              </button>
            )}
          </div>
        )}

        <div className="rcx-title-row">
          <h2 className="rcx-step-title">{STEP_TITLES[currentStep]}</h2>
          <span className="rcx-step-counter">{currentStep + 1} / {STEP_COUNT}</span>
        </div>

        <div className="rcx-segs">
          {STEP_TITLES.map((t, i) => (
            <button
              key={i}
              type="button"
              className={`rcx-seg${i < currentStep ? ' is-done' : ''}${i === currentStep ? ' is-current' : ''}`}
              onClick={() => handleJumpTo(i)}
              aria-label={`Step ${i + 1}: ${t}`}
            />
          ))}
        </div>
      </div>

      {/* ── Scrollable step body ── */}
      <div
        className="rcx-body"
        ref={bodyScrollRef}
        onScroll={(e) => { stepScrollsRef.current[currentStep] = e.currentTarget.scrollTop; }}
        style={{ paddingBottom: 'calc(120px + var(--kb-height, 0px))' }}
      >
        <div key={currentStep} className="rcx-step-anim">
          {renderStep()}
          {showValidation && !validation.ok && (
            <div className="rcx-validation">
              Fix these before publishing:
              <ul>
                {validation.errors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="rcx-foot">
        {currentStep > 0 && (
          <button type="button" className="rcx-foot-back" onClick={handleBack} aria-label="Back">
            <ArrowLeft size={17} />
          </button>
        )}
        <button
          type="button"
          className={`rcx-foot-cta${!gate.ok ? ' is-disabled' : ''}${currentStep === LAST_STEP && gate.ok ? ' is-publish' : ''}`}
          onClick={currentStep === LAST_STEP ? handlePublish : handleNext}
        >
          {ctaLabel}
          {gate.ok && currentStep < LAST_STEP && <ArrowRight size={15} strokeWidth={2.2} />}
          {gate.ok && currentStep === LAST_STEP && <Check size={16} strokeWidth={2.4} />}
        </button>
      </div>

      {/* ── Published overlay ── */}
      {published && (
        <div className="rcx-published">
          <div className="rcx-published-badge">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 12.5l5 5L19.5 7" className="rcx-published-check" />
            </svg>
          </div>
          <div className="rcx-published-title">
            {existing ? 'Changes saved' : 'Recipe published'}
          </div>
          <div className="rcx-published-sub">
            {published.name || 'Your recipe'} is in your pantry
            {state.isPublic ? " and on your friends' feeds." : ', visible only to you.'}
          </div>
          <div className="rcx-published-actions">
            {userId && published.id && (
              <button type="button" className="rcx-published-view" onClick={handleViewPublished}>
                View recipe
              </button>
            )}
            <button type="button" className="rcx-published-done" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      )}

      {/* ── Resume-draft prompt overlay ── */}
      {showResume && resumeSlot && (
        <div className="rcx-overlay">
          <div className="rcx-modal">
            <h3 className="rcx-modal-title">Resume your draft?</h3>
            <p className="rcx-modal-sub">
              You have an unsaved recipe from {formatTimeAgo(resumeSlot.savedAt)}. Pick up where you left off, or start fresh.
            </p>
            <div className="rcx-modal-actions">
              <button type="button" className="rcx-mini-ghost" onClick={handleResumeDiscard}>Start over</button>
              <button type="button" className="rcx-mini-primary" onClick={handleResumeAccept}>Resume</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Edit-with-AI composer overlay ── */}
      {aiEditOpen && (
        <div
          className="rcx-overlay"
          onClick={() => { if (!aiEditBusy) setAiEditOpen(false); }}
        >
          <div className="rcx-modal is-wide" onClick={(e) => e.stopPropagation()}>
            <div className="rcx-modal-head">
              <span className="rcx-modal-eyebrow"><Sparkles size={13} /> Edit with AI</span>
              <GlassButton
                id="recipe-builder-ai-edit-close"
                symbol="xmark"
                label="Close"
                disabled={aiEditBusy}
                onClick={() => setAiEditOpen(false)}
                className="rcx-head-close"
              >
                <X size={14} />
              </GlassButton>
            </div>
            <p className="rcx-modal-sub">
              Describe a change and the AI will revise <strong>{state.name.trim() || 'this recipe'}</strong> —
              building on what's here, not starting over.
            </p>
            <div className="rcx-chips">
              {AI_EDIT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="rcx-chip"
                  disabled={aiEditBusy}
                  onClick={() => handleApplyAiEdit(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea
              ref={aiEditInputRef}
              className="rcx-area"
              value={aiEditText}
              onChange={(e) => { setAiEditText(e.target.value); if (aiEditError) setAiEditError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handleApplyAiEdit(); }
              }}
              disabled={aiEditBusy}
              rows={3}
              placeholder="e.g. Make it vegetarian, add a make-ahead tip, scale to 8 servings…"
            />
            {aiEditError && (
              <p className="rcx-modal-error"><AlertCircle size={13} /> {aiEditError}</p>
            )}
            <div className="rcx-modal-actions">
              <button
                type="button"
                className="rcx-mini-ghost"
                onClick={() => setAiEditOpen(false)}
                disabled={aiEditBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rcx-mini-primary"
                onClick={() => handleApplyAiEdit()}
                disabled={aiEditBusy || !aiEditText.trim()}
              >
                {aiEditBusy ? (<><Loader2 size={14} className="rcx-spin" /> Revising…</>) : (<><Sparkles size={14} /> Apply edit</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
