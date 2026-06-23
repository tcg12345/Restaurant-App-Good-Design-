/**
 * Guide CRUD and query functions — Supabase data layer.
 *
 * Guides are editorial-style curated lists of restaurants or recipes.
 * Each guide row stores its `entries` (ordered references + per-entry
 * editorial copy) as JSONB inside a dedicated `guides` table — separate
 * from `user_app_data` because guides are sometimes published for other
 * users to read.
 */
import { supabase, supabaseConfigured } from './supabase';

export type GuideType = 'restaurants' | 'recipes';
export type GuideVisibility = 'private' | 'public';

/** Free-form section a user can append to an entry from the Live
 *  Editor. Each carries a custom header and a body string, plus the
 *  format used to render the body on the published guide. Stored on
 *  GuideEntry so it round-trips through `saveGuide` like everything
 *  else. */
export interface CustomSection {
  /** Stable id within the entry — used as a React key and as part of
   *  the per-element styleKey for the Element tab. */
  id: string;
  header: string;
  body: string;
  /** Render hint for the body. `paragraph` keeps the body as a single
   *  block; `bullets` and `numbered` split it on newlines and render
   *  each line as a list item. */
  format: 'paragraph' | 'bullets' | 'numbered';
}

export interface GuideEntry {
  /** Stable id within the guide — used for keying and reordering. */
  id: string;
  /** restaurant id (when guide.type === 'restaurants') or recipe id. */
  refId: string;
  /** Denormalized display snapshot — captured at insert time so the
   *  detail page can render without doing a live join. */
  name: string;
  subtitle: string;   // cuisine · price · neighborhood  OR  cuisine · totalTime · difficulty
  image: string;      // cover/photo for this entry
  /** Owner-curated. Optional but encouraged. */
  score?: number;
  /** Free-form description / personal notes — auto-seeded from the
   *  user's own rating notes when the entry is added from a rated place. */
  notes?: string;
  mustOrder?: string[];     // restaurants only
  keyIngredients?: string[]; // recipes only
  bestFor?: string;
  insiderTip?: string;
  /** Restaurant entries only — surfaced under the title. */
  neighborhood?: string;
  hours?: string;
  /** Restaurant entries only — separately editable in the Live Editor.
   *  Originally derived into `subtitle`; we now keep both so the editor's
   *  inspector can tweak them individually without re-parsing. */
  cuisine?: string;
  price?: string;            // '$' | '$$' | '$$$' | '$$$$'
  /** Recipe entries only. */
  totalTime?: number;
  difficulty?: string;
  /** Recipe entries only — author user id, needed so the desktop
   *  RecipePanel can resolve the home-meal record without an extra
   *  lookup. Restaurant entries don't need this. */
  authorId?: string;
  /** User-defined sections appended to this entry in the Live Editor
   *  — each with a custom header and body. Stored inline on the entry
   *  so they ride the existing JSONB persistence. */
  customSections?: CustomSection[];
}

/** Per-text-node style override stored under `theme.textStyles[key]`.
 *  Every property is optional — an empty record means "use the defaults
 *  baked into the rendering primitive". */
export interface ElementStyle {
  /** Font size as a percentage of the element's base size. 50–250. */
  size?: number;
  /** Numeric weight — matches `font-weight`. */
  weight?: 300 | 400 | 500 | 700 | 800;
  italic?: boolean;
  /** `auto` defers to the element's default color; `accent` / `muted` /
   *  `inverse` are theme-aware tokens; a `#rrggbb` is a custom value. */
  color?: 'auto' | 'accent' | 'muted' | 'inverse' | string;
  align?: 'left' | 'center' | 'right';
  /** `auto` defers; `serif` / `sans` switch to the matching theme font. */
  family?: 'auto' | 'serif' | 'sans';
  /** em value. */
  letterSpacing?: number;
}

/** Map of visibility flags for sections + sub-elements. Toggled from the
 *  Live Editor's Layout tab; consumed by the rendering primitives. */
export interface GuideVisibilityMap {
  toc: boolean;
  author: boolean;
  endCap: boolean;
  heroEyebrow: boolean;
  heroAuthor: boolean;
  heroStats: boolean;
  heroActions: boolean;
  introQuote: boolean;
  introTags: boolean;
  entryScore: boolean;
  entryMeta: boolean;
  entryHours: boolean;
  entryActions: boolean;
  entryMustOrder: boolean;
  entryBestFor: boolean;
  entryTip: boolean;
  entryCta: boolean;
}

/** Per-guide author override fields. Each is optional — when absent, the
 *  rendering primitives fall back to the linked user profile. */
