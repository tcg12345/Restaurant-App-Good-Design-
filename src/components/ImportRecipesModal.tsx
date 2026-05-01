import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, FileUp, Upload, CheckCircle, XCircle, Loader2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { useLists, type RecipeIngredient } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';

interface ParsedRecipe {
  title: string;
  description: string;
  ingredients: RecipeIngredient[];
  // Steps render as plain strings on a HomeMeal, so the parser already
  // normalizes both CSV and JSON shapes to a string array.
  steps: string[];
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  servings: number | null;
  // HomeMeal.difficulty is title-cased, so we parse straight into that shape.
  difficulty: 'Easy' | 'Medium' | 'Hard';
  cuisine: string;
  tags: string[];
  // First entry becomes the cover photo on the resulting HomeMeal.
  photos: string[];
  isPublic: boolean;
  // 0–10 rating saved as the meal score; null leaves it as 0.
  rating: number | null;
  reviewNotes: string;
}

interface ImportItem {
  recipe: ParsedRecipe;
  status: 'pending' | 'creating' | 'created' | 'error';
  error?: string;
}

/* ── Field parsing helpers ── */

const toInt = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

// Parse a 0–10 rating. Returns null when the cell is blank or unparseable so
// importers can leave the column empty and just skip review creation.
const toRating = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(10, n));
};

const toDifficulty = (v: unknown): 'Easy' | 'Medium' | 'Hard' => {
  const s = String(v ?? '').trim().toLowerCase();
  if (s === 'easy') return 'Easy';
  if (s === 'hard') return 'Hard';
  return 'Medium';
};

const toBool = (v: unknown): boolean => {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === 'public';
};

// Split a multi-value string on a list of separators. Used for tags, photos,
// and the row-mode ingredient/step fields. Falls back to a single-element
// array when the input has no separator chars.
const splitMulti = (raw: string): string[] => {
  if (!raw) return [];
  // "|" is the canonical separator (CSV-safe). Newlines and ";" are also accepted.
  return raw
    .split(/[|\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

// Parse an ingredient line like "2 cups flour" or "1 tbsp olive oil" or
// "salt to taste". Falls back to putting the whole string in `name` when no
// leading number can be found.
const parseIngredientLine = (line: string): RecipeIngredient => {
  const trimmed = line.trim();
  if (!trimmed) return { name: '', amount: '', unit: '' };

  // Match leading number (incl. fractions like "1/2" or decimals)
  const m = trimmed.match(/^([\d./\s]+?)\s+([a-zA-Z]+)?\s*(.+)$/);
  if (m) {
    const amount = m[1].trim();
    const maybeUnit = (m[2] || '').trim();
    const rest = m[3].trim();
    // Heuristic: short alpha tokens are likely units. Anything longer than
    // 8 chars probably isn't a unit, so fold it back into the name.
    if (maybeUnit && maybeUnit.length <= 8) {
      return { name: rest, amount, unit: maybeUnit };
    }
    return { name: `${maybeUnit} ${rest}`.trim(), amount, unit: '' };
  }
  return { name: trimmed, amount: '', unit: '' };
};

const normalizeIngredient = (raw: unknown): RecipeIngredient => {
  if (typeof raw === 'string') return parseIngredientLine(raw);
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return {
      name: String(r.name ?? r.ingredient ?? ''),
      amount: String(r.amount ?? r.qty ?? r.quantity ?? ''),
      unit: String(r.unit ?? ''),
    };
  }
  return { name: String(raw ?? ''), amount: '', unit: '' };
};

const normalizeStep = (raw: unknown): string => {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    return String(r.text ?? r.step ?? r.instruction ?? '');
  }
  return String(raw ?? '');
};

/* ── CSV parsing ── */

// Parse a single CSV line, respecting "quoted, fields, with, commas".
const splitCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; continue; }
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) { fields.push(cur); cur = ''; continue; }
    cur += ch;
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
};

