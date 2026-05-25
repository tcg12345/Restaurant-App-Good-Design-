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
import type { RestaurantMeta } from '../contexts/ListsContext';
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
  onLookupUser: (query: string) => Promise<Array<{
    username: string;
    displayName?: string;
    bio?: string;
    isExpert?: boolean;
    homeCity?: string;
  }>>;
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
  // Invisible: assistant's tool_use blocks we don't surface as cards
  // (currently search_restaurants and lookup_user). Kept in messages
  // state so the conversation can be reconstructed on the next API
  // call without breaking Anthropic's "every tool_use needs a matching
  // tool_result immediately after" rule.
  | { type: 'tool_use'; toolUseId: string; toolName: string; input: unknown }
  // Invisible: user-role tool_result blocks emitted between agentic
  // turns. Stored on the user turn so the history round-trips cleanly.
  | { type: 'tool_result'; toolUseId: string; content: string };

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
function findPlaceByName(name: string, places: Map<string, ScoredPlace>): ScoredPlace | null {
  const norm = name.trim().toLowerCase();
  for (const p of places.values()) {
    if ((p.name || '').toLowerCase() === norm) return p;
  }
  return null;
}

const MARKDOWN_BOLD_RE = /(\*\*[^*\n]+\*\*)/g;
const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/** Render an assistant text block:
 *   - **bold** markdown becomes <strong> (or an inline link when the
 *     bolded text is a known restaurant name).
 *   - Plain-text restaurant names from `places` become inline links
 *     too — so even when Claude forgets the markdown, mentions are
 *     still clickable.
 *  Links are styled as accent-tinted pills and tap-through to the
 *  detail page via `onNavigate`. */
