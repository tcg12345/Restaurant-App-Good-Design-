// Shared ingredient parsing helpers — used by both the Basic AddHomeMealModal
// and the Advanced recipe builder (StepIngredients). Extracted so neither
// surface invents its own slightly-different fuzzy unit matcher or fraction
// converter and produces inconsistent results.
//
// The parser handles:
//   - Mixed fractions ("1 1/2"), plain fractions ("1/2"), decimals ("0.5",
//     ".5", "1.5"), ranges ("1-2" → low end), comma decimals ("0,5" → 0.5)
//   - Two-word units ("fl oz", "fluid ounce") before single-word units
//   - Fuzzy alias matching (Levenshtein) for the single-add form, plus a
//     `strict` mode used by the line parser so ingredient words don't get
//     misread as units.
//   - Singular/plural rendering for "1 cup" vs "2 cups".

import type { RecipeIngredient } from '../contexts/ListsContext';

/* ── Public types ────────────────────────────────────────────────── */

// Per-line outcome of the bulk paste parser. Rendered with a green Check
// (success) or red X (error) so the user can see exactly which lines made it.
export type BulkResult =
  | { line: string; status: 'success'; ingredient: RecipeIngredient }
  | { line: string; status: 'error'; message: string };

// Unit definition shape — the dropdown shows the plural (canonical) form;
// aliases cover common spellings / typos so user input normalizes cleanly.
export interface UnitDef {
  label: string;     // canonical plural form shown in dropdown
  singular: string;  // singular form used when amount <= 1
  aliases: string[]; // case-insensitive alias set for fuzzy matching
}

/* ── Unit catalog ────────────────────────────────────────────────── */