export interface GuideAuthorOverrides {
  name?: string;
  handle?: string;
  avatar?: string;   // base64 or URL
  bio?: string;
}

/** Visual customization persisted on a guide. Created and edited via the
 *  Live Editor; consumed by both that editor and the public reader so
 *  authors and viewers see the same styled output. Every field is
 *  optional in storage — the rendering primitives backfill with
 *  DEFAULT_THEME so partial themes round-trip cleanly. */
export interface GuideTheme {
  // Global design
  accent: string;
  surface: 'cream' | 'paper' | 'sand' | 'mist' | 'slate';
  headingFont: 'noto-serif' | 'playfair' | 'fraunces' | 'dm-serif';
  bodyFont: 'manrope' | 'inter' | 'ibm-plex';
  density: 'compact' | 'comfortable' | 'spacious';
  radius: 'sharp' | 'soft' | 'round';

  // Hero
  heroLayout: 'classic' | 'centered' | 'split' | 'minimal';
  heroAlign: 'left' | 'center';
  heroScrim: number;
  heroImageFit: 'cover' | 'contain';
  heroImagePosX: number;
  heroImagePosY: number;
  heroImageBrightness: number;
  heroImageSaturation: number;

  // Intro
  introStyle: 'plain' | 'bordered' | 'accent';

  // Entry layout
  entryLayout: 'sidebar' | 'banner' | 'minimal';
  entryShowPhoto: boolean;

  visibility: GuideVisibilityMap;

  /** Per-element typography overrides, keyed by a dotted path
   *  ('title', 'intro', 'entry.{id}.name', etc.). */
  textStyles: Record<string, ElementStyle>;

  authorOverrides?: GuideAuthorOverrides;
}

/** Defaults applied by `getTheme()` for any field missing from the stored
 *  theme. Mirrors the reference editor's `defaultTheme` so the editor and
 *  reader agree on the baseline. */
export const DEFAULT_THEME: GuideTheme = {
  accent: '#9F3012',
  surface: 'cream',
  headingFont: 'noto-serif',
  bodyFont: 'manrope',
  density: 'comfortable',
  radius: 'soft',

  heroLayout: 'classic',
  heroAlign: 'left',
  heroScrim: 70,
  heroImageFit: 'cover',
  heroImagePosX: 50,
  heroImagePosY: 50,
  heroImageBrightness: 100,
  heroImageSaturation: 105,

  introStyle: 'plain',

  entryLayout: 'sidebar',
  entryShowPhoto: false,

  visibility: {
    toc: true,
    author: true,
    endCap: true,
    heroEyebrow: true,
    heroAuthor: true,
    heroStats: true,
    heroActions: true,
    introQuote: true,
    introTags: true,
    entryScore: true,
    entryMeta: true,
    entryHours: true,
    entryActions: true,
    entryMustOrder: true,
    entryBestFor: true,
    entryTip: true,
    entryCta: true,
  },

  textStyles: {},
};

/** Merge a stored theme with DEFAULT_THEME, preserving the partial
 *  visibility and textStyles maps. Use this anywhere a render primitive
 *  needs a fully-populated theme. */
export function getTheme(guide: Pick<Guide, 'theme' | 'coverPhoto'> | null | undefined): GuideTheme {
  const t = guide?.theme;
  // When the user hasn't customized the theme and there's no cover
  // photo, default the hero to 'minimal'. The Classic / Centered /
  // Split heroes are built around an image; without one they look
  // empty, while Minimal is purpose-designed for the photo-less case.
  // Explicit theme choices (made via Live Edit) always win.
  if (!t) {
    const hasCover = !!guide?.coverPhoto;
    return hasCover ? DEFAULT_THEME : { ...DEFAULT_THEME, heroLayout: 'minimal' };
  }
  return {
    ...DEFAULT_THEME,
    ...t,
    visibility: { ...DEFAULT_THEME.visibility, ...(t.visibility ?? {}) },
    textStyles: { ...(t.textStyles ?? {}) },
    authorOverrides: t.authorOverrides ? { ...t.authorOverrides } : undefined,
  };
}

export interface Guide {
  id: string;
  userId: string;
  type: GuideType;
  title: string;
  subtitle: string;
  intro: string;
  coverPhoto: string;
  tags: string[];
  visibility: GuideVisibility;
  isPublished: boolean;
  /** When false, entry cards render text-only on the published guide
   *  (no per-entry hero image). The guide's cover photo is still used.
   *  Defaults to true to keep legacy rows looking identical. */
  includePhotos: boolean;
  entries: GuideEntry[];
  avgScore: number | null;
  readMinutes: number | null;
  /** Live Editor customization. Absent when the user hasn't opened the
   *  editor; `getTheme()` fills in the defaults during render. */
  theme?: GuideTheme;
  createdAt: string;
  updatedAt: string;
}

