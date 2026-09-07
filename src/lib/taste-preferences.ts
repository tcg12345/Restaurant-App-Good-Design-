import { isAppGoal, type AppGoal } from "./app-goal";

/** Deliberate preferences, independent of historical ratings and earned taste points. */
export interface TastePreferences {
  cuisines: string[];
  avoidCuisines: string[];
  prices: number[];
  dietary: string[];
  atmosphere: string;
  city: string;
  goal?: AppGoal;
  discovery: "balanced" | "familiar" | "adventurous";
  cookingMinutes?: number;
  notes: string;
}
export const TASTE_PREFERENCES_KEY = "__taste_preferences_v1__";
export interface TastePreferencesRecord {
  version: 1;
  ownerId: string;
  updatedAt: number;
  values: TastePreferences;
}
export const DIETARY_PREFERENCES = [
  "Vegetarian",
  "Vegan",
  "Pescatarian",
  "Gluten-free",
  "Dairy-free",
] as const;
const list = (raw: unknown, max = 20) =>
  Array.isArray(raw)
    ? [
        ...new Set(
          raw
            .filter((s): s is string => typeof s === "string")
            .map((s) => s.trim().slice(0, 60))
            .filter(Boolean),
        ),
      ].slice(0, max)
    : [];
const text = (raw: unknown, max: number) =>
  typeof raw === "string" ? raw.trim().slice(0, max) : "";
export function sanitizeTastePreferences(raw: unknown): TastePreferences {
  const r =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const avoidCuisines = list(r.avoidCuisines);
  return {
    cuisines: list(r.cuisines).filter(
      (c) => !avoidCuisines.some((a) => a.toLowerCase() === c.toLowerCase()),
    ),
    avoidCuisines,
    prices: Array.isArray(r.prices)
      ? [
          ...new Set(
            r.prices.filter(
              (p): p is number =>
                typeof p === "number" &&
                Number.isInteger(p) &&
                p >= 1 &&
                p <= 4,
            ),
          ),
        ].sort()
      : [],
    dietary: list(r.dietary, 8).map(
      (d) =>
        DIETARY_PREFERENCES.find((c) => c.toLowerCase() === d.toLowerCase()) ??
        d,
    ),
    atmosphere: text(r.atmosphere, 100),
    city: text(r.city, 100),
    goal: isAppGoal(r.goal) ? r.goal : undefined,
    discovery:
      r.discovery === "familiar" || r.discovery === "adventurous"
        ? r.discovery
        : "balanced",
    cookingMinutes:
      typeof r.cookingMinutes === "number" &&
      Number.isInteger(r.cookingMinutes) &&
      r.cookingMinutes >= 10 &&
      r.cookingMinutes <= 240
        ? r.cookingMinutes
        : undefined,
    notes: text(r.notes, 700),
  };
}
/** Seed once from this account's profile row, never a device-wide guest mirror. */
export function tastePreferencesFromQuiz(raw: unknown): TastePreferences {
  const q =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const tier = (v: unknown): v is number =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 4;
  return sanitizeTastePreferences({
    ...q,
    prices: tier(q.pricePrimary)
      ? [q.pricePrimary, ...(tier(q.priceSecondary) ? [q.priceSecondary] : [])]
      : q.prices,
  });
}

