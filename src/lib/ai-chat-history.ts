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
  /** Assistant turns only: the user's thumbs up / down on this answer.
   *  Kept on the message (rather than in component state) so re-opening a
   *  saved chat still shows the verdict the user already gave — the row in
   *  ai_chat_feedback is the collected data, this is the UI's memory of it.
   *  Absent on every turn nobody rated, and on all older saved chats. */
  feedback?: 'up' | 'down';
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

/** Deletion tombstone: chat `id` was deleted at `deletedAt`. Kept alongside
 *  the chats (localStorage + the cloud payload) so a deletion survives the
 *  union merge — without it, any other device's copy of the chat would just
 *  resurrect it on the next sync. A chat whose updatedAt is NEWER than its
 *  tombstone wins (the user kept talking in it on another device). */
export interface ChatTombstone {
  id: string;
  deletedAt: number;
}
export const MAX_CHAT_TOMBSTONES = 100;
const CHAT_TOMBSTONE_STORAGE_KEY = 'lp-chat-tombstones-v1';

function isValidChat(c: unknown): c is SavedChat {
  return !!c && typeof (c as SavedChat).id === 'string' && Array.isArray((c as SavedChat).messages);
}

function isValidTombstone(t: unknown): t is ChatTombstone {
  return !!t && typeof (t as ChatTombstone).id === 'string' && typeof (t as ChatTombstone).deletedAt === 'number';
}

/** Newest-first, capped at MAX_SAVED_CHATS. The id tiebreak keeps the order
 *  canonical, so two devices holding the same set serialize identically
 *  (sameChatSet compares positionally). */
export function boundChats(chats: SavedChat[]): SavedChat[] {
  return [...chats]
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_SAVED_CHATS);
}

/** Drop malformed entries, dedupe by id (newest deletedAt wins), newest
 *  first, capped at MAX_CHAT_TOMBSTONES. */
export function boundTombstones(tombstones: ChatTombstone[]): ChatTombstone[] {
  const byId = new Map<string, ChatTombstone>();
  for (const t of tombstones) {
    if (!isValidTombstone(t)) continue;
    const cur = byId.get(t.id);
    if (!cur || t.deletedAt > cur.deletedAt) byId.set(t.id, t);
  }
  return [...byId.values()]
    .sort((a, b) => b.deletedAt - a.deletedAt || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_CHAT_TOMBSTONES);
}

/** Union two tombstone lists (newest deletedAt per id wins, capped). */
export function mergeTombstones(a: ChatTombstone[], b: ChatTombstone[]): ChatTombstone[] {
  return boundTombstones([...a, ...b]);
}

export function loadChatTombstones(): ChatTombstone[] {
  try {
    const raw = localStorage.getItem(CHAT_TOMBSTONE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? boundTombstones(parsed) : [];
  } catch {
    return [];
  }
}

export function persistChatTombstones(tombstones: ChatTombstone[]) {
  try {
    localStorage.setItem(CHAT_TOMBSTONE_STORAGE_KEY, JSON.stringify(boundTombstones(tombstones)));
  } catch { /* best-effort */ }
}

/** Cheap change detector: id + updatedAt per position is a sound fingerprint
 *  because every content change bumps updatedAt, and boundChats orders
 *  canonically. Used to skip no-op cloud writes/state commits. */
export function sameChatSet(a: SavedChat[], b: SavedChat[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].updatedAt !== b[i].updatedAt) return false;
  }
  return true;
}

export function sameTombstoneSet(a: ChatTombstone[], b: ChatTombstone[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].deletedAt !== b[i].deletedAt) return false;
  }
  return true;
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
 *  more recently. Tombstones then suppress deleted ids — EXCEPT when the
 *  surviving copy was updated after the deletion (the user continued that
 *  conversation on another device; destroying live work loses more than a
 *  re-appearing chat costs). Runs on every sync cycle, so a device's
 *  unsynced chats and the cloud's chats from other devices both survive
 *  while deletions propagate instead of resurrecting. */
export function mergeChats(local: SavedChat[], cloud: SavedChat[], tombstones: ChatTombstone[] = []): SavedChat[] {
  const byId = new Map<string, SavedChat>();
  for (const c of cloud) if (isValidChat(c)) byId.set(c.id, c);
  for (const c of local) {
    if (!isValidChat(c)) continue;
    const existing = byId.get(c.id);
    if (!existing || c.updatedAt > existing.updatedAt) byId.set(c.id, c);
  }
  const deletedAtById = new Map(tombstones.map((t) => [t.id, t.deletedAt]));
  const alive = [...byId.values()].filter((c) => {
    const deletedAt = deletedAtById.get(c.id);
    return deletedAt === undefined || c.updatedAt > deletedAt;
  });
  return boundChats(alive);
}

/* ── Cloud payload codec ─────────────────────────────────────────────────
 * The user_app_data.location_chat_history column stores a JSONB ARRAY of
 * chats (legacy shape). Tombstones ride along as one extra sentinel element
 * rather than switching the column to an envelope object: older deployed
 * clients filter entries through "has a string id and a messages array", so
 * they silently drop the sentinel and keep reading their chats — an
 * envelope would have made their entire history look empty. An old client's
 * write does drop the sentinel from the cloud copy, but every updated
 * device still holds its tombstones locally and re-applies + re-uploads
 * them on its next sync. */