export type GuideDraft = Omit<Guide, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'avgScore' | 'readMinutes'>;

/**
 * Shared guide-visibility predicates — the single source of truth so the
 * owner Profile and the public UserProfile never drift on which guides count
 * as "real" or "public". A guide is publicly visible only when it's both
 * published AND set to public; a guide is real (worth rendering at all) when
 * it has a title or any entries (filters out abandoned blank drafts).
 */
export const isRealGuide = (g: Guide): boolean =>
  g.entries.length > 0 || g.title.trim().length > 0;

export const isPublicGuide = (g: Guide): boolean =>
  g.visibility === 'public' && g.isPublished && isRealGuide(g);

function rowToGuide(row: Record<string, unknown>): Guide {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    type: row.type as GuideType,
    title: (row.title as string) || '',
    subtitle: (row.subtitle as string) || '',
    intro: (row.intro as string) || '',
    coverPhoto: (row.cover_photo as string) || '',
    tags: (row.tags as string[]) || [],
    visibility: (row.visibility as GuideVisibility) || 'private',
    isPublished: (row.is_published as boolean) ?? false,
    // include_photos: default true for rows pre-dating migration 027.
    includePhotos: row.include_photos == null ? true : (row.include_photos as boolean),
    entries: ((row.entries as GuideEntry[]) || []),
    avgScore: (row.avg_score as number) ?? null,
    readMinutes: (row.read_minutes as number) ?? null,
    // theme: undefined for rows pre-dating migration 028.
    theme: (row.theme as GuideTheme | null) ?? undefined,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

/** Derive avg score from scored entries (ignoring un-scored ones). */
export function computeAvgScore(entries: GuideEntry[]): number | null {
  const scored = entries.map((e) => e.score).filter((s): s is number => typeof s === 'number');
  if (scored.length === 0) return null;
  return scored.reduce((a, b) => a + b, 0) / scored.length;
}

/** Rough read-time estimate: 200 wpm for intro + ~25s per entry. */
export function computeReadMinutes(intro: string, entries: GuideEntry[]): number {
  const introWords = intro.trim().split(/\s+/).filter(Boolean).length;
  const minutes = introWords / 200 + (entries.length * 25) / 60;
  return Math.max(1, Math.round(minutes));
}

/**
 * Create or update a guide row. Pass `id` to update; omit to insert.
 * Returns the saved row, or null on failure.
 */
export async function saveGuide(
  userId: string,
  draft: GuideDraft & { id?: string },
): Promise<Guide | null> {
  if (!supabaseConfigured || !userId) return null;
  try {
    const avgScore = computeAvgScore(draft.entries);
    const readMinutes = computeReadMinutes(draft.intro, draft.entries);
    const payload: Record<string, unknown> = {
      user_id: userId,
      type: draft.type,
      title: draft.title,
      subtitle: draft.subtitle,
      intro: draft.intro,
      cover_photo: draft.coverPhoto,
      tags: draft.tags,
      visibility: draft.visibility,
      is_published: draft.isPublished,
      include_photos: draft.includePhotos,
      entries: draft.entries,
      avg_score: avgScore,
      read_minutes: readMinutes,
      theme: draft.theme ?? null,
      updated_at: new Date().toISOString(),
    };
    if (draft.id) payload.id = draft.id;

    let { data, error } = await supabase
      .from('guides')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    // Retry without `theme` if the column hasn't been migrated yet
    // (mirrors the include_photos fallback below). Keeps the feature
    // usable until the user runs migration 028.
    if (error && /\btheme\b/i.test(error.message || '')) {
      const { theme: _dropTheme, ...legacy } = payload;
      const retry = await supabase
        .from('guides')
        .upsert(legacy, { onConflict: 'id' })
        .select('*')
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }
    // Retry without include_photos if the column hasn't been migrated
    // yet — keeps the feature usable until the user runs migration 027.
    if (error && /include_photos/i.test(error.message || '')) {
      const { include_photos: _drop, ...legacy } = payload;
      const retry = await supabase
        .from('guides')
        .upsert(legacy, { onConflict: 'id' })
        .select('*')
        .single();
      data = retry.data as typeof data;
      error = retry.error;
    }
    if (error) {
      console.error('[Supabase] saveGuide error:', error);
      return null;
    }
    return rowToGuide(data as Record<string, unknown>);
  } catch (err) {
    console.error('[Supabase] saveGuide exception:', err);
    return null;
  }
}

/** Delete a guide row. Owner-only via RLS. */
export async function deleteGuide(guideId: string): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const { error } = await supabase.from('guides').delete().eq('id', guideId);
    if (error) {
      console.error('[Supabase] deleteGuide error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] deleteGuide exception:', err);
    return false;
  }
}

