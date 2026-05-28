// LocationPage AI chatbot — floating FAB + chat island.
//
// Scoped to /location for now. Sends the current visible-restaurants
// pool + active filters to the location-chat Edge Function on every
// turn so Claude always sees the user's state. Renders streaming
// text + inline restaurant cards when Claude calls the
// recommend_restaurants tool.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  ChefHat,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Plus,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import {
  formatLocationLabel,
  priceLevelToString,
  CUISINE_TYPES,
} from '../lib/places';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import type { RestaurantMeta, HomeMeal, RecipeIngredient, RecipeIngredientGroup, RecipeNote, RecipeStepDetail } from '../contexts/ListsContext';
import type { Recipe } from '../contexts/RecipesContext';
import type { ScoredPlace } from '../lib/recommendations';
import {
  streamLocationChat,
  type AnthropicMessage,
  type ContentBlock,
  type ChatFilters,
  type CompactRestaurant,
  type UserContext,
} from '../lib/location-chat-client';
import { RecipeDraftCard } from './chat/RecipeDraftCard';
import { RecipeDraftSheet } from './chat/RecipeDraftSheet';

const GOOGLE_TYPE_TO_CUISINE_LABEL: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const entry of CUISINE_TYPES) {
    if (entry.type) out[entry.type] = entry.label;
  }
  return out;
})();

/** Map a Google place's types array to a human-readable cuisine label.
 *  Mirrors the helper LocationPage uses locally — duplicated here so
 *  this component has no dependency on LocationPage's internals. */
function inferCuisineLabel(types: string[]): string {
  for (const t of types) {
    const label = GOOGLE_TYPE_TO_CUISINE_LABEL[t];
    if (label && label !== 'All') return label;
  }
  return '';
}

export interface AssistantUser {
  username: string;
  displayName?: string;
  bio?: string;
  isExpert?: boolean;
  homeCity?: string;
}

/** Public recipe surfaced via search_community_recipes — augmented
 *  with the author's display name + username so the card can show
 *  "by @joesmith" and the bot can mention attribution in prose. */
export interface CommunityRecipeHit {
  /** Source-agnostic id. For home meals it's prefixed with
   *  "hm:userId:mealId" so it can't collide with formal recipe
   *  UUIDs; the navigate handler strips the prefix and routes to
   *  /meal/:userId/:mealId. Formal recipe ids are passed through
   *  unchanged and route to /recipe/:userId/:id. */
  id: string;
  userId: string;
  title: string;
  cuisine?: string;
  prepTimeMinutes?: number | null;
  cookTimeMinutes?: number | null;
  difficulty?: string;
  photos?: string[];
  ingredientCount?: number;
  stepCount?: number;
  /** Where the recipe lives — drives the navigate URL pattern. */
  source?: 'recipe' | 'home_meal';
  authorUsername?: string;
  authorDisplayName?: string;
  authorIsExpert?: boolean;
  authorIsFriend?: boolean;
}

export interface AssistantCircleRating {
  username: string;
  displayName?: string;
  isExpert?: boolean;
  isFriend?: boolean;
  score?: number;
  notes?: string;
}

/** Result envelope for any action tool. `ok` controls how the tool
 *  result string reads to Claude; `detail` becomes the human-readable
 *  message so the model can confirm it back to the user accurately. */
export interface ActionResult {
  ok: boolean;
  detail?: string;
}

/* ── Model picker ────────────────────────────────────────────────
   The chat can run on Sonnet 4.6, Opus 4.7, or 'auto' (server-side
   heuristic chooses per turn). Stored as a literal string so it
   round-trips through localStorage and over the wire untouched. */
export type ChatModelPref = 'auto' | 'claude-sonnet-4-6' | 'claude-opus-4-7';
const CHAT_MODEL_STORAGE_KEY = 'gourmad-chat-model';
const VALID_MODEL_PREFS: readonly ChatModelPref[] = ['auto', 'claude-sonnet-4-6', 'claude-opus-4-7'];
function loadModelPref(): ChatModelPref {
  try {
    const raw = localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
    if (raw && (VALID_MODEL_PREFS as readonly string[]).includes(raw)) return raw as ChatModelPref;
  } catch { /* private mode / quota — fall through */ }
  return 'auto';
}
function saveModelPref(pref: ChatModelPref) {
  try { localStorage.setItem(CHAT_MODEL_STORAGE_KEY, pref); } catch { /* best-effort */ }
}
const MODEL_LABELS: Record<ChatModelPref, string> = {
  auto: 'Auto',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-opus-4-7': 'Opus 4.7',
};
const MODEL_SUBLABELS: Record<ChatModelPref, string> = {
  auto: 'Picks per turn',
  'claude-sonnet-4-6': 'Fast, low cost',
  'claude-opus-4-7': 'Deepest reasoning',
};

interface LocationChatProps {
  /** Filtered restaurant pool — what the user is currently looking at. */
  visible: ScoredPlace[];
  /** Shared meta cache so chat cards render the same "Neighborhood,
   *  Borough" labels the list rows do. */
  restaurantMeta: Record<string, RestaurantMeta>;
  /** Display name for the system prompt. e.g. "New York, NY". */
  cityDisplay: string;
  /** Short city name for empty-state suggestions. e.g. "New York". */
  shortCityName: string;
  /** Active-filter snapshot — passed straight to the Edge Function so
   *  Claude can refer to filters in its replies. */
  filters: ChatFilters;
  /** City coords for the distance line on cards (falls back to first
   *  visible place when absent). */
  origin: { lat: number; lng: number } | null;
  /** Fetches fresh Google Places hits for a free-text query, anchored
   *  to the user's current city by default. When `city` is supplied,
   *  geocodes that city and searches there instead — lets Claude
   *  turn web_search restaurant names into clickable card ids for
   *  any city in the world, not just the page's current one. */
  onSearchRestaurants: (query: string, city?: string) => Promise<ScoredPlace[]>;
  /** All of the user's saved recipes (across every list). Used as
   *  the lookup table when Claude calls recommend_recipes — same
   *  pattern as placeById for restaurants. */
  recipes: Recipe[];
  /** Restaurants the user has rated or wishlisted that may not be in
   *  the visible pool (e.g. a Paris restaurant when the page is
   *  browsing New York). Augments placeById so the chat can render
   *  cards + auto-link any of those names mentioned in prose. */
  knownPlaces: ScoredPlace[];
  /** Personalization context — user's taste, lists, friends, etc.
   *  Shipped in the request body and inlined into the system prompt
   *  so Claude can tailor recommendations. Optional; omit and the
   *  chat works in 'cold' mode. */
  userContext?: UserContext;
  /** Looks up app users by username / display name (case-insensitive
   *  substring). Returns up to 5 public profiles. Wired to Claude's
   *  lookup_user tool. */
  onLookupUser: (query: string) => Promise<AssistantUser[]>;
  /** Browse experts. Optional filters narrow by cuisine focus (bio
   *  match) or home city. Wired to Claude's find_experts tool. */
  onFindExperts?: (opts: { cuisine?: string; city?: string }) => Promise<AssistantUser[]>;
  /** Search public recipes from friends, experts, and other users
   *  on the platform. Wired to Claude's search_community_recipes
   *  tool. Returns hits with author metadata so cards can show
   *  "by @username" and the bot can mention attribution. */
  onSearchCommunityRecipes?: (opts: { query?: string; cuisine?: string; source?: 'friends' | 'experts' | 'public' | 'all' }) => Promise<CommunityRecipeHit[]>;
  /** Look up who in the user's circle (friends + followed experts)
   *  rated a specific restaurant. Wired to Claude's get_circle_ratings
   *  tool. Implemented in LocationPage off signals.communityByRestaurant. */
  onGetCircleRatings: (restaurantId: string) => Promise<AssistantUser[] | AssistantCircleRating[]>;

  /* ── ACTION handlers — wire up new in-app capabilities. All are
       optional so this component still works standalone (the bot
       just gets back "action not available here" tool results
       when an unwired tool is called). ───────────────────────── */
  /** Current route — sent to Claude so it can tailor "you're on X"
   *  replies. Defaults to /location when omitted. */
  currentPath?: string;
  /** Human label for the current route — sent to Claude. */
  currentPageLabel?: string;
  /** Navigate to an in-app path. The chat closes automatically. */
  onNavigate?: (path: string) => ActionResult | Promise<ActionResult>;
  /** Open the rating modal for a restaurant id (resolves name via
   *  knownPlaces / placeById / restaurantMeta). */
  onOpenRatingModal?: (restaurantId: string) => ActionResult | Promise<ActionResult>;
  /** Open the unified "Add restaurant" multi-step modal. */
  onOpenAddRestaurantModal?: (restaurantId: string, initialPage?: string) => ActionResult | Promise<ActionResult>;
  /** Open the "Add to list" picker for a restaurant. */
  onOpenAddToListModal?: (restaurantId: string) => ActionResult | Promise<ActionResult>;
  /** Toggle wishlist membership for a restaurant. */
  onToggleWishlist?: (restaurantId: string) => ActionResult | Promise<ActionResult>;
  /** Open the Add Recipe flow. */
  onOpenAddRecipeModal?: () => ActionResult | Promise<ActionResult>;
  /** Open the Add Post flow. */
  onOpenAddPostModal?: () => ActionResult | Promise<ActionResult>;
  /** Open the Add Reel flow, optionally pre-selecting a kind. */
  onOpenAddReelModal?: (kind?: 'restaurant' | 'recipe') => ActionResult | Promise<ActionResult>;
  /** Open the Log Home Meal flow. */
  onOpenHomeMealModal?: (meal?: HomeMeal) => ActionResult | Promise<ActionResult>;
  /** All recipes/home-cooked meals on the user's account. Used by the
   *  AI-recipe-draft preview sheet to (a) commit a new meal via
   *  `onPublishHomeMeal` and (b) detect when a meal published via the
   *  Edit → modal path has actually landed in the user's cookbook. */
  homeMeals?: HomeMeal[];
  /** Persist an AI-built recipe draft into the user's cookbook. Returns
   *  the freshly assigned id so the chat block can transition to a
   *  "Published" state. */
  onPublishHomeMeal?: (meal: Omit<HomeMeal, 'id' | 'createdAt'>) => HomeMeal;
  /** Open the Guide Creator sheet. */
  onOpenGuideCreator?: () => ActionResult | Promise<ActionResult>;
  /** When true the FAB sits high enough to clear the global
   *  BottomNav (phone-mode pages outside /location). Defaults to
   *  false, which keeps the original low-and-tight placement that
   *  works well on /location and on desktop. */
  fabAboveBottomNav?: boolean;
  /** When true the FAB animates down + fades out (Twitter / Instagram
   *  scroll-hide). AppAssistant flips this on mobile while the user
   *  scrolls DOWN and flips it back off when they scroll UP. Always
   *  false on desktop. */
  fabHidden?: boolean;
}

