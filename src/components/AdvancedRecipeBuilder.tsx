// Advanced Recipe Builder — a multi-step wizard mounted by AddHomeMealModal
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
  /** Longer "story" paragraph shown in the recipe page body. Optional —
   *  falls back to the summary on the recipe page when blank. */
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
}

/** Step rail / mobile-header label. The accent word renders italic +
 *  rust ("The *basics*.") inside the big serif title. */
const STEP_LABELS: Array<{ lead: string; accent: string }> = [
  { lead: 'The', accent: 'basics' },
  { lead: 'The', accent: 'details' },
  { lead: 'Timing &', accent: 'yield' },
  { lead: 'The', accent: 'ingredients' },
  { lead: 'The', accent: 'method' },
  { lead: 'Equipment &', accent: 'notes' },
  { lead: 'Review &', accent: 'publish' },
];
/** Short, plain title for places that don't render the accent word
 *  (rail step list, mobile header eyebrow, footer "NEXT UP" label). */
const STEP_TITLES = ['The basics', 'Details', 'Timing & yield', 'Ingredients', 'Method', 'Equipment & notes', 'Review & publish'];
/** Next-step title, indexed by the CURRENT step (so it's STEP_TITLES shifted by one). */
const NEXT_LABELS = STEP_TITLES.slice(1);
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
    date: base?.date || new Date().toISOString().slice(0, 10),
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
  if (!state.summary.trim()) errors.push({ step: 0, message: 'One-line summary is required.' });
  if (!state.coverPhoto) errors.push({ step: 1, message: 'Hero image is required.' });
  const ingredientCount = state.ingredientGroups.reduce(
    (sum, g) => sum + g.ingredients.filter((i) => i.name.trim()).length,
    0,
  );
  if (ingredientCount === 0) errors.push({ step: 3, message: 'Add at least one ingredient.' });
  const stepCount = flattenStepGroups(state.stepGroups).length;
  if (stepCount === 0) errors.push({ step: 4, message: 'Add at least one method step.' });
  return { ok: errors.length === 0, errors };
}

/** Per-step gate for the "Next" button. Only the Ingredients (step 3) and
 *  Method (step 4) steps hard-block — the user must add at least one real
 *  ingredient / step before moving on. Other steps' missing-required
 *  warnings still surface on Publish via `validate`. */
