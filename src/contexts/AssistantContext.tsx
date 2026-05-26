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
import type { ChatFilters } from '../lib/location-chat-client';
import type { AssistantUser, AssistantCircleRating } from '../components/LocationChat';

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
}

interface AssistantContextValue {
  /** Current page context — null when no page has published. */
  pageContext: AssistantPageContext | null;
  /** Called by pages to publish their rich context. Returns a teardown
   *  function so callers can clear on unmount. */
  setPageContext: (ctx: AssistantPageContext | null) => void;
}

const AssistantContext = createContext<AssistantContextValue | null>(null);

export const AssistantProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [pageContext, setPageContext] = useState<AssistantPageContext | null>(null);
  const value = useMemo<AssistantContextValue>(
    () => ({ pageContext, setPageContext }),
    [pageContext],
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
