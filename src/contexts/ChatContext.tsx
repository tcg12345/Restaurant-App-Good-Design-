import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { useLists } from './ListsContext';
import { supabaseConfigured } from '../lib/supabase';
import { loadUserData, saveChats } from '../lib/supabase-db';

/** Key under which we mirror chats into the always-present restaurant_meta
 *  JSONB column — a reliable cloud fallback when the dedicated chats /
 *  chats_read columns aren't present (mirrors __home_meals__ / __trips__). */
const META_CHATS_KEY = '__chats_v1__';

/* ── Merge helpers (union local + cloud so nothing is lost on sign-in) ── */

function mergeConversations(local: Conversation[], cloud: Conversation[]): Conversation[] {
  const byId = new Map<string, Conversation>();
  for (const c of cloud) if (c && c.id) byId.set(c.id, c);
  for (const c of local) {
    if (!c || !c.id) continue;
    const existing = byId.get(c.id);
    if (!existing) { byId.set(c.id, c); continue; }
    // Same conversation on both sides — union messages by id.
    const msgs = new Map<string, ChatMessage>();
    for (const m of existing.messages || []) msgs.set(m.id, m);
    for (const m of c.messages || []) msgs.set(m.id, m);
    const messages = [...msgs.values()].sort((a, b) => a.timestamp - b.timestamp);
    byId.set(c.id, {
      ...existing,
      ...c,
      name: c.name || existing.name,
      messages,
      lastMessageAt: Math.max(
        existing.lastMessageAt || 0,
        c.lastMessageAt || 0,
        messages.length ? messages[messages.length - 1].timestamp : 0,
      ),
      createdAt: Math.min(existing.createdAt || Date.now(), c.createdAt || Date.now()),
    });
  }
  return [...byId.values()].sort((a, b) => b.lastMessageAt - a.lastMessageAt);
}

function mergeRead(local: Record<string, number>, cloud: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...cloud };
  for (const [k, v] of Object.entries(local || {})) out[k] = Math.max(out[k] || 0, v || 0);
  return out;
}

/* ── Types ── */

export interface SharedRestaurant {
  restaurantId: string;
  name: string;
  image: string;
  cuisine: string;
  price: string;
  address: string;
  score?: number;       // if sharing a review
  notes?: string;       // review notes
  wouldReturn?: boolean;
  tags?: string[];
  isReview: boolean;    // true = sharing a review, false = sharing a detail page
}

export interface SharedRecipe {
  mealId: string;
  authorId: string;
  authorName: string;
  name: string;
  image: string;        // cover photo URL
  description?: string;
  tags?: string[];
  totalTime?: number;   // minutes
  difficulty?: string;
  ingredientCount?: number;
  stepCount?: number;
}

export interface SharedReel {
  reelId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName?: string;
  authorAvatarColor: string;
  authorInitials: string;
  isExpert: boolean;
  kind: 'restaurant' | 'recipe';
  videoUrl?: string;
  posterUrl?: string;
  bgGradient: string;
  caption: string;
  // Snapshot of the attached entity so the card can render without
  // refetching.
  attachedTitle: string;       // restaurant name or recipe title
  attachedSubtitle?: string;   // cuisine + price, or "12 min · 4 servings · Easy"
  attachedImage?: string;
  attachedRoute: string;       // /restaurant/:id  OR  /recipe/:id
}

export interface SharedPost {
  postId: string;
  authorId: string;
  authorUsername: string;
  authorDisplayName?: string;
  authorAvatarColor: string;
  authorInitials: string;
  isExpert: boolean;
  caption: string;
  locationLabel: string;
  /** First item's media URL — used as the rich preview cover. */
  coverUrl?: string;
  coverMediaType?: 'photo' | 'video';
  bgGradient: string;
  /** Total item count (drives the "8 items" / multi-item indicator). */
  itemCount: number;
}

export interface SharedGuide {
  guideId: string;
  title: string;
  subtitle: string;
  coverPhoto: string;
  authorName: string;
  /** 'restaurants' | 'recipes' — drives the icon and the route. */
  type: 'restaurants' | 'recipes';
  entryCount: number;
  avgScore: number | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  sharedRestaurant?: SharedRestaurant;
  sharedRecipe?: SharedRecipe;
  sharedReel?: SharedReel;
  sharedPost?: SharedPost;
  sharedGuide?: SharedGuide;
  timestamp: number;
}

export interface Conversation {
  id: string;
  name?: string;          // group name (undefined for 1:1 chats)
  participantIds: string[];
  messages: ChatMessage[];
  lastMessageAt: number;
  createdAt: number;
  isGroup: boolean;
}

/** Anything that can be sent inline as a rich card with a chat message. */
export interface SharePayload {
  text?: string;
  sharedRestaurant?: SharedRestaurant;
  sharedRecipe?: SharedRecipe;
  sharedReel?: SharedReel;
  sharedPost?: SharedPost;
  sharedGuide?: SharedGuide;
}

