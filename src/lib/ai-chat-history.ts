// Shared types + persistence for the "Ask a local" AI assistant chat
// history. Extracted from LocationChat so the history can also be written
// from elsewhere (e.g. the Add Recipe modal's "Create with AI" flow) and
// synced to Supabase via AiChatHistoryContext.

import type { HomeMeal } from '../contexts/ListsContext';
import type { ScoredPlace } from './recommendations';

export interface UiMessage {
  role: 'user' | 'assistant';
  /** Rendered content blocks for this turn. Text deltas append into
   *  the last text block; tool_use cards become their own block. */
  blocks: UiBlock[];
}

export type UiBlock =
  | { type: 'text'; text: string }
  // `notes` maps a place id → a 1-2 sentence blurb shown under that card.
  | { type: 'cards'; toolUseId: string; placeIds: string[]; reason?: string; notes?: Record<string, string> }
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

export interface SavedChat {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UiMessage[];
  chatPlaces: Record<string, ScoredPlace>;
}

const CHAT_STORAGE_KEY = 'lp-chat-history-v1';
/** Which user the locally-cached history belongs to, so we can drop a
 *  previous account's chats when a different user signs in on the device. */
export const CHAT_USER_KEY = 'lp-chat-history-user';
export const MAX_SAVED_CHATS = 30;

function isValidChat(c: unknown): c is SavedChat {
  return !!c && typeof (c as SavedChat).id === 'string' && Array.isArray((c as SavedChat).messages);
}

/** Newest-first, capped at MAX_SAVED_CHATS. */
export function boundChats(chats: SavedChat[]): SavedChat[] {
  return [...chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SAVED_CHATS);
}

export function loadSavedChats(): SavedChat[] {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidChat);
  } catch {
    return [];
  }
}

export function persistSavedChats(chats: SavedChat[]) {
  const bounded = boundChats(chats);
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

/** Union local + cloud by id; for the same id keep whichever was touched
 *  more recently. Used on sign-in so a device's unsynced chats and the
 *  cloud's chats from other devices both survive. */
export function mergeChats(local: SavedChat[], cloud: SavedChat[]): SavedChat[] {
  const byId = new Map<string, SavedChat>();
  for (const c of cloud) if (isValidChat(c)) byId.set(c.id, c);
  for (const c of local) {
    if (!isValidChat(c)) continue;
    const existing = byId.get(c.id);
    if (!existing || c.updatedAt > existing.updatedAt) byId.set(c.id, c);
  }
  return boundChats([...byId.values()]);
}

/** Derive a chat title from the first user message in the conversation. */
export function deriveChatTitle(messages: UiMessage[]): string {
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

export function newChatId(): string {
  return `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Build a one-turn SavedChat that records a recipe drafted OUTSIDE the
 *  chat (the Add Recipe modal's "Create with AI" flow) so it still shows
 *  up in the assistant's history exactly like a chat-authored draft. */
export function buildGeneratedRecipeChat(args: {
  prompt: string;
  draft: HomeMeal;
  rawInput: unknown;
}): SavedChat {
  const { prompt, draft, rawInput } = args;
  const now = Date.now();
  const toolUseId = `modal-draft-${now}-${Math.random().toString(36).slice(2, 8)}`;
  const messages: UiMessage[] = [
    { role: 'user', blocks: [{ type: 'text', text: prompt.trim() || `Create a ${draft.name} recipe` }] },
    {
      role: 'assistant',
      blocks: [
        { type: 'text', text: `Drafted ${draft.name} — open the card to review, tweak, or publish.` },
        { type: 'recipe_draft', toolUseId, draft, rawInput, publishedMealId: null },
      ],
    },
  ];
  return {
    id: newChatId(),
    title: deriveChatTitle(messages),
    createdAt: now,
    updatedAt: now,
    messages,
    chatPlaces: {},
  };
}