function canLeaveStep(state: AdvancedRecipeState, step: number): { ok: boolean; reason?: string } {
  if (step === 3) {
    const count = state.ingredientGroups.reduce(
      (sum, g) => sum + g.ingredients.filter((i) => i.name.trim()).length,
      0,
    );
    if (count === 0) {
      return { ok: false, reason: 'Add at least one ingredient before moving on.' };
    }
  }
  if (step === 4) {
    const count = flattenStepGroups(state.stepGroups).length;
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
  /** Pre-fill the builder with this recipe but treat it as a NEW recipe
   *  (saves via createHomeMeal, never updateHomeMeal). Used by the
   *  "Create with AI" flow to hand off a generated draft for review.
   *  Ignored when `existing` is set. */
  seed?: HomeMeal | null;
  /** Step index (0–5) to open on. Defaults to 0. The AI flow passes 5
   *  (Review) so the user lands on a skim of the finished recipe. */
  initialStep?: number;
  /** When the builder was opened to fine-tune an AI draft, a callback
   *  to discard these edits and return to the draft preview. Renders a
   *  "Back to AI draft" button when provided. */
  onBackToDraft?: () => void;
}

export const AdvancedRecipeBuilder: React.FC<AdvancedRecipeBuilderProps> = ({ existing, onClose, tabSlot, seed, initialStep, onBackToDraft }) => {
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
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);
  const [showResume, setShowResume] = useState(false);
  const [resumeSlot, setResumeSlot] = useState<ResumeSlot | null>(null);
  const [showValidation, setShowValidation] = useState(false);
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

  const key = useMemo(() => resumeSlotKey(userId, existing?.id || null), [userId, existing?.id]);
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
    if (existing || seed) return;
    const pendingId = consumePendingResumeDraftId();
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
  // Per-step gate. When the current step blocks (Ingredients with
  // nothing in it, Method with nothing in it) the Next button goes
  // disabled and an inline note explains why.
  const gate = useMemo(() => canLeaveStep(state, currentStep), [state, currentStep]);

  const handleNext = useCallback(() => {
    // Belt-and-suspenders: the Next button is also disabled by `gate`
    // in the render, but block here too in case it's clicked via the
    // keyboard while still focused.
    if (!canLeaveStep(state, currentStep).ok) return;
    if (currentStep < LAST_STEP) setCurrentStep(currentStep + 1);
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
  const progress = Math.round(((currentStep + 1) / STEP_COUNT) * 100);

  const isPhone = phoneMode;

  const renderStep = () => {
    switch (currentStep) {
      case 0: return <StepBasics state={state} dispatch={dispatch} />;
      case 1: return <StepDetails state={state} dispatch={dispatch} />;
      case 2: return <StepTiming state={state} dispatch={dispatch} />;
      case 3: return <StepIngredients state={state} dispatch={dispatch} existingId={existing?.id} />;
      case 4: return <StepMethod state={state} dispatch={dispatch} existingId={existing?.id} />;
      case 5: return <StepEquipmentNotes state={state} dispatch={dispatch} />;
      case 6: return <StepReview state={state} dispatch={dispatch} validation={validation} />;
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

      {/* Edit-with-AI composer overlay. */}
      {aiEditOpen && (
        <div
          className="arb-draft-overlay"
          onClick={() => { if (!aiEditBusy) setAiEditOpen(false); }}
        >
          <div className="arb-aiedit-card" onClick={(e) => e.stopPropagation()}>
            <div className="arb-aiedit-head">
              <div className="arb-aiedit-eyebrow"><Sparkles size={14} /> Edit with AI</div>
              <button
                type="button"
                className="arb-aiedit-close"
                onClick={() => setAiEditOpen(false)}
                disabled={aiEditBusy}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <p className="arb-aiedit-sub">
              Describe a change and the AI will revise <strong>{state.name.trim() || 'this recipe'}</strong> —
              building on what's here, not starting over.
            </p>
            <div className="arb-aiedit-chips">
              {AI_EDIT_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="arb-aiedit-chip"
                  disabled={aiEditBusy}
                  onClick={() => handleApplyAiEdit(s)}
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea
              ref={aiEditInputRef}
              className="arb-aiedit-input"
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
              <p className="arb-aiedit-error"><AlertCircle size={13} /> {aiEditError}</p>
            )}
            <div className="arb-aiedit-actions">
              <button
                type="button"
                className="arb-aiedit-cancel"
                onClick={() => setAiEditOpen(false)}
                disabled={aiEditBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="arb-aiedit-apply"
                onClick={() => handleApplyAiEdit()}
                disabled={aiEditBusy || !aiEditText.trim()}
              >
                {aiEditBusy ? (<><Loader2 size={15} className="arb-spin" /> Revising…</>) : (<><Sparkles size={15} /> Apply edit</>)}
              </button>
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
          {/* Tab strip — switch builder modes, with the close button. */}
          <div className="arb-m-tabs">
            {tabSlot}
            <button
              type="button"
              className="arb-m-header-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          {onBackToDraft && (
            <button type="button" className="arb-back-to-draft is-mobile" onClick={onBackToDraft}>
              <ArrowLeft size={14} />
              <Sparkles size={12} />
              Back to AI draft
            </button>
          )}
          <div className="arb-m-titlerow">
            <div className="arb-m-titleblock-left">
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
          {existing && (
            <button
              type="button"
              className="arb-edit-ai-btn is-mobile"
              onClick={() => { setAiEditError(null); setAiEditOpen(true); }}
            >
              <Sparkles size={13} />
              Edit with AI
            </button>
          )}
        </header>
      )}

      <div className="arb-shell">
        {/* Desktop left rail. */}
        {!isPhone && (
          <nav className="arb-rail">
            <div className="arb-rail-eyebrow">{existing ? 'Edit recipe' : 'New recipe'}</div>
            <div className="arb-rail-title">
              {existing ? <>Let's <em>refine</em> it.</> : <>Let's build a <em>recipe</em>.</>}
            </div>
            {onBackToDraft && (
              <button type="button" className="arb-back-to-draft" onClick={onBackToDraft}>
                <ArrowLeft size={14} />
                <Sparkles size={13} />
                Back to AI draft
              </button>
            )}
            {tabSlot && <div style={{ marginTop: 16 }}>{tabSlot}</div>}
            {existing && (
              <button
                type="button"
                className="arb-edit-ai-btn"
                onClick={() => { setAiEditError(null); setAiEditOpen(true); }}
              >
                <Sparkles size={14} />
                Edit with AI
              </button>
            )}
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
                <span style={{ marginLeft: 'auto' }}>Step {currentStep + 1} of {STEP_COUNT}</span>
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
              Step <span className="strong">{currentStep + 1}</span> of {STEP_COUNT}
            </div>
            <h2 className="arb-pane-title">
              {STEP_LABELS[currentStep].lead}{' '}
              <span className="arb-pane-title-accent">{STEP_LABELS[currentStep].accent}</span>.
            </h2>
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
              {currentStep < LAST_STEP ? (
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
            {currentStep < LAST_STEP ? (
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
