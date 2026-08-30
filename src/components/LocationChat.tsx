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
  ArrowDown,
  ArrowLeft,
  Bookmark,
  ChefHat,
  UtensilsCrossed,
  Check,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
  MapPin,
  Plus,
  RotateCw,
  Search,
  Send,
  Sparkles,
  Square,
  Star,
  Trash2,
  X,
  Zap,
  Heart,
  Gem,
  Users,
  Moon,
  Coffee,
  Info,
  CircleDollarSign,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { GlassButton, useGlassOccluder } from '../lib/glass-buttons';
import { cuisineLabel as placeCuisineLabel, labelForCuisineType } from '../lib/cuisine';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  formatLocationLabel,
  priceLevelToString,
} from '../lib/places';
import { haversineDistanceMi, formatDistance } from '../lib/distance';
import { isAllowedAppPath } from '../lib/app-routes';
import { ugc, ugcSanitize, UGC_MAX_BIO, UGC_MAX_NAME, UGC_MAX_TITLE, UGC_MAX_NOTE, UGC_MAX_HANDLE } from '../lib/ugc';
import type { RestaurantMeta, HomeMeal } from '../contexts/ListsContext';
import type { Recipe } from '../contexts/RecipesContext';
import type { ScoredPlace } from '../lib/recommendations';
import type { AssistantAttachment } from '../contexts/AssistantContext';
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
import { buildRecipeInputToHomeMeal, mergeRecipeEdit, changedFieldsInEdit, type BuildRecipeInput } from '../lib/recipe-from-ai';
import { refineRecipe, editRecipeIngredient, type IngredientEdit, type IngredientEditResult } from '../lib/build-recipe-client';
import { generateRecipeImage } from '../lib/generate-recipe-image-client';
import { uploadPhoto } from '../lib/images';
import { useAiChatHistory } from '../contexts/AiChatHistoryContext';
import { deriveChatTitle, type UiMessage, type UiBlock, type SavedChat } from '../lib/ai-chat-history';
import { logChatFeedback } from '../lib/ai-chat-feedback';

/** Cuisine for a place. One shared resolver — lib/cuisine — so this and
 *  LocationPage can't drift apart, and both get primaryType. Aliased
 *  because buildSuggestions below has its own local `cuisineLabel`. */
const inferCuisineLabel = placeCuisineLabel;

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

/** A Michelin dataset hit for the AI chat: a renderable ScoredPlace (synthetic
 *  id) enriched with its distinction label + Guide URL so the bot can both
 *  render a card and state the distinction accurately in prose. */
export type MichelinChatHit = ScoredPlace & {
  michelinDistinction: string;
  guideUrl: string;
  cuisineText: string;
  priceText: string;
};

/** Result envelope for any action tool. `ok` controls how the tool
 *  result string reads to Claude; `detail` becomes the human-readable
 *  message so the model can confirm it back to the user accurately. */
export interface ActionResult {
  ok: boolean;
  detail?: string;
}

/* ── Model picker ────────────────────────────────────────────────
   The chat can run on Sonnet 4.6, Opus 4.8, or 'auto' (server-side
   heuristic chooses per turn). Stored as a literal string so it
   round-trips through localStorage and over the wire untouched.
   The legacy 'claude-opus-4-7' pref is accepted on load and migrated
   to 4.8 so a persisted choice from before the bump still resolves. */