const parseCSV = (text: string): ParsedRecipe[] => {
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/['"]/g, ''));
  const idx = (...keys: string[]) => headers.findIndex((h) => keys.some((k) => h === k || h.includes(k)));

  const titleIdx = idx('title', 'name', 'recipe');
  if (titleIdx === -1) return [];

  const descIdx = idx('description', 'desc', 'summary');
  const ingIdx = idx('ingredient');
  const stepIdx = idx('step', 'instruction', 'direction');
  const prepIdx = idx('prep_time', 'prep');
  const cookIdx = idx('cook_time', 'cook');
  const servIdx = idx('serving', 'serves', 'yield');
  const diffIdx = idx('difficulty');
  const cuisineIdx = idx('cuisine');
  const tagsIdx = idx('tag');
  // photos col matches before the more specific cover_photo, so we find cover first.
  const coverIdx = idx('cover_photo', 'cover', 'thumbnail');
  const photosIdx = headers.findIndex((h) => (h.includes('photo') || h.includes('image')) && !h.includes('cover') && !h.includes('thumb') && !h.includes('review'));
  const publicIdx = idx('public', 'visibility');
  const ratingIdx = idx('rating', 'score');
  const notesIdx = headers.findIndex((h) => h.includes('review_note') || h === 'review' || h.includes('review_text') || h === 'notes');

  return lines.slice(1).map((line) => {
    const f = splitCsvLine(line);
    const get = (i: number) => (i >= 0 ? (f[i] ?? '') : '');

    const ingredients = ingIdx >= 0 ? splitMulti(get(ingIdx)).map((s) => parseIngredientLine(s)) : [];
    const stepsArr = stepIdx >= 0 ? splitMulti(get(stepIdx)) : [];
    const cover = get(coverIdx).trim();
    const otherPhotos = splitMulti(get(photosIdx));
    const photos = cover ? [cover, ...otherPhotos.filter((p) => p !== cover)] : otherPhotos;

    return {
      title: get(titleIdx),
      description: get(descIdx),
      ingredients,
      steps: stepsArr,
      prepTimeMinutes: toInt(get(prepIdx)),
      cookTimeMinutes: toInt(get(cookIdx)),
      servings: toInt(get(servIdx)),
      difficulty: toDifficulty(get(diffIdx)),
      cuisine: get(cuisineIdx),
      tags: splitMulti(get(tagsIdx)),
      photos,
      isPublic: toBool(get(publicIdx)),
      rating: toRating(get(ratingIdx)),
      reviewNotes: get(notesIdx),
    } as ParsedRecipe;
  }).filter((r) => r.title);
};

/* ── JSON parsing ── */

const parseJSON = (text: string): ParsedRecipe[] => {
  try {
    const data = JSON.parse(text);
    const arr: unknown[] = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>).recipes)
      ? ((data as Record<string, unknown>).recipes as unknown[])
      : Array.isArray((data as Record<string, unknown>).data)
      ? ((data as Record<string, unknown>).data as unknown[])
      : [data];

    return arr
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .map((r) => {
        const title = String(r.title ?? r.name ?? '');
        const ingRaw = r.ingredients ?? [];
        const stepRaw = r.steps ?? r.instructions ?? r.directions ?? [];
        const photosRaw = r.photos ?? r.images ?? r.photo ?? r.image ?? [];
        const tagsRaw = r.tags ?? [];
        const cover = String(r.coverPhoto ?? r.cover_photo ?? r.cover ?? r.thumbnail ?? '').trim();

        const photoList: string[] = Array.isArray(photosRaw)
          ? photosRaw.map((p) => String(p)).filter(Boolean)
          : typeof photosRaw === 'string'
          ? splitMulti(photosRaw)
          : [];
        const photos = cover
          ? [cover, ...photoList.filter((p) => p !== cover)]
          : photoList;

        return {
          title,
          description: String(r.description ?? r.desc ?? r.summary ?? ''),
          ingredients: Array.isArray(ingRaw)
            ? ingRaw.map(normalizeIngredient)
            : typeof ingRaw === 'string'
            ? splitMulti(ingRaw).map(parseIngredientLine)
            : [],
          steps: Array.isArray(stepRaw)
            ? stepRaw.map(normalizeStep).filter(Boolean)
            : typeof stepRaw === 'string'
            ? splitMulti(stepRaw)
            : [],
          prepTimeMinutes: toInt(r.prepTimeMinutes ?? r.prep_time_minutes ?? r.prepTime ?? r.prep_time ?? r.prep),
          cookTimeMinutes: toInt(r.cookTimeMinutes ?? r.cook_time_minutes ?? r.cookTime ?? r.cook_time ?? r.cook),
          servings: toInt(r.servings ?? r.serves ?? r.yield),
          difficulty: toDifficulty(r.difficulty),
          cuisine: String(r.cuisine ?? ''),
          tags: Array.isArray(tagsRaw)
            ? tagsRaw.map((t) => String(t)).filter(Boolean)
            : typeof tagsRaw === 'string'
            ? splitMulti(tagsRaw)
            : [],
          photos,
          isPublic: toBool(r.isPublic ?? r.is_public ?? r.public),
          rating: toRating(r.rating ?? r.score),
          reviewNotes: String(r.reviewNotes ?? r.review_notes ?? r.review ?? r.notes ?? ''),
        } as ParsedRecipe;
      })
      .filter((r) => r.title);
  } catch {
    return [];
  }
};