export function readTastePreferences(
  raw: unknown,
  ownerId: string,
): TastePreferencesRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as TastePreferencesRecord;
  return r.version === 1 &&
    r.ownerId === ownerId &&
    Number.isFinite(r.updatedAt)
    ? {
        version: 1,
        ownerId,
        updatedAt: r.updatedAt,
        values: sanitizeTastePreferences(r.values),
      }
    : null;
}
export function mergeTastePreferences(
  local: unknown,
  remote: unknown,
  ownerId: string,
): TastePreferencesRecord | null {
  const a = readTastePreferences(local, ownerId),
    b = readTastePreferences(remote, ownerId);
  return a && (!b || a.updatedAt > b.updatedAt) ? a : b;
}
export function tastePreferenceText(p: TastePreferences): string {
  return [
    p.cuisines.length ? `Prefer cuisines: ${p.cuisines.join(", ")}.` : "",
    p.avoidCuisines.length
      ? `Usually avoid cuisines: ${p.avoidCuisines.join(", ")}.`
      : "",
    p.prices.length
      ? `Usual restaurant price tiers: ${p.prices.map((n) => "$".repeat(n)).join(", ")}.`
      : "",
    p.dietary.length ? `Eating preferences: ${p.dietary.join(", ")}.` : "",
    p.atmosphere ? `Preferred atmosphere: ${p.atmosphere}.` : "",
    p.city ? `Default dining city: ${p.city}.` : "",
    p.goal ? `App focus: ${p.goal}.` : "",
    p.discovery !== "balanced" ? `Discovery style: ${p.discovery}.` : "",
    p.cookingMinutes
      ? `Usual cooking time: up to ${p.cookingMinutes} minutes.`
      : "",
    p.notes ? `Personal note: ${p.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
const tokens = (s: string) =>
  s
    .toLowerCase()
    .split(/[,;/|]+/)
    .map((t) => t.trim());
export function cuisinePreference(
  p: TastePreferences,
  cuisine: string,
): number {
  const cs = tokens(cuisine);
  if (p.avoidCuisines.some((c) => cs.includes(c.toLowerCase()))) return -4;
  return p.cuisines.some((c) => cs.includes(c.toLowerCase())) ? 2.5 : 0;
}
/** Only ranking inputs belong in pool cache keys; never private notes. */
export function tasteRankingKey(p?: TastePreferences): string {
  if (!p) return "";
  const text = JSON.stringify([
    p.cuisines,
    p.avoidCuisines,
    p.prices,
    p.dietary,
    p.atmosphere,
    p.discovery,
  ]);
  return [...text]
    .reduce(
      (h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0,
      2166136261,
    )
    .toString(36);
}
export function recipePreferenceScore(
  p: TastePreferences,
  r: {
    cuisine?: string;
    tags?: string[];
    prepTimeMinutes?: number | null;
    cookTimeMinutes?: number | null;
  },
): number {
  let score = cuisinePreference(p, r.cuisine || "") * 3;
  const tags = (r.tags || []).map((t) => t.toLowerCase());
  score += p.dietary.filter((d) => tags.includes(d.toLowerCase())).length * 4;
  if (
    p.cookingMinutes &&
    r.prepTimeMinutes != null &&
    r.cookTimeMinutes != null
  )
    score += r.prepTimeMinutes + r.cookTimeMinutes <= p.cookingMinutes ? 3 : -3;
  return score;
}
export interface TastePreferencePatch {
  addCuisines?: string[];
  removeCuisines?: string[];
  addAvoid?: string[];
  removeAvoid?: string[];
  dietary?: string[];
  pricePrimary?: number;
  priceSecondary?: number;
  prices?: number[];
  atmosphere?: string;
  city?: string;
  goal?: AppGoal;
  discovery?: TastePreferences["discovery"];
  cookingMinutes?: number;
  notes?: string;
}
/** Allowlisted patch: unknown AI keys can never become rating/points writes. */
export function patchTastePreferences(
  current: TastePreferences,
  patch: TastePreferencePatch,
): TastePreferences {
  const edit = (base: string[], add: unknown, remove: unknown) =>
    [...new Set([...base, ...list(add)])].filter(
      (c) => !list(remove).some((r) => r.toLowerCase() === c.toLowerCase()),
    );
  return sanitizeTastePreferences({
    ...current,
    cuisines: edit(current.cuisines, patch.addCuisines, patch.removeCuisines),
    avoidCuisines: edit(current.avoidCuisines, patch.addAvoid, [
      ...list(patch.removeAvoid),
      ...list(patch.addCuisines).filter(
        (c) => !list(patch.addAvoid).includes(c),
      ),
    ]),
    dietary: patch.dietary ?? current.dietary,
    prices:
      patch.prices ??
      (patch.pricePrimary
        ? [
            patch.pricePrimary,
            ...(patch.priceSecondary ? [patch.priceSecondary] : []),
          ]
        : patch.priceSecondary
          ? [...current.prices, patch.priceSecondary]
          : current.prices),
    atmosphere: patch.atmosphere ?? current.atmosphere,
    city: patch.city ?? current.city,
    goal: patch.goal ?? current.goal,
    discovery: patch.discovery ?? current.discovery,
    cookingMinutes: patch.cookingMinutes ?? current.cookingMinutes,
    notes: patch.notes ?? current.notes,
  });
}

/** Guide ranking uses known title/type metadata, never guesses at its entries. */
export function guidePreferenceScore(
  p: TastePreferences,
  g: { title: string; type: string },
): number {
  const title = g.title.toLowerCase();
  return (
    p.cuisines.filter((c) => title.includes(c.toLowerCase())).length * 3 -
    p.avoidCuisines.filter((c) => title.includes(c.toLowerCase())).length * 5 +
    ((p.goal === "cooking" && g.type === "recipes") ||
    (p.goal === "restaurants" && g.type !== "recipes")
      ? 2
      : 0)
  );
}