export const CHAT_TOMBSTONE_SENTINEL_ID = '__ai_chat_tombstones__';

export interface AiChatCloudPayload {
  chats: SavedChat[];
  tombstones: ChatTombstone[];
}

export function encodeCloudChatPayload(chats: SavedChat[], tombstones: ChatTombstone[]): unknown[] {
  const bounded = boundTombstones(tombstones);
  const encoded: unknown[] = [...boundChats(chats)];
  if (bounded.length > 0) encoded.push({ id: CHAT_TOMBSTONE_SENTINEL_ID, deletedIds: bounded });
  return encoded;
}

export function decodeCloudChatPayload(raw: unknown): AiChatCloudPayload {
  if (!Array.isArray(raw)) return { chats: [], tombstones: [] };
  const chats: SavedChat[] = [];
  let tombstones: ChatTombstone[] = [];
  for (const entry of raw) {
    if (entry && (entry as { id?: unknown }).id === CHAT_TOMBSTONE_SENTINEL_ID) {
      const ids = (entry as { deletedIds?: unknown }).deletedIds;
      if (Array.isArray(ids)) tombstones = mergeTombstones(tombstones, ids as ChatTombstone[]);
      continue;
    }
    if (isValidChat(entry)) chats.push(entry);
  }
  return { chats: boundChats(chats), tombstones };
}

/* ── Inline draft images ─────────────────────────────────────────────────
 * recipe_draft blocks are the only place chat messages carry images (the
 * draft's coverPhoto + photo strip). The draft sheet uploads to Storage
 * before applying, so these are normally short http(s) URLs — but the
 * upload's offline/signed-out fallback leaves the base64 data: URL inline,
 * and one such image (hundreds of KB) persisted per save is what pushes
 * localStorage into its quota fallback and silently evicts the oldest
 * chats. These helpers find inline images in saved history and swap them
 * for Storage URLs once AiChatHistoryContext manages to upload them. */

/** Distinct data: URLs inside recipe_draft blocks across all chats. */
export function collectChatImageDataUrls(chats: SavedChat[]): string[] {
  const out = new Set<string>();
  for (const chat of chats) {
    for (const m of chat.messages) {
      for (const b of m.blocks) {
        if (b.type !== 'recipe_draft') continue;
        const draft = b.draft as { coverPhoto?: unknown; photos?: unknown[] };
        if (typeof draft.coverPhoto === 'string' && draft.coverPhoto.startsWith('data:')) out.add(draft.coverPhoto);
        for (const p of Array.isArray(draft.photos) ? draft.photos : []) {
          // Draft photo strips hold bare URL strings; published-meal shapes
          // hold {url} objects. Handle both.
          if (typeof p === 'string' && p.startsWith('data:')) out.add(p);
          else if (p && typeof (p as { url?: unknown }).url === 'string' && ((p as { url: string }).url).startsWith('data:')) {
            out.add((p as { url: string }).url);
          }
        }
      }
    }
  }
  return [...out];
}

/** Swap inline draft-image URLs per `replacements` (data: URL → Storage
 *  URL). Changed chats get a fresh updatedAt so the slimmed copy wins the
 *  cross-device merge over the bloated one; untouched chats/messages keep
 *  their identity. */
export function replaceChatImageUrls(chats: SavedChat[], replacements: Map<string, string>, now: number): SavedChat[] {
  if (replacements.size === 0) return chats;
  let anyChanged = false;
  const next = chats.map((chat) => {
    let chatChanged = false;
    const messages = chat.messages.map((m) => {
      let msgChanged = false;
      const blocks = m.blocks.map((b) => {
        if (b.type !== 'recipe_draft') return b;
        const draft = b.draft as { coverPhoto?: unknown; photos?: unknown[] };
        let draftChanged = false;
        let coverPhoto = draft.coverPhoto;
        if (typeof coverPhoto === 'string' && replacements.has(coverPhoto)) {
          coverPhoto = replacements.get(coverPhoto);
          draftChanged = true;
        }
        const origPhotos = Array.isArray(draft.photos) ? draft.photos : undefined;
        const photos = origPhotos?.map((p) => {
          if (typeof p === 'string' && replacements.has(p)) { draftChanged = true; return replacements.get(p); }
          const url = (p as { url?: unknown } | null)?.url;
          if (typeof url === 'string' && replacements.has(url)) {
            draftChanged = true;
            return { ...(p as object), url: replacements.get(url) };
          }
          return p;
        });
        if (!draftChanged) return b;
        msgChanged = true;
        const nextDraft = { ...(b.draft as object), coverPhoto } as typeof b.draft;
        if (origPhotos) (nextDraft as { photos?: unknown[] }).photos = photos;
        return { ...b, draft: nextDraft };
      });
      if (!msgChanged) return m;
      chatChanged = true;
      return { ...m, blocks };
    });
    if (!chatChanged) return chat;
    anyChanged = true;
    return { ...chat, messages, updatedAt: now };
  });
  return anyChanged ? next : chats;
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
