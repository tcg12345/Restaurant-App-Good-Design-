/**
 * Top lists — the user's ratings sliced into ranked leaderboards.
 *
 * A "top list" is a saved slice of someone's own ratings: everything
 * (`overall`), or one cuisine / city / price band / tag. Each renders as a
 * cover card on the profile and as a full ranked page at
 * /profile/top/:listKey.
 *
 * This lives outside Profile.tsx because two screens now derive the same
 * lists from the same ratings and the same locally-stored customization —
 * the profile grid and the full-list page. One derivation means the page a
 * card opens can never disagree with the card that opened it.
 */

/** A saved slice. `overall` has no value; the rest key off one. */
export type TopListConfig =
  | { type: 'overall'; value?: undefined }
  | { type: 'cuisine'; value: string }
  | { type: 'city'; value: string }
  | { type: 'price'; value: string }
  | { type: 'tag'; value: string };

/** The user's deltas on top of the auto-seeded lists. Stored per user in
 *  localStorage; see {@link loadCustomization}. */
export type TopListCustomization = {
  /** Keys of auto lists the user removed. */
  hidden: string[];
  /** Slices the user added by hand. */
  custom: TopListConfig[];
  /** Preferred display order, by key. Visible keys not present fall to the
   *  end in their natural (auto + custom) order — so a freshly-eligible
   *  auto list slots in predictably without erasing the user's choices. */
  order: string[];
};

/** The shape this module needs off a rating. Structural on purpose so
 *  callers can pass their full RestaurantRating unchanged. */
export interface TopListRating {
  restaurantId: string;
  name: string;
  score: number;
  cuisine?: string;
  price?: string;
  address?: string;
  image?: string;
  tags?: string[];
}

/** A list with its matches resolved. `items` is the ranked top slice for
 *  previews; `all` is every match, for the full page. */
export interface TopList<R extends TopListRating = TopListRating> {
  config: TopListConfig;
  key: string;
  label: string;
  items: R[];
  all: R[];
  total: number;
  avg: number;
}

/** How many matching ratings a slice needs before it can become a list —
 *  below this a "top 10" is just the list of everything you've rated. */
export const MIN_LIST_SIZE = 4;

/** Preview length on a cover card. */
const PREVIEW_SIZE = 3;

const storageKey = (userId: string | null | undefined) => `gourmad-top-lists-${userId || 'anon'}`;

/**
 * The city out of a formatted address.
 *
 * Heuristic: in "<street>, <city>, <state-or-country>" the city is the
 * middle part; in "<street>, <city>" it's the last. Picking accordingly is
 * what stops "CT" or "USA" being rendered as a place label.
 */
export function cityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts[parts.length - 1];
}

/** Stable identity for a list — also the :listKey in its URL. */
export function topListKey(c: TopListConfig): string {
  if (c.type === 'overall') return c.type;
  return `${c.type}:${c.value}`;
}

/** Inverse of {@link topListKey}, for reading a key back out of a URL.
 *  Returns null for anything that isn't a key this module produces. */
export function parseTopListKey(key: string): TopListConfig | null {
  if (key === 'overall') return { type: 'overall' };
  const idx = key.indexOf(':');
  if (idx <= 0) return null;
  const type = key.slice(0, idx);
  const value = key.slice(idx + 1);
  if (!value) return null;
  if (type === 'cuisine' || type === 'city' || type === 'price' || type === 'tag') {
    return { type, value };
  }
  return null;
}

/** Short name — what a card or a rail header shows. */
export function topListLabel(c: TopListConfig): string {
  return c.type === 'overall' ? 'Overall' : c.value;
}

/** The kind of slice, for a card's eyebrow line. */
export function topListKindLabel(c: TopListConfig): string {
  switch (c.type) {
    case 'overall': return 'All ratings';
    case 'cuisine': return 'Cuisine';
    case 'city': return 'City';
    case 'price': return 'Price';
    case 'tag': return 'Tag';
  }
}

/** Long name — used where the list needs to introduce itself (page title,
 *  share text) rather than sit under a heading that already says "Top". */
export function topListPlainLabel(c: TopListConfig): string {
  if (c.type === 'overall') return 'Top 10 overall';
  if (c.type === 'city') return `Top 10 in ${c.value}`;
  return `Top 10 · ${c.value}`;
}

export const topListPredicate = (c: TopListConfig) => (r: TopListRating): boolean => {
  switch (c.type) {
    case 'overall': return true;
    case 'cuisine': return r.cuisine === c.value;
    case 'city': return cityFromAddress(r.address || '') === c.value;
    case 'price': return r.price === c.value;
    case 'tag': return Array.isArray(r.tags) && r.tags.includes(c.value);
  }
};

/** Sub-line for a rating inside a list — drops whatever the list itself
 *  already says (a Japanese list needn't repeat "Japanese" on every row). */
