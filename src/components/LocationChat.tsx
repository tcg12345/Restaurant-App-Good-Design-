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
  ChevronRight,
  Loader2,
  MapPin,
  RotateCw,
  Send,
  Sparkles,
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
import type { ScoredPlace } from '../lib/recommendations';
import {
  streamLocationChat,
  type AnthropicMessage,
  type ContentBlock,
  type ChatFilters,
  type CompactRestaurant,
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
}

interface UiMessage {
  role: 'user' | 'assistant';
  /** Rendered content blocks for this turn. Text deltas append into
   *  the last text block; tool_use cards become their own block. */
  blocks: UiBlock[];
}

type UiBlock =
  | { type: 'text'; text: string }
  | { type: 'cards'; toolUseId: string; placeIds: string[]; reason?: string };

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

/** Strip the UI blocks back into the Anthropic content array we
 *  need to round-trip on the next request (we have to resend the
 *  assistant's full content including tool_use blocks so Claude
 *  can match up tool_result blocks we send in the follow-up). */
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

export const LocationChat: React.FC<LocationChatProps> = ({
  visible,
  restaurantMeta,
  cityDisplay,
  shortCityName,
  filters,
  origin,
}) => {
  const navigate = useNavigate();
  const { phoneMode, setHideBottomNav } = useSettings();

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const suggestions = useMemo(
    () => buildSuggestions(shortCityName, filters),
    [shortCityName, filters],
  );

  const placeById = useMemo(() => {
    const m = new Map<string, ScoredPlace>();
    for (const p of visible) m.set(p.id, p);
    return m;
  }, [visible]);

  const handleNavigateRestaurant = useCallback((id: string) => {
    setOpen(false);
    // Defer the navigation a tick so the close animation has a
    // chance to play before the route swap.
    setTimeout(() => navigate(`/restaurant/${id}`), 60);
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
    let pendingToolResults: ContentBlock[] = [];

    try {
      for (let turn = 0; turn < MAX_AGENTIC_TURNS; turn++) {
        // If we have tool_results from the previous turn, add a user
        // turn carrying them BEFORE the next stream.
        if (pendingToolResults.length > 0) {
          convo = [...convo, { role: 'user', content: pendingToolResults }];
          pendingToolResults = [];
        }

        const assistantBlocks: UiBlock[] = [];
        let textBlockOpen = false;
        const toolUsesInThisTurn: Array<{ id: string; placeIds: string[]; reason: string }> = [];

        const stream = streamLocationChat(
          {
            messages: convo,
            restaurants: restaurantsForModel,
            filters,
            city: cityDisplay,
          },
          controller.signal,
        );

        for await (const ev of stream) {
          if (controller.signal.aborted) break;
          if (ev.type === 'text_delta') {
            // Append to (or open) the trailing text block of the
            // current assistant turn.
            if (!textBlockOpen) {
              assistantBlocks.push({ type: 'text', text: '' });
              textBlockOpen = true;
            }
            const last = assistantBlocks[assistantBlocks.length - 1];
            if (last.type === 'text') last.text += ev.delta;
            // Mirror to UI by replacing the trailing assistant turn.
            setMessages((prev) => {
              const next = [...prev];
              next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
              return next;
            });
          } else if (ev.type === 'tool_use') {
            textBlockOpen = false;
            if (ev.name === 'recommend_restaurants') {
              const input = (ev.input || {}) as { restaurant_ids?: string[]; reason?: string };
              const placeIds = Array.isArray(input.restaurant_ids)
                ? input.restaurant_ids.filter((id): id is string => typeof id === 'string')
                : [];
              const reason = typeof input.reason === 'string' ? input.reason : '';
              assistantBlocks.push({
                type: 'cards',
                toolUseId: ev.id,
                placeIds,
                reason,
              });
              toolUsesInThisTurn.push({ id: ev.id, placeIds, reason });
              setMessages((prev) => {
                const next = [...prev];
                next[next.length - 1] = { role: 'assistant', blocks: [...assistantBlocks] };
                return next;
              });
            }
          } else if (ev.type === 'done') {
            // End of one streamed message. If the model called any
            // tools we need to round-trip with tool_results.
            if (toolUsesInThisTurn.length > 0) {
              // Add the assistant turn (with its tool_use blocks) to convo.
              convo = [
                ...convo,
                { role: 'assistant', content: uiBlocksToAnthropicContent(assistantBlocks) },
              ];
              for (const tu of toolUsesInThisTurn) {
                // Cards have already been rendered client-side; the
                // tool_result just confirms.
                pendingToolResults.push({
                  type: 'tool_result',
                  tool_use_id: tu.id,
                  content: tu.placeIds.length > 0
                    ? `Rendered ${tu.placeIds.length} restaurant card(s) to the user.`
                    : 'No matching restaurant ids — please try different ones.',
                });
              }
              // Open a fresh assistant turn for the next stream's text.
              setMessages((prev) => [...prev, { role: 'assistant', blocks: [] }]);
            } else {
              // Final answer — exit the agentic loop.
              return;
            }
            break; // exit for-await, top-of-loop processes pendingToolResults.
          } else if (ev.type === 'error') {
            setError(ev.message);
            // Drop the trailing empty assistant turn if there's
            // nothing in it; otherwise keep the partial.
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
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [messages, visible, restaurantMeta, origin, filters, cityDisplay]);

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
            role="dialog"
            aria-label="Restaurant assistant"
          >
            {phoneMode && (
              <div className="lp-chat-drag-handle" aria-hidden="true">
                <span />
              </div>
            )}

            <header className="lp-chat-head">
              <div className="lp-chat-head-icon" aria-hidden="true">
                <Sparkles />
              </div>
              <div className="lp-chat-head-text">
                <h3>Ask a local</h3>
                <p>Powered by Claude</p>
              </div>
              <button
                type="button"
                className="lp-chat-head-close"
                onClick={() => setOpen(false)}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </header>

            <div className="lp-chat-body" ref={scrollRef}>
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

              {messages.map((m, mi) => (
                <div
                  key={mi}
                  className={cn('lp-chat-msg', m.role === 'user' ? 'is-user' : 'is-assistant')}
                >
                  {m.blocks.length === 0 && m.role === 'assistant' && streaming && (
                    <div className="lp-chat-bubble">
                      <span className="lp-chat-typing" aria-label="Assistant is typing">
                        <span /><span /><span />
                      </span>
                    </div>
                  )}
                  {m.blocks.map((b, bi) => {
                    if (b.type === 'text') {
                      if (!b.text) return null;
                      return (
                        <div key={bi} className="lp-chat-bubble">
                          {b.text}
                        </div>
                      );
                    }
                    // cards
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
              ))}

              {error && (
                <div className="lp-chat-error">
                  <span>{error}</span>
                  <button type="button" onClick={handleRetry} className="lp-chat-error-retry">
                    <RotateCw size={12} /> Try again
                  </button>
                </div>
              )}
            </div>

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
            <div className="lp-chat-foot-note">
              AI can make mistakes — verify the basics.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