export const UNITS: UnitDef[] = [
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

/* ── Rendering helpers ───────────────────────────────────────────── */

/** Returns singular form for amounts in (0, 1], otherwise the plural label.
 *  amount==null (no amount given) uses the plural label. */
export const displayUnit = (label: string, amount: number | null): string => {
  if (!label) return '';
  const def = UNITS.find((u) => u.label === label);
  if (!def) return label;
  if (amount !== null && amount > 0 && amount <= 1) return def.singular;
  return def.label;
};

/* ── Parsing internals ───────────────────────────────────────────── */

/** Classic iterative Levenshtein with O(min(m,n)) memory. */
export const levenshtein = (a: string, b: string): number => {
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

/** Map any input (exact alias, mistype, singular/plural, long form) to a
 *  canonical plural label. Returns '' if nothing reasonable matches.
 *  `strict` disables fuzzy matching — the line parser uses strict mode to
 *  avoid turning ingredient words into bogus units. */
export const normalizeUnit = (input: string, strict = false): string => {
  // 'T' vs 't' is the one case-SENSITIVE pair in cooking shorthand:
  // uppercase T = tablespoon, lowercase t = teaspoon. Resolve before the
  // case-insensitive alias pass, which would map both to tbsp.
  const rawCleaned = input.trim().replace(/[.,;:]+$/, '');
  if (rawCleaned === 'T') return 'tbsp';
  if (rawCleaned === 't') return 'tsp';
  const cleaned = rawCleaned.toLowerCase();
  if (!cleaned) return '';
  for (const u of UNITS) {
    if (u.aliases.some((a) => a.toLowerCase() === cleaned)) return u.label;
  }
  if (strict) return '';
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

/* ── Unicode quantity normalization ──────────────────────────────── */

/** Unicode vulgar fraction → ASCII "n/d". Recipe imports genuinely carry
 *  these: the import edge function decodes &frac12; back to ½, and JSON-LD
 *  recipe markup commonly uses the precomposed characters. */
const UNICODE_FRACTION_ASCII: Record<string, string> = {
  '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4',
  '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5',
  '⅙': '1/6', '⅚': '5/6', '⅐': '1/7', '⅛': '1/8', '⅜': '3/8',
  '⅝': '5/8', '⅞': '7/8', '⅑': '1/9', '⅒': '1/10',
};
const UNICODE_FRACTION_RE = /(\d+)?\s*([½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅐⅛⅜⅝⅞⅑⅒])/g;

/** Rewrite a quantity token into the ASCII vocabulary every parser here
 *  understands: precomposed vulgar fractions become "n/d" ("½" → "1/2"),
 *  compounds keep their whole part ("1½" / "1 ½" → "1 1/2"), the unicode
 *  fraction slash (⁄) becomes "/", and en/em dashes and the minus sign
 *  become "-" so ranges like "2–3" parse. Text without any of those passes
 *  through untouched. */
export const normalizeQuantityToken = (raw: string): string => {
  return raw
    .replace(/[–—−]/g, '-')
    .replace(/⁄/g, '/')
    .replace(UNICODE_FRACTION_RE, (_, whole: string | undefined, ch: string) => {
      const ascii = UNICODE_FRACTION_ASCII[ch];
      return whole ? `${whole} ${ascii}` : ascii;
    })
    .trim();
};

/** Matches a decimal in any of these forms: "1", "1.5", "0.5", ".5", "1.".
 *  Reused by both parseAmount and parseIngredientLine. */
export const DECIMAL_PATTERN = '(?:\\d+\\.\\d+|\\d+\\.|\\.\\d+|\\d+)';

/** Parses "2", "1/2", "1 1/2", "0.5", "1-2" (range uses low end) into a number.
 *  Returns null for anything it can't recognize. */
export const parseAmount = (str: string): number | null => {
  // Normalize unicode fractions/dashes first ("½" → "1/2", "1½" → "1 1/2",
  // "2–3" → "2-3"), then comma decimal separators ("0,5" → "0.5") so
  // European-style input works without a special case.
  const trimmed = normalizeQuantityToken(str).replace(/,/g, '.');
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

/** Converts a decimal number to a display-friendly cooking fraction like
 *  "1 1/2". Uses eighths / thirds / quarters / fifths / sixths. */
export const toFraction = (value: number): string => {
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

/** Normalizes a stored amount string for display ("0.5" → "1/2"). */
export const displayAmount = (amount: string): string => {
  if (!amount) return '';
  const parsed = parseAmount(amount);
  if (parsed === null) return amount;
  return toFraction(parsed);
};

/** Parses a single bulk-paste line into { amount, unit, name }. */
export const parseIngredientLine = (raw: string): { name: string; amount: string; unit: string } | null => {
  // Strip bullets, collapse whitespace, normalize comma decimals, and
  // rewrite unicode fractions/dashes to ASCII so "½ cup sugar" and "2–3
  // eggs" parse instead of landing whole in the name field.
  const line = normalizeQuantityToken(raw.trim().replace(/^[-*•·●]\s*/, ''))
    .replace(/\s+/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2');
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
  // STRICT matching only: this word is ingredient prose, not a value the
  // user offered as a unit, and Levenshtein distance 1 on short words
  // turns real ingredients into bogus units ("2 bay leaves" → unit "bags"
  // name "leaves"; "2 ears corn" → "jars"). Fuzzy matching stays available
  // where the user is explicitly typing a unit (the unit combobox).
  if (words.length >= 2) {
    const twoWord = `${words[0]} ${words[1]}`;
    const matched = normalizeUnit(twoWord, true);
    if (matched) return { amount, unit: matched, name: words.slice(2).join(' ') };
  }
  const firstWord = words[0].replace(/[.,;:]$/, '');
  const matched = normalizeUnit(firstWord, true);
  if (matched) return { amount, unit: matched, name: words.slice(1).join(' ') };
  return { amount, unit: '', name: rest };
};

/** Flatten grouped ingredients into a flat array for legacy consumers
 *  (SocialFeed cards, RecipePage's flat-list fallback). Group order is
 *  preserved; ingredient order within each group is preserved. */
export const flattenIngredientGroups = (
  groups: Array<{ name: string; ingredients: RecipeIngredient[] }>,
): RecipeIngredient[] => {
  const out: RecipeIngredient[] = [];
  for (const g of groups) {
    for (const i of g.ingredients) out.push(i);
  }
  return out;
};