interface UiMessage {
  role: 'user' | 'assistant';
  /** Rendered content blocks for this turn. Text deltas append into
   *  the last text block; tool_use cards become their own block. */
  blocks: UiBlock[];
}

type UiBlock =
  | { type: 'text'; text: string }
  | { type: 'cards'; toolUseId: string; placeIds: string[]; reason?: string }
  | { type: 'recipe_cards'; toolUseId: string; recipeIds: string[]; reason?: string }
  // AI-built recipe draft. The `draft` is a full HomeMeal-shaped object
  // with builderVersion: 'advanced'; it has a stable client-assigned id
  // but is NOT in homeMeals until the user taps Publish in the preview
  // sheet. `publishedMealId` is set once the user publishes — either
  // from the sheet directly or via the Edit → modal path (matched by id).
  // `rawInput` round-trips the original tool input back to Anthropic so
  // the conversation history stays valid across turns.
  | { type: 'recipe_draft'; toolUseId: string; draft: HomeMeal; rawInput: unknown; publishedMealId: string | null }
  // Invisible: assistant's tool_use blocks we don't surface as cards
  // (currently search_restaurants and lookup_user). Kept in messages
  // state so the conversation can be reconstructed on the next API
  // call without breaking Anthropic's "every tool_use needs a matching
  // tool_result immediately after" rule.
  | { type: 'tool_use'; toolUseId: string; toolName: string; input: unknown }
  // Invisible: user-role tool_result blocks emitted between agentic
  // turns. Stored on the user turn so the history round-trips cleanly.
  | { type: 'tool_result'; toolUseId: string; content: string };

/** Shape the `build_recipe` tool emits — mirrors AdvancedRecipeState
 *  field-for-field. We normalize this into a HomeMeal before storing
 *  it on the chat block. */
interface BuildRecipeInput {
  name?: string;
  summary?: string;
  cuisine?: string;
  course?: string[];
  difficulty?: 'Easy' | 'Medium' | 'Hard';
  prepTime?: number;
  cookTime?: number;
  chillTime?: number;
  servings?: number;
  yieldDescription?: string;
  ingredientGroups?: RecipeIngredientGroup[];
  steps?: RecipeStepDetail[];
  equipment?: string[];
  tags?: string[];
  notes?: RecipeNote[];
}

/** Turn the tool's structured input into a complete HomeMeal that the
 *  Advanced builder can hydrate from via `fromHomeMeal()`. Dual-writes
 *  the rich → flat representations so any consumer that reads the flat
 *  `ingredients` / `steps` arrays still renders.
 *
 *  Validates that the AI gave us something usable (name + at least one
 *  ingredient + at least one step). Returns `null` when invalid so the
 *  caller can fail the tool_result with a useful message. */