export type ChatModelPref = 'auto' | 'claude-sonnet-4-6' | 'claude-opus-4-8';
const CHAT_MODEL_STORAGE_KEY = 'gourmad-chat-model';
const VALID_MODEL_PREFS: readonly ChatModelPref[] = ['auto', 'claude-sonnet-4-6', 'claude-opus-4-8'];
function loadModelPref(): ChatModelPref {
  try {
    const raw = localStorage.getItem(CHAT_MODEL_STORAGE_KEY);
    if (raw === 'claude-opus-4-7') return 'claude-opus-4-8'; // migrate retired id
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
  'claude-opus-4-8': 'Opus 4.8',
};
const MODEL_SUBLABELS: Record<ChatModelPref, string> = {
  auto: 'Picks per turn',
  'claude-sonnet-4-6': 'Fast, low cost',
  'claude-opus-4-8': 'Deepest reasoning',
};

interface LocationChatProps {
  /** Drop the floating launcher, keeping the chat itself mountable. For
   *  pages with their own way in (a detail page's glass capsule). */
  hideLauncher?: boolean;
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
  /** Display-only: how many restaurants the user has rated. Feeds the
   *  empty state's "I know your N ratings" line — nothing else. */
  ratingsCount?: number;
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
  /** Query the bundled Michelin dataset (stars / Bib / Selected) for the AI
   *  chat. Returns enriched ScoredPlaces (synthetic ids) so cards render, each
   *  carrying its distinction + Guide URL. Wired to Claude's search_michelin
   *  tool. Resolved locally — no Google/web calls. */
  onSearchMichelin?: (opts: { distinctions?: string[]; city?: string; name?: string; limit?: number }) => Promise<MichelinChatHit[]>;
  /** Look up who in the user's circle (friends + followed experts)
   *  rated a specific restaurant. Wired to Claude's get_circle_ratings
   *  tool. Implemented in LocationPage off signals.communityByRestaurant. */
  onGetCircleRatings: (restaurantId: string) => Promise<AssistantUser[] | AssistantCircleRating[]>;
  /** Plot the restaurants the assistant just recommended onto the map
   *  page (markers + sidebar) and fly there. Only provided when the chat
   *  is open on the map page, so on every other page it's undefined and
   *  the map is never touched. */
  onAssistantPlaces?: (places: ScoredPlace[]) => void;

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
  /** Restaurant ids already on the user's wishlist. Read-only: the
   *  recommendation cards need to know whether their bookmark is filled,
   *  which onToggleWishlist alone can't answer. */
  savedRestaurantIds?: ReadonlySet<string>;
  /** The user's OWN score (0–10) per restaurant id, for the "You: 8.4"
   *  chip on a place they've already rated. */
  myRestaurantScores?: Record<string, number>;
  /** Open the Add Recipe flow. */
  onOpenAddRecipeModal?: () => ActionResult | Promise<ActionResult>;
  /** Open the Add Post flow. */
  onOpenAddPostModal?: () => ActionResult | Promise<ActionResult>;
  /** Open the Add Reel flow, optionally pre-selecting a kind. */
  onOpenAddReelModal?: (kind?: 'restaurant' | 'recipe') => ActionResult | Promise<ActionResult>;
  /** Open the Log Home Meal flow. */
  onOpenHomeMealModal?: (meal?: HomeMeal, opts?: { onBackToDraft?: () => void }) => ActionResult | Promise<ActionResult>;
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
  /** The search takeover is above the page at z-70; the FAB rides on it. */
  fabOverTakeover?: boolean;
  /** When true the FAB animates down + fades out (Twitter / Instagram
   *  scroll-hide). AppAssistant flips this on mobile while the user
   *  scrolls DOWN and flips it back off when they scroll UP. Always
   *  false on desktop. */
  fabHidden?: boolean;
  /** The restaurant / recipe the chat is pinned to (set from a detail
   *  page's "ask about this" button), plus the way to unpin it. */
  attachment?: AssistantAttachment | null;
  onClearAttachment?: () => void;
  /** Bumped by a page that wants the panel opened. */
  openRequest?: number;
}

// UiMessage / UiBlock / SavedChat and the history persistence helpers live
// in ../lib/ai-chat-history so they can be shared with AiChatHistoryContext
// and the Add Recipe modal's "Create with AI" flow.

/** Build the compact restaurant payload sent to the model. */
function buildCompactRestaurants(
  visible: ScoredPlace[],
  meta: Record<string, RestaurantMeta>,
  origin: { lat: number; lng: number } | null,
): CompactRestaurant[] {
  return visible.slice(0, 50).map((p) => {
    const cuisine = inferCuisineLabel(p);
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

/* ── What you'd ask next ──────────────────────────────────────────────
   Refinements offered under a finished answer, so the next turn is one
   tap instead of a sentence. Derived from what the assistant actually
   recommended rather than a fixed list: offering "Under $$" against a set
   that is already all $ reads as the assistant not having looked at its
   own answer.

   Client-side on purpose. The model could return these (an optional
   `follow_ups` on recommend_restaurants), and they'd be sharper for it —
   but that costs an Edge Function deploy, and these have to be right on
   the very next turn, offline included. They also degrade honestly: a
   chip only appears when the pool it describes exists. */
const FOLLOWUP_LIMIT = 3;

function buildFollowUps(
  places: ScoredPlace[],
  origin: { lat: number; lng: number } | null,
): string[] {
  if (places.length === 0) return [];
  const out: string[] = [];

  // Price: only offer to go cheaper when there IS something dearer here.
  const levels = places.map((p) => p.priceLevel).filter((n): n is number => typeof n === 'number' && n > 0);
  if (levels.some((n) => n >= 3)) out.push('Somewhere cheaper');

  // Distance: only when the set is genuinely spread out — against three
  // places all under half a mile, "walkable" is already the answer.
  if (origin) {
    const far = places.some((p) => haversineDistanceMi(origin.lat, origin.lng, p.lat, p.lng) > 1.2);
    if (far) out.push('Walkable from me');
  }

  // Cuisine: one note repeated three times is the case worth escaping.
  const cuisines = new Set(places.map((p) => inferCuisineLabel(p)).filter(Boolean));
  if (cuisines.size === 1) out.push('Something different');

  // Always available, and the most-asked refinement of a room.
  out.push('Somewhere quieter');
  out.push('Good for a group');
  out.push('Open late tonight');

  return out.slice(0, FOLLOWUP_LIMIT);
}

/* ── The end of an answer ─────────────────────────────────────────────
   Follow-ups to tap, and the one place the user can say the answer was
   wrong. Rendered under the LAST assistant turn only: on every turn it
   becomes furniture, and the question "was that any good?" is about the
   answer you are currently looking at. */
interface ChatAnswerFooterProps {
  followUps: string[];
  verdict?: 'up' | 'down';
  savableCount: number;
  allSaved: boolean;
  onFollowUp: (s: string) => void;
  onVerdict: (v: 'up' | 'down') => void;
  onSaveAll: () => void;
}

const ChatAnswerFooter: React.FC<ChatAnswerFooterProps> = ({
  followUps, verdict, savableCount, allSaved, onFollowUp, onVerdict, onSaveAll,
}) => (
  <div className="lp-chat-answer-foot">
    {followUps.length > 0 && (
      <div className="lp-chat-followups">
        {followUps.map((f) => (
          <button key={f} type="button" className="lp-chat-followup" onClick={() => onFollowUp(f)}>
            {f}
          </button>
        ))}
      </div>
    )}
    <div className="lp-chat-verdict">
      <button
        type="button"
        className={cn('lp-chat-verdict-btn', verdict === 'up' && 'is-on')}
        aria-pressed={verdict === 'up'}
        onClick={() => onVerdict('up')}
      >
        <ThumbsUp size={14} strokeWidth={1.9} />
        Good pick
      </button>
      <button
        type="button"
        className={cn('lp-chat-verdict-btn', verdict === 'down' && 'is-on')}
        aria-pressed={verdict === 'down'}
        onClick={() => onVerdict('down')}
      >
        <ThumbsDown size={14} strokeWidth={1.9} />
        Not for me
      </button>
      {savableCount > 0 && (
        <button
          type="button"
          className="lp-chat-verdict-btn lp-chat-saveall"
          onClick={onSaveAll}
          disabled={allSaved}
        >
          <Bookmark size={14} strokeWidth={1.9} />
          {allSaved ? 'Saved' : savableCount === 1 ? 'Save it' : 'Save all'}
        </button>
      )}
    </div>
  </div>
);

/* ── One conversation turn, memoized ─────────────────────────────────
   During a stream every token delta replaces ONLY the last message
   object; earlier turns keep their reference, so React.memo skips them
   entirely. Before this, each delta re-ran renderAssistantText (and
   the combined place/user linkRegex scan) over EVERY bubble in the
   conversation — visible jank on older phones once a chat grew long.
   All other props are referentially stable between deltas (useMemo /
   useCallback in the parent). */
interface ChatTurnProps {
  m: UiMessage;
  linkables: InlineLinkable[];
  linkRegex: RegExp | null;
  placeById: Map<string, ScoredPlace>;
  recipeById: Map<string, Recipe | CommunityRecipeHit>;
  restaurantMeta: Record<string, RestaurantMeta>;
  /** The user's OWN score per restaurant id, 0–10 — drives the "You: 8.4"
   *  chip. A place they've rated is a different kind of recommendation
   *  than one they've never been to, and the card should say so. */
  myScores: Record<string, number>;
  /** Restaurants already on the wishlist — fills the bookmark. */
  savedIds: ReadonlySet<string>;
  /** Distance origin for the card's meta line. */
  origin: { lat: number; lng: number } | null;
  onNavigateRestaurant: (id: string) => void;
  onNavigateRecipe: (id: string) => void;
  onOpenDraft: (toolUseId: string) => void;
  onToggleSave: (id: string) => void;
  /** Show this place on the map. Absent off the map page, where the
   *  action would have nowhere to go — the button hides rather than
   *  no-ops. */
  onShowOnMap?: (id: string) => void;
}

const ChatTurn = React.memo<ChatTurnProps>(({
  m, linkables, linkRegex, placeById, recipeById, restaurantMeta,
  myScores, savedIds, origin,
  onNavigateRestaurant, onNavigateRecipe, onOpenDraft, onToggleSave, onShowOnMap,
}) => {
  // Hide messages that have only invisible blocks (a user turn full of
  // tool_results, an assistant turn that only called search_restaurants,
  // an empty pre-stream assistant slot, etc.). The persistent typing
  // indicator at the bottom of the list handles all the "Claude is
  // thinking" UX, so empty assistant slots don't need their own bubble.
  const hasVisibleContent = m.blocks.some(
    (b) =>
      (b.type === 'text' && b.text)
      || (b.type === 'cards' && b.placeIds.length > 0)
      || (b.type === 'recipe_cards' && b.recipeIds.length > 0)
      || b.type === 'recipe_draft',
  );
  if (!hasVisibleContent) return null;
  return (
    <div className={cn('lp-chat-msg', m.role === 'user' ? 'is-user' : 'is-assistant')}>
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
                // Difficulty in the new Supabase store is lowercase
                // ('easy' / 'medium' / 'hard') — capitalize for display.
                const difficulty = r.difficulty
                  ? r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1)
                  : '';
                // Community recipes carry author metadata — show "by
                // @author" so the user knows it isn't their own. The
                // user's own recipes come through as a Recipe and have
                // no authorUsername field.
                const author = 'authorUsername' in r ? r.authorUsername : undefined;
                const authorDisplay = 'authorDisplayName' in r ? r.authorDisplayName : undefined;
                return (
                  <button
                    key={id}
                    type="button"
                    className="lp-chat-card lp-chat-card-recipe"
                    onClick={() => onNavigateRecipe(id)}
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
                onOpen={() => onOpenDraft(b.toolUseId)}
              />
            </div>
          );
        }
        /* ── Recommendations ──────────────────────────────────────
           Rows, not cards. The old boxed card held the name and a
           9.5px all-caps meta line in a 56px-tall bordered tile with
           the blurb exiled underneath it, so a set of three read as
           three widgets rather than one answer. Here each place gets
           room: the score as a ring, the name at reading size, one
           quiet meta line, the assistant's actual sentence about the
           place, and the two things you'd want to do next. Hairlines
           between them; no borders. */
        if (b.placeIds.length === 0) return null;
        return (
          <div key={bi} className="lp-recs">
            {b.placeIds.map((id) => {
              const place = placeById.get(id);
              const note = b.notes?.[id];
              if (!place) {
                return (
                  <div key={id} className="lp-rec lp-rec-missing">
                    Restaurant no longer in your filtered list.
                  </div>
                );
              }
              const score = place.rating > 0 ? place.rating * 2 : 0;
              const scoreClass = score >= 8
                ? 'is-good'
                : score >= 5 ? 'is-mid' : 'is-low';
              const cuisine = inferCuisineLabel(place);
              const priceLabel = priceLevelToString(place.priceLevel);
              const placeMeta = restaurantMeta[place.id];
              const areaLabel = formatLocationLabel(
                placeMeta?.addressComponents,
                place.address || '',
                placeMeta?.neighborhood,
              );
              const distMi = origin
                ? haversineDistanceMi(origin.lat, origin.lng, place.lat, place.lng)
                : null;
              // One meta line, joined by dots — assembling it here rather
              // than with interleaved separator spans means no stray
              // leading dot when a field is missing.
              const meta = [
                cuisine,
                priceLabel,
                areaLabel,
                distMi != null ? formatDistance(distMi) : '',
              ].filter(Boolean).join(' · ');
              const mine = myScores[id];
              const saved = savedIds.has(id);
              return (
                <article key={id} className="lp-rec">
                  <div className={cn('lp-rec-score', scoreClass)}>
                    {score > 0 ? score.toFixed(1) : '—'}
                  </div>
                  <div className="lp-rec-body">
                    <div className="lp-rec-head">
                      <h4>
                        <button type="button" onClick={() => onNavigateRestaurant(id)}>
                          {place.name}
                        </button>
                      </h4>
                      {typeof mine === 'number' && mine > 0 && (
                        <span className="lp-rec-you">You: {mine.toFixed(1)}</span>
                      )}
                    </div>
                    {meta && <p className="lp-rec-meta">{meta}</p>}
                    {note && <p className="lp-rec-note">{note}</p>}
                    <div className="lp-rec-actions">
                      <button type="button" onClick={() => onNavigateRestaurant(id)}>Open</button>
                      {onShowOnMap && (
                        <button type="button" onClick={() => onShowOnMap(id)}>Map</button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={cn('lp-rec-save', saved && 'is-saved')}
                    onClick={() => onToggleSave(id)}
                    aria-pressed={saved}
                    aria-label={saved ? `Remove ${place.name} from your saves` : `Save ${place.name}`}
                  >
                    <Bookmark size={16} strokeWidth={1.9} />
                  </button>
                </article>
              );
            })}
          </div>
        );
      })}
    </div>
  );
});
ChatTurn.displayName = 'ChatTurn';

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
      const highlights = b.notes
        ? Object.entries(b.notes).map(([id, note]) => ({ id, note }))
        : [];
      out.push({
        type: 'tool_use',
        id: b.toolUseId,
        name: 'recommend_restaurants',
        input: {
          restaurant_ids: b.placeIds,
          reason: b.reason || '',
          ...(highlights.length ? { highlights } : {}),
        },
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

interface ChatSuggestion { prompt: string; title: string; subtitle: string; icon: React.ReactNode; }

/** The starter deck rotates: each open of the chat (and each new chat)
 *  advances a persisted counter, and the four visible cards are a sliding
 *  window over the pool below — so the page never greets you with the
 *  same four twice in a row. */
const STARTER_ROT_KEY = 'gourmad-chat-starter-rot';
function nextStarterSeed(): number {
  try {
    const n = ((parseInt(localStorage.getItem(STARTER_ROT_KEY) || '0', 10) || 0) + 1) % 10000;
    localStorage.setItem(STARTER_ROT_KEY, String(n));
    return n;
  } catch { return Math.floor(Math.random() * 16); }
}
function pickStarters(pool: ChatSuggestion[], seed: number): ChatSuggestion[] {
  if (pool.length <= 4) return pool;
  const start = (seed * 4) % pool.length;
  return Array.from({ length: 4 }, (_, i) => pool[(start + i) % pool.length]);
}

/** Suggestion-card pool for the empty state. Every slot derives from the
 *  live context — active cuisine/neighborhood/price filters plus time of
 *  day — so the cards read as "about this search", not boilerplate.
 *  `prompt` is sent to the model; `title` / `subtitle` / `icon` drive the
 *  card. Order matters: the first four are the strongest, and rotation
 *  walks the ring from there. */
function buildSuggestions(shortCity: string, filters: ChatFilters): ChatSuggestion[] {
  const cuisineLabel = labelForCuisineType(filters.cuisines?.[0]);
  const cuisineLc = cuisineLabel.toLowerCase();
  const hood = filters.neighborhoods?.[0] || '';
  const area = hood || shortCity;
  const priceTier = filters.price && filters.price >= 1 && filters.price <= 4 ? filters.price : 0;
  const priceSigns = priceTier > 0 ? '$'.repeat(priceTier) : '';
  // Meal slot from the device clock — the user is usually planning the
  // next meal, not an abstract one.
  const hour = new Date().getHours();
  const meal = hour < 11
    ? { key: 'breakfast', title: 'Breakfast', subtitle: 'morning spots' }
    : hour < 15
      ? { key: 'lunch', title: 'Lunch now', subtitle: 'good for midday' }
      : hour < 22
        ? { key: 'dinner tonight', title: 'Dinner tonight', subtitle: 'evening picks' }
        : { key: 'late-night food', title: 'Late night', subtitle: 'still serving' };
  return [
    cuisineLabel
      ? { prompt: `Best ${cuisineLc} spots in ${area}`, title: `Best ${cuisineLabel}`, subtitle: `top picks in ${area}`, icon: <Sparkles size={14} strokeWidth={1.9} /> }
      : { prompt: `Best date night spots in ${area}`, title: 'Date night', subtitle: 'somewhere worth dressing for', icon: <Heart size={14} strokeWidth={1.9} /> },
    {
      prompt: `Hidden gems most people miss in ${area}`,
      title: 'Hidden gems',
      subtitle: hood ? `underrated in ${hood}` : 'underrated local favorites',
      icon: <Gem size={14} strokeWidth={1.9} />,
    },
    {
      prompt: `Where should I go for ${meal.key}${cuisineLc ? ` — ideally ${cuisineLc}` : ''} in ${area}?`,
      title: meal.title,
      subtitle: cuisineLabel ? `${meal.subtitle} · ${cuisineLabel}` : meal.subtitle,
      icon: <Clock size={14} strokeWidth={1.9} />,
    },
    priceTier > 0
      ? { prompt: `Best ${priceSigns} ${cuisineLc || 'restaurants'} in ${area}`, title: `Best ${priceSigns}`, subtitle: 'matches your price filter', icon: <CircleDollarSign size={14} strokeWidth={1.9} /> }
      : { prompt: `Something quick under $20 in ${area}`, title: 'Under $20', subtitle: 'quick and budget-friendly', icon: <CircleDollarSign size={14} strokeWidth={1.9} /> },
    {
      prompt: `What have people I follow rated highly recently?`,
      title: 'This week',
      subtitle: 'what your people just rated',
      icon: <Users size={14} strokeWidth={1.9} />,
    },
    {
      prompt: `Where's still serving late tonight in ${area}?`,
      title: 'Open late',
      subtitle: 'kitchens running past eleven',
      icon: <Moon size={14} strokeWidth={1.9} />,
    },
    {
      prompt: `Best brunch in ${area}`,
      title: 'Brunch',
      subtitle: 'weekend-morning picks',
      icon: <Coffee size={14} strokeWidth={1.9} />,
    },
    {
      prompt: `Somewhere special worth a trip in ${area}`,
      title: 'Worth the trip',
      subtitle: 'destination meals nearby',
      icon: <MapPin size={14} strokeWidth={1.9} />,
    },
    {
      prompt: `What are the local classics ${shortCity} is actually known for?`,
      title: 'Local classics',
      subtitle: `what ${shortCity} does best`,
      icon: <Star size={14} strokeWidth={1.9} />,
    },
  ];
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
  ratingsCount,
  filters,
  origin,
  onSearchRestaurants,
  onSearchMichelin,
  userContext,
  onLookupUser,
  onFindExperts,
  onSearchCommunityRecipes,
  onGetCircleRatings,
  onAssistantPlaces,
  savedRestaurantIds,
  myRestaurantScores,
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
  attachment,
  onClearAttachment,
  openRequest,
  hideLauncher,
  fabAboveBottomNav,
  fabOverTakeover,
  fabHidden,
}) => {
  const navigate = useNavigate();
  const { phoneMode, setHideBottomNav } = useSettings();
  const { user: authUser } = useAuth();
  const { showToast } = useToast();

  const [open, setOpen] = useState(false);
  // A detail page asked for the panel. Signal, not a controlled prop: the
  // chat still owns `open`, so asking again while it's up changes nothing
  // and the user can still close it.
  const firstOpenRequest = useRef(openRequest ?? 0);
  useEffect(() => {
    if (openRequest === undefined) return;
    if (openRequest === firstOpenRequest.current) return;
    firstOpenRequest.current = openRequest;
    setOpen(true);
  }, [openRequest]);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  // Elapsed seconds since the current streaming turn started. Drives
  // the "Thinking… 5s" label so the user has visible feedback that
  // the AI is still actively working during long recipe builds.
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Tick once per second while a turn is streaming. Reset on every
  // start so a new turn always begins at 0.
  useEffect(() => {
    if (!streaming) {
      setStreamElapsed(0);
      return;
    }
    const started = Date.now();
    setStreamElapsed(0);
    const interval = setInterval(() => {
      setStreamElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [streaming]);

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
  // subsequent change. The savedChats list itself lives in
  // AiChatHistoryContext (localStorage cache + Supabase cross-device
  // sync); this component just reads it and upserts/deletes entries.
  const [view, setView] = useState<'chat' | 'history'>('chat');
  // Starter-deck rotation — advances on every open and every new chat.
  const [starterSeed, setStarterSeed] = useState(0);
  useEffect(() => { if (open) setStarterSeed(nextStarterSeed()); }, [open]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  // Free-text filter for the saved-chats list (history view).
  const [historyQuery, setHistoryQuery] = useState('');
  const { savedChats, upsertChat, deleteChat } = useAiChatHistory();
  // Saved chats narrowed by the history search box (matches the title —
  // which is the user's opening prompt, so it covers what's on screen).
  const filteredChats = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    if (!q) return savedChats;
    return savedChats.filter((c) => (c.title || '').toLowerCase().includes(q));
  }, [savedChats, historyQuery]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Mirror the latest conversation into refs so we can persist it on unmount
  // / panel-close even if the debounce hasn't fired. AppAssistant unmounts
  // this component on hidden routes and sign-out, so without a flush a chat
  // created in the last ~600ms would never reach localStorage (or the cloud).
  const messagesRef = useRef(messages);
  const chatPlacesRef = useRef(chatPlaces);
  const currentChatIdRef = useRef(currentChatId);
  const saveDirtyRef = useRef(false);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { chatPlacesRef.current = chatPlaces; }, [chatPlaces]);
  useEffect(() => { currentChatIdRef.current = currentChatId; }, [currentChatId]);

  // Persist the in-progress conversation immediately (cancels the pending
  // debounce). Safe to call when nothing's dirty — it no-ops. Reads from
  // refs so it works from an unmount cleanup.
  const flushSave = useCallback(() => {
    if (!saveDirtyRef.current || messagesRef.current.length === 0) return;
    saveDirtyRef.current = false;
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    let id = currentChatIdRef.current;
    if (!id) {
      id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      currentChatIdRef.current = id;
      setCurrentChatId(id);
    }
    upsertChat({ id, title: deriveChatTitle(messagesRef.current), messages: messagesRef.current, chatPlaces: chatPlacesRef.current });
  }, [upsertChat]);

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
  // The panel covers the page it was opened over, so every glass control
  // underneath has to stand down — those are drawn natively, ABOVE the
  // WebView, and would otherwise pile onto the panel's own header buttons
  // in the same corner. Declared rather than left to the hit-test probe,
  // which was missing the tab roots' header capsule.
  const islandRef = useGlassOccluder();

  // Hide the bottom-nav on phone while the chat sheet is up.
  useEffect(() => {
    if (!phoneMode) return;
    setHideBottomNav(open);
    return () => setHideBottomNav(false);
  }, [open, phoneMode, setHideBottomNav]);

  // "Jump to latest" pill — shown when new content is streaming in while
  // the user is scrolled up off the bottom (pinned-off), hidden the moment
  // they return to the bottom (by tap or by scrolling).
  const [showJump, setShowJump] = useState(false);
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    // rAF so a state update queued this tick (e.g. the just-sent user
    // message) has painted before we measure scrollHeight.
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  // Autoscroll to the bottom as messages grow / stream — but only when the
  // user is already near the bottom. This effect fires on every streamed
  // token; unconditionally pinning made it impossible to scroll up and
  // re-read earlier messages during a long streaming answer.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) el.scrollTop = el.scrollHeight;
    else if (streaming) setShowJump(true);
  }, [messages, streaming]);

  // Retire the pill as soon as the user scrolls back to the bottom
  // themselves. Re-bound per open/view because the scroller only exists
  // while the chat view is mounted.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) setShowJump(false);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [open, view]);

  // Focus the input when the chat opens — desktop only. On phones we
  // deliberately DON'T auto-focus: doing so pops the on-screen keyboard up
  // while the panel is still sliding in, and the keyboard resize fights the
  // slide animation, making the whole thing glitch. The user taps the field
  // to type when they're ready.
  useEffect(() => {
    if (!open || phoneMode) return;
    const t = setTimeout(() => inputRef.current?.focus(), 220);
    return () => clearTimeout(t);
  }, [open, phoneMode]);

  // Abort any in-flight request when the component unmounts.
  useEffect(() => () => {
    abortRef.current?.abort();
  }, []);

  // Autosize the composer with its content, up to ~4 lines (the CSS
  // max-height caps it; past that it scrolls internally). rows={1} alone
  // never grew, so multi-line prompts scrolled invisibly in a single row.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
  }, [input, open, view]);

  // Always land in the live-chat view when the panel opens —
  // history view is a navigation destination, not a default.
  useEffect(() => {
    if (open) setView('chat');
  }, [open]);

  // Auto-save the current conversation on any change. Debounced so
  // streaming text deltas don't trigger one write per token; one save
  // fires ~600ms after activity settles, and flushSave() guarantees a
  // final write on panel-close / unmount.
  useEffect(() => {
    if (messages.length === 0) return;
    saveDirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushSave, 600);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [messages, chatPlaces, currentChatId, flushSave]);

  // Flush immediately when the panel closes, and once on unmount — so a
  // conversation survives closing the chat or navigating to a route where
  // the assistant is hidden, not just the 600ms debounce.
  useEffect(() => { if (!open) flushSave(); }, [open, flushSave]);
  useEffect(() => () => flushSave(), [flushSave]);

  // History-feature handlers.
  const handleNewChat = useCallback(() => {
    // Flush BEFORE wiping: the auto-save is debounced ~600ms, and once
    // messages go empty its effect early-returns (cleanup already cleared
    // the pending timer) while flushSave itself no-ops on an empty
    // messagesRef — so an answer that just finished streaming would be
    // silently lost. flushSave reads from refs, which still hold the
    // pre-wipe conversation at this point.
    flushSave();
    abortRef.current?.abort();
    setMessages([]);
    setChatPlaces({});
    setChatKnownUsers({});
    setCurrentChatId(null);
    setError(null);
    setView('chat');
    setStreaming(false);
    setStarterSeed(nextStarterSeed());
  }, [flushSave]);

  const handleSelectChat = useCallback((chat: SavedChat) => {
    // Same as handleNewChat: persist the outgoing conversation before
    // replacing it, or its last ~600ms of activity never gets saved.
    flushSave();
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
  }, [flushSave]);

  const handleDeleteChat = useCallback((id: string) => {
    deleteChat(id);
    if (currentChatId === id) {
      // The user just deleted the conversation they're currently in
      // — drop into a fresh empty chat so they can start over.
      setMessages([]);
      setChatPlaces({});
      setCurrentChatId(null);
      setError(null);
    }
  }, [currentChatId, deleteChat]);

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
    () => pickStarters(buildSuggestions(shortCityName, filters), starterSeed),
    [shortCityName, filters, starterSeed],
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

  // ── Drive the map page when the assistant recommends restaurants ──
  // On the map page (where `onAssistantPlaces` is wired) we hand the
  // latest recommend_restaurants result to the page so it can swap the
  // markers + sidebar to exactly those places and fly there. We wait for
  // the turn to finish streaming so search_restaurants results have
  // settled into chatPlaces (and thus placeById). A ref de-dupes so the
  // same block isn't re-plotted; the first settle just adopts whatever
  // history is already loaded without moving the map.
  const lastPlottedCardsRef = useRef<string | null>(null);
  const plotInitializedRef = useRef(false);
  useEffect(() => {
    if (!onAssistantPlaces || streaming) return;
    let latest: { toolUseId: string; placeIds: string[] } | null = null;
    for (let i = messages.length - 1; i >= 0 && !latest; i--) {
      const msg = messages[i];
      if (msg.role !== 'assistant') continue;
      for (let j = msg.blocks.length - 1; j >= 0; j--) {
        const b = msg.blocks[j];
        if (b.type === 'cards' && b.placeIds.length > 0) {
          latest = { toolUseId: b.toolUseId, placeIds: b.placeIds };
          break;
        }
      }
    }
    if (!latest) { plotInitializedRef.current = true; return; }
    if (!plotInitializedRef.current) {
      // First settle — adopt any restored history without moving the map.
      lastPlottedCardsRef.current = latest.toolUseId;
      plotInitializedRef.current = true;
      return;
    }
    if (lastPlottedCardsRef.current === latest.toolUseId) return;
    const places = latest.placeIds
      .map((id) => placeById.get(id))
      .filter((p): p is ScoredPlace => !!p);
    if (places.length === 0) return;
    lastPlottedCardsRef.current = latest.toolUseId;
    onAssistantPlaces(places);
  }, [streaming, messages, placeById, onAssistantPlaces]);

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

  /* ── Card actions ────────────────────────────────────────────────── */

  const emptySaved = useMemo(() => new Set<string>(), []);
  const savedIds = savedRestaurantIds ?? emptySaved;
  const emptyScores = useMemo(() => ({}), []);
  const myScores = myRestaurantScores ?? emptyScores;

  const handleToggleSave = useCallback((id: string) => {
    if (!onToggleWishlist) { showToast('Saving is not available here.'); return; }
    // Optimism belongs to whoever owns the wishlist — savedIds comes back
    // down as a prop, so the bookmark fills when the write lands.
    void Promise.resolve(onToggleWishlist(id));
  }, [onToggleWishlist, showToast]);

  /** Put one recommendation on the map. Only wired on the map page; the
   *  button doesn't render anywhere else. */
  const handleShowOnMap = useMemo(() => {
    if (!onAssistantPlaces) return undefined;
    return (id: string) => {
      const place = placeById.get(id);
      if (!place) return;
      onAssistantPlaces([place]);
      setOpen(false);
    };
  }, [onAssistantPlaces, placeById]);

  /* ── Was that any good? ──────────────────────────────────────────────
     The verdict is stored on the message (so re-opening the chat still
     shows it) and written to ai_chat_feedback (migration 077), which is
     the collected data. Tapping the same thumb again clears the UI state
     but doesn't write — an un-rating isn't a verdict, and the table is
     append-only. */
  const sessionKeyRef = useRef(`s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

  const handleVerdict = useCallback((index: number, verdict: 'up' | 'down') => {
    let recorded: 'up' | 'down' | undefined;
    setMessages((prev) => prev.map((m, i) => {
      if (i !== index) return m;
      const next = m.feedback === verdict ? undefined : verdict;
      recorded = next;
      return { ...m, feedback: next };
    }));
    if (!recorded) return;
    const msg = messagesRef.current[index];
    const ids = (msg?.blocks ?? []).flatMap((b) => (b.type === 'cards' ? b.placeIds : []));
    logChatFeedback({
      verdict: recorded,
      turnKey: `${currentChatIdRef.current || sessionKeyRef.current}:${index}`,
      restaurantIds: ids,
      userId: authUser?.id ?? null,
    });
    showToast(recorded === 'up' ? 'Thanks — noted.' : 'Thanks — I\u2019ll aim differently.');
  }, [showToast, authUser?.id]);

  /** Save every recommendation in the turn that isn't saved already.
   *  Toggling blindly would UN-save the ones the user had kept. */
  const handleSaveAll = useCallback((ids: string[]) => {
    if (!onToggleWishlist) { showToast('Saving is not available here.'); return; }
    const fresh = ids.filter((id) => !savedIds.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => { void Promise.resolve(onToggleWishlist(id)); });
    showToast(fresh.length === 1 ? 'Saved.' : `Saved ${fresh.length} places.`);
  }, [onToggleWishlist, savedIds, showToast]);

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
    showToast('Recipe published', { variant: 'success' });
    // Close the chat panel and land on the saved recipe page. Small
    // delay so the close + sheet exit animations have time to play
    // before the route changes — matches the AddHomeMealModal flow.
    setOpen(false);
    const ownerId = authUser?.id;
    if (ownerId && saved?.id) {
      setTimeout(() => navigate(`/recipe/${ownerId}/${saved.id}`), 80);
    }
  }, [openDraftToolUseId, onPublishHomeMeal, patchDraftBlock, showToast, authUser?.id, navigate]);

  const handleEditDraft = useCallback((draft: HomeMeal) => {
    if (!openDraftToolUseId || !onOpenHomeMealModal) return;
    const toolUseId = openDraftToolUseId;
    setDraftEditMarkers((prev) => ({ ...prev, [toolUseId]: Date.now() }));
    setOpen(false);
    setOpenDraftToolUseId(null);
    // Pass a "back to AI draft" callback so the Advanced builder can
    // bounce the user back here: reopen the chat and the draft sheet.
    void Promise.resolve(onOpenHomeMealModal(draft, {
      onBackToDraft: () => { setOpen(true); setOpenDraftToolUseId(toolUseId); },
    }));
  }, [openDraftToolUseId, onOpenHomeMealModal]);

  const handleCoverPhotoChange = useCallback((dataUrl: string | null) => {
    if (!openDraftToolUseId) return;
    const toolUseId = openDraftToolUseId;
    patchDraftBlock(toolUseId, (b) => ({
      ...b,
      draft: {
        ...b.draft,
        coverPhoto: dataUrl || undefined,
        photos: dataUrl
          ? Array.from(new Set([dataUrl, ...(b.draft.photos || [])]))
          : (b.draft.photos || []).filter((p) => p !== b.draft.coverPhoto),
      },
    }));
    // The sheet uploads before calling us, so it normally hands over a short
    // Storage URL; a data: URL means that upload FAILED (offline, signed
    // out) and the image is riding inline. Left that way it gets persisted
    // whole into localStorage + the cloud JSONB row — one image is hundreds
    // of KB, enough to trip persistSavedChats' quota fallback and silently
    // evict the oldest chats. The image is applied above regardless (it must
    // render now); here we retry the upload and swap the inline payload for
    // the URL once it lands. Anything that stays inline past this (still
    // offline) is caught by the saved-history migration in
    // AiChatHistoryContext.
    if (!dataUrl || !dataUrl.startsWith('data:')) return;
    void uploadPhoto(dataUrl)
      .then((storedUrl) => {
        patchDraftBlock(toolUseId, (b) => ({
          ...b,
          draft: {
            ...b.draft,
            coverPhoto: b.draft.coverPhoto === dataUrl ? storedUrl : b.draft.coverPhoto,
            photos: ((b.draft.photos || []) as unknown as string[]).map((p) => (p === dataUrl ? storedUrl : p)) as never,
          },
        }));
      })
      .catch(() => { /* still offline / signed out — migration retries later */ });
  }, [openDraftToolUseId, patchDraftBlock]);

  // Refine the open draft with a free-text AI instruction from the
  // preview sheet. Runs a stateless build-recipe edit call and
  // patches the block in place — both the draft (so the sheet + card
  // refresh) and the rawInput (so the chat conversation round-trips
  // the latest version back to the model).
  const handleRefineDraft = useCallback(async (instruction: string): Promise<{ ok: boolean; error?: string }> => {
    if (!openDraftToolUseId) return { ok: false, error: 'No recipe to refine.' };
    const current = openDraftBlock?.draft;
    if (!current) return { ok: false, error: 'No recipe to refine.' };
    const res = await refineRecipe(current, instruction);
    if (res.ok && res.meal) {
      patchDraftBlock(openDraftToolUseId, (b) => ({
        ...b,
        draft: res.meal!,
        rawInput: res.recipe ?? b.rawInput,
      }));
      return { ok: true };
    }
    return { ok: false, error: res.error };
  }, [openDraftToolUseId, openDraftBlock, patchDraftBlock]);

  // Remove or substitute one ingredient in the open draft. Patches both the
  // draft and the rawInput (like a refine) so the conversation round-trips
  // the latest version. The AI may decline — the sheet shows its reason and
  // the draft stays untouched.
  const handleIngredientEditDraft = useCallback(async (edit: IngredientEdit): Promise<IngredientEditResult> => {
    if (!openDraftToolUseId) return { ok: false, error: 'No recipe to update.' };
    const current = openDraftBlock?.draft;
    if (!current) return { ok: false, error: 'No recipe to update.' };
    const res = await editRecipeIngredient(current, edit);
    if (res.ok && res.meal) {
      patchDraftBlock(openDraftToolUseId, (b) => ({
        ...b,
        draft: res.meal!,
        rawInput: res.recipe ?? b.rawInput,
      }));
    }
    return res;
  }, [openDraftToolUseId, openDraftBlock, patchDraftBlock]);

  // Generate an AI hero photo of the finished dish for the open draft. The
  // preview sheet compresses the result and applies it through
  // handleCoverPhotoChange (same path as an uploaded cover photo).
  const handleGenerateDraftImage = useCallback(async (): Promise<{ ok: boolean; dataUrl?: string; error?: string }> => {
    const current = openDraftBlock?.draft;
    if (!current) return { ok: false, error: 'No recipe to picture yet.' };
    return generateRecipeImage(current);
  }, [openDraftBlock]);

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

  // `historyOverride` replaces the closure `messages` as the wire history
  // for this turn. handleRetry needs it: it trims the failed user turn out
  // of state, but that slice isn't visible here until the next render — the
  // closure still ends with the original user turn, so building baseHistory
  // from it would put the question on the wire twice in a row (which the
  // API's role-alternation rules can reject — a 400 on the exact flow retry
  // exists to recover from).
  const sendTurn = useCallback(async (userText: string, historyOverride?: UiMessage[]) => {
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
    const cleanedMessages = sanitizeForAnthropic(historyOverride ?? messages);
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
            attachment: attachment ?? undefined,
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
              const input = (ev.input || {}) as {
                restaurant_ids?: string[];
                reason?: string;
                highlights?: Array<{ id?: string; note?: string }>;
              };
              const placeIds = Array.isArray(input.restaurant_ids)
                ? input.restaurant_ids.filter((id): id is string => typeof id === 'string')
                : [];
              const reason = typeof input.reason === 'string' ? input.reason : '';
              // Map each per-restaurant highlight to its card by id.
              const notes: Record<string, string> = {};
              if (Array.isArray(input.highlights)) {
                for (const h of input.highlights) {
                  if (h && typeof h.id === 'string' && typeof h.note === 'string' && h.note.trim()) {
                    notes[h.id] = h.note.trim();
                  }
                }
              }
              assistantBlocks.push({ type: 'cards', toolUseId: ev.id, placeIds, reason, notes });
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
              console.log('[build_recipe] tool_use event input:', input);
              const draft = buildRecipeInputToHomeMeal(input);
              if (draft) {
                console.log(`[build_recipe] card pushed: "${draft.name}"`);
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
                console.warn('[build_recipe] tool_use rejected — no usable name in input');
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
          // No tools, no visible content — almost always max_tokens
          // truncation mid-output. Surface a friendly message so the
          // user isn't staring at an empty chat.
          const hasAnyVisible = assistantBlocks.some(
            (b) =>
              (b.type === 'text' && b.text.trim().length > 0)
              || b.type === 'cards'
              || b.type === 'recipe_cards'
              || b.type === 'recipe_draft',
          );
          if (!hasAnyVisible) {
            assistantBlocks.push({
              type: 'text',
              text: "Sorry — I ran out of room before I could finish that. Try asking again, or be a bit more specific.",
            });
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
              return next;
            });
          }
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
                    const bits = [
                      ugc(h.displayName || h.username, UGC_MAX_NAME),
                      h.username ? `@${ugcSanitize(h.username, UGC_MAX_HANDLE)}` : null,
                      h.homeCity ? ugc(h.homeCity, UGC_MAX_NAME) : null,
                      h.bio ? ugc(h.bio, UGC_MAX_BIO) : null,
                    ].filter(Boolean).join(' · ');
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
                    const handle = h.username ? `@${ugcSanitize(h.username, UGC_MAX_HANDLE)}` : '';
                    const noteSnippet = h.notes ? ` ${ugc(h.notes, UGC_MAX_NOTE)}` : '';
                    return `${i + 1}. ${ugc(h.displayName || h.username, UGC_MAX_NAME)} ${handle ? `(${handle})` : ''} — ${role} — ${score}${noteSnippet}`;
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
                    const cuisine = inferCuisineLabel(p);
                    const price = priceLevelToString(p.priceLevel);
                    const score = p.rating > 0 ? `${(p.rating * 2).toFixed(1)}/10` : '';
                    const meta = [cuisine, price, score].filter(Boolean).join(' · ');
                    return `${i + 1}. ${ugc(p.name, UGC_MAX_NAME)}  (id: ${p.id})  ${meta}`;
                  }).join('\n');
                  content = `Search for "${query}" returned ${Math.min(found.length, 10)} matches:\n${lines}\n\nRecommend any of these via recommend_restaurants — their cards will render even though they're outside the user's current filters.`;
                }
              } catch (err) {
                content = `Search for "${query}" failed: ${err instanceof Error ? err.message : 'unknown error'}. Don't retry the same query.`;
              }
            }
          } else if (tu.name === 'search_michelin') {
            const input = (tu.input || {}) as { distinctions?: string[]; city?: string; name?: string; limit?: number };
            if (!onSearchMichelin) {
              content = 'search_michelin is not available in this context. Fall back to general knowledge or web_search.';
            } else {
              try {
                const hits = await onSearchMichelin({
                  distinctions: Array.isArray(input.distinctions) ? input.distinctions : undefined,
                  city: (input.city || '').trim() || undefined,
                  name: (input.name || '').trim() || undefined,
                  limit: typeof input.limit === 'number' ? input.limit : undefined,
                });
                if (!hits || hits.length === 0) {
                  const what = input.name
                    ? `"${input.name}"`
                    : [(input.distinctions || []).join('/'), input.city].filter(Boolean).join(' in ');
                  content = `No Michelin Guide restaurants matched ${what || 'that query'}. If the user asked whether a specific place has a distinction and it's not in the dataset, tell them it isn't currently in the Michelin Guide (the dataset is complete/authoritative).`;
                } else {
                  // Stash as renderable places so recommend_restaurants cards
                  // resolve via placeById.
                  setChatPlaces((prev) => {
                    const next = { ...prev };
                    for (const h of hits) next[h.id] = h;
                    return next;
                  });
                  const lines = hits.map((h, i) => {
                    const meta = [h.michelinDistinction, h.cuisineText, h.priceText].filter(Boolean).join(' · ');
                    return `${i + 1}. ${ugc(h.name, UGC_MAX_NAME)}  (id: ${h.id})  ${meta}`;
                  }).join('\n');
                  content = `Michelin Guide dataset returned ${hits.length} restaurant(s):\n${lines}\n\nThis is the complete, authoritative list — present ALL of them to the user (don't trim) and render cards via recommend_restaurants using these ids. Their distinction is shown above; state it accurately. Only use web_search if you need extra detail not in this data.`;
                }
              } catch (err) {
                content = `search_michelin failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
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
                      h.cuisine ? ugc(h.cuisine, UGC_MAX_NAME) : null,
                      totalMin > 0 ? `${totalMin} min` : null,
                      h.difficulty,
                      h.authorIsFriend ? '[friend]' : h.authorIsExpert ? '[verified]' : null,
                    ].filter(Boolean).join(' · ');
                    const byline = h.authorUsername
                      ? ` — by ${ugc(h.authorDisplayName || h.authorUsername, UGC_MAX_NAME)} (@${ugcSanitize(h.authorUsername, UGC_MAX_HANDLE)})`
                      : '';
                    return `${i + 1}. ${ugc(h.title, UGC_MAX_TITLE)}  (id: ${h.id})  ${meta}${byline}`;
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
                    const bits = [
                      ugc(h.displayName || h.username, UGC_MAX_NAME),
                      h.username ? `@${ugcSanitize(h.username, UGC_MAX_HANDLE)}` : null,
                      h.homeCity ? ugc(h.homeCity, UGC_MAX_NAME) : null,
                      h.bio ? ugc(h.bio, UGC_MAX_BIO) : null,
                    ].filter(Boolean).join(' · ');
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
            if (!isAllowedAppPath(path)) {
              // Whitelist against the real route table — not just a '/' prefix
              // — so injected content can't steer the user off-app or to a
              // made-up route.
              content = `navigate refused: "${path}" is not a known in-app page. Use one of the documented routes.`;
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
            console.log('[build_recipe] dispatch input:', input);
            const draft = buildRecipeInputToHomeMeal(input);
            if (!draft) {
              content = 'build_recipe failed: the recipe needs a `name` at minimum. Re-call build_recipe with a name and as much detail as you have (ingredients, steps, timing).';
            } else {
              const ingredientCount = draft.ingredients?.length || 0;
              const stepCount = (draft.stepDetails?.length || draft.steps?.length || 0);
              console.log(`[build_recipe] rendered "${draft.name}" — ${ingredientCount} ingredients, ${stepCount} steps`);
              content = `Recipe draft "${draft.name}" rendered as an in-chat card (${ingredientCount} ingredients, ${stepCount} steps). The user can tap it to preview, then Publish to add it to their cookbook or Edit to fine-tune in the Advanced builder. Reply with ONE short sentence pointing the user at the card — do NOT paste the recipe text.`;
            }
          } else if (tu.name === 'edit_recipe_draft') {
            const input = (tu.input || {}) as BuildRecipeInput;
            const changed = changedFieldsInEdit(input);
            console.log('[edit_recipe_draft] dispatch input:', input, 'changed:', changed);
            if (changed.length === 0) {
              content = 'edit_recipe_draft failed: no fields supplied. Include at least one field to change.';
            } else {
              // Find AND patch the most recent unpublished recipe_draft
              // in a single setMessages callback so we read live state
              // (the streaming convo may have queued other updates).
              let patchedName: string | null = null;
              let foundDraft = false;
              setMessages((prev) => {
                for (let mi = prev.length - 1; mi >= 0; mi--) {
                  const msg = prev[mi];
                  for (let bi = msg.blocks.length - 1; bi >= 0; bi--) {
                    const b = msg.blocks[bi];
                    if (b.type === 'recipe_draft' && b.publishedMealId === null) {
                      foundDraft = true;
                      const merged = mergeRecipeEdit(b.draft, input);
                      patchedName = merged.name;
                      const newBlocks = [...msg.blocks];
                      newBlocks[bi] = { ...b, draft: merged };
                      const next = [...prev];
                      next[mi] = { ...msg, blocks: newBlocks };
                      console.log(`[edit_recipe_draft] patched "${merged.name}" — fields:`, changed.join(', '));
                      return next;
                    }
                  }
                }
                return prev;
              });
              if (!foundDraft) {
                content = 'edit_recipe_draft failed: no editable draft in this conversation. Call build_recipe first to create a recipe, then edit it.';
              } else {
                content = `Updated draft "${patchedName}" — replaced fields: ${changed.join(', ')}. The card refreshed in chat. Reply with ONE short sentence about what changed (no full recipe text).`;
              }
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

      // Reaching here means MAX_AGENTIC_TURNS ran out while the model was
      // still calling tools — anything it did (searches, opened modals,
      // navigation) already happened, but no closing text followed. Fill
      // the trailing empty assistant turn so the user isn't left staring
      // at silent side effects.
      const capNote = "I've done what I can in this turn — ask a follow-up if you'd like me to keep going.";
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === 'assistant' && last.blocks.length === 0) {
          next[next.length - 1] = { role: 'assistant', blocks: [{ type: 'text', text: capNote }] };
          return next;
        }
        return [...next, { role: 'assistant', blocks: [{ type: 'text', text: capNote }] }];
      });
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
    // The user's OWN send always comes into view, even if they'd scrolled
    // up — the near-bottom-gated autoscroll effect alone left it offscreen.
    setShowJump(false);
    scrollToBottom();
  }, [input, sendTurn, streaming, scrollToBottom]);

  /* Everything the answer footer needs, or null when there's no finished
     assistant answer to stand under. Recomputed per turn, not per token:
     the `streaming` guard means it simply isn't mounted mid-stream. */
  const answerFooter = useMemo(() => {
    if (streaming || messages.length === 0) return null;
    const index = messages.length - 1;
    const last = messages[index];
    if (last.role !== 'assistant') return null;
    const hasAnswer = last.blocks.some(
      (b) => (b.type === 'text' && b.text.trim())
        || (b.type === 'cards' && b.placeIds.length > 0)
        || (b.type === 'recipe_cards' && b.recipeIds.length > 0)
        || b.type === 'recipe_draft',
    );
    if (!hasAnswer) return null;
    const placeIds = last.blocks.flatMap((b) => (b.type === 'cards' ? b.placeIds : []))
      .filter((id) => placeById.has(id));
    const places = placeIds.map((id) => placeById.get(id)!);
    return {
      index,
      placeIds,
      followUps: buildFollowUps(places, origin),
      verdict: last.feedback,
      allSaved: placeIds.length > 0 && placeIds.every((id) => savedIds.has(id)),
    };
  }, [streaming, messages, placeById, origin, savedIds]);

  const handleSuggestion = useCallback((s: string) => {
    if (streaming) return;
    setInput('');
    void sendTurn(s);
    setShowJump(false);
    scrollToBottom();
  }, [sendTurn, streaming, scrollToBottom]);

  // Stop generation mid-stream: aborting the fetch makes sendTurn's catch
  // swallow the AbortError and its finally clear `streaming`; whatever text
  // already streamed in stays in the conversation.
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleRetry = useCallback(() => {
    // Find the last user message and resend it.
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const text = lastUser.blocks.find((b): b is { type: 'text'; text: string } => b.type === 'text')?.text;
    if (!text) return;
    // Trim back to before that user message so we re-send cleanly. Pass the
    // sliced history to sendTurn explicitly — its closure still holds the
    // pre-slice messages (ending with this same user turn), and sendTurn
    // appends the turn again itself.
    const idx = messages.lastIndexOf(lastUser);
    const sliced = messages.slice(0, idx);
    setMessages(sliced);
    void sendTurn(text, sliced);
  }, [messages, sendTurn]);

  return (
    <>
      <AnimatePresence>
        {!open && !hideLauncher && (
          <motion.div
            key="fab"
            className={cn('lp-chat-fab-slot', fabAboveBottomNav && 'is-above-nav', fabOverTakeover && 'is-over-takeover')}
            initial={{ opacity: 0, scale: 0.85, y: 8 }}
            // Scroll-hide on mobile: while `fabHidden` is true the button
            // slips down + fades out, but stays mounted so coming back is
            // an animation rather than a remount. Click events are
            // suppressed while it's invisible.
            animate={fabHidden
              ? { opacity: 0, scale: 0.75, y: 32 }
              : { opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 8 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ pointerEvents: fabHidden ? 'none' : 'auto' }}
            aria-hidden={fabHidden || undefined}
          >
            {/* The wrapper animates, the button is measured. Framer writes
                a transform onto the slot every frame; the native glass
                layer mirrors the BUTTON's box, which is stable inside it.
                (`effectiveOpacity` walks up from the button, so the slot's
                fade carries the glass with it.) */}
            <GlassButton
              id="assistant-fab"
              symbol="sparkles"
              label="Open assistant"
              onClick={() => setOpen(true)}
              className="lp-chat-fab"
            >
              <Sparkles />
            </GlassButton>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="island"
            ref={islandRef}
            className={cn('lp-chat-island', phoneMode && 'is-phone')}
            // Phone: opacity-only fade. A transform (scale/translate) on a
            // position:fixed full-screen panel breaks iOS keyboard handling
            // (the panel gets shoved up / mis-positioned when the keyboard
            // opens), so the full-page chat must animate without one.
            initial={phoneMode ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 16 }}
            animate={phoneMode ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
            exit={phoneMode ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={phoneMode
              ? { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
              : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
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

            <header
              className="lp-chat-head"
              onMouseDown={onHeaderMouseDown}
              style={!phoneMode ? { cursor: pos ? 'grab' : 'default', userSelect: 'none' } : undefined}
            >
              {view === 'history' ? (
                <GlassButton
                  id="ai-back"
                  symbol="chevron.left"
                  label="Back to chat"
                  onClick={() => setView('chat')}
                  className="lp-chat-glass-btn"
                >
                  <ArrowLeft size={16} />
                </GlassButton>
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
                        <span className="lp-chat-model-dot" aria-hidden="true" />
                        <span>{MODEL_LABELS[model]} · {MODEL_SUBLABELS[model].toLowerCase()}</span>
                        <ChevronDown size={11} strokeWidth={2.4} />
                      </button>
                      {modelMenuOpen && (
                        <div className="lp-chat-model-menu" role="listbox">
                          {(['auto', 'claude-sonnet-4-6', 'claude-opus-4-8'] as ChatModelPref[]).map((opt) => (
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
                  <GlassButton
                    id="ai-new"
                    symbol="plus"
                    label="New chat"
                    onClick={handleNewChat}
                    className="lp-chat-glass-btn"
                  >
                    <Plus size={16} />
                  </GlassButton>
                  <GlassButton
                    id="ai-history"
                    symbol="clock"
                    label="Prior chats"
                    onClick={() => { setHistoryQuery(''); setView('history'); }}
                    className="lp-chat-glass-btn"
                  >
                    <Clock size={16} />
                  </GlassButton>
                </>
              )}
              <GlassButton
                id="ai-close"
                symbol="xmark"
                label="Close"
                onClick={() => setOpen(false)}
                className="lp-chat-glass-btn"
              >
                <X size={16} />
              </GlassButton>
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
                    <>
                    <div className="lp-chat-history-search">
                      <Search size={15} className="lp-chat-history-search-icon" />
                      <input
                        type="text"
                        value={historyQuery}
                        onChange={(e) => setHistoryQuery(e.target.value)}
                        placeholder="Search chats…"
                        aria-label="Search chats"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {historyQuery && (
                        <button
                          type="button"
                          className="lp-chat-history-search-clear"
                          onClick={() => setHistoryQuery('')}
                          aria-label="Clear search"
                          title="Clear search"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>
                    {filteredChats.length === 0 ? (
                      <div className="lp-chat-history-empty">
                        <p>No chats match “{historyQuery.trim()}”.</p>
                      </div>
                    ) : (
                    filteredChats.map((chat) => (
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
                        <ChevronRight size={15} strokeWidth={2.2} className="lp-chat-history-chev" aria-hidden="true" />
                      </div>
                    ))
                    )}
                    </>
                  )}
                </div>
              ) : (
              <>
              {messages.length === 0 && (
                <div className="lp-chat-empty">
                  <div className="lp-chat-empty-mark" aria-hidden="true">
                    <Sparkles size={26} />
                  </div>
                  <h2 className="lp-chat-empty-lead">
                    What should I eat in {shortCityName}?
                  </h2>
                  <p className="lp-chat-empty-sub">
                    {ratingsCount && ratingsCount > 0
                      ? `I know your ${ratingsCount} rating${ratingsCount === 1 ? '' : 's'}, your saves and who you follow. Ask like you'd ask a friend who lives here.`
                      : "I know your saves and who you follow. Ask like you'd ask a friend who lives here."}
                  </p>
                  <div className="lp-chat-starters">
                    {suggestions.map((sg, i) => (
                      <button
                        key={`${sg.title}-${i}`}
                        type="button"
                        className="lp-chat-starter"
                        onClick={() => handleSuggestion(sg.prompt)}
                      >
                        <span className="icon" aria-hidden="true">{sg.icon}</span>
                        <span className="title">{sg.title}</span>
                        <span className="sub">{sg.subtitle}</span>
                      </button>
                    ))}
                  </div>
                  <p className="lp-chat-empty-note">
                    <Info size={13} strokeWidth={1.9} />
                    Answers draw on your ratings, your circle and live search.
                  </p>
                </div>
              )}

              {/* Each turn is a memoized ChatTurn (defined above) — only
                  the streaming message's object changes per token delta,
                  so completed bubbles skip re-render entirely. */}
              {messages.map((m, mi) => (
                <ChatTurn
                  key={mi}
                  m={m}
                  linkables={linkables}
                  linkRegex={linkRegex}
                  placeById={placeById}
                  recipeById={recipeById}
                  restaurantMeta={restaurantMeta}
                  myScores={myScores}
                  savedIds={savedIds}
                  origin={origin}
                  onNavigateRestaurant={handleNavigateRestaurant}
                  onNavigateRecipe={handleNavigateRecipe}
                  onOpenDraft={handleOpenDraft}
                  onToggleSave={handleToggleSave}
                  onShowOnMap={handleShowOnMap}
                />
              ))}

              {/* The end of the answer: what to ask next, and whether it
                  was any good. Only under the finished last turn — mid
                  stream the answer isn't there yet to judge, and on every
                  turn it stops being a question and becomes furniture. */}
              {answerFooter && (
                <ChatAnswerFooter
                  followUps={answerFooter.followUps}
                  verdict={answerFooter.verdict}
                  savableCount={answerFooter.placeIds.length}
                  allSaved={answerFooter.allSaved}
                  onFollowUp={handleSuggestion}
                  onVerdict={(v) => handleVerdict(answerFooter.index, v)}
                  onSaveAll={() => handleSaveAll(answerFooter.placeIds)}
                />
              )}

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
                  <div className="lp-chat-bubble lp-chat-thinking">
                    <span className="lp-chat-thinking-mark" aria-hidden="true"><Sparkles size={11} /></span>
                    <span className="lp-chat-typing" aria-label="Assistant is responding">
                      <span /><span /><span />
                    </span>
                    <span className="lp-chat-thinking-label">
                      {streamElapsed >= 20
                        ? 'Still working on it…'
                        : streamElapsed >= 8
                          ? 'Working on it…'
                          : 'Thinking…'}
                    </span>
                    {streamElapsed >= 4 && (
                      <span className="lp-chat-thinking-elapsed">{streamElapsed}s</span>
                    )}
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

              {/* "Jump to latest" — rendered at the END of the list and
                  position:sticky to the scroller's bottom edge, so it
                  floats over the content only while the user is pinned
                  off the bottom during a stream. */}
              {showJump && (
                <div className="lp-chat-jump-wrap">
                  <button
                    type="button"
                    className="lp-chat-jump"
                    onClick={() => { setShowJump(false); scrollToBottom('smooth'); }}
                  >
                    <ArrowDown size={13} />
                    Jump to latest
                  </button>
                </div>
              )}
              </>
              )}
            </div>

            {view === 'chat' && (
            <form className="lp-chat-foot" onSubmit={handleSubmit}>
              {attachment && (
                /* What the next message is about. Sits inside the composer
                   so it reads as part of the message being written, not as
                   a banner over the transcript — and so the X that removes
                   it is exactly where the thing it removes is. */
                <div className="lp-chat-attach">
                  <span className="lp-chat-attach-icon" aria-hidden>
                    {attachment.kind === 'recipe' ? <ChefHat size={13} /> : <UtensilsCrossed size={13} />}
                  </span>
                  <span className="lp-chat-attach-text">
                    <span className="lp-chat-attach-name">{attachment.name}</span>
                    {attachment.subtitle && (
                      <span className="lp-chat-attach-sub">{attachment.subtitle}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="lp-chat-attach-x"
                    onClick={() => onClearAttachment?.()}
                    aria-label={`Stop asking about ${attachment.name}`}
                  >
                    <X size={12} strokeWidth={2.4} />
                  </button>
                </div>
              )}
              <div className="lp-chat-composer">
                {/* NOT disabled while streaming — disabling blurred the
                    field, which dismisses the iOS keyboard after every
                    send. Submission is gated in handleSubmit instead, so
                    the user can type their follow-up while the answer
                    streams. */}
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
                />
                {streaming ? (
                  // Stop control — a long generation (a 12k-token recipe
                  // answer) is cancellable; the abort keeps whatever
                  // already streamed in.
                  <button
                    type="button"
                    className="lp-chat-send is-stop"
                    onClick={handleStop}
                    aria-label="Stop generating"
                  >
                    <Square size={12} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="lp-chat-send"
                    disabled={!input.trim()}
                    aria-label="Send"
                  >
                    <ArrowUp size={18} />
                  </button>
                )}
              </div>
            </form>
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
        onCoverPhotoChange={handleCoverPhotoChange}
        onRefine={handleRefineDraft}
        onGenerateImage={handleGenerateDraftImage}
        onIngredientEdit={handleIngredientEditDraft}
      />
    </>
  );
};