function renderAssistantText(
  text: string,
  places: Map<string, ScoredPlace>,
  onNavigate: (id: string) => void,
  placeNameRegex: RegExp | null,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let key = 0;
  const linkifyPlain = (segment: string): void => {
    if (!segment) return;
    if (!placeNameRegex) {
      out.push(<React.Fragment key={key++}>{segment}</React.Fragment>);
      return;
    }
    placeNameRegex.lastIndex = 0;
    let lastEnd = 0;
    let m: RegExpExecArray | null;
    while ((m = placeNameRegex.exec(segment)) !== null) {
      if (m.index > lastEnd) {
        out.push(<React.Fragment key={key++}>{segment.slice(lastEnd, m.index)}</React.Fragment>);
      }
      const matched = m[0];
      const place = findPlaceByName(matched, places);
      if (place) {
        out.push(
          <button
            key={key++}
            type="button"
            className="lp-chat-inline-link"
            onClick={() => onNavigate(place.id)}
          >
            {matched}
          </button>,
        );
      } else {
        out.push(<React.Fragment key={key++}>{matched}</React.Fragment>);
      }
      lastEnd = m.index + matched.length;
      // Defensive: a zero-width match would loop forever
      if (m.index === placeNameRegex.lastIndex) placeNameRegex.lastIndex++;
    }
    if (lastEnd < segment.length) {
      out.push(<React.Fragment key={key++}>{segment.slice(lastEnd)}</React.Fragment>);
    }
  };

  for (const part of text.split(MARKDOWN_BOLD_RE)) {
    if (!part) continue;
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      const inner = part.slice(2, -2);
      const exact = findPlaceByName(inner, places);
      if (exact) {
        out.push(
          <button
            key={key++}
            type="button"
            className="lp-chat-inline-link"
            onClick={() => onNavigate(exact.id)}
          >
            {inner}
          </button>,
        );
      } else {
        out.push(<strong key={key++}>{inner}</strong>);
      }
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
  recipes,
  knownPlaces,
}) => {
  const navigate = useNavigate();
  const { phoneMode, setHideBottomNav } = useSettings();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chat-local cache for places returned by the search_restaurants
  // tool — they may fall outside the user's current filters (whole
  // point of the tool) so we need somewhere to render cards from
  // regardless of visible[]. Keys are place ids.
  const [chatPlaces, setChatPlaces] = useState<Record<string, ScoredPlace>>({});

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
  const { dragProps } = useBottomSheet(open && phoneMode, () => setOpen(false));

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
    setCurrentChatId(null);
    setError(null);
    setView('chat');
    setStreaming(false);
  }, []);

  const handleSelectChat = useCallback((chat: SavedChat) => {
    abortRef.current?.abort();
    setMessages(chat.messages);
    setChatPlaces(chat.chatPlaces || {});
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

  const recipeById = useMemo(() => {
    const m = new Map<string, Recipe>();
    for (const r of recipes) if (r?.id) m.set(r.id, r);
    return m;
  }, [recipes]);

  // Pre-built regex over every known restaurant name so the assistant
  // text renderer can linkify mentions in O(text length) per render
  // instead of N (places) × text length. Longest-first so 'Joe's Pizza
  // & Wings' wins over 'Joe's'. Word-boundary-anchored so substrings
  // inside other words don't get linkified.
  const placeNameRegex = useMemo<RegExp | null>(() => {
    const names = [...placeById.values()]
      .map((p) => p.name)
      .filter((n): n is string => !!n && n.length >= 3)
      .sort((a, b) => b.length - a.length);
    if (names.length === 0) return null;
    const escaped = names.map((n) => n.replace(REGEX_ESCAPE_RE, '\\$&'));
    return new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi');
  }, [placeById]);

  const handleNavigateRestaurant = useCallback((id: string) => {
    setOpen(false);
    // Defer the navigation a tick so the close animation has a
    // chance to play before the route swap.
    setTimeout(() => navigate(`/restaurant/${id}`), 60);
  }, [navigate]);

  const handleNavigateRecipe = useCallback((id: string) => {
    setOpen(false);
    setTimeout(() => navigate(`/recipe/${id}`), 60);
  }, [navigate]);

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

    // Build the message history we'll send. We always send the full
    // history (so Claude has context) plus the new user turn.
    const baseHistory: AnthropicMessage[] = messages.map((m) => ({
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
            // Filter out ids the user doesn't actually own so we can
            // tell Claude what stuck vs what was a hallucination.
            const valid = ids.filter((id) => recipeById.has(id));
            const invalid = ids.filter((id) => !recipeById.has(id));
            if (valid.length === 0 && invalid.length === 0) {
              content = 'No recipe ids provided.';
            } else if (valid.length === 0) {
              content = `None of the recipe ids matched the user's saved recipes (${invalid.join(', ')}). Don't fabricate — only use ids from the RECIPES section of the system prompt.`;
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
                  const lines = hits.slice(0, 5).map((h, i) => {
                    const flag = h.isExpert ? ' [expert]' : '';
                    const bits = [h.displayName || h.username, h.username ? `@${h.username}` : null, h.homeCity, h.bio]
                      .filter(Boolean)
                      .join(' · ');
                    return `${i + 1}. ${bits}${flag}`;
                  }).join('\n');
                  content = `Found ${hits.length} user(s) matching "${query}":\n${lines}`;
                }
              } catch (err) {
                content = `User lookup for "${query}" failed: ${err instanceof Error ? err.message : 'unknown error'}.`;
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
  }, [messages, visible, restaurantMeta, origin, filters, cityDisplay, onSearchRestaurants, userContext, onLookupUser, recipeById]);

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
            className="lp-chat-fab"
            onClick={() => setOpen(true)}
            initial={{ opacity: 0, scale: 0.85, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: 8 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            aria-label="Open assistant"
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
              <div className="lp-chat-drag-handle" aria-hidden="true">
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
                    <p>Powered by Claude</p>
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
                    || (b.type === 'recipe_cards' && b.recipeIds.length > 0),
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
                            ? renderAssistantText(b.text, placeById, handleNavigateRestaurant, placeNameRegex)
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
                                  Recipe not found in your saved list.
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
                                </div>
                                <ChevronRight />
                              </button>
                            );
                          })}
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
    </>
  );
};