/**
 * Flip a guide between 'public' and 'private' without rewriting its entries.
 *
 * Making a guide public also marks it published: "public" is the single
 * user-facing share control on the profile, and a public guide that wasn't
 * also `is_published` would be invisible on the public profile (which filters
 * on published+public) while still showing on the owner's profile — the exact
 * drift this avoids. Making a guide private leaves `is_published` untouched so
 * re-sharing it doesn't lose its published state.
 */
export async function setGuideVisibility(
  guideId: string,
  visibility: GuideVisibility,
): Promise<boolean> {
  if (!supabaseConfigured) return false;
  try {
    const patch: Record<string, unknown> = { visibility, updated_at: new Date().toISOString() };
    if (visibility === 'public') patch.is_published = true;
    const { error } = await supabase
      .from('guides')
      .update(patch)
      .eq('id', guideId);
    if (error) {
      console.error('[Supabase] setGuideVisibility error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] setGuideVisibility exception:', err);
    return false;
  }
}

/** Fetch a single guide by id. RLS enforces visibility. */
export async function getGuideById(guideId: string): Promise<Guide | null> {
  if (!supabaseConfigured || !guideId) return null;
  try {
    const { data, error } = await supabase
      .from('guides')
      .select('*')
      .eq('id', guideId)
      .single();
    if (error) {
      if (error.code !== 'PGRST116') console.error('[Supabase] getGuideById error:', error);
      return null;
    }
    return rowToGuide(data as Record<string, unknown>);
  } catch (err) {
    console.error('[Supabase] getGuideById exception:', err);
    return null;
  }
}

/** All guides authored by the current user (drafts + published). */
export async function getMyGuides(userId: string): Promise<Guide[]> {
  if (!supabaseConfigured || !userId) return [];
  try {
    const { data, error } = await supabase
      .from('guides')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) {
      console.error('[Supabase] getMyGuides error:', error);
      return [];
    }
    return ((data as Record<string, unknown>[]) || []).map(rowToGuide);
  } catch (err) {
    console.error('[Supabase] getMyGuides exception:', err);
    return [];
  }
}

/**
 * Guides surfaced on Discover. Returns published + public guides only,
 * newest first. Authored by other users (excludes the caller's own).
 */
export async function getGuidesForFeed(opts: {
  limit?: number;
  excludeUserId?: string;
} = {}): Promise<Guide[]> {
  if (!supabaseConfigured) return [];
  const { limit = 20, excludeUserId } = opts;
  try {
    let q = supabase
      .from('guides')
      .select('*')
      .eq('is_published', true)
      .eq('visibility', 'public')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (excludeUserId) q = q.neq('user_id', excludeUserId);
    const { data, error } = await q;
    if (error) {
      console.error('[Supabase] getGuidesForFeed error:', error);
      return [];
    }
    return ((data as Record<string, unknown>[]) || []).map(rowToGuide);
  } catch (err) {
    console.error('[Supabase] getGuidesForFeed exception:', err);
    return [];
  }
}

/** Add a saved-bookmark for the caller against a guide. */
export async function saveGuideBookmark(userId: string, guideId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase
      .from('saved_guides')
      .upsert({ user_id: userId, guide_id: guideId }, { onConflict: 'user_id,guide_id' });
    if (error) {
      console.error('[Supabase] saveGuideBookmark error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] saveGuideBookmark exception:', err);
    return false;
  }
}

export async function removeGuideBookmark(userId: string, guideId: string): Promise<boolean> {
  if (!supabaseConfigured || !userId) return false;
  try {
    const { error } = await supabase
      .from('saved_guides')
      .delete()
      .eq('user_id', userId)
      .eq('guide_id', guideId);
    if (error) {
      console.error('[Supabase] removeGuideBookmark error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Supabase] removeGuideBookmark exception:', err);
    return false;
  }
}

/** Map of guideId → true for guides the caller has saved. */
export async function getSavedGuideIds(userId: string): Promise<Set<string>> {
  if (!supabaseConfigured || !userId) return new Set();
  try {
    const { data, error } = await supabase
      .from('saved_guides')
      .select('guide_id')
      .eq('user_id', userId);
    if (error) {
      console.error('[Supabase] getSavedGuideIds error:', error);
      return new Set();
    }
    return new Set(((data as { guide_id: string }[]) || []).map((r) => r.guide_id));
  } catch (err) {
    console.error('[Supabase] getSavedGuideIds exception:', err);
    return new Set();
  }
}