/* ── Component ── */

interface Props {
  open: boolean;
  onClose: () => void;
}

export const ImportRecipesModal: React.FC<Props> = ({ open, onClose }) => {
  const { createHomeMealsBulk, closeHomeMealModal } = useLists();
  const { phoneMode } = useSettings();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = useState<ParsedRecipe[]>([]);
  const [items, setItems] = useState<ImportItem[]>([]);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isDone, setIsDone] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const abortRef = useRef(false);

  const reset = () => {
    setParsed([]);
    setItems([]);
    setFileName('');
    setParseError('');
    setIsRunning(false);
    setIsDone(false);
    abortRef.current = false;
  };

  const handleClose = () => {
    if (isRunning) abortRef.current = true;
    reset();
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError('');
    setParsed([]);
    setItems([]);
    setIsDone(false);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = String(ev.target?.result ?? '');
      const recipes = file.name.toLowerCase().endsWith('.json')
        ? parseJSON(text)
        : parseCSV(text);

      if (recipes.length === 0) {
        setParseError(
          'No recipes found. Make sure your file has a "title" (or "name") column for CSV, or a "title"/"name" field for JSON.',
        );
        return;
      }
      setParsed(recipes);
      setItems(recipes.map((r) => ({ recipe: r, status: 'pending' as const })));
    };
    reader.onerror = () => setParseError('Failed to read file.');
    reader.readAsText(file);
    // Reset input so re-uploading the same file fires onChange.
    e.target.value = '';
  };

  const runImport = async () => {
    setIsRunning(true);
    abortRef.current = false;

    const today = new Date().toISOString().slice(0, 10);

    // Build every meal payload up-front so the bulk insert can run in one
    // shot. Calling createHomeMeal per row would issue one cloud PATCH per
    // meal, and the responses can land out of order — an early snapshot
    // with only a handful of rows can clobber the final array.
    const mealsToCreate = items.map((item) => {
      const r = item.recipe;
      const cover = r.photos[0] ?? '';
      const galleryUrls = r.photos.slice(cover ? 1 : 0);
      return {
        name: r.title,
        date: today,
        score: r.rating ?? 0,
        wouldMakeAgain: true,
        description: r.description || r.reviewNotes,
        photos: galleryUrls.map((url) => ({ url, caption: '', isFavorite: false })),
        tags: r.tags,
        dishes: [],
        isPublic: r.isPublic,
        coverPhoto: cover,
        prepTime: r.prepTimeMinutes ?? undefined,
        cookTime: r.cookTimeMinutes ?? undefined,
        servings: r.servings ?? undefined,
        difficulty: r.difficulty,
        cuisine: r.cuisine,
        ingredients: r.ingredients,
        steps: r.steps,
      };
    });

    try {
      createHomeMealsBulk(mealsToCreate);
      setItems((prev) => prev.map((it) => ({ ...it, status: 'created' as const })));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setItems((prev) => prev.map((it) => ({ ...it, status: 'error' as const, error: msg })));
    }

    setIsRunning(false);
    setIsDone(true);
  };

  const stats = {
    total: items.length,
    created: items.filter((i) => i.status === 'created').length,
    errors: items.filter((i) => i.status === 'error').length,
    pending: items.filter((i) => i.status === 'pending' || i.status === 'creating').length,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={cn(
            'fixed inset-0 bg-black/60 backdrop-blur-sm z-[150] flex justify-center',
            phoneMode ? 'items-end' : 'items-end sm:items-center',
          )}
          onClick={handleClose}
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'bg-surface w-full overflow-hidden flex flex-col',
              phoneMode
                ? 'h-full rounded-none'
                : 'h-full sm:max-w-md sm:max-h-[92vh] sm:h-[92vh] rounded-none sm:rounded-3xl',
            )}
          >
            {/* Header */}
            <div className="px-6 pt-5 sm:pt-6 pb-3 flex items-center justify-between flex-shrink-0">
              <div className="min-w-0">
                <h2 className="font-serif font-bold text-xl truncate">Import Recipes</h2>
                <p className="text-xs text-on-surface/40 mt-0.5">Upload a CSV or JSON file</p>
              </div>
              <button
                onClick={handleClose}
                className="p-2 -mr-2 text-on-surface/40 hover:text-on-surface transition-colors"
                aria-label="Close"
              >
                <X size={22} />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 pb-6 space-y-4">
              {parsed.length === 0 && (
                <>
                  {/* Dropzone */}
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full border-2 border-dashed border-on-surface/15 rounded-2xl p-8 text-center cursor-pointer hover:border-primary/30 hover:bg-primary/[0.03] transition-all"
                  >
                    <FileUp size={32} className="mx-auto text-on-surface/25 mb-3" />
                    <p className="text-sm font-semibold text-on-surface/60">Click to upload a file</p>
                    <p className="text-xs text-on-surface/35 mt-1">CSV, JSON, or TXT</p>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.json,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />

                  {parseError && (
                    <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl">
                      <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-red-600">{parseError}</p>
                    </div>
                  )}

                  {/* Format guide */}
                  <div className="bg-on-surface/[0.03] rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowFormat((v) => !v)}
                      className="w-full flex items-center justify-between px-4 py-3"
                    >
                      <span className="text-xs font-bold text-on-surface/60 uppercase tracking-wider">
                        Supported Formats
                      </span>
                      {showFormat ? (
                        <ChevronUp size={16} className="text-on-surface/40" />
                      ) : (
                        <ChevronDown size={16} className="text-on-surface/40" />
                      )}
                    </button>

                    {showFormat && (
                      <div className="px-4 pb-4 space-y-4">
                        <p className="text-[11px] text-on-surface/55 leading-relaxed">
                          Only <span className="font-mono">title</span> is required — every other field can
                          be left blank or omitted entirely.
                        </p>

                        <div className="space-y-1.5">
                          <p className="text-xs font-semibold text-on-surface/70">Recognized fields</p>
                          <ul className="text-[11px] text-on-surface/55 leading-[1.7] space-y-0.5">
                            <li><span className="font-mono">title</span> — required</li>
                            <li><span className="font-mono">description</span> — short summary</li>
                            <li><span className="font-mono">ingredients</span> — e.g. <span className="font-mono">"2 cups flour | 1 tsp salt"</span></li>
                            <li><span className="font-mono">steps</span> — e.g. <span className="font-mono">"Mix dry | Add wet | Bake"</span></li>
                            <li><span className="font-mono">prep_time</span>, <span className="font-mono">cook_time</span> — minutes (number)</li>
                            <li><span className="font-mono">servings</span> — number of servings</li>
                            <li><span className="font-mono">difficulty</span> — <span className="font-mono">easy</span> / <span className="font-mono">medium</span> / <span className="font-mono">hard</span></li>
                            <li><span className="font-mono">cuisine</span> — e.g. Italian, Thai</li>
                            <li><span className="font-mono">tags</span> — comma- or pipe-separated</li>
                            <li><span className="font-mono">cover_photo</span> — URL of the main image</li>
                            <li><span className="font-mono">photos</span> — additional image URLs</li>
                            <li><span className="font-mono">rating</span> — 0–10 (saved as the meal score)</li>
                            <li><span className="font-mono">notes</span> — extra description/notes</li>
                            <li><span className="font-mono">is_public</span> — <span className="font-mono">true</span> / <span className="font-mono">false</span></li>
                          </ul>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-on-surface/70 mb-1">CSV</p>
                          <p className="text-[11px] text-on-surface/50 mb-1">
                            Use <span className="font-mono">|</span> to separate multiple ingredients, steps,
                            tags, or photo URLs in a single cell. Leave any column blank to skip it.
                          </p>
                          <code className="block text-[10px] bg-white p-2 rounded-lg text-on-surface/60 overflow-x-auto whitespace-pre">
                            {'title,description,ingredients,steps,prep_time,cook_time,servings,difficulty,cuisine,tags,cover_photo,photos,rating,notes,is_public\n'}
                            {'"Spaghetti Carbonara","Classic Roman pasta","200g spaghetti|2 eggs|100g pancetta","Boil pasta|Fry pancetta|Combine",10,15,2,medium,Italian,"pasta|dinner",https://example.com/carb.jpg,,8.5,"Nailed it on the first try",false\n'}
                            {'"Quick Toast",,,,,,,,,,,,,,'}
                          </code>
                        </div>

                        <div>
                          <p className="text-xs font-semibold text-on-surface/70 mb-1">JSON</p>
                          <p className="text-[11px] text-on-surface/50 mb-1">
                            Pass an array of objects, or wrap in{' '}
                            <span className="font-mono">{'{ "recipes": [...] }'}</span>. Ingredients can be
                            strings or objects with <span className="font-mono">name</span>,{' '}
                            <span className="font-mono">amount</span>,{' '}
                            <span className="font-mono">unit</span>. Omit any field you don't have.
                          </p>
                          <code className="block text-[10px] bg-white p-2 rounded-lg text-on-surface/60 overflow-x-auto whitespace-pre">
{`[
  {
    "title": "Spaghetti Carbonara",
    "description": "Classic Roman pasta",
    "ingredients": [
      { "name": "spaghetti", "amount": "200", "unit": "g" },
      "2 eggs",
      "100g pancetta"
    ],
    "steps": ["Boil pasta", "Fry pancetta", "Combine"],
    "prepTimeMinutes": 10,
    "cookTimeMinutes": 15,
    "servings": 2,
    "difficulty": "medium",
    "cuisine": "Italian",
    "tags": ["pasta", "dinner"],
    "coverPhoto": "https://example.com/carb.jpg",
    "photos": ["https://example.com/carb-2.jpg"],
    "rating": 8.5,
    "notes": "Nailed it on the first try",
    "isPublic": false
  },
  { "title": "Quick Toast" }
]`}
                          </code>
                        </div>

                        <p className="text-[11px] text-on-surface/45 leading-relaxed">
                          Each row gets added to your <span className="italic">Home Cooking</span> list as
                          a logged meal. Photos must be URLs (https) — to attach local image files, log
                          the meal directly with the <span className="italic">+</span> button instead. A
                          <span className="font-mono"> rating</span> becomes the meal's score.
                        </p>
                      </div>
                    )}
                  </div>
                </>
              )}

              {parsed.length > 0 && (
                <>
                  {/* File info bar */}
                  <div className="flex items-center justify-between bg-white rounded-xl border border-on-surface/[0.08] px-3 py-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileUp size={14} className="text-primary flex-shrink-0" />
                      <span className="text-xs font-medium truncate">{fileName}</span>
                      <span className="text-[10px] text-on-surface/40">
                        {parsed.length} {parsed.length === 1 ? 'recipe' : 'recipes'}
                      </span>
                    </div>
                    {!isRunning && (
                      <button
                        onClick={reset}
                        className="p-1 text-on-surface/30 hover:text-on-surface/60"
                        aria-label="Clear"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>

                  {(isRunning || isDone) && (
                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="bg-emerald-50 rounded-lg p-2">
                        <div className="text-emerald-600 font-bold text-lg">{stats.created}</div>
                        <div className="text-emerald-600">Added</div>
                      </div>
                      <div className="bg-red-50 rounded-lg p-2">
                        <div className="text-red-600 font-bold text-lg">{stats.errors}</div>
                        <div className="text-red-600">Errors</div>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2">
                        <div className="text-gray-600 font-bold text-lg">{stats.pending}</div>
                        <div className="text-gray-600">Pending</div>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {!isRunning && !isDone && (
                      <button
                        onClick={runImport}
                        className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-xl font-medium hover:bg-primary/90 transition-colors"
                      >
                        <Upload className="w-4 h-4" /> Import {parsed.length}{' '}
                        {parsed.length === 1 ? 'recipe' : 'recipes'}
                      </button>
                    )}
                    {isRunning && (
                      <button
                        onClick={() => {
                          abortRef.current = true;
                        }}
                        className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white py-3 rounded-xl font-medium"
                      >
                        Stop
                      </button>
                    )}
                    {isDone && (
                      <button
                        onClick={() => {
                          reset();
                          onClose();
                          // When at least one meal landed on the list, also
                          // dismiss the parent Log Home Meal modal so the
                          // user lands directly on the populated list.
                          if (stats.created > 0) closeHomeMealModal();
                        }}
                        className="flex-1 flex items-center justify-center gap-2 bg-primary text-white py-3 rounded-xl font-medium"
                      >
                        Done
                      </button>
                    )}
                  </div>

                  {isRunning && stats.total > 0 && (
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all duration-300"
                        style={{
                          width: `${((stats.created + stats.errors) / stats.total) * 100}%`,
                        }}
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div
                        key={idx}
                        className={cn(
                          'flex items-center gap-3 p-3 rounded-xl border transition-colors',
                          item.status === 'created'
                            ? 'bg-emerald-50 border-emerald-200'
                            : item.status === 'error'
                            ? 'bg-red-50 border-red-200'
                            : item.status === 'creating'
                            ? 'bg-blue-50 border-blue-200'
                            : 'bg-white border-gray-200',
                        )}
                      >
                        <div className="flex-shrink-0">
                          {item.status === 'pending' && (
                            <div className="w-5 h-5 rounded-full border-2 border-gray-300" />
                          )}
                          {item.status === 'creating' && (
                            <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />
                          )}
                          {item.status === 'created' && (
                            <CheckCircle className="w-5 h-5 text-emerald-500" />
                          )}
                          {item.status === 'error' && <XCircle className="w-5 h-5 text-red-400" />}
                        </div>
                        {item.recipe.photos[0] && (
                          <img
                            src={item.recipe.photos[0]}
                            alt={item.recipe.title}
                            className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                            referrerPolicy="no-referrer"
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{item.recipe.title}</div>
                          <div className="text-xs text-on-surface/55 truncate">
                            {[
                              item.recipe.cuisine,
                              item.recipe.rating !== null && `${item.recipe.rating.toFixed(1)}/10`,
                              item.recipe.ingredients.length > 0 &&
                                `${item.recipe.ingredients.length} ingredients`,
                              item.recipe.steps.length > 0 && `${item.recipe.steps.length} steps`,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                          {item.status === 'error' && (
                            <div className="text-xs text-red-500 truncate">
                              {item.error || 'Failed to import'}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
