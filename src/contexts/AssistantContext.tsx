// AssistantContext — published state that the global AppAssistant
// component reads to enrich the AI chat. Pages opt in by calling
// useSetAssistantPageContext() with their rich data; otherwise the
// assistant falls back to defaults (empty restaurant pool, the user's
// home city, etc.).
//
// Only LocationPage publishes here today (it has the live filtered
// restaurant pool, lookup callbacks, geocoded coords, etc.), but the
// shape is general so other pages can join later.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ScoredPlace } from '../lib/recommendations';
import type { RestaurantMeta } from './ListsContext';
import type { ChatFilters, UserContext } from '../lib/location-chat-client';
import type { AssistantUser, AssistantCircleRating } from '../components/LocationChat';
import type { Recipe } from './RecipesContext';

export interface AssistantPageContext {
  /** Filtered restaurant pool the user is looking at on this page. */
  visible: ScoredPlace[];
  /** Restaurant meta cache so chat cards render the same labels. */
  restaurantMeta: Record<string, RestaurantMeta>;
  /** Display name for the system prompt, e.g. "New York, NY". */
  cityDisplay: string;
  /** Short city name for suggestion chips, e.g. "New York". */
  shortCityName: string;
  /** Active-filter snapshot for the system prompt. */
  filters: ChatFilters;
  /** Coords for the distance line on cards. */
  origin: { lat: number; lng: number } | null;
  /** Free-text Google Places search anchored to a city.
   *  When omitted on a page, AppAssistant falls back to a generic
   *  search using the user's home city. */
  onSearchRestaurants?: (query: string, city?: string) => Promise<ScoredPlace[]>;
  /** User lookup callback. Falls back to a Supabase username search. */
  onLookupUser?: (query: string) => Promise<AssistantUser[]>;
  /** Circle-rating lookup. Falls back to empty results when not
   *  published (only LocationPage has the rich signals map). */
  onGetCircleRatings?: (restaurantId: string) => Promise<AssistantCircleRating[]>;
  /** Plot a set of AI-recommended restaurants on the map: the map page
   *  swaps the sidebar list + markers to exactly these places and flies
   *  to frame them. Only published by the map page (LocationPage), so the
   *  chat calling it is a no-op everywhere else — i.e. the map only reacts
   *  to the chat when you're actually on the map page. Pass `null`/`[]` to
   *  clear the override and return to the normal area results. */
  onAssistantPlaces?: (places: ScoredPlace[]) => void;
  /** Page-built rich user context (meta-enriched neighborhoods, friends,
   *  followed experts, circle signals). AppAssistant prefers this over
   *  the minimal context it can build itself, so the system prompt's
   *  personalization sections ("Mira has this at 9.4") can fire. */
  userContext?: UserContext;
  /** Page-built card-lookup places (rated + wishlist synthesized, with
   *  the page's cuisine hints). */
  knownPlaces?: ScoredPlace[];
  /** Stub-filtered recipe lookup table for recipe cards. */
  recipes?: Recipe[];
}

/**
 * A restaurant or recipe the conversation is ABOUT.
 *
 * Set by a detail page's "ask about this" button. While one is attached
 * the composer shows it as a removable chip and the system prompt gets a
 * dedicated section naming it, so "is it worth it?" resolves to this
 * place rather than to whatever the model last inferred. Clearing the
 * chip returns the chat to its normal, page-wide behaviour.
 *
 * `details` is a compact, already-formatted digest the PAGE builds — it's
 * the side that actually holds the rating, hours, ingredients, etc. The
 * chat just forwards it.
 */
export interface AssistantAttachment {
  kind: 'restaurant' | 'recipe';
  /** Restaurant place id, or recipe id — what tools address it by. */
  id: string;
  name: string;
  /** One line under the name in the chip: "Italian · $$$ · Westport". */
  subtitle?: string;
  /** Everything the app knows locally, as `label: value` lines. */
  details?: string[];
}

interface AssistantContextValue {
  /** Current page context — null when no page has published. */
  pageContext: AssistantPageContext | null;
  /** Called by pages to publish their rich context. Returns a teardown
   *  function so callers can clear on unmount. */
  setPageContext: (ctx: AssistantPageContext | null) => void;
  /** The subject the chat is pinned to, or null for a normal chat. */
  attachment: AssistantAttachment | null;
  setAttachment: (a: AssistantAttachment | null) => void;
  /** Bumped every time a page asks for the chat panel to open. The chat
   *  owns its own open state, so this is a signal rather than a setter —
   *  re-asking while it's already open is a no-op, not a fight. */
  openRequest: number;
  requestOpen: () => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export const AssistantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [pageContext, setPageContext] = useState<AssistantPageContext | null>(null);
  const [attachment, setAttachment] = useState<AssistantAttachment | null>(null);
  const [openRequest, setOpenRequest] = useState(0);
  const requestOpen = useCallback(() => setOpenRequest((n) => n + 1), []);
  const value = useMemo<AssistantContextValue>(
    () => ({ pageContext, setPageContext, attachment, setAttachment, openRequest, requestOpen }),
    [pageContext, attachment, openRequest, requestOpen],
  );
  return (
    <AssistantContext.Provider value={value}>
      {children}
    </AssistantContext.Provider>
  );
};

export function useAssistantContext(): AssistantContextValue {
  const ctx = useContext(AssistantContext);
  if (!ctx) {
    // No provider — return inert defaults so callers don't crash
    // (most relevant for tests / standalone rendering).
    return {
      pageContext: null,
      setPageContext: () => {},
      attachment: null,
      setAttachment: () => {},
      openRequest: 0,
      requestOpen: () => {},
    };
  }
  return ctx;
}

/** Convenience hook for pages to publish their context. Clears on
 *  unmount so the global assistant falls back to defaults when the
 *  user navigates away. Callers are expected to memoize `ctx` so the
 *  effect doesn't re-fire on every render. */
export function useSetAssistantPageContext(ctx: AssistantPageContext | null): void {
  const { setPageContext } = useAssistantContext();
  useEffect(() => {
    setPageContext(ctx);
    return () => setPageContext(null);
  }, [setPageContext, ctx]);
}

/** Publish helper for callers that want imperative control without
 *  the lifecycle effect — e.g. when the data isn't ready yet. */
export function useAssistantSetter(): (ctx: AssistantPageContext | null) => void {
  const { setPageContext } = useAssistantContext();
  return useCallback((ctx) => setPageContext(ctx), [setPageContext]);
}

/**
 * Detail-page helper: pin the chat to this restaurant / recipe and open it.
 *
 * Returns a stable callback so a page can wire it straight to a button.
 */
export function useAskAssistantAbout(): (a: AssistantAttachment) => void {
  const { setAttachment, requestOpen } = useAssistantContext();
  return useCallback((a: AssistantAttachment) => {
    setAttachment(a);
    requestOpen();
  }, [setAttachment, requestOpen]);
}