function buildRecipeInputToHomeMeal(input: BuildRecipeInput): HomeMeal | null {
  const name = (input.name || '').trim();
  if (!name) return null;
  const groups: RecipeIngredientGroup[] = Array.isArray(input.ingredientGroups)
    ? input.ingredientGroups
        .filter((g) => g && Array.isArray(g.ingredients))
        .map((g) => ({
          name: g.name || 'Ingredients',
          ingredients: g.ingredients
            .filter((i) => i && (i.name || '').trim())
            .map((i) => ({ name: i.name.trim(), amount: i.amount || '', unit: i.unit || '' })),
        }))
        .filter((g) => g.ingredients.length > 0)
    : [];
  if (groups.length === 0) return null;
  const flatIngredients: RecipeIngredient[] = groups.flatMap((g) => g.ingredients);

  const stepDetails: RecipeStepDetail[] = Array.isArray(input.steps)
    ? input.steps
        .filter((s) => s && (s.body || '').trim())
        .map((s) => ({
          title: s.title?.trim() || undefined,
          body: s.body.trim(),
          durationMin: typeof s.durationMin === 'number' && s.durationMin > 0 ? s.durationMin : undefined,
          tip: s.tip?.trim() || undefined,
        }))
    : [];
  if (stepDetails.length === 0) return null;
  const flatSteps = stepDetails.map((s) => s.body);

  const summary = (input.summary || '').trim();
  const today = new Date().toISOString().slice(0, 10);

  return {
    id: `ai-draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    summary: summary || undefined,
    description: summary,
    date: today,
    score: 0,
    wouldMakeAgain: false,
    isPublic: false,
    dishes: [],
    photos: [],
    tags: Array.isArray(input.tags) ? input.tags.filter((t) => typeof t === 'string' && t.trim()) : [],
    cuisine: input.cuisine || undefined,
    course: Array.isArray(input.course) ? input.course.filter((c) => typeof c === 'string' && c.trim()) : undefined,
    difficulty: input.difficulty,
    prepTime: typeof input.prepTime === 'number' && input.prepTime >= 0 ? input.prepTime : undefined,
    cookTime: typeof input.cookTime === 'number' && input.cookTime >= 0 ? input.cookTime : undefined,
    chillTime: typeof input.chillTime === 'number' && input.chillTime >= 0 ? input.chillTime : undefined,
    servings: typeof input.servings === 'number' && input.servings > 0 ? input.servings : undefined,
    yieldDescription: input.yieldDescription?.trim() || undefined,
    ingredientGroups: groups,
    ingredients: flatIngredients,
    stepDetails,
    steps: flatSteps,
    equipment: Array.isArray(input.equipment) ? input.equipment.filter((e) => typeof e === 'string' && e.trim()) : [],
    notes: Array.isArray(input.notes)
      ? input.notes.filter((n) => n && n.text && ['tip', 'makeAhead', 'substitution', 'general'].includes(n.type))
      : [],
    builderVersion: 'advanced',
    coverPhoto: undefined,
    createdAt: Date.now(),
  };
}

/** Build the compact restaurant payload sent to the model. */
function buildCompactRestaurants(
  visible: ScoredPlace[],
  meta: Record<string, RestaurantMeta>,
  origin: { lat: number; lng: number } | null,
): CompactRestaurant[] {
  return visible.slice(0, 50).map((p) => {
    const cuisine = inferCuisineLabel(p.types);
    const priceLabel = priceLevelToString(p.priceLevel);
    const score = p.rating > 0 ? (p.rating * 2).toFixed(1) : '';
    const placeMeta = meta[p.id];
    const neighborhood = formatLocationLabel(
      placeMeta?.addressComponents,
      p.address || '',
      placeMeta?.neighborhood,
    );
    const distMi = origin
      ? haversineDistanceMi(origin.lat, origin.lng, p.lat, p.lng)
      : null;
    return {
      id: p.id,
      name: p.name,
      cuisine: cuisine || undefined,
      price: priceLabel || undefined,
      score: score ? `${score}/10` : undefined,
      neighborhood: neighborhood || undefined,
      distance: distMi != null ? formatDistance(distMi) : undefined,
    };
  });
}

/** Find a place in the lookup map by case-insensitive exact name match. */
interface InlineLinkable {
  /** Lowercase pattern to match against (case-insensitive). For
   *  users this includes both the display name and "@username" forms. */
  pattern: string;
  kind: 'place' | 'user';
  /** Click handler — closes the chat then navigates. */
  navigate: () => void;
  /** CSS class suffix so users and places can render slightly
   *  differently if desired. */
  className: string;
}

const MARKDOWN_BOLD_RE = /(\*\*[^*\n]+\*\*)/g;
const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/** Build the longest-first alternation regex for the linkable list.
 *  Display names get \b…\b word-boundaries; "@username" patterns
 *  use a leading "@" + trailing \b. Sort by pattern length so
 *  "Joe's Pizza & Wings" beats "Joe's". */
function buildLinkableRegex(items: InlineLinkable[]): RegExp | null {
  if (items.length === 0) return null;
  const seen = new Set<string>();
  const unique = items.filter((it) => {
    const k = it.pattern.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const sorted = [...unique].sort((a, b) => b.pattern.length - a.pattern.length);
  const alternations = sorted.map((it) => {
    const esc = it.pattern.replace(REGEX_ESCAPE_RE, '\\$&');
    if (it.pattern.startsWith('@')) {
      // username pattern: literal @ + bare word characters; need a
      // trailing word-boundary so @joe doesn't match part of @joey.
      return esc + '\\b';
    }
    return `\\b${esc}\\b`;
  });
  return new RegExp(`(${alternations.join('|')})`, 'gi');
}

function findLinkable(matched: string, items: InlineLinkable[]): InlineLinkable | null {
  const norm = matched.toLowerCase();
  for (const it of items) {
    if (it.pattern.toLowerCase() === norm) return it;
  }
  return null;
}

/** Render an assistant text block:
 *   - **bold** markdown becomes <strong> (or an inline link when the
 *     bolded text is a known restaurant or user name).
 *   - Plain-text restaurant + user names become inline links too —
 *     so even when Claude forgets the markdown, mentions are still
 *     clickable. Restaurants tap-through to the detail page; users
 *     tap-through to their profile.
 *  Links are styled as accent-tinted pills. */
function renderAssistantText(
  text: string,
  linkables: InlineLinkable[],
  linkRegex: RegExp | null,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let key = 0;
  const renderLink = (it: InlineLinkable, label: string) => (
    <button
      key={key++}
      type="button"
      className={it.className}
      onClick={it.navigate}
    >
      {label}
    </button>
  );
  const linkifyPlain = (segment: string): void => {
    if (!segment) return;
    if (!linkRegex) {
      out.push(<React.Fragment key={key++}>{segment}</React.Fragment>);
      return;
    }
    linkRegex.lastIndex = 0;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = linkRegex.exec(segment)) !== null) {
      if (m.index > lastEnd) {
        out.push(<React.Fragment key={key++}>{segment.slice(lastEnd, m.index)}</React.Fragment>);
      }
      const matched = m[0];
      const it = findLinkable(matched, linkables);
      if (it) out.push(renderLink(it, matched));
      else out.push(<React.Fragment key={key++}>{matched}</React.Fragment>);
      lastEnd = m.index + matched.length;
      if (m.index === linkRegex.lastIndex) linkRegex.lastIndex++;
    }
    if (lastEnd < segment.length) {
      out.push(<React.Fragment key={key++}>{segment.slice(lastEnd)}</React.Fragment>);
    }
  };

  for (const part of text.split(MARKDOWN_BOLD_RE)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const inner = part.slice(2, -2);
      const exact = findLinkable(inner, linkables);
      if (exact) out.push(renderLink(exact, inner));
      else out.push(<strong key={key++}>{inner}</strong>);
    } else {
      linkifyPlain(part);
    }
  }
  return out;
}

/** Strip the UI blocks back into the Anthropic content array we
 *  need to round-trip on the next request. We MUST resend the
 *  assistant's full content (including tool_use blocks) AND the
 *  user-role tool_result blocks that followed them, otherwise
 *  Anthropic rejects the conversation with
 *  "tool_use ids were found without tool_result blocks immediately
 *  after".  */
/** Walk the message history pair-wise and drop any tool_use /
 *  tool_result that doesn't have its counterpart in the adjacent
 *  message. Anthropic strictly requires that every tool_result in a
 *  user turn has a matching tool_use in the IMMEDIATELY preceding
 *  assistant turn, and vice versa — otherwise the API rejects the
 *  request with 'tool_use ids were found without tool_result blocks'
 *  or 'unexpected tool_use_id found in tool_result blocks'.
 *
 *  State and saved chats keep the full UI history (so the user still
 *  sees their cards even if the protocol blocks went sideways); only
 *  the wire payload sent to Anthropic is sanitised. Common triggers:
 *  aborted streams, older saved chats from before tool_result
 *  persistence was added, agentic-loop interruptions. */
function sanitizeForAnthropic(messages: UiMessage[]): UiMessage[] {
  const out: UiMessage[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'assistant') {
      // Tool_use ids in the next user turn (the only place a
      // tool_result could legitimately match them).
      const nextResultIds = new Set<string>();
      const nextMsg = messages[i + 1];
      if (nextMsg && nextMsg.role === 'user') {
        for (const b of nextMsg.blocks) {
          if (b.type === 'tool_result') nextResultIds.add(b.toolUseId);
        }
      }
      const blocks = m.blocks.filter((b) => {
        if (b.type === 'cards' || b.type === 'recipe_cards' || b.type === 'recipe_draft' || b.type === 'tool_use') {
          return nextResultIds.has(b.toolUseId);
        }
        return true;
      });
      const hasContent = blocks.some((b) =>
        (b.type === 'text' && !!b.text)
        || (b.type === 'cards' && b.placeIds.length > 0)
        || (b.type === 'recipe_cards' && b.recipeIds.length > 0)
        || b.type === 'recipe_draft'
        || b.type === 'tool_use'
      );
      if (hasContent) out.push({ ...m, blocks });
    } else {
      // user — drop tool_results whose tool_use is not in the
      // immediately preceding assistant turn.
      const prevToolUseIds = new Set<string>();
      const prevMsg = messages[i - 1];
      if (prevMsg && prevMsg.role === 'assistant') {
        for (const b of prevMsg.blocks) {
          if (b.type === 'cards' || b.type === 'recipe_cards' || b.type === 'recipe_draft' || b.type === 'tool_use') {
            prevToolUseIds.add(b.toolUseId);
          }
        }
      }
      const blocks = m.blocks.filter((b) => {
        if (b.type === 'tool_result') return prevToolUseIds.has(b.toolUseId);
        return true;
      });
      const hasContent = blocks.some((b) =>
        (b.type === 'text' && !!b.text) || b.type === 'tool_result',
      );
      if (hasContent) out.push({ ...m, blocks });
    }
  }
  return out;
}

function uiBlocksToAnthropicContent(blocks: UiBlock[]): ContentBlock[] {
  const out: ContentBlock[] = [];
  for (const b of blocks) {
    if (b.type === 'text' && b.text) {
      out.push({ type: 'text', text: b.text });
    } else if (b.type === 'cards') {
      out.push({
        type: 'tool_use',
        id: b.toolUseId,
        name: 'recommend_restaurants',
        input: { restaurant_ids: b.placeIds, reason: b.reason || '' },
      });
    } else if (b.type === 'recipe_cards') {
      out.push({
        type: 'tool_use',
        id: b.toolUseId,
        name: 'recommend_recipes',
        input: { recipe_ids: b.recipeIds, reason: b.reason || '' },
      });
    } else if (b.type === 'recipe_draft') {
      // Round-trip the original tool input so the model sees its own
      // build_recipe call exactly as it emitted it.
      out.push({
        type: 'tool_use',
        id: b.toolUseId,
        name: 'build_recipe',
        input: b.rawInput,
      });
    } else if (b.type === 'tool_use') {
      out.push({
        type: 'tool_use',
        id: b.toolUseId,
        name: b.toolName,
        input: b.input,
      });
    } else if (b.type === 'tool_result') {
      out.push({
        type: 'tool_result',
        tool_use_id: b.toolUseId,
        content: b.content,
      });
    }
  }
  return out;
}

/** Pluck suggestion chips for the empty state, biased by active filters. */
function buildSuggestions(shortCity: string, filters: ChatFilters): string[] {
  const cuisineLabel = (filters.cuisines?.[0] && (
    GOOGLE_TYPE_TO_CUISINE_LABEL[filters.cuisines[0]] || ''
  )) || '';
  const out = [
    cuisineLabel
      ? `Best ${cuisineLabel.toLowerCase()} spots in ${shortCity}`
      : `Best date night spots in ${shortCity}`,
    'Hidden gems most people miss',
    'Where to go for a casual lunch',
    'Something quick under $20',
  ];
  return out.slice(0, 4);
}

const MAX_AGENTIC_TURNS = 5;

/* ── Chat history persistence ─────────────────────────────────────
   Saved chats live in localStorage so they survive reloads + return
   visits. Each conversation gets a stable id, a title derived from
   the first user message, and the full UiMessage array (including
   invisible tool_use / tool_result blocks so reopening can continue
   the agentic conversation without breaking Anthropic's history
   rules). chatPlaces — the search_restaurants result cache — is
   snapshot too so cards inside an old chat still resolve. */

interface SavedChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UiMessage[];
  chatPlaces: Record<string, ScoredPlace>;
}

const CHAT_STORAGE_KEY = 'lp-chat-history-v1';
const MAX_SAVED_CHATS = 30;

function loadSavedChats(): SavedChat[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && typeof c.id === 'string' && Array.isArray(c.messages));
  } catch {
    return [];
  }
}

function persistSavedChats(chats: SavedChat[]) {
  const bounded = [...chats]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_CHATS);
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Quota exceeded — drop oldest one at a time until it fits.
    let working = bounded;
    while (working.length > 1) {
      working = working.slice(0, -1);
      try {
        localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(working));
        return;
      } catch { /* keep trimming */ }
    }
  }
}

/** Derive a chat title from the first user message in the conversation. */
function deriveChatTitle(messages: UiMessage[]): string {
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const b of m.blocks) {
      if (b.type === 'text' && b.text) {
        const t = b.text.trim().replace(/\s+/g, ' ');
        return t.length > 50 ? t.slice(0, 50).trimEnd() + '…' : t;
      }
    }
  }
  return 'New conversation';
}

/** Compact relative-time label for the history list. */
function formatTimeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

function countUserMessages(messages: UiMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.role === 'user' && m.blocks.some((b) => b.type === 'text' && b.text)) n++;
  }
  return n;
}

export const LocationChat: React.FC<LocationChatProps> = ({
  visible,
  restaurantMeta,
  cityDisplay,
  shortCityName,
  filters,
  origin,
  onSearchRestaurants,
  userContext,
  onLookupUser,
  onFindExperts,
  onSearchCommunityRecipes,
  onGetCircleRatings,
  recipes,
  knownPlaces,
  currentPath,
  currentPageLabel,
  onNavigate,
  onOpenRatingModal,
  onOpenAddRestaurantModal,
  onOpenAddToListModal,
  onToggleWishlist,
  onOpenAddRecipeModal,
  onOpenAddPostModal,
  onOpenAddReelModal,
  onOpenHomeMealModal,
  onOpenGuideCreator,
  homeMeals,
  onPublishHomeMeal,
  fabAboveBottomNav,
  fabHidden,
}) => {
  const navigate = useNavigate();
  const { phoneMode, setHideBottomNav } = useSettings();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Model preference. Persisted in localStorage so the choice survives
  // reloads. 'auto' lets the server's heuristic pick per turn.
  const [model, setModel] = useState<ChatModelPref>(() => loadModelPref());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => { saveModelPref(model); }, [model]);
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [modelMenuOpen]);

  // Chat-local cache for places returned by the search_restaurants
  // tool — they may fall outside the user's current filters (whole
  // point of the tool) so we need somewhere to render cards from
  // regardless of visible[]. Keys are place ids.
  const [chatPlaces, setChatPlaces] = useState<Record<string, ScoredPlace>>({});

  // Chat-local cache for users surfaced via lookup_user or
  // get_circle_ratings during this conversation. Augments the
  // friend / expert lists from userContext when scanning prose for
  // inline @username / display-name links.
  const [chatKnownUsers, setChatKnownUsers] = useState<Record<string, { username: string; displayName?: string }>>({});

  // Chat-local cache for community recipes surfaced via
  // search_community_recipes. Folded into recipeById so cards
  // rendered by recommend_recipes resolve even when the id isn't
  // one of the user's own saved recipes.
  const [chatCommunityRecipes, setChatCommunityRecipes] = useState<Record<string, CommunityRecipeHit>>({});

  // AI-built recipe drafts. `openDraftToolUseId` identifies the
  // recipe_draft block whose preview sheet is currently open. The
  // draft itself lives on the chat block in `messages` — we look it
  // up by toolUseId when rendering the sheet so edits to the block
  // (publish status, deletion) stay in sync without prop drilling.
  const [openDraftToolUseId, setOpenDraftToolUseId] = useState<string | null>(null);
  // Tracks drafts whose Edit was tapped — used to detect when the
  // user publishes from the Advanced builder so we can transition the
  // chat card to a "Published" state. Keyed by recipe_draft.toolUseId,
  // value is the timestamp at which Edit was tapped (we match a new
  // homeMeal with name === draft.name and createdAt >= editStartedAt).
  const [draftEditMarkers, setDraftEditMarkers] = useState<Record<string, number>>({});

  // ── Chat history ────────────────────────────────────────────────
  // `view` swaps between the live conversation and the saved-chats
  // list. `currentChatId` tracks which saved chat (if any) the
  // current messages belong to — null = unsaved new chat. Sending
  // the first message auto-creates the id; auto-save persists every
  // subsequent change. The savedChats list is loaded once on mount
  // and kept in lockstep with localStorage.
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [savedChats, setSavedChats] = useState<SavedChat[]>(() => loadSavedChats());
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Desktop drag — repositions the island. Resize is handled by
  // the browser's native CSS `resize: both` on the island element
  // (more reliable than wiring our own mousedown listener through
  // the foot / send-button stack). Position is computed once when
  // the chat first opens so it lands in its anchored bottom-right
  // spot, then is fully user-controlled from there. Phone mode
  // skips drag entirely — the bottom sheet animation handles itself.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const { dragProps, startDrag } = useBottomSheet(open && phoneMode, () => setOpen(false));

  // Hide the bottom-nav on phone while the chat sheet is up.
  useEffect(() => {
    if (!phoneMode) return;
    setHideBottomNav(open);
    return () => setHideBottomNav(false);
  }, [open, phoneMode, setHideBottomNav]);

  // Autoscroll to the bottom as messages grow / stream.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // Focus the input when the chat opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [open]);

  // Abort any in-flight request when the component unmounts.
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // Always land in the live-chat view when the panel opens —
  // history view is a navigation destination, not a default.
  useEffect(() => {
    if (open) setView('chat');
  }, [open]);

  // Auto-save the current conversation on any change. Debounced so
  // streaming text deltas don't trigger one localStorage write per
  // token; one save fires ~600ms after activity settles. On the
  // first message we mint an id and adopt it as currentChatId so
  // subsequent saves update the same row.
  useEffect(() => {
    if (messages.length === 0) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      let id = currentChatId;
      if (!id) {
        id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setCurrentChatId(id);
      }
      setSavedChats((prev) => {
        const now = Date.now();
        const idx = prev.findIndex((c) => c.id === id);
        const updated: SavedChat = {
          id: id!,
          title: deriveChatTitle(messages),
          createdAt: idx >= 0 ? prev[idx].createdAt : now,
          updatedAt: now,
          messages,
          chatPlaces,
        };
        const next = idx >= 0
          ? prev.map((c, i) => (i === idx ? updated : c))
          : [updated, ...prev];
        persistSavedChats(next);
        return next;
      });
    }, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, chatPlaces, currentChatId]);

  // History-feature handlers.
  const handleNewChat = useCallback(() => {
    abortRef.current?.abort();
    // The auto-save effect already snapshotted any messages we had
    // here, so it's safe to wipe local state.
    setMessages([]);
    setChatPlaces({});
    setChatKnownUsers({});
    setCurrentChatId(null);
    setError(null);
    setView('chat');
    setStreaming(false);
  }, []);

  const handleSelectChat = useCallback((chat: SavedChat) => {
    abortRef.current?.abort();
    setMessages(chat.messages);
    setChatPlaces(chat.chatPlaces || {});
    // Reset the user-link cache on chat switch — friends/experts from
    // userContext still linkify; only mid-conversation lookups are lost.
    setChatKnownUsers({});
    setCurrentChatId(chat.id);
    setError(null);
    setStreaming(false);
    setView('chat');
  }, []);

  const handleDeleteChat = useCallback((id: string) => {
    setSavedChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      persistSavedChats(next);
      return next;
    });
    if (currentChatId === id) {
      // The user just deleted the conversation they're currently in
      // — drop into a fresh empty chat so they can start over.
      setMessages([]);
      setChatPlaces({});
      setCurrentChatId(null);
      setError(null);
    }
  }, [currentChatId]);

  // Compute the initial desktop position when the chat first opens —
  // bottom-right with a 24px gutter, sized to match the CSS defaults
  // (400 × 560). Once positioned, drag is in charge.
  useEffect(() => {
    if (!open || phoneMode || pos) return;
    setPos({
      left: Math.max(16, window.innerWidth - 400 - 24),
      top: Math.max(16, window.innerHeight - 560 - 24),
    });
  }, [open, phoneMode, pos]);

  // Drag the header to reposition. Mouse events on the document let
  // the drag continue when the cursor leaves the island bounds.
  const onHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (phoneMode || !pos) return;
    // Ignore clicks that originated on a button (the close X, etc.)
    // so those keep working as normal click targets.
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startLeft: pos.left,
      startTop: pos.top,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = ev.clientX - dragRef.current.startX;
      const dy = ev.clientY - dragRef.current.startY;
      setPos({
        left: Math.max(0, Math.min(window.innerWidth - 80, dragRef.current.startLeft + dx)),
        top: Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.startTop + dy)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [phoneMode, pos]);

  const suggestions = useMemo(
    () => buildSuggestions(shortCityName, filters),
    [shortCityName, filters],
  );

  const placeById = useMemo(() => {
    const m = new Map<string, ScoredPlace>();
    // visible first (canonical / filtered list)…
    for (const p of visible) m.set(p.id, p);
    // …then chatPlaces (search_restaurants results)…
    for (const id in chatPlaces) {
      if (!m.has(id)) m.set(id, chatPlaces[id]);
    }
    // …then knownPlaces (synthesized from the user's rated +
    // wishlisted restaurants so cards / inline links resolve for any
    // place they've personally logged, even cross-city).
    for (const p of knownPlaces) {
      if (!m.has(p.id)) m.set(p.id, p);
    }
    return m;
  }, [visible, chatPlaces, knownPlaces]);

  /** Recipe lookup for card rendering. The user's own recipes come
   *  through `recipes` (typed Recipe[]); community recipes surfaced
   *  by search_community_recipes are stored chat-local under the
   *  CommunityRecipeHit shape (a flatter projection that includes
   *  author info). The card render branches on which field set is
   *  present, so we don't need to coerce them into the same type. */
  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe | CommunityRecipeHit>();
    for (const r of recipes) if (r?.id) m.set(r.id, r);
    for (const id in chatCommunityRecipes) {
      // Don't let community hits overwrite the user's own version
      // of a recipe — the user's own card shouldn't carry "by @them".
      if (!m.has(id)) m.set(id, chatCommunityRecipes[id]);
    }
    return m;
  }, [recipes, chatCommunityRecipes]);

  const handleNavigateRestaurant = useCallback((id: string) => {
    setOpen(false);
    // Defer the navigation a tick so the close animation has a
    // chance to play before the route swap.
    setTimeout(() => navigate(`/restaurant/${id}`), 60);
  }, [navigate]);

  const handleNavigateRecipe = useCallback((id: string) => {
    setOpen(false);
    // Resolve from the union map (user's own Recipe[] OR
    // CommunityRecipeHit[]). Three URL patterns:
    //   - Home meal community hit  → /meal/<userId>/<mealId>
    //   - Formal recipe with owner → /recipe/<userId>/<id>
    //   - Unknown / fallback       → /recipe/<id>
    const recipe = recipeById.get(id);
    let target = `/recipe/${id}`;
    if (recipe && 'source' in recipe && recipe.source === 'home_meal') {
      // Home-meal ids are prefixed "hm:<userId>:<mealId>" — strip
      // the prefix to recover the real meal id; userId is on the
      // hit object directly.
      const realMealId = id.startsWith('hm:')
        ? id.split(':').slice(2).join(':')
        : id;
      target = `/meal/${recipe.userId}/${realMealId}`;
    } else if (recipe && 'userId' in recipe && recipe.userId) {
      target = `/recipe/${recipe.userId}/${id}`;
    }
    setTimeout(() => navigate(target), 60);
  }, [navigate, recipeById]);

  const handleNavigateUser = useCallback((username: string) => {
    setOpen(false);
    setTimeout(() => navigate(`/user/${username}`), 60);
  }, [navigate]);

  // Combined linkable set for the assistant-text renderer. Includes
  // every known restaurant (visible + chatPlaces + knownPlaces from
  // the rated/wishlist synth) AND every known user (friends +
  // followed experts from userContext + anyone Claude has surfaced
  // mid-conversation via lookup_user / get_circle_ratings).
  const linkables = useMemo<InlineLinkable[]>(() => {
    const items: InlineLinkable[] = [];
    // Places — match restaurant name; tap-through to detail page.
    for (const p of placeById.values()) {
      if (!p.name || p.name.length < 3) continue;
      items.push({
        pattern: p.name,
        kind: 'place',
        navigate: () => handleNavigateRestaurant(p.id),
        className: 'lp-chat-inline-link',
      });
    }
    // Users — both '@username' and 'Display Name' patterns route to
    // the same profile page. Deduped by username so a name doesn't
    // get added once from userContext and once from chatKnownUsers.
    const userMap = new Map<string, { username: string; displayName?: string }>();
    for (const f of userContext?.friends || []) {
      if (f.username) userMap.set(f.username, { username: f.username, displayName: f.displayName });
    }
    for (const e of userContext?.followedExperts || []) {
      if (e.username) userMap.set(e.username, { username: e.username, displayName: e.displayName });
    }
    for (const k in chatKnownUsers) {
      if (!userMap.has(k)) userMap.set(k, chatKnownUsers[k]);
    }
    for (const u of userMap.values()) {
      items.push({
        pattern: '@' + u.username,
        kind: 'user',
        navigate: () => handleNavigateUser(u.username),
        className: 'lp-chat-inline-link is-user',
      });
      if (u.displayName && u.displayName.length >= 3 && u.displayName.toLowerCase() !== u.username.toLowerCase()) {
        items.push({
          pattern: u.displayName,
          kind: 'user',
          navigate: () => handleNavigateUser(u.username),
          className: 'lp-chat-inline-link is-user',
        });
      }
    }
    return items;
  }, [placeById, userContext, chatKnownUsers, handleNavigateRestaurant, handleNavigateUser]);

  // One pre-built regex for everything — O(text length) per render.
  const linkRegex = useMemo(() => buildLinkableRegex(linkables), [linkables]);

  // ── AI recipe drafts ──
  // Resolve the open draft block from `messages`. Doing this on every
  // render (instead of caching) keeps the sheet in sync with publish /
  // delete edits without any extra plumbing.
  const openDraftBlock = useMemo(() => {
    if (!openDraftToolUseId) return null;
    for (const m of messages) {
      for (const b of m.blocks) {
        if (b.type === 'recipe_draft' && b.toolUseId === openDraftToolUseId) {
          return b;
        }
      }
    }
    return null;
  }, [openDraftToolUseId, messages]);

  // Immutably patch the matching recipe_draft block. `mutator` returns
  // `null` to delete the block entirely. Empty assistant turns (e.g.
  // the AI's only output was the now-deleted draft card) are dropped
  // alongside their following user/tool_result turn so the
  // conversation doesn't render a stranded "no content" message.
  const patchDraftBlock = useCallback(
    (toolUseId: string, mutator: (b: Extract<UiBlock, { type: 'recipe_draft' }>) => UiBlock | null) => {
      setMessages((prev) => {
        let changed = false;
        const next = prev.map((m) => {
          const newBlocks: UiBlock[] = [];
          for (const b of m.blocks) {
            if (b.type === 'recipe_draft' && b.toolUseId === toolUseId) {
              const replacement = mutator(b);
              if (replacement) newBlocks.push(replacement);
              changed = true;
              continue;
            }
            newBlocks.push(b);
          }
          return { ...m, blocks: newBlocks };
        });
        if (!changed) return prev;
        // Drop any assistant turn that is now empty AND its paired
        // tool_result on the following user turn — keeps history clean
        // after a draft deletion.
        return next.filter((m, i) => {
          if (m.role === 'user' && i > 0) {
            const prevAssistant = next[i - 1];
            const prevEmpty = prevAssistant && prevAssistant.role === 'assistant' && prevAssistant.blocks.length === 0;
            if (prevEmpty) return false;
          }
          if (m.role === 'assistant' && m.blocks.length === 0) return false;
          return true;
        });
      });
    },
    [],
  );

  const handleOpenDraft = useCallback((toolUseId: string) => {
    setOpenDraftToolUseId(toolUseId);
  }, []);

  const handleCloseDraft = useCallback(() => {
    setOpenDraftToolUseId(null);
  }, []);

  const handlePublishDraft = useCallback((draft: HomeMeal) => {
    if (!openDraftToolUseId || !onPublishHomeMeal) return;
    const { id: _ignored, createdAt: _ignored2, ...payload } = draft;
    const saved = onPublishHomeMeal(payload);
    patchDraftBlock(openDraftToolUseId, (b) => ({ ...b, publishedMealId: saved.id }));
    setOpenDraftToolUseId(null);
  }, [openDraftToolUseId, onPublishHomeMeal, patchDraftBlock]);

  const handleEditDraft = useCallback((draft: HomeMeal) => {
    if (!openDraftToolUseId || !onOpenHomeMealModal) return;
    setDraftEditMarkers((prev) => ({ ...prev, [openDraftToolUseId]: Date.now() }));
    setOpen(false);
    setOpenDraftToolUseId(null);
    void Promise.resolve(onOpenHomeMealModal(draft));
  }, [openDraftToolUseId, onOpenHomeMealModal]);

  const handleDeleteDraft = useCallback(() => {
    if (!openDraftToolUseId) return;
    const id = openDraftToolUseId;
    setOpenDraftToolUseId(null);
    patchDraftBlock(id, () => null);
    setDraftEditMarkers((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [openDraftToolUseId, patchDraftBlock]);

  // When the user takes the Edit → modal → publish path, the modal's
  // own publish handler calls createHomeMeal with a fresh id (we don't
  // intercept). Match the resulting homeMeal back to the chat block
  // by name + createdAt and mark it published.
  useEffect(() => {
    if (!homeMeals || homeMeals.length === 0) return;
    const markerIds = Object.keys(draftEditMarkers);
    if (markerIds.length === 0) return;
    for (const toolUseId of markerIds) {
      const startedAt = draftEditMarkers[toolUseId];
      let draftName: string | null = null;
      let alreadyPublished = false;
      for (const m of messages) {
        for (const b of m.blocks) {
          if (b.type === 'recipe_draft' && b.toolUseId === toolUseId) {
            draftName = b.draft.name;
            if (b.publishedMealId !== null) alreadyPublished = true;
            break;
          }
        }
        if (draftName) break;
      }
      if (!draftName || alreadyPublished) {
        // Block no longer pending — clear the marker and move on.
        setDraftEditMarkers((prev) => {
          const next = { ...prev };
          delete next[toolUseId];
          return next;
        });
        continue;
      }
      const match = homeMeals.find(
        (hm) => hm.name === draftName && hm.createdAt >= startedAt - 1000,
      );
      if (match) {
        patchDraftBlock(toolUseId, (b) => ({ ...b, publishedMealId: match.id }));
        setDraftEditMarkers((prev) => {
          const next = { ...prev };
          delete next[toolUseId];
          return next;
        });
      }
    }
  }, [homeMeals, draftEditMarkers, messages, patchDraftBlock]);

  const sendTurn = useCallback(async (userText: string) => {
    setError(null);
    setStreaming(true);
    const trimmedUser = userText.trim();
    if (!trimmedUser) {
      setStreaming(false);
      return;
    }
    // Snapshot the visible pool ONCE per turn so the Edge Function
    // always sees consistent context (and Anthropic's prompt cache
    // gets a stable system block within the same filter state).
    const restaurantsForModel = buildCompactRestaurants(visible, restaurantMeta, origin);

    // Build the message history we'll send. Sanitize first — drop
    // any orphan tool_use / tool_result blocks left over from old
    // saved chats, aborted streams, or other state hiccups. The UI
    // state itself stays untouched (so the user keeps seeing their
    // cards); only the wire payload is cleaned.
    const cleanedMessages = sanitizeForAnthropic(messages);
    const baseHistory: AnthropicMessage[] = cleanedMessages.map((m) => ({
      role: m.role,
      content: uiBlocksToAnthropicContent(m.blocks),
    }));
    const userTurn: AnthropicMessage = {
      role: 'user',
      content: [{ type: 'text', text: trimmedUser }],
    };

    // Add the user turn to the UI immediately + open an empty
    // assistant turn we'll stream into.
    setMessages((prev) => [
      ...prev,
      { role: 'user', blocks: [{ type: 'text', text: trimmedUser }] },
      { role: 'assistant', blocks: [] },
    ]);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    // The agentic loop: keep round-tripping with tool_results until
    // Claude stops calling tools or we hit the safety cap.
    let convo: AnthropicMessage[] = [...baseHistory, userTurn];

    try {
      for (let turn = 0; turn < MAX_AGENTIC_TURNS; turn++) {
        const assistantBlocks: UiBlock[] = [];
        let textBlockOpen = false;
        // Every tool_use Claude emits in this streamed message —
        // recommend_restaurants AND search_restaurants. We process
        // them all after 'done' so we can await the search ones.
        const toolUsesInThisTurn: Array<{ id: string; name: string; input: unknown }> = [];

        const stream = streamLocationChat(
          {
            messages: convo,
            restaurants: restaurantsForModel,
            filters,
            city: cityDisplay,
            userContext,
            currentPath,
            currentPageLabel,
            model,
          },
          controller.signal,
        );

        let streamReachedDone = false;
        let modelCalledTools = false;

        for await (const ev of stream) {
          if (controller.signal.aborted) break;
          if (ev.type === 'text_delta') {
            if (!textBlockOpen) {
              assistantBlocks.push({ type: 'text', text: '' });
              textBlockOpen = true;
            }
            const last = assistantBlocks[assistantBlocks.length - 1];
            if (last.type === 'text') last.text += ev.delta;
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
              return next;
            });
          } else if (ev.type === 'tool_use') {
            textBlockOpen = false;
            toolUsesInThisTurn.push({ id: ev.id, name: ev.name, input: ev.input });
            if (ev.name === 'recommend_restaurants') {
              // Render cards immediately — no need to wait for 'done'.
              const input = (ev.input || {}) as { restaurant_ids?: string[]; reason?: string };
              const placeIds = Array.isArray(input.restaurant_ids)
                ? input.restaurant_ids.filter((id): id is string => typeof id === 'string')
                : [];
              const reason = typeof input.reason === 'string' ? input.reason : '';
              assistantBlocks.push({ type: 'cards', toolUseId: ev.id, placeIds, reason });
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
                return next;
              });
            } else if (ev.name === 'recommend_recipes') {
              const input = (ev.input || {}) as { recipe_ids?: string[]; reason?: string };
              const recipeIds = Array.isArray(input.recipe_ids)
                ? input.recipe_ids.filter((id): id is string => typeof id === 'string')
                : [];
              const reason = typeof input.reason === 'string' ? input.reason : '';
              assistantBlocks.push({ type: 'recipe_cards', toolUseId: ev.id, recipeIds, reason });
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
                return next;
              });
            } else if (ev.name === 'build_recipe') {
              // AI-authored recipe. Materialise immediately as a draft
              // card so the user sees the result the moment the model
              // commits — no spinner waiting for the dispatch phase.
              const input = (ev.input || {}) as BuildRecipeInput;
              const draft = buildRecipeInputToHomeMeal(input);
              if (draft) {
                assistantBlocks.push({
                  type: 'recipe_draft',
                  toolUseId: ev.id,
                  draft,
                  rawInput: ev.input,
                  publishedMealId: null,
                });
                setMessages((prev) => {
                  const next = [...prev];
                  next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
                  return next;
                });
              } else {
                // Invalid payload — fall through so the dispatch phase
                // emits a tool_result describing what's missing. Still
                // record the tool_use so the protocol stays valid.
                assistantBlocks.push({
                  type: 'tool_use',
                  toolUseId: ev.id,
                  toolName: ev.name,
                  input: ev.input,
                });
              }
            } else {
              // search_restaurants (or any future invisible tool) —
              // record the tool_use so the assistant turn round-trips
              // correctly. Card-less / no UI surface.
              assistantBlocks.push({
                type: 'tool_use',
                toolUseId: ev.id,
                toolName: ev.name,
                input: ev.input,
              });
            }
          } else if (ev.type === 'done') {
            streamReachedDone = true;
            modelCalledTools = toolUsesInThisTurn.length > 0;
            break;
          } else if (ev.type === 'error') {
            setError(ev.message);
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant' && last.blocks.length === 0) {
                return prev.slice(0, -1);
              }
              return prev;
            });
            return;
          }
        }

        if (!streamReachedDone) {
          // Stream cut off without a 'done' event (likely an abort).
          return;
        }
        if (!modelCalledTools) {
          // Final answer — exit the agentic loop.
          return;
        }

        // Process every tool use Claude emitted this turn, generating
        // a tool_result content string for each. recommend_restaurants
        // is a no-op confirm. search_restaurants actually does work:
        // hits Google Places via the parent's callback, dedupes into
        // chatPlaces (so the cards Claude renders next still resolve),
        // and returns a compact id-keyed listing back to Claude.
        const toolResultsForApi: ContentBlock[] = [];
        const toolResultsForUi: UiBlock[] = [];
        for (const tu of toolUsesInThisTurn) {
          let content = '';
          if (tu.name === 'recommend_restaurants') {
            const input = (tu.input || {}) as { restaurant_ids?: string[] };
            const ids = Array.isArray(input.restaurant_ids) ? input.restaurant_ids : [];
            content = ids.length > 0
              ? `Rendered ${ids.length} restaurant card(s) for the user.`
              : 'No restaurant ids provided.';
          } else if (tu.name === 'recommend_recipes') {
            const input = (tu.input || {}) as { recipe_ids?: string[] };
            const ids = Array.isArray(input.recipe_ids) ? input.recipe_ids : [];
            // Valid = either the user's own saved recipes OR community
            // hits we've already cached from a previous
            // search_community_recipes call this conversation.
            const valid = ids.filter((id) => recipeById.has(id));
            const invalid = ids.filter((id) => !recipeById.has(id));
            if (valid.length === 0 && invalid.length === 0) {
              content = 'No recipe ids provided.';
            } else if (valid.length === 0) {
              content = `None of the recipe ids matched the user's saved RECIPES or any cached community-recipes hits (${invalid.join(', ')}). Don't fabricate — call search_community_recipes first to get real ids, or pick from the RECIPES section.`;
            } else if (invalid.length > 0) {
              content = `Rendered ${valid.length} recipe card(s) for the user. Skipped ${invalid.length} unknown id(s): ${invalid.join(', ')}.`;
            } else {
              content = `Rendered ${valid.length} recipe card(s) for the user.`;
            }
          } else if (tu.name === 'lookup_user') {
            const input = (tu.input || {}) as { query?: string };
            const query = (input.query || '').trim();
            if (!query) {
              content = 'No query provided to lookup_user.';
            } else {
              try {
                const hits = await onLookupUser(query);
                if (!hits || hits.length === 0) {
                  content = `No users matched "${query}". Tell the user honestly that you couldn't find that person.`;
                } else {
                  // Stash for inline-link rendering so any names
                  // Claude mentions in its reply auto-link.
                  setChatKnownUsers((prev) => {
                    const next = { ...prev };
                    for (const h of hits) {
                      if (h.username) next[h.username] = { username: h.username, displayName: h.displayName };
                    }
                    return next;
                  });
                  const lines = hits.slice(0, 5).map((h, i) => {
                    const flag = h.isExpert ? ' [expert]' : '';
                    const bits = [h.displayName || h.username, h.username ? `@${h.username}` : null, h.homeCity, h.bio]
                      .filter(Boolean)
                      .join(' · ');
                    return `${i + 1}. ${bits}${flag}`;
                  }).join('\n');
                  content = `Found ${hits.length} user(s) matching "${query}":\n${lines}\n\nMention them by name in your reply — names will auto-link to their profiles.`;
                }
              } catch (err) {
                content = `User lookup for "${query}" failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'get_circle_ratings') {
            const input = (tu.input || {}) as { restaurant_id?: string };
            const rid = (input.restaurant_id || '').trim();
            if (!rid) {
              content = 'No restaurant_id provided to get_circle_ratings.';
            } else {
              try {
                const hits = await onGetCircleRatings(rid);
                if (!hits || hits.length === 0) {
                  content = 'No one in the user\'s circle has rated this restaurant. Tell the user plainly.';
                } else {
                  setChatKnownUsers((prev) => {
                    const next = { ...prev };
                    for (const h of hits) {
                      if (h.username) next[h.username] = { username: h.username, displayName: h.displayName };
                    }
                    return next;
                  });
                  const lines = hits.map((h, i) => {
                    const role = h.isExpert ? 'expert' : h.isFriend ? 'friend' : 'community';
                    const score = typeof h.score === 'number' ? `${h.score.toFixed(1)}/10` : '—';
                    const handle = h.username ? `@${h.username}` : '';
                    const noteSnippet = h.notes ? ` "${h.notes.slice(0, 60).trim()}${h.notes.length > 60 ? '…' : ''}"` : '';
                    return `${i + 1}. ${h.displayName || h.username} ${handle ? `(${handle})` : ''} — ${role} — ${score}${noteSnippet}`;
                  }).join('\n');
                  content = `${hits.length} member${hits.length === 1 ? '' : 's'} of the user's circle rated this restaurant:\n${lines}\n\nMention them by name in your reply — names will auto-link to their profiles.`;
                }
              } catch (err) {
                content = `Circle-ratings lookup failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'search_restaurants') {
            const input = (tu.input || {}) as { query?: string; city?: string };
            const query = (input.query || '').trim();
            const city = (input.city || '').trim() || undefined;
            if (!query) {
              content = 'No query provided to search_restaurants.';
            } else {
              try {
                const found = await onSearchRestaurants(query, city);
                if (!found || found.length === 0) {
                  const where = city ? ` in ${city}` : '';
                  content = `Search for "${query}"${where} returned no results. Tell the user honestly that you couldn't find anything matching that ask.`;
                } else {
                  // Stash for the card-lookup map so any IDs Claude
                  // recommends from this batch still render.
                  setChatPlaces((prev) => {
                    const next = { ...prev };
                    for (const p of found) next[p.id] = p;
                    return next;
                  });
                  const lines = found.slice(0, 10).map((p, i) => {
                    const cuisine = inferCuisineLabel(p.types);
                    const price = priceLevelToString(p.priceLevel);
                    const score = p.rating > 0 ? `${(p.rating * 2).toFixed(1)}/10` : '';
                    const meta = [cuisine, price, score].filter(Boolean).join(' · ');
                    return `${i + 1}. ${p.name}  (id: ${p.id})  ${meta}`;
                  }).join('\n');
                  content = `Search for "${query}" returned ${Math.min(found.length, 10)} matches:\n${lines}\n\nRecommend any of these via recommend_restaurants — their cards will render even though they're outside the user's current filters.`;
                }
              } catch (err) {
                content = `Search for "${query}" failed: ${err instanceof Error ? err.message : 'unknown error'}. Don't retry the same query.`;
              }
            }
          } else if (tu.name === 'search_community_recipes') {
            const input = (tu.input || {}) as { query?: string; cuisine?: string; source?: 'friends' | 'experts' | 'public' | 'all' };
            const query = (input.query || '').trim();
            const cuisine = (input.cuisine || '').trim() || undefined;
            const source = input.source || 'all';
            if (!onSearchCommunityRecipes) {
              content = 'search_community_recipes is not wired up in this context.';
            } else {
              try {
                const hits = await onSearchCommunityRecipes({ query, cuisine, source });
                if (!hits || hits.length === 0) {
                  const bits = [query, cuisine, source !== 'all' ? source : null].filter(Boolean).join(' / ');
                  content = bits
                    ? `No community recipes matched "${bits}". Tell the user honestly nothing came back across friends / experts / public — DO NOT pivot to restaurants unless they ask.`
                    : 'No community recipes available right now.';
                } else {
                  // Stash for the card-lookup map so any IDs Claude
                  // recommends from this batch resolve.
                  setChatCommunityRecipes((prev) => {
                    const next = { ...prev };
                    for (const h of hits) next[h.id] = h;
                    return next;
                  });
                  // Stash authors as known users so any name mentions
                  // in the bot's reply auto-link to their profiles.
                  setChatKnownUsers((prev) => {
                    const next = { ...prev };
                    for (const h of hits) {
                      if (h.authorUsername) {
                        next[h.authorUsername] = { username: h.authorUsername, displayName: h.authorDisplayName };
                      }
                    }
                    return next;
                  });
                  const lines = hits.slice(0, 10).map((h, i) => {
                    const totalMin = (h.prepTimeMinutes || 0) + (h.cookTimeMinutes || 0);
                    const meta = [
                      h.cuisine,
                      totalMin > 0 ? `${totalMin} min` : null,
                      h.difficulty,
                      h.authorIsFriend ? '[friend]' : h.authorIsExpert ? '[expert]' : null,
                    ].filter(Boolean).join(' · ');
                    const byline = h.authorUsername
                      ? ` — by ${h.authorDisplayName || h.authorUsername} (@${h.authorUsername})`
                      : '';
                    return `${i + 1}. ${h.title}  (id: ${h.id})  ${meta}${byline}`;
                  }).join('\n');
                  content = `Community recipes matched (${hits.length}):\n${lines}\n\nRecommend any of these via recommend_recipes — the cards will render with the author's name. You can also mention authors by username; names auto-link.`;
                }
              } catch (err) {
                content = `search_community_recipes failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'find_experts') {
            const input = (tu.input || {}) as { cuisine?: string; city?: string };
            const cuisine = (input.cuisine || '').trim() || undefined;
            const city = (input.city || '').trim() || undefined;
            if (!onFindExperts) {
              content = 'find_experts is not wired up in this context.';
            } else {
              try {
                const hits = await onFindExperts({ cuisine, city });
                if (!hits || hits.length === 0) {
                  const bits = [cuisine, city].filter(Boolean).join(' / ');
                  content = bits
                    ? `No experts matched ${bits}. Tell the user honestly nothing came back.`
                    : 'No experts available right now.';
                } else {
                  setChatKnownUsers((prev) => {
                    const next = { ...prev };
                    for (const h of hits) {
                      if (h.username) next[h.username] = { username: h.username, displayName: h.displayName };
                    }
                    return next;
                  });
                  const lines = hits.slice(0, 8).map((h, i) => {
                    const bits = [h.displayName || h.username, h.username ? `@${h.username}` : null, h.homeCity, h.bio]
                      .filter(Boolean)
                      .join(' · ');
                    return `${i + 1}. ${bits}`;
                  }).join('\n');
                  content = `Found ${hits.length} expert(s):\n${lines}\n\nMention them by name in your reply — names will auto-link to their profiles. If the user wants the full list, suggest navigate({ path: '/experts' }).`;
                }
              } catch (err) {
                content = `find_experts failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'navigate') {
            const input = (tu.input || {}) as { path?: string; label?: string };
            const path = (input.path || '').trim();
            const label = (input.label || '').trim();
            if (!path || !path.startsWith('/')) {
              content = `navigate requires an absolute path beginning with '/'. Got: "${path}".`;
            } else if (!onNavigate) {
              content = 'navigate is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onNavigate(path));
                if (res.ok) {
                  // Close the chat shortly after a successful nav so
                  // the destination page is visible. Defer one tick
                  // so the agentic loop can still finish processing
                  // any remaining tool calls in this turn cleanly.
                  setTimeout(() => setOpen(false), 80);
                  content = `Navigated to ${label || path}. The chat will close so the user can see the destination.`;
                } else {
                  content = res.detail || `Navigation to ${path} failed.`;
                }
              } catch (err) {
                content = `Navigation to ${path} failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_rating_modal') {
            const input = (tu.input || {}) as { restaurant_id?: string };
            const rid = (input.restaurant_id || '').trim();
            if (!rid) {
              content = 'open_rating_modal requires a restaurant_id.';
            } else if (!onOpenRatingModal) {
              content = 'Rating modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenRatingModal(rid));
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the rating modal for the restaurant. ${res.detail || 'The user can now rate it.'}`;
                } else {
                  content = res.detail || `Could not open the rating modal for ${rid}.`;
                }
              } catch (err) {
                content = `open_rating_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_add_restaurant_modal') {
            const input = (tu.input || {}) as { restaurant_id?: string; initial_page?: string };
            const rid = (input.restaurant_id || '').trim();
            const initialPage = (input.initial_page || '').trim() || undefined;
            if (!rid) {
              content = 'open_add_restaurant_modal requires a restaurant_id.';
            } else if (!onOpenAddRestaurantModal) {
              content = 'Add Restaurant modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenAddRestaurantModal(rid, initialPage));
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Add Restaurant flow. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || `Could not open the Add Restaurant flow for ${rid}.`;
                }
              } catch (err) {
                content = `open_add_restaurant_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_add_to_list_modal') {
            const input = (tu.input || {}) as { restaurant_id?: string };
            const rid = (input.restaurant_id || '').trim();
            if (!rid) {
              content = 'open_add_to_list_modal requires a restaurant_id.';
            } else if (!onOpenAddToListModal) {
              content = 'Add to List modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenAddToListModal(rid));
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Add-to-List picker. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || `Could not open the Add-to-List picker for ${rid}.`;
                }
              } catch (err) {
                content = `open_add_to_list_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'toggle_wishlist') {
            const input = (tu.input || {}) as { restaurant_id?: string };
            const rid = (input.restaurant_id || '').trim();
            if (!rid) {
              content = 'toggle_wishlist requires a restaurant_id.';
            } else if (!onToggleWishlist) {
              content = 'Wishlist toggle is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onToggleWishlist(rid));
                content = res.ok
                  ? (res.detail || 'Wishlist updated.')
                  : (res.detail || `Could not toggle wishlist for ${rid}.`);
              } catch (err) {
                content = `toggle_wishlist failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_add_recipe_modal') {
            if (!onOpenAddRecipeModal) {
              content = 'Add Recipe modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenAddRecipeModal());
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Add Recipe flow. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || 'Could not open the Add Recipe flow.';
                }
              } catch (err) {
                content = `open_add_recipe_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_add_post_modal') {
            if (!onOpenAddPostModal) {
              content = 'Add Post modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenAddPostModal());
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Add Post flow. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || 'Could not open the Add Post flow.';
                }
              } catch (err) {
                content = `open_add_post_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_add_reel_modal') {
            const input = (tu.input || {}) as { kind?: 'restaurant' | 'recipe' };
            if (!onOpenAddReelModal) {
              content = 'Add Reel modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenAddReelModal(input.kind));
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Add Reel flow. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || 'Could not open the Add Reel flow.';
                }
              } catch (err) {
                content = `open_add_reel_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'build_recipe') {
            const input = (tu.input || {}) as BuildRecipeInput;
            const draft = buildRecipeInputToHomeMeal(input);
            if (!draft) {
              content = 'build_recipe failed: the recipe needs a non-empty name, at least one ingredient (with a name), and at least one step. Re-call build_recipe with the missing fields filled in.';
            } else {
              content = `Recipe draft "${draft.name}" rendered as an in-chat card. The user can tap it to preview, then Publish to add it to their cookbook or Edit to fine-tune in the Advanced builder. Reply with ONE short sentence pointing the user at the card — do NOT paste the recipe text.`;
            }
          } else if (tu.name === 'open_home_meal_modal') {
            if (!onOpenHomeMealModal) {
              content = 'Add Recipe modal is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenHomeMealModal());
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Add Recipe flow. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || 'Could not open the Add Recipe flow.';
                }
              } catch (err) {
                content = `open_home_meal_modal failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else if (tu.name === 'open_guide_creator') {
            if (!onOpenGuideCreator) {
              content = 'Guide Creator is not wired up in this context.';
            } else {
              try {
                const res = await Promise.resolve(onOpenGuideCreator());
                if (res.ok) {
                  setTimeout(() => setOpen(false), 80);
                  content = `Opened the Guide Creator. ${res.detail || ''}`.trim();
                } else {
                  content = res.detail || 'Could not open the Guide Creator.';
                }
              } catch (err) {
                content = `open_guide_creator failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
              }
            }
          } else {
            content = `Unknown tool "${tu.name}".`;
          }
          toolResultsForApi.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content,
          });
          toolResultsForUi.push({
            type: 'tool_result',
            toolUseId: tu.id,
            content,
          });
        }

        // CRITICAL: persist tool_results in the React `messages` state
        // (as an invisible user turn). Without this, sending a fresh
        // user message later rebuilds the history from messages and
        // Anthropic rejects it with "tool_use ids were found without
        // tool_result blocks immediately after".
        setMessages((prev) => [
          ...prev,
          { role: 'user', blocks: toolResultsForUi },
          { role: 'assistant', blocks: [] },
        ]);

        // Add assistant turn + user(tool_results) turn to convo for
        // the next streamed iteration.
        convo = [
          ...convo,
          { role: 'assistant', content: uiBlocksToAnthropicContent(assistantBlocks) },
          { role: 'user', content: toolResultsForApi },
        ];
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [
    messages,
    visible,
    restaurantMeta,
    origin,
    filters,
    cityDisplay,
    onSearchRestaurants,
    userContext,
    onLookupUser,
    onFindExperts,
    onSearchCommunityRecipes,
    onGetCircleRatings,
    recipeById,
    currentPath,
    currentPageLabel,
    onNavigate,
    onOpenRatingModal,
    onOpenAddRestaurantModal,
    onOpenAddToListModal,
    onToggleWishlist,
    onOpenAddRecipeModal,
    onOpenAddPostModal,
    onOpenAddReelModal,
    onOpenHomeMealModal,
    onOpenGuideCreator,
  ]);

  const handleSubmit = useCallback((e?: React.FormEvent) => {
    e?.preventDefault();
    if (streaming) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    void sendTurn(text);
  }, [input, sendTurn, streaming]);

  const handleSuggestion = useCallback((s: string) => {
    if (streaming) return;
    setInput('');
    void sendTurn(s);
  }, [sendTurn, streaming]);

  const handleRetry = useCallback(() => {
    // Find the last user message and resend it.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const text = lastUser.blocks.find((b): b is { type: 'text'; text: string } => b.type === 'text')?.text;
    if (!text) return;
    // Trim back to before that user message so we re-send cleanly.
    const idx = messages.lastIndexOf(lastUser);
    setMessages(messages.slice(0, idx));
    void sendTurn(text);
  }, [messages, sendTurn]);

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="fab"
            type="button"
            className={cn('lp-chat-fab', fabAboveBottomNav && 'is-above-nav')}
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, scale: 0.85, y: 8 }}
            // Scroll-hide on mobile: while `fabHidden` is true the
            // button slips down + fades out, but stays mounted so the
            // pulse animation doesn't restart on every reveal. Click
            // events are suppressed while it's invisible.
            animate={fabHidden
              ? { opacity: 0, scale: 0.75, y: 32 }
              : { opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 8 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ pointerEvents: fabHidden ? 'none' : 'auto' }}
            aria-label="Open assistant"
            aria-hidden={fabHidden || undefined}
          >
            <span className="lp-chat-fab-pulse" aria-hidden="true" />
            <Sparkles />
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="island"
            className={cn('lp-chat-island', phoneMode && 'is-phone')}
            initial={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.94, y: 16 }}
            animate={phoneMode ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={phoneMode ? { y: '100%' } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={phoneMode
              ? { type: 'spring', damping: 28, stiffness: 300 }
              : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            {...(phoneMode ? dragProps : {})}
            style={!phoneMode && pos
              ? {
                  left: pos.left,
                  top: pos.top,
                  right: 'auto',
                  bottom: 'auto',
                }
              : undefined}
            role="dialog"
            aria-label="Restaurant assistant"
          >
            {phoneMode && (
              <div
                className="lp-chat-drag-handle"
                aria-hidden="true"
                onPointerDown={startDrag}
                style={{ touchAction: 'none' }}
              >
                <span />
              </div>
            )}

            <header
              className="lp-chat-head"
              onMouseDown={onHeaderMouseDown}
              style={!phoneMode ? { cursor: pos ? 'grab' : 'default', userSelect: 'none' } : undefined}
            >
              {view === 'history' ? (
                <button
                  type="button"
                  className="lp-chat-head-back"
                  onClick={() => setView('chat')}
                  aria-label="Back to chat"
                  title="Back to chat"
                >
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <div className="lp-chat-head-icon" aria-hidden="true">
                  <Sparkles />
                </div>
              )}
              <div className="lp-chat-head-text">
                {view === 'history' ? (
                  <>
                    <h3>Chats</h3>
                    <p>{savedChats.length === 0
                      ? 'No saved chats yet'
                      : `${savedChats.length} saved`}</p>
                  </>
                ) : (
                  <>
                    <h3>Ask a local</h3>
                    <div className="lp-chat-head-model" ref={modelMenuRef}>
                      <button
                        type="button"
                        className="lp-chat-model-pill"
                        onClick={() => setModelMenuOpen((o) => !o)}
                        aria-haspopup="listbox"
                        aria-expanded={modelMenuOpen}
                        title="Change model"
                      >
                        {model === 'auto' && <Zap size={10} strokeWidth={2.6} />}
                        <span>{MODEL_LABELS[model]}</span>
                        <ChevronDown size={11} strokeWidth={2.4} />
                      </button>
                      {modelMenuOpen && (
                        <div className="lp-chat-model-menu" role="listbox">
                          {(['auto', 'claude-sonnet-4-6', 'claude-opus-4-7'] as ChatModelPref[]).map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              role="option"
                              aria-selected={model === opt}
                              className={cn('lp-chat-model-opt', model === opt && 'is-selected')}
                              onClick={() => { setModel(opt); setModelMenuOpen(false); }}
                            >
                              <div className="lp-chat-model-opt-text">
                                <div className="lp-chat-model-opt-label">
                                  {opt === 'auto' && <Zap size={11} strokeWidth={2.4} />}
                                  <span>{MODEL_LABELS[opt]}</span>
                                </div>
                                <div className="lp-chat-model-opt-sub">{MODEL_SUBLABELS[opt]}</div>
                              </div>
                              {model === opt && <Check size={13} strokeWidth={2.4} />}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              {view === 'chat' && (
                <>
                  <button
                    type="button"
                    className="lp-chat-head-action"
                    onClick={handleNewChat}
                    aria-label="New chat"
                    title="New chat"
                  >
                    <Plus size={16} />
                  </button>
                  <button
                    type="button"
                    className="lp-chat-head-action"
                    onClick={() => setView('history')}
                    aria-label="Prior chats"
                    title="Prior chats"
                  >
                    <Clock size={16} />
                  </button>
                </>
              )}
              <button
                type="button"
                className="lp-chat-head-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </header>

            <div className={cn('lp-chat-body', view === 'history' && 'is-history')} ref={scrollRef}>
              {view === 'history' ? (
                <div className="lp-chat-history">
                  {savedChats.length === 0 ? (
                    <div className="lp-chat-history-empty">
                      <p>No prior chats yet.</p>
                      <p className="sub">Conversations save automatically — they'll appear here after you send your first message.</p>
                    </div>
                  ) : (
                    savedChats.map((chat) => (
                      <div
                        key={chat.id}
                        className={cn('lp-chat-history-item', chat.id === currentChatId && 'is-current')}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectChat(chat)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSelectChat(chat);
                          }
                        }}
                      >
                        <div className="lp-chat-history-info">
                          <h4>{chat.title}</h4>
                          <p>
                            {formatTimeAgo(chat.updatedAt)}
                            {' · '}
                            {countUserMessages(chat.messages)} message{countUserMessages(chat.messages) === 1 ? '' : 's'}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="lp-chat-history-delete"
                          onClick={(e) => { e.stopPropagation(); handleDeleteChat(chat.id); }}
                          aria-label={`Delete "${chat.title}"`}
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : (
              <>
              {messages.length === 0 && (
                <div className="lp-chat-empty">
                  <p className="lp-chat-empty-lead">
                    Ask me what to eat in {shortCityName} — I'll pick from your filtered list.
                  </p>
                  <div className="lp-chat-suggestions">
                    {suggestions.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className="lp-chat-suggestion"
                        onClick={() => handleSuggestion(s)}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m, mi) => {
                // Hide messages that have only invisible blocks (a
                // user turn full of tool_results, an assistant turn
                // that only called search_restaurants, an empty
                // pre-stream assistant slot, etc.). The persistent
                // typing indicator at the bottom of the list (below)
                // handles all the "Claude is thinking" UX, so empty
                // assistant slots don't need their own bubble.
                const hasVisibleContent = m.blocks.some(
                  (b) =>
                    (b.type === 'text' && b.text)
                    || (b.type === 'cards' && b.placeIds.length > 0)
                    || (b.type === 'recipe_cards' && b.recipeIds.length > 0)
                    || b.type === 'recipe_draft',
                );
                if (!hasVisibleContent) return null;
                return (
                <div
                  key={mi}
                  className={cn('lp-chat-msg', m.role === 'user' ? 'is-user' : 'is-assistant')}
                >
                  {m.blocks.map((b, bi) => {
                    if (b.type === 'text') {
                      if (!b.text) return null;
                      return (
                        <div key={bi} className="lp-chat-bubble">
                          {m.role === 'assistant'
                            ? renderAssistantText(b.text, linkables, linkRegex)
                            : b.text}
                        </div>
                      );
                    }
                    if (b.type === 'tool_use' || b.type === 'tool_result') {
                      // Invisible protocol blocks — stored in state for
                      // round-tripping the conversation; never rendered.
                      return null;
                    }
                    if (b.type === 'recipe_cards') {
                      if (b.recipeIds.length === 0) return null;
                      return (
                        <div key={bi} className="lp-chat-cards">
                          {b.recipeIds.map((id) => {
                            const r = recipeById.get(id);
                            if (!r) {
                              return (
                                <div key={id} className="lp-chat-card lp-chat-card-missing">
                                  Recipe not found.
                                </div>
                              );
                            }
                            const totalMin = (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0);
                            const cover = r.photos?.[0] || '';
                            // Difficulty in the new Supabase store is
                            // lowercase ('easy' / 'medium' / 'hard') —
                            // capitalize the first letter for display.
                            const difficulty = r.difficulty
                              ? r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1)
                              : '';
                            // Community recipes carry author metadata
                            // — show "by @author" so the user knows it
                            // isn't their own. The user's own recipes
                            // come through as a Recipe and have no
                            // authorUsername field.
                            const author = 'authorUsername' in r ? r.authorUsername : undefined;
                            const authorDisplay = 'authorDisplayName' in r ? r.authorDisplayName : undefined;
                            return (
                              <button
                                key={id}
                                type="button"
                                className="lp-chat-card lp-chat-card-recipe"
                                onClick={() => handleNavigateRecipe(id)}
                              >
                                <div
                                  className="lp-chat-card-recipe-cover"
                                  style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
                                  aria-hidden="true"
                                >
                                  {!cover && <ChefHat size={18} />}
                                </div>
                                <div className="lp-chat-card-info">
                                  <h4>{r.title}</h4>
                                  <p>
                                    {r.cuisine && <span className="accent">{r.cuisine}</span>}
                                    {r.cuisine && (totalMin > 0 || difficulty) && <span className="dot">·</span>}
                                    {totalMin > 0 && <span className="price">{totalMin} min</span>}
                                    {totalMin > 0 && difficulty && <span className="dot">·</span>}
                                    {difficulty && <span>{difficulty}</span>}
                                  </p>
                                  {author && (
                                    <p className="lp-chat-card-byline">
                                      by {authorDisplay || `@${author}`}
                                    </p>
                                  )}
                                </div>
                                <ChevronRight />
                              </button>
                            );
                          })}
                        </div>
                      );
                    }
                    if (b.type === 'recipe_draft') {
                      return (
                        <div key={bi} className="lp-chat-cards">
                          <RecipeDraftCard
                            draft={b.draft}
                            publishedMealId={b.publishedMealId}
                            onOpen={() => handleOpenDraft(b.toolUseId)}
                          />
                        </div>
                      );
                    }
                    // restaurant cards
                    if (b.placeIds.length === 0) return null;
                    return (
                      <div key={bi} className="lp-chat-cards">
                        {b.placeIds.map((id) => {
                          const place = placeById.get(id);
                          if (!place) {
                            return (
                              <div key={id} className="lp-chat-card lp-chat-card-missing">
                                Restaurant no longer in your filtered list.
                              </div>
                            );
                          }
                          const score = place.rating > 0 ? place.rating * 2 : 0;
                          const scoreClass = score >= 8
                            ? 'is-good'
                            : score >= 5 ? 'is-mid' : 'is-low';
                          const cuisine = inferCuisineLabel(place.types);
                          const priceLabel = priceLevelToString(place.priceLevel);
                          const placeMeta = restaurantMeta[place.id];
                          const areaLabel = formatLocationLabel(
                            placeMeta?.addressComponents,
                            place.address || '',
                            placeMeta?.neighborhood,
                          );
                          return (
                            <button
                              key={id}
                              type="button"
                              className="lp-chat-card"
                              onClick={() => handleNavigateRestaurant(id)}
                            >
                              <div className={cn('lp-chat-card-score', scoreClass)}>
                                {score > 0 ? score.toFixed(1) : '—'}
                              </div>
                              <div className="lp-chat-card-info">
                                <h4>{place.name}</h4>
                                <p>
                                  {cuisine && <span className="accent">{cuisine}</span>}
                                  {cuisine && priceLabel && <span className="dot">·</span>}
                                  {priceLabel && <span className="price">{priceLabel}</span>}
                                  {(cuisine || priceLabel) && areaLabel && <span className="dot">·</span>}
                                  {areaLabel && (
                                    <span className="area">
                                      <MapPin size={11} />
                                      {areaLabel}
                                    </span>
                                  )}
                                </p>
                              </div>
                              <ChevronRight />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
                );
              })}

              {/* Persistent typing indicator — visible the whole time
                  `streaming` is true (between user-send and final
                  message_stop), so the dots stay on screen during
                  tool calls and gaps between text deltas, not just
                  the brief pre-first-token moment. Looks like an
                  assistant bubble so it slots into the conversation
                  naturally; auto-scroll keeps it in view because
                  the existing scroll effect re-fires on `streaming`. */}
              {streaming && (
                <div className="lp-chat-msg is-assistant lp-chat-streaming-indicator">
                  <div className="lp-chat-bubble">
                    <span className="lp-chat-typing" aria-label="Assistant is responding">
                      <span /><span /><span />
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="lp-chat-error">
                  <span>{error}</span>
                  <button type="button" onClick={handleRetry} className="lp-chat-error-retry">
                    <RotateCw size={12} /> Try again
                  </button>
                </div>
              )}
              </>
              )}
            </div>

            {view === 'chat' && (
            <form className="lp-chat-foot" onSubmit={handleSubmit}>
              <textarea
                ref={inputRef}
                className="lp-chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                rows={1}
                placeholder={
                  messages.length === 0
                    ? 'Ask for a recommendation…'
                    : 'Ask a follow-up…'
                }
                disabled={streaming}
              />
              <button
                type="submit"
                className="lp-chat-send"
                disabled={streaming || !input.trim()}
                aria-label="Send"
              >
                {streaming ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
            )}
            {view === 'chat' && (
              <div className="lp-chat-foot-note">
                AI can make mistakes — verify the basics.
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <RecipeDraftSheet
        open={openDraftBlock !== null}
        draft={openDraftBlock?.draft ?? null}
        publishedMealId={openDraftBlock?.publishedMealId ?? null}
        onClose={handleCloseDraft}
        onPublish={handlePublishDraft}
        onEdit={handleEditDraft}
        onDelete={handleDeleteDraft}
      />
    </>
  );
};