export function topListMetaText(c: TopListConfig, r: TopListRating): string | undefined {
  const city = cityFromAddress(r.address || '');
  switch (c.type) {
    case 'overall':
    case 'tag':
      return undefined; // default cuisine · price · city
    case 'cuisine':
      return [city, r.price].filter(Boolean).join(' · ');
    case 'city':
      return [r.cuisine, r.price].filter(Boolean).join(' · ');
    case 'price':
      return [r.cuisine, city].filter(Boolean).join(' · ');
  }
}

/** The sub-line a row shows when the list has no opinion about it. */
export function defaultMetaText(r: TopListRating): string {
  return [r.cuisine, r.price, cityFromAddress(r.address || '')].filter(Boolean).join(' · ');
}

export function loadCustomization(userId: string | null | undefined): TopListCustomization {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { hidden: [], custom: [], order: [] };
    const parsed = JSON.parse(raw);
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch {
    return { hidden: [], custom: [], order: [] };
  }
}

export function saveCustomization(userId: string | null | undefined, c: TopListCustomization): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(c));
  } catch {
    /* ignore quota errors */
  }
}

/** Counts per (cuisine / city / price / tag) — seeds the auto lists and
 *  gates which slices the editor offers. */
export function countCategories(ratings: TopListRating[]) {
  const cuisine = new Map<string, number>();
  const city = new Map<string, number>();
  const price = new Map<string, number>();
  const tag = new Map<string, number>();
  ratings.forEach((r) => {
    if (r.cuisine) cuisine.set(r.cuisine, (cuisine.get(r.cuisine) || 0) + 1);
    const c = cityFromAddress(r.address || '');
    if (c) city.set(c, (city.get(c) || 0) + 1);
    if (r.price) price.set(r.price, (price.get(r.price) || 0) + 1);
    if (Array.isArray(r.tags)) r.tags.forEach((t) => { if (t) tag.set(t, (tag.get(t) || 0) + 1); });
  });
  return { cuisine, city, price, tag };
}

/** Auto-seeded configs: overall, then any cuisine / city over the
 *  threshold, heaviest first. */
export function autoTopListConfigs(counts: ReturnType<typeof countCategories>): TopListConfig[] {
  const out: TopListConfig[] = [{ type: 'overall' }];
  const push = (m: Map<string, number>, type: 'cuisine' | 'city') => {
    Array.from(m.entries())
      .filter(([, n]) => n >= MIN_LIST_SIZE)
      .sort((a, b) => b[1] - a[1])
      .forEach(([value]) => out.push({ type, value } as TopListConfig));
  };
  push(counts.cuisine, 'cuisine');
  push(counts.city, 'city');
  return out;
}

/** Auto lists minus what the user hid, plus what they added, in their
 *  preferred order. */
export function visibleTopListConfigs(
  autoConfigs: TopListConfig[],
  customization: TopListCustomization,
): TopListConfig[] {
  const hidden = new Set(customization.hidden);
  const auto = autoConfigs.filter((c) => !hidden.has(topListKey(c)));
  const autoKeys = new Set(auto.map(topListKey));
  const custom = customization.custom.filter((c) => !autoKeys.has(topListKey(c)));
  const all = [...auto, ...custom];

  if (customization.order.length === 0) return all;
  const orderIdx = new Map<string, number>(customization.order.map((k, i) => [k, i]));
  return [...all].sort((a, b) => {
    const ai = orderIdx.get(topListKey(a));
    const bi = orderIdx.get(topListKey(b));
    if (ai != null && bi != null) return ai - bi;
    if (ai != null) return -1;
    if (bi != null) return 1;
    return 0; // both unknown — preserve natural auto/custom order
  });
}

/** Resolve one config against the ratings. Returns null when nothing
 *  matches, so callers can drop empty slices. */
export function buildTopList<R extends TopListRating>(
  config: TopListConfig,
  ratings: R[],
  previewSize = PREVIEW_SIZE,
): TopList<R> | null {
  const matching = ratings.filter(topListPredicate(config));
  if (matching.length === 0) return null;
  const all = [...matching].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
  const total = all.length;
  const avg = all.reduce((s, r) => s + (Number(r.score) || 0), 0) / total;
  return {
    config,
    key: topListKey(config),
    label: topListLabel(config),
    items: all.slice(0, previewSize),
    all,
    total,
    avg,
  };
}

/**
 * Everything the profile grid needs, in one pass: which lists are visible
 * and what's in each. Both the grid and the full-list page call this, so a
 * card and the page it opens are always derived identically.
 */
export function deriveTopLists<R extends TopListRating>(
  ratings: R[],
  customization: TopListCustomization,
  previewSize = PREVIEW_SIZE,
): { configs: TopListConfig[]; autoConfigs: TopListConfig[]; lists: Array<TopList<R>> } {
  const counts = countCategories(ratings);
  const autoConfigs = autoTopListConfigs(counts);
  const configs = visibleTopListConfigs(autoConfigs, customization);
  const lists = configs
    .map((config) => buildTopList(config, ratings, previewSize))
    .filter((l): l is TopList<R> => l !== null);
  return { configs, autoConfigs, lists };
}
