import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Check, ChevronLeft, ChevronRight, Tag, Image, UtensilsCrossed, Globe, Lock, Camera, Trash2, Search, Star, BookOpen, Clock, Flame, Users, Hash, FileText, ChevronDown, ClipboardPaste } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type PhotoItem, type HomeMealDish, type RecipeIngredient } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { useRecipes } from '../contexts/RecipesContext';

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

// Per-line outcome of the bulk ingredient parser. Rendered with a green Check
// (success) or red X (error) so the user can see exactly which lines made it.
type BulkResult =
  | { line: string; status: 'success'; ingredient: RecipeIngredient }
  | { line: string; status: 'error'; message: string };

// Unit definitions — the dropdown always shows the plural (canonical) form.
// Aliases cover common user spellings including mistyped/long forms so the
// bulk paste parser and single-add form can normalize whatever the user typed.
type UnitDef = {
  label: string;     // canonical plural form shown in dropdown
  singular: string;  // singular form used when amount <= 1
  aliases: string[]; // case-insensitive alias set for fuzzy matching
};

const UNITS: UnitDef[] = [
  { label: 'cups', singular: 'cup', aliases: ['cup', 'cups', 'c'] },
  { label: 'tbsp', singular: 'tbsp', aliases: ['tbsp', 'tbsps', 'tablespoon', 'tablespoons', 'tbl', 'tbls', 'tbs', 'T'] },
  { label: 'tsp', singular: 'tsp', aliases: ['tsp', 'tsps', 'teaspoon', 'teaspoons', 't'] },
  { label: 'oz', singular: 'oz', aliases: ['oz', 'ozs', 'ounce', 'ounces'] },
  { label: 'fl oz', singular: 'fl oz', aliases: ['fl oz', 'fluid ounce', 'fluid ounces', 'floz'] },
  { label: 'lbs', singular: 'lb', aliases: ['lb', 'lbs', 'pound', 'pounds'] },
  { label: 'g', singular: 'g', aliases: ['g', 'gram', 'grams', 'gm'] },
  { label: 'kg', singular: 'kg', aliases: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'] },
  { label: 'mg', singular: 'mg', aliases: ['mg', 'milligram', 'milligrams'] },
  { label: 'ml', singular: 'ml', aliases: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
  { label: 'L', singular: 'L', aliases: ['l', 'liter', 'liters', 'litre', 'litres'] },
  { label: 'pinches', singular: 'pinch', aliases: ['pinch', 'pinches'] },
  { label: 'dashes', singular: 'dash', aliases: ['dash', 'dashes'] },
  { label: 'drops', singular: 'drop', aliases: ['drop', 'drops'] },
  { label: 'handfuls', singular: 'handful', aliases: ['handful', 'handfuls'] },
  { label: 'cloves', singular: 'clove', aliases: ['clove', 'cloves'] },
  { label: 'slices', singular: 'slice', aliases: ['slice', 'slices'] },
  { label: 'pieces', singular: 'piece', aliases: ['piece', 'pieces', 'pc', 'pcs'] },
  { label: 'cans', singular: 'can', aliases: ['can', 'cans'] },
  { label: 'jars', singular: 'jar', aliases: ['jar', 'jars'] },
  { label: 'packages', singular: 'package', aliases: ['package', 'packages', 'pkg', 'pkgs', 'pack', 'packs'] },
  { label: 'bunches', singular: 'bunch', aliases: ['bunch', 'bunches'] },
  { label: 'sprigs', singular: 'sprig', aliases: ['sprig', 'sprigs'] },
  { label: 'heads', singular: 'head', aliases: ['head', 'heads'] },
  { label: 'stalks', singular: 'stalk', aliases: ['stalk', 'stalks'] },
  { label: 'sticks', singular: 'stick', aliases: ['stick', 'sticks'] },
  { label: 'quarts', singular: 'quart', aliases: ['quart', 'quarts', 'qt', 'qts'] },
  { label: 'pints', singular: 'pint', aliases: ['pint', 'pints', 'pt', 'pts'] },
  { label: 'gallons', singular: 'gallon', aliases: ['gallon', 'gallons', 'gal', 'gals'] },
  { label: 'boxes', singular: 'box', aliases: ['box', 'boxes'] },
  { label: 'bags', singular: 'bag', aliases: ['bag', 'bags'] },
  { label: 'bottles', singular: 'bottle', aliases: ['bottle', 'bottles'] },
  { label: 'inches', singular: 'inch', aliases: ['inch', 'inches', 'in'] },
  { label: 'cm', singular: 'cm', aliases: ['cm', 'centimeter', 'centimeters'] },
];

// Returns singular form for amounts <= 1 (and > 0), otherwise the plural label.
// Amount == null (no amount given) uses the plural label.
const displayUnit = (label: string, amount: number | null): string => {
  if (!label) return '';
  const def = UNITS.find((u) => u.label === label);
  if (!def) return label;
  if (amount !== null && amount > 0 && amount <= 1) return def.singular;
  return def.label;
};

// Classic iterative Levenshtein with O(min(m,n)) memory.
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
};

// Map any input (exact alias, mistype, singular/plural, long form) to a canonical
// plural label. Returns '' if nothing reasonable matches. `strict` disables fuzzy
// matching — used by the line parser to avoid turning ingredient words into units.
const normalizeUnit = (input: string, strict = false): string => {
  const cleaned = input.trim().toLowerCase().replace(/[.,;:]+$/, '');
  if (!cleaned) return '';
  for (const u of UNITS) {
    if (u.aliases.some((a) => a.toLowerCase() === cleaned)) return u.label;
  }
  if (strict) return '';
  // Fuzzy fallback: find closest alias, require a small distance relative to length.
  let best: UnitDef | null = null;
  let bestDist = Infinity;
  for (const u of UNITS) {
    for (const a of u.aliases) {
      const d = levenshtein(cleaned, a.toLowerCase());
      if (d < bestDist) { bestDist = d; best = u; }
    }
  }
  if (!best) return '';
  const threshold = cleaned.length <= 3 ? 1 : cleaned.length <= 5 ? 1 : 2;
  if (bestDist <= threshold) return best.label;
  return '';
};

// Parses "2", "1/2", "1 1/2", "0.5", "1-2" (range uses low end) into a number.
// Returns null for anything it can't recognize.
// Matches a decimal number in any of these forms: "1", "1.5", "0.5", ".5".
// Used by both parseAmount and parseIngredientLine so they agree on what
// counts as a number.
const DECIMAL_PATTERN = '(?:\\d+\\.\\d+|\\d+\\.|\\.\\d+|\\d+)';

const parseAmount = (str: string): number | null => {
  // Normalize comma decimal separators ("0,5" → "0.5") so European-style
  // input works without a special case.
  const trimmed = str.trim().replace(/,/g, '.');
  if (!trimmed) return null;
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    if (!den) return null;
    return whole + num / den;
  }
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = parseInt(fracMatch[2], 10);
    if (!den) return null;
    return num / den;
  }
  if (new RegExp(`^${DECIMAL_PATTERN}$`).test(trimmed)) {
    const n = parseFloat(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  const rangeMatch = trimmed.match(new RegExp(`^(${DECIMAL_PATTERN})\\s*-\\s*${DECIMAL_PATTERN}$`));
  if (rangeMatch) {
    const n = parseFloat(rangeMatch[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// Converts a decimal number to a display-friendly fraction like "1 1/2".
// Uses common cooking fractions (eighths, thirds, quarters).
const toFraction = (value: number): string => {
  if (!Number.isFinite(value) || value < 0) return '';
  if (value === 0) return '0';
  const whole = Math.floor(value);
  const frac = value - whole;
  if (frac < 0.01) return String(whole);
  const candidates: { value: number; str: string }[] = [
    { value: 1 / 8, str: '1/8' },
    { value: 1 / 6, str: '1/6' },
    { value: 1 / 5, str: '1/5' },
    { value: 1 / 4, str: '1/4' },
    { value: 1 / 3, str: '1/3' },
    { value: 3 / 8, str: '3/8' },
    { value: 2 / 5, str: '2/5' },
    { value: 1 / 2, str: '1/2' },
    { value: 3 / 5, str: '3/5' },
    { value: 5 / 8, str: '5/8' },
    { value: 2 / 3, str: '2/3' },
    { value: 3 / 4, str: '3/4' },
    { value: 4 / 5, str: '4/5' },
    { value: 5 / 6, str: '5/6' },
    { value: 7 / 8, str: '7/8' },
  ];
  let best = candidates[0];
  let bestDiff = Math.abs(frac - best.value);
  for (const c of candidates) {
    const diff = Math.abs(frac - c.value);
    if (diff < bestDiff) { best = c; bestDiff = diff; }
  }
  // If rounding up to the next whole is closer than any fraction, just round up.
  if (Math.abs(1 - frac) < bestDiff) return String(whole + 1);
  if (whole === 0) return best.str;
  return `${whole} ${best.str}`;
};

// Normalizes a stored amount string for display (e.g. "0.5" → "1/2").
const displayAmount = (amount: string): string => {
  if (!amount) return '';
  const parsed = parseAmount(amount);
  if (parsed === null) return amount;
  return toFraction(parsed);
};

// Parses a single bulk-paste line into { amount, unit, name }.
const parseIngredientLine = (raw: string): { name: string; amount: string; unit: string } | null => {
  // Strip bullets, collapse whitespace, and normalize comma decimals.
  const line = raw.trim().replace(/^[-*•·●]\s*/, '').replace(/\s+/g, ' ').replace(/(\d),(\d)/g, '$1.$2');
  if (!line) return null;
  // Leading amount can be a mixed fraction ("1 1/2"), a fraction ("1/2"),
  // a decimal with or without a leading zero (".5", "0.5", "1.5"), a plain
  // integer, or a range ("1-2"). The pattern matches any of these.
  const amountMatch = line.match(
    new RegExp(`^(\\d+\\s+\\d+/\\d+|\\d+/\\d+|${DECIMAL_PATTERN}(?:\\s*-\\s*${DECIMAL_PATTERN})?)\\s*(.*)$`),
  );
  if (!amountMatch) {
    return { name: line, amount: '', unit: '' };
  }
  const amount = amountMatch[1].replace(/\s*-\s*/, '-');
  const rest = amountMatch[2];
  if (!rest) return { name: '', amount, unit: '' };
  const words = rest.split(' ');
  // Try a two-word unit first ("fl oz", "fluid ounces"), then one-word.
  if (words.length >= 2) {
    const twoWord = `${words[0]} ${words[1]}`;
    const matched = normalizeUnit(twoWord);
    if (matched) return { amount, unit: matched, name: words.slice(2).join(' ') };
  }
  const firstWord = words[0].replace(/[.,;:]$/, '');
  const matched = normalizeUnit(firstWord);
  if (matched) return { amount, unit: matched, name: words.slice(1).join(' ') };
  return { amount, unit: '', name: rest };
};

type Page = 'main' | 'tags' | 'photos' | 'dishes' | 'ingredients' | 'steps';

export const AddHomeMealModal: React.FC = () => {
  const {
    homeMealModalOpen, homeMealModalData, closeHomeMealModal,
    createHomeMeal, updateHomeMeal, deleteHomeMeal,
  } = useLists();
  const { phoneMode } = useSettings();
  const { myRecipes } = useRecipes();

  const existing = homeMealModalData;

  const [mealName, setMealName] = useState('');
  const [score, setScore] = useState(0);
  const [notes, setNotes] = useState('');
  const [visitDate, setVisitDate] = useState(new Date().toISOString().slice(0, 10));
  const [wouldMakeAgain, setWouldMakeAgain] = useState(true);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [dishes, setDishes] = useState<HomeMealDish[]>([]);
  const [isPublic, setIsPublic] = useState(false);

  // Recipe-like fields
  const [coverPhoto, setCoverPhoto] = useState('');
  // Prep / cook time is edited as separate hours + minutes strings so the
  // fields can be empty (placeholder "0") until the user actually types.
  const [prepHoursStr, setPrepHoursStr] = useState('');
  const [prepMinutesStr, setPrepMinutesStr] = useState('');
  const [cookHoursStr, setCookHoursStr] = useState('');
  const [cookMinutesStr, setCookMinutesStr] = useState('');
  const [servingsStr, setServingsStr] = useState('');
  const [difficulty, setDifficulty] = useState<'Easy' | 'Medium' | 'Hard'>('Medium');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [steps, setSteps] = useState<string[]>([]);

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
      // Split stored minute totals into hours + minutes strings. Empty
      // strings render as placeholder "0".
      const prepMins = existing?.prepTime ?? 0;
      const cookMins = existing?.cookTime ?? 0;
      const ph = Math.floor(prepMins / 60);
      const pm = prepMins % 60;
      const ch = Math.floor(cookMins / 60);
      const cm = cookMins % 60;
      setPrepHoursStr(ph > 0 ? String(ph) : '');
      setPrepMinutesStr(pm > 0 ? String(pm) : '');
      setCookHoursStr(ch > 0 ? String(ch) : '');
      setCookMinutesStr(cm > 0 ? String(cm) : '');
      setServingsStr(existing?.servings != null ? String(existing.servings) : '');
      setDifficulty(existing?.difficulty ?? 'Medium');
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
    setPage('main');
  };

  const handleDeleteDish = () => {
    if (editingDishId) {
      setDishes((prev) => prev.filter((d) => d.id !== editingDishId));
    }
    setPage('main');
  };

  // Convert the hours/minutes strings into a single minute total for storage.
  const prepTotalMinutes = (parseInt(prepHoursStr, 10) || 0) * 60 + (parseInt(prepMinutesStr, 10) || 0);
  const cookTotalMinutes = (parseInt(cookHoursStr, 10) || 0) * 60 + (parseInt(cookMinutesStr, 10) || 0);
  const servingsValue = parseInt(servingsStr, 10);

  // Servings stepper helper — defaults to 4 when the field is empty.
  const adjustServings = (delta: number) => {
    const current = parseInt(servingsStr, 10);
    const base = Number.isFinite(current) && current > 0 ? current : 4;
    const next = Math.max(1, base + delta);
    setServingsStr(String(next));
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
      prepTime: prepTotalMinutes,
      cookTime: cookTotalMinutes,
      servings: Number.isFinite(servingsValue) && servingsValue > 0 ? servingsValue : 4,
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
            <input ref={coverInputRef} type="file" accept="image/*" onChange={handleCoverUpload} className="hidden" />
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

                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3">
                    {/* Cover photo — compact dropzone */}
                    <button
                      onClick={() => coverInputRef.current?.click()}
                      className="w-full h-20 rounded-2xl border border-dashed border-on-surface/20 bg-on-surface/[0.02] shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)] flex items-center justify-center gap-2 mb-3 overflow-hidden hover:border-primary/30 transition-colors relative"
                    >
                      {coverPhoto ? (
                        <>
                          <img src={coverPhoto} alt="Cover" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                            <Camera size={18} className="text-white" />
                          </div>
                        </>
                      ) : (
                        <>
                          <Camera size={16} className="text-on-surface/30" />
                          <span className="text-xs text-on-surface/40 font-medium">Add cover photo</span>
                        </>
                      )}
                    </button>

                    {/* Meal name */}
                    <input
                      type="text"
                      value={mealName}
                      onChange={(e) => setMealName(e.target.value)}
                      placeholder="Meal name"
                      autoFocus
                      className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl px-4 py-2.5 text-sm font-semibold placeholder:font-medium placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/20 mb-2.5"
                    />

                    {/* Description (max-height w/ internal scroll) */}
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="A brief description..."
                      rows={2}
                      className="w-full bg-on-surface/[0.04] border border-on-surface/10 rounded-xl py-2 px-4 text-sm font-medium placeholder:text-on-surface/35 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none max-h-24 overflow-y-auto mb-3"
                    />

                    {/* Quick Info */}
                    <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium mb-1.5">Quick Info</p>

                    {/* Prep | Cook — side-by-side w/ divider */}
                    <div className="flex items-stretch bg-on-surface/[0.04] border border-on-surface/10 rounded-xl mb-2">
                      <div className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2">
                        <Clock size={12} className="text-on-surface/40 flex-shrink-0" />
                        <span className="text-[10px] font-semibold text-on-surface/50 mr-0.5">Prep</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={prepHoursStr}
                          onChange={(e) => setPrepHoursStr(e.target.value.replace(/\D/g, ''))}
                          placeholder="0"
                          className="w-6 bg-transparent text-center text-sm font-semibold tabular-nums placeholder:text-on-surface/30 focus:outline-none"
                          aria-label="Prep hours"
                        />
                        <span className="text-[10px] text-on-surface/45">h</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={prepMinutesStr}
                          onChange={(e) => setPrepMinutesStr(e.target.value.replace(/\D/g, ''))}
                          onBlur={() => {
                            const m = parseInt(prepMinutesStr, 10) || 0;
                            if (m >= 60) {
                              const extraH = Math.floor(m / 60);
                              const remMin = m % 60;
                              const h = parseInt(prepHoursStr, 10) || 0;
                              setPrepHoursStr(String(h + extraH));
                              setPrepMinutesStr(remMin > 0 ? String(remMin) : '');
                            }
                          }}
                          placeholder="0"
                          className="w-7 bg-transparent text-center text-sm font-semibold tabular-nums placeholder:text-on-surface/30 focus:outline-none"
                          aria-label="Prep minutes"
                        />
                        <span className="text-[10px] text-on-surface/45">m</span>
                      </div>
                      <div className="w-px bg-on-surface/10 my-2" />
                      <div className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2">
                        <Flame size={12} className="text-on-surface/40 flex-shrink-0" />
                        <span className="text-[10px] font-semibold text-on-surface/50 mr-0.5">Cook</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cookHoursStr}
                          onChange={(e) => setCookHoursStr(e.target.value.replace(/\D/g, ''))}
                          placeholder="0"
                          className="w-6 bg-transparent text-center text-sm font-semibold tabular-nums placeholder:text-on-surface/30 focus:outline-none"
                          aria-label="Cook hours"
                        />
                        <span className="text-[10px] text-on-surface/45">h</span>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cookMinutesStr}
                          onChange={(e) => setCookMinutesStr(e.target.value.replace(/\D/g, ''))}
                          onBlur={() => {
                            const m = parseInt(cookMinutesStr, 10) || 0;
                            if (m >= 60) {
                              const extraH = Math.floor(m / 60);
                              const remMin = m % 60;
                              const h = parseInt(cookHoursStr, 10) || 0;
                              setCookHoursStr(String(h + extraH));
                              setCookMinutesStr(remMin > 0 ? String(remMin) : '');
                            }
                          }}
                          placeholder="0"
                          className="w-7 bg-transparent text-center text-sm font-semibold tabular-nums placeholder:text-on-surface/30 focus:outline-none"
                          aria-label="Cook minutes"
                        />
                        <span className="text-[10px] text-on-surface/45">m</span>
                      </div>
                    </div>

                    {/* Servings stepper + Difficulty pills */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className="flex items-center bg-on-surface/[0.04] border border-on-surface/10 rounded-xl flex-shrink-0">
                        <div className="pl-2.5 pr-0.5 py-1.5 flex items-center gap-1">
                          <Users size={12} className="text-on-surface/40" />
                          <span className="text-[10px] font-semibold text-on-surface/50">Serves</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => adjustServings(-1)}
                          className="w-6 h-8 text-on-surface/55 hover:text-on-surface transition-colors text-base leading-none"
                          aria-label="Decrease servings"
                        >−</button>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={servingsStr}
                          onChange={(e) => setServingsStr(e.target.value.replace(/\D/g, ''))}
                          placeholder="4"
                          className="w-7 bg-transparent text-center text-sm font-semibold tabular-nums placeholder:text-on-surface/30 focus:outline-none"
                          aria-label="Servings"
                        />
                        <button
                          type="button"
                          onClick={() => adjustServings(1)}
                          className="w-6 h-8 text-on-surface/55 hover:text-on-surface transition-colors text-base leading-none pr-1"
                          aria-label="Increase servings"
                        >+</button>
                      </div>
                      <div className="flex gap-1 flex-1 min-w-0">
                        {(['Easy', 'Medium', 'Hard'] as const).map((d) => (
                          <button
                            key={d}
                            onClick={() => setDifficulty(d)}
                            className={cn(
                              "flex-1 py-1.5 rounded-full text-[11px] font-semibold border transition-all",
                              difficulty === d
                                ? DIFFICULTY_COLORS[d]
                                : "border-on-surface/10 bg-on-surface/[0.02] text-on-surface/50 hover:border-on-surface/20",
                            )}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Your rating */}
                    <div className="border-t border-on-surface/8 pt-3 mb-3">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium mb-2 text-center">Your Rating</p>
                      <div className="flex flex-col items-center">
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className={cn(
                            "text-4xl font-serif font-bold tabular-nums",
                            score >= 8 ? 'text-green-500' : score >= 5 ? 'text-yellow-500' : score > 0 ? 'text-red-400' : 'text-on-surface/25',
                          )}>
                            {score > 0 ? score.toFixed(1) : '—'}
                          </span>
                          <span className="text-xs text-on-surface/35 font-medium">/ 10</span>
                        </div>
                        <div className="w-full max-w-[240px]">
                          <input
                            type="range" min="0" max="10" step="0.1"
                            value={score}
                            onChange={(e) => setScore(parseFloat(e.target.value))}
                            className="w-full h-2 bg-on-surface/10 rounded-full appearance-none cursor-pointer accent-primary"
                          />
                          <p className="text-[11px] font-medium text-on-surface/45 text-center mt-1">
                            {score === 0 ? 'Slide to rate' : score >= 9 ? 'Exceptional!' : score >= 8 ? 'Excellent' : score >= 7 ? 'Very Good' : score >= 6 ? 'Good' : score >= 5 ? 'Average' : score >= 4 ? 'Below Average' : score >= 3 ? 'Poor' : 'Terrible'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Dishes — compact */}
                    <div className="border-t border-on-surface/8 pt-2.5 mb-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium">Dishes</p>
                        <button
                          onClick={() => openDishPage()}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:text-primary/80 transition-colors"
                        >
                          <Plus size={12} />Add Dish
                        </button>
                      </div>
                      {hasDishes ? (
                        <div className="bg-white rounded-xl border border-on-surface/8 overflow-hidden">
                          {dishes.map((dish, i) => (
                            <button
                              key={dish.id}
                              onClick={() => openDishPage(dish)}
                              className={cn(
                                "w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-on-surface/[0.03] transition-colors",
                                i !== dishes.length - 1 && "border-b border-on-surface/6",
                              )}
                            >
                              {dish.photo ? (
                                <img src={dish.photo} alt="" className="w-8 h-8 rounded-lg object-cover flex-shrink-0" />
                              ) : (
                                <div className="w-8 h-8 rounded-lg bg-on-surface/5 flex items-center justify-center flex-shrink-0">
                                  <UtensilsCrossed size={13} className="text-on-surface/25" />
                                </div>
                              )}
                              <span className="text-[13px] font-medium text-on-surface/75 flex-1 truncate">{dish.name}</span>
                              <ChevronRight size={13} className="text-on-surface/25 flex-shrink-0" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-on-surface/12 bg-on-surface/[0.02]">
                          <UtensilsCrossed size={14} className="text-on-surface/25" />
                          <p className="text-[11px] text-on-surface/35">No dishes added</p>
                        </div>
                      )}
                    </div>

                    {/* Recipe Details — compact menu list */}
                    <div className="border-t border-on-surface/8 pt-2.5 mb-2">
                      <p className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-medium mb-1.5">Recipe Details</p>
                      <div className="bg-white rounded-xl border border-on-surface/8 overflow-hidden">
                        <DetailRow icon={<Hash size={14} />} label="Ingredients" active={hasIngredients} sub={hasIngredients ? `${ingredients.length} items` : undefined} onClick={() => setPage('ingredients')} />
                        <DetailRow icon={<FileText size={14} />} label="Steps" active={hasSteps} sub={hasSteps ? `${steps.length} steps` : undefined} onClick={() => setPage('steps')} />
                        <DetailRow icon={<Image size={14} />} label="Photos" active={hasPhotos} sub={hasPhotos ? `${photos.length} added` : undefined} onClick={handlePhotosClick} />
                        <DetailRow icon={<Tag size={14} />} label="Tags" active={hasTags} sub={hasTags ? `${selectedTags.length} selected` : undefined} onClick={() => setPage('tags')} isLast />
                      </div>
                    </div>

                    {/* Privacy — compact */}
                    <button
                      onClick={() => setIsPublic(!isPublic)}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all text-left",
                        isPublic ? "bg-primary/5 border-primary/20" : "bg-white border-on-surface/8 hover:border-on-surface/15",
                      )}
                    >
                      <span className={cn("flex-shrink-0", isPublic ? "text-primary" : "text-on-surface/35")}>
                        {isPublic ? <Globe size={14} /> : <Lock size={14} />}
                      </span>
                      <span className={cn("text-[12px] font-semibold flex-1", isPublic ? "text-primary" : "text-on-surface/55")}>
                        {isPublic ? 'Public' : 'Private'}
                      </span>
                      <span className="text-[10px] text-on-surface/30">
                        {isPublic ? 'Visible to friends' : 'Only you can see this'}
                      </span>
                    </button>

                    {existing && !confirmDelete && (
                      <button
                        onClick={() => setConfirmDelete(true)}
                        className="w-full mt-3 py-2 text-red-400 text-[11px] font-semibold hover:text-red-500 transition-colors"
                      >
                        Delete Meal
                      </button>
                    )}
                    {existing && confirmDelete && (
                      <div className="mt-3 flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                        <p className="text-[11px] text-red-600 font-medium">Delete this meal?</p>
                        <div className="flex gap-2">
                          <button onClick={() => setConfirmDelete(false)} className="px-2.5 py-1 text-[11px] font-semibold text-on-surface/50 border border-on-surface/15 rounded-lg hover:bg-white">Cancel</button>
                          <button onClick={() => { if (existing) { deleteHomeMeal(existing.id); } closeHomeMealModal(); }} className="px-2.5 py-1 text-[11px] font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600">Delete</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sticky save footer — pill button w/ drop shadow */}
                  <div className="px-5 pt-2.5 pb-4 flex-shrink-0 border-t border-on-surface/8 bg-surface">
                    <button
                      onClick={handleSave}
                      disabled={!mealName.trim()}
                      className="w-full py-3 bg-primary text-white rounded-full font-semibold text-sm shadow-[0_6px_20px_-6px_rgba(188,108,97,0.55)] active:scale-[0.98] transition-transform disabled:opacity-40 disabled:shadow-none"
                    >
                      {existing ? 'Update Meal' : 'Save Meal'}
                    </button>
                  </div>
                </motion.div>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/* ── Shared sub-components ── */

// Compact ~44px-tall row used inside a bordered container on the main page.
// Relies on a shared parent for the outer border/background.
const DetailRow: React.FC<{
  icon: React.ReactNode; label: string; active: boolean; sub?: string; onClick: () => void; isLast?: boolean;
}> = ({ icon, label, active, sub, onClick, isLast }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-on-surface/[0.03] transition-colors",
      !isLast && "border-b border-on-surface/6",
    )}
  >
    <span className={cn(
      "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0",
      active ? "bg-primary/10 text-primary" : "bg-on-surface/[0.05] text-on-surface/45",
    )}>
      {icon}
    </span>
    <span className={cn("text-[13px] font-medium flex-1", active ? "text-on-surface" : "text-on-surface/65")}>{label}</span>
    {sub && <span className="text-[11px] text-primary/70 flex-shrink-0">{sub}</span>}
    <ChevronRight size={13} className="text-on-surface/25 flex-shrink-0" />
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