interface ChatContextValue {
  conversations: Conversation[];
  createConversation: (participantIds: string[], name?: string) => Conversation;
  sendMessage: (conversationId: string, text: string, sharedRestaurant?: SharedRestaurant, sharedRecipe?: SharedRecipe, sharedReel?: SharedReel, sharedPost?: SharedPost, sharedGuide?: SharedGuide) => void;
  /** Find an existing 1:1 chat with the friend, or create one and return it. */
  getOrCreateDirectConversation: (friendId: string) => Conversation;
  /** Convenience: resolve direct chats for the targets, then send the same
   *  payload to each. Group conversations are sent as-is. Returns the list
   *  of conversation ids that received the message. */
  shareToTargets: (targets: { conversationId?: string; friendId?: string }[], payload: SharePayload) => string[];
  getConversation: (id: string) => Conversation | undefined;
  findDirectConversation: (friendId: string) => Conversation | undefined;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, name: string) => void;
  markRead: (conversationId: string) => void;
  unreadCount: number;
  getUnreadForConversation: (conversationId: string) => number;
}

const STORAGE_KEY = 'gourmad-chats';
const READ_KEY = 'gourmad-chats-read';

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveToStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`[ChatContext] saveToStorage(${key}) failed:`, err);
  }
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  // ChatProvider is mounted inside ListsProvider, so we can mirror chats into
  // restaurant_meta (always-present) as a reliable cloud fallback.
  const { stashMetaKey } = useLists();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [conversations, setConversations] = useState<Conversation[]>(() => loadFromStorage(STORAGE_KEY, []));
  // Track last-read timestamps per conversation
  const [readTimestamps, setReadTimestamps] = useState<Record<string, number>>(() => loadFromStorage(READ_KEY, {}));
  const [cloudLoaded, setCloudLoaded] = useState(false);

  // Mirrors of state so the async cloud load can merge against the freshest
  // local data without stale closures.
  const conversationsRef = useRef(conversations);
  useEffect(() => { conversationsRef.current = conversations; }, [conversations]);
  const readRef = useRef(readTimestamps);
  useEffect(() => { readRef.current = readTimestamps; }, [readTimestamps]);

  // ── Sync to cloud helper ──
  // Dual-write: the dedicated chats/chats_read columns (best when they exist)
  // AND a copy inside restaurant_meta.__chats_v1__ — the latter always works,
  // so chats persist and follow the user across devices even on schemas where
  // the dedicated columns were never migrated.
  const syncToCloud = useCallback((chats: Conversation[], read: Record<string, number>) => {
    if (!userIdRef.current || !supabaseConfigured) return;
    saveChats(userIdRef.current, chats, read);
    stashMetaKey(META_CHATS_KEY, { chats, read });
  }, [stashMetaKey]);

  // ── Load from Supabase on sign-in: merge cloud (dedicated column OR the
  //    restaurant_meta fallback) with local, then backfill so nothing is lost. ──
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let cancelled = false;

    (async () => {
      try {
        const cloud = await loadUserData(userId);
        if (cancelled || !cloud) { setCloudLoaded(true); return; }

        const metaFallback = (cloud.restaurantMeta as Record<string, unknown> | undefined)?.[META_CHATS_KEY] as
          | { chats?: Conversation[]; read?: Record<string, number> }
          | undefined;
        const cloudChats: Conversation[] = (cloud.chats && cloud.chats.length > 0)
          ? cloud.chats
          : (Array.isArray(metaFallback?.chats) ? metaFallback!.chats! : []);
        const cloudRead: Record<string, number> = (cloud.chats && cloud.chats.length > 0)
          ? (cloud.chatsRead || {})
          : (metaFallback?.read || cloud.chatsRead || {});

        const merged = mergeConversations(conversationsRef.current, cloudChats);
        const mergedRead = mergeRead(readRef.current, cloudRead);

        setConversations(merged);
        setReadTimestamps(mergedRead);
        conversationsRef.current = merged;
        readRef.current = mergedRead;
        saveToStorage(STORAGE_KEY, merged);
        saveToStorage(READ_KEY, mergedRead);
        setCloudLoaded(true);

        // Backfill: push the union back so local-only chats reach the cloud and
        // the __chats_v1__ fallback gets created on existing accounts.
        syncToCloud(merged, mergedRead);
      } catch (err) {
        console.warn('[Chat] Failed to load from cloud:', err);
        setCloudLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, syncToCloud]);

  // Persist conversations to localStorage + cloud
  useEffect(() => {
    saveToStorage(STORAGE_KEY, conversations);
  }, [conversations]);

  useEffect(() => {
    saveToStorage(READ_KEY, readTimestamps);
  }, [readTimestamps]);

  const createConversation = useCallback((participantIds: string[], name?: string): Conversation => {
    const allParticipants = userId ? [...new Set([userId, ...participantIds])] : participantIds;
    const isGroup = allParticipants.length > 2 || !!name;
    const conv: Conversation = {
      id: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: isGroup ? (name || 'Group Chat') : undefined,
      participantIds: allParticipants,
      messages: [],
      lastMessageAt: Date.now(),
      createdAt: Date.now(),
      isGroup,
    };
    setConversations((prev) => {
      const next = [conv, ...prev];
      syncToCloud(next, readTimestamps);
      return next;
    });
    return conv;
  }, [userId, syncToCloud, readTimestamps]);

  const sendMessage = useCallback((conversationId: string, text: string, sharedRestaurant?: SharedRestaurant, sharedRecipe?: SharedRecipe, sharedReel?: SharedReel, sharedPost?: SharedPost, sharedGuide?: SharedGuide) => {
    if (!userId) return;
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: userId,
      text,
      sharedRestaurant,
      sharedRecipe,
      sharedReel,
      sharedPost,
      sharedGuide,
      timestamp: Date.now(),
    };
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === conversationId
          ? { ...c, messages: [...c.messages, msg], lastMessageAt: Date.now() }
          : c
      );
      const newRead = { ...readTimestamps, [conversationId]: Date.now() };
      syncToCloud(next, newRead);
      return next;
    });
    // Mark this conversation as read for sender
    setReadTimestamps((prev) => ({ ...prev, [conversationId]: Date.now() }));
  }, [userId, syncToCloud, readTimestamps]);

  const getConversation = useCallback((id: string) => conversations.find((c) => c.id === id), [conversations]);

  const findDirectConversation = useCallback((friendId: string): Conversation | undefined => {
    if (!userId) return undefined;
    return conversations.find((c) =>
      !c.isGroup &&
      c.participantIds.length === 2 &&
      c.participantIds.includes(userId) &&
      c.participantIds.includes(friendId)
    );
  }, [conversations, userId]);

  /** Resolve a 1:1 chat with the given friend, creating one if it doesn't
   *  exist. Returns the conv synchronously so callers can immediately
   *  sendMessage() against it. */
  const getOrCreateDirectConversation = useCallback((friendId: string): Conversation => {
    const existing = findDirectConversation(friendId);
    if (existing) return existing;
    return createConversation([friendId]);
  }, [findDirectConversation, createConversation]);

  /** Send the same payload to a list of targets (friend ids OR existing
   *  conversation ids). New direct chats are auto-created for friend
   *  ids without an existing 1:1 chat. */
  const shareToTargets = useCallback((
    targets: { conversationId?: string; friendId?: string }[],
    payload: SharePayload,
  ): string[] => {
    if (!userId || targets.length === 0) return [];
    const sentTo: string[] = [];
    const cachedByFriend: Record<string, string> = {};
    for (const t of targets) {
      let convId: string | undefined;
      if (t.conversationId) {
        convId = t.conversationId;
      } else if (t.friendId) {
        if (cachedByFriend[t.friendId]) {
          convId = cachedByFriend[t.friendId];
        } else {
          const conv = getOrCreateDirectConversation(t.friendId);
          cachedByFriend[t.friendId] = conv.id;
          convId = conv.id;
        }
      }
      if (!convId) continue;
      sendMessage(
        convId,
        payload.text || '',
        payload.sharedRestaurant,
        payload.sharedRecipe,
        payload.sharedReel,
        payload.sharedPost,
        payload.sharedGuide,
      );
      sentTo.push(convId);
    }
    return sentTo;
  }, [userId, getOrCreateDirectConversation, sendMessage]);

  const deleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      syncToCloud(next, readTimestamps);
      return next;
    });
  }, [syncToCloud, readTimestamps]);

  const renameConversation = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    setConversations((prev) => {
      const next = prev.map((c) =>
        c.id === id ? { ...c, name: trimmed || undefined } : c
      );
      syncToCloud(next, readTimestamps);
      return next;
    });
  }, [syncToCloud, readTimestamps]);

  const markRead = useCallback((conversationId: string) => {
    setReadTimestamps((prev) => {
      const next = { ...prev, [conversationId]: Date.now() };
      syncToCloud(conversations, next);
      return next;
    });
  }, [syncToCloud, conversations]);

  const getUnreadForConversation = useCallback((conversationId: string): number => {
    if (!userId) return 0;
    const conv = conversations.find((c) => c.id === conversationId);
    if (!conv) return 0;
    const lastRead = readTimestamps[conversationId] || 0;
    return conv.messages.filter((m) => m.senderId !== userId && m.timestamp > lastRead).length;
  }, [conversations, readTimestamps, userId]);

  const unreadCount = conversations.reduce((sum, c) => {
    if (!userId) return sum;
    const lastRead = readTimestamps[c.id] || 0;
    const unread = c.messages.filter((m) => m.senderId !== userId && m.timestamp > lastRead).length;
    return sum + unread;
  }, 0);

  return (
    <ChatContext.Provider value={{
      conversations, createConversation, sendMessage, getConversation,
      findDirectConversation, getOrCreateDirectConversation, shareToTargets,
      deleteConversation, renameConversation, markRead,
      unreadCount, getUnreadForConversation,
    }}>
      {children}
    </ChatContext.Provider>
  );
};

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
