import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';

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

/* ── Persistence model ──
 *
 * Conversations and messages live in the shared `conversations` /
 * `messages` / `conversation_reads` tables (migration 037) with
 * participant-scoped RLS — messages are actually delivered to the other
 * participants, unlike the old model that wrote the sender's own
 * user_app_data blob. New messages arrive over a realtime subscription.
 *
 * localStorage is ONLY a per-user display cache so the messages screen
 * paints instantly on reload; the server is the source of truth. The old
 * single-player keys (gourmad-chats / gourmad-chats-read) are discarded on
 * startup — that data was never delivered to anyone.
 */

const LEGACY_KEYS = ['gourmad-chats', 'gourmad-chats-read'];
const cacheKey = (uid: string) => `gourmad-chats-v2:${uid}`;

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

/* ── Row mapping ── */

interface ConversationRow {
  id: string;
  participant_ids: string[] | null;
  is_group: boolean | null;
  name: string | null;
  created_at: string | null;
  last_message_at: string | null;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string | null;
  shared_payload: Record<string, unknown> | null;
  created_at: string | null;
}

const parseTs = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Date.now();
};

function rowToMessage(row: MessageRow): ChatMessage {
  const shared = (row.shared_payload && typeof row.shared_payload === 'object') ? row.shared_payload : {};
  return {
    id: row.id,
    senderId: row.sender_id,
    text: row.text || '',
    sharedRestaurant: shared.sharedRestaurant as SharedRestaurant | undefined,
    sharedRecipe: shared.sharedRecipe as SharedRecipe | undefined,
    sharedReel: shared.sharedReel as SharedReel | undefined,
    sharedPost: shared.sharedPost as SharedPost | undefined,
    sharedGuide: shared.sharedGuide as SharedGuide | undefined,
    timestamp: parseTs(row.created_at),
  };
}

function rowToConversation(row: ConversationRow, messages: ChatMessage[]): Conversation {
  return {
    id: row.id,
    name: row.name || undefined,
    participantIds: row.participant_ids || [],
    messages,
    lastMessageAt: parseTs(row.last_message_at || row.created_at),
    createdAt: parseTs(row.created_at),
    isGroup: !!row.is_group,
  };
}

const byNewestActivity = (a: Conversation, b: Conversation) => b.lastMessageAt - a.lastMessageAt;

function buildSharedPayload(msg: ChatMessage): Record<string, unknown> | null {
  const payload: Record<string, unknown> = {};
  if (msg.sharedRestaurant) payload.sharedRestaurant = msg.sharedRestaurant;
  if (msg.sharedRecipe) payload.sharedRecipe = msg.sharedRecipe;
  if (msg.sharedReel) payload.sharedReel = msg.sharedReel;
  if (msg.sharedPost) payload.sharedPost = msg.sharedPost;
  if (msg.sharedGuide) payload.sharedGuide = msg.sharedGuide;
  return Object.keys(payload).length > 0 ? payload : null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  // Last-read timestamps per conversation (mirrors conversation_reads rows).
  const [readTimestamps, setReadTimestamps] = useState<Record<string, number>>({});

  // Which user the current state was hydrated for — gates the cache-persist
  // effect so a user switch can never write user A's chats under B's key.
  const hydratedForRef = useRef<string | null>(null);
  // Conversation inserts still in flight, so sendMessage can await the row
  // before inserting a message that references it (FK).
  const pendingCreates = useRef(new Map<string, Promise<unknown>>());
  // Conversations being fetched after a realtime message for an unknown id.
  const fetchingConvs = useRef(new Set<string>());

  // ── Cache persist (display cache only — server is source of truth) ──
  useEffect(() => {
    if (!userId || hydratedForRef.current !== userId) return;
    saveToStorage(cacheKey(userId), { conversations, read: readTimestamps });
  }, [conversations, readTimestamps, userId]);

  // A realtime message can reference a conversation we don't know yet
  // (a friend just started a chat with us) — fetch it plus its history.
  const fetchConversation = useCallback(async (convId: string) => {
    if (!supabaseConfigured || fetchingConvs.current.has(convId)) return;
    fetchingConvs.current.add(convId);
    try {
      const [convRes, msgRes] = await Promise.all([
        supabase.from('conversations').select('*').eq('id', convId).maybeSingle(),
        supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: true }),
      ]);
      const row = convRes.data as ConversationRow | null;
      if (!row) return;
      const conv = rowToConversation(row, ((msgRes.data || []) as MessageRow[]).map(rowToMessage));
      setConversations((prev) => prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev].sort(byNewestActivity));
    } catch (err) {
      console.warn('[Chat] fetchConversation failed:', err);
    } finally {
      fetchingConvs.current.delete(convId);
    }
  }, []);

  // ── Load + realtime subscription per signed-in user ──
  useEffect(() => {
    // The pre-037 keys held the single-player illusion (never delivered to
    // anyone) — discard rather than migrate.
    try { LEGACY_KEYS.forEach((k) => localStorage.removeItem(k)); } catch { /* ignore */ }

    if (!userId) {
      hydratedForRef.current = null;
      setConversations([]);
      setReadTimestamps({});
      return;
    }

    // Instant paint from the per-user display cache.
    const cached = loadFromStorage<{ conversations?: Conversation[]; read?: Record<string, number> } | null>(cacheKey(userId), null);
    setConversations(Array.isArray(cached?.conversations) ? cached!.conversations! : []);
    setReadTimestamps(cached?.read && typeof cached.read === 'object' ? cached.read : {});
    hydratedForRef.current = userId;

    if (!supabaseConfigured) return;

    let cancelled = false;
    (async () => {
      try {
        const { data: convRows, error: convErr } = await supabase
          .from('conversations')
          .select('*')
          .contains('participant_ids', [userId])
          .order('last_message_at', { ascending: false });
        if (convErr) { console.warn('[Chat] load conversations failed:', convErr.message); return; }
        const rows = (convRows || []) as ConversationRow[];
        const ids = rows.map((r) => r.id);

        const [msgRes, readRes] = await Promise.all([
          ids.length > 0
            ? supabase.from('messages').select('*').in('conversation_id', ids).order('created_at', { ascending: true })
            : Promise.resolve({ data: [], error: null }),
          supabase.from('conversation_reads').select('conversation_id, last_read_at').eq('user_id', userId),
        ]);
        if (cancelled) return;
        if (msgRes.error) { console.warn('[Chat] load messages failed:', msgRes.error.message); return; }

        const msgsByConv = new Map<string, ChatMessage[]>();
        for (const raw of (msgRes.data || []) as MessageRow[]) {
          const list = msgsByConv.get(raw.conversation_id) || [];
          list.push(rowToMessage(raw));
          msgsByConv.set(raw.conversation_id, list);
        }
        const convs = rows.map((r) => rowToConversation(r, msgsByConv.get(r.id) || [])).sort(byNewestActivity);

        const read: Record<string, number> = {};
        for (const r of (readRes.data || []) as Array<{ conversation_id: string; last_read_at: string }>) {
          read[r.conversation_id] = parseTs(r.last_read_at);
        }

        setConversations(convs);
        setReadTimestamps(read);
        saveToStorage(cacheKey(userId), { conversations: convs, read });
      } catch (err) {
        console.warn('[Chat] load failed:', err);
      }
    })();

    // Realtime: RLS scopes postgres_changes per subscriber, so this only
    // delivers INSERTs on messages in conversations the user belongs to.
    const channel = supabase
      .channel(`messages-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const row = payload.new as MessageRow;
        if (!row?.id || !row.conversation_id) return;
        setConversations((prev) => {
          const idx = prev.findIndex((c) => c.id === row.conversation_id);
          if (idx === -1) {
            // New conversation started by someone else — pull it in.
            void fetchConversation(row.conversation_id);
            return prev;
          }
          const conv = prev[idx];
          if (conv.messages.some((m) => m.id === row.id)) return prev; // own optimistic echo
          const msg = rowToMessage(row);
          const next = [...prev];
          next[idx] = {
            ...conv,
            messages: [...conv.messages, msg].sort((a, b) => a.timestamp - b.timestamp),
            lastMessageAt: Math.max(conv.lastMessageAt, msg.timestamp),
          };
          return next.sort(byNewestActivity);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId, fetchConversation]);

  // ── Remote write helpers (optimistic local state + fire-and-forget) ──

  const persistReadState = useCallback((conversationId: string, atMs: number) => {
    const uid = userIdRef.current;
    if (!uid || !supabaseConfigured) return;
    void (async () => {
      try {
        const pending = pendingCreates.current.get(conversationId);
        if (pending) await pending;
        const { error } = await supabase.from('conversation_reads').upsert({
          conversation_id: conversationId,
          user_id: uid,
          last_read_at: new Date(atMs).toISOString(),
        }, { onConflict: 'conversation_id,user_id' });
        if (error) console.warn('[Chat] persist read state failed:', error.message);
      } catch (err) {
        console.warn('[Chat] persist read state failed:', err);
      }
    })();
  }, []);

  const createConversation = useCallback((participantIds: string[], name?: string): Conversation => {
    const allParticipants = userId ? [...new Set([userId, ...participantIds])] : [...new Set(participantIds)];
    const isGroup = allParticipants.length > 2 || !!name;
    const conv: Conversation = {
      id: crypto.randomUUID(),
      name: isGroup ? (name || 'Group Chat') : undefined,
      participantIds: allParticipants,
      messages: [],
      lastMessageAt: Date.now(),
      createdAt: Date.now(),
      isGroup,
    };
    setConversations((prev) => [conv, ...prev]);
    if (userId && supabaseConfigured) {
      const insert = supabase.from('conversations').insert({
        id: conv.id,
        participant_ids: allParticipants,
        is_group: isGroup,
        name: conv.name ?? null,
      }).then(({ error }) => {
        if (error) console.warn('[Chat] create conversation failed:', error.message);
        pendingCreates.current.delete(conv.id);
      });
      pendingCreates.current.set(conv.id, insert);
    }
    return conv;
  }, [userId]);

  const sendMessage = useCallback((conversationId: string, text: string, sharedRestaurant?: SharedRestaurant, sharedRecipe?: SharedRecipe, sharedReel?: SharedReel, sharedPost?: SharedPost, sharedGuide?: SharedGuide) => {
    if (!userId) return;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: userId,
      text,
      sharedRestaurant,
      sharedRecipe,
      sharedReel,
      sharedPost,
      sharedGuide,
      timestamp: Date.now(),
    };
    setConversations((prev) => prev.map((c) =>
      c.id === conversationId
        ? { ...c, messages: [...c.messages, msg], lastMessageAt: msg.timestamp }
        : c
    ).sort(byNewestActivity));
    // Sending implies having read the conversation.
    setReadTimestamps((prev) => ({ ...prev, [conversationId]: msg.timestamp }));

    if (supabaseConfigured) {
      void (async () => {
        try {
          const pending = pendingCreates.current.get(conversationId);
          if (pending) await pending;
          const { error } = await supabase.from('messages').insert({
            id: msg.id,
            conversation_id: conversationId,
            sender_id: userId,
            text,
            shared_payload: buildSharedPayload(msg),
          });
          if (error) console.warn('[Chat] send failed:', error.message);
        } catch (err) {
          console.warn('[Chat] send failed:', err);
        }
      })();
      persistReadState(conversationId, msg.timestamp);
    }
  }, [userId, persistReadState]);

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
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setReadTimestamps((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (userIdRef.current && supabaseConfigured) {
      void (async () => {
        try {
          const pending = pendingCreates.current.get(id);
          if (pending) await pending;
          const { error } = await supabase.from('conversations').delete().eq('id', id);
          if (error) console.warn('[Chat] delete conversation failed:', error.message);
        } catch (err) {
          console.warn('[Chat] delete conversation failed:', err);
        }
      })();
    }
  }, []);

  const renameConversation = useCallback((id: string, name: string) => {
    const trimmed = name.trim();
    setConversations((prev) => prev.map((c) =>
      c.id === id ? { ...c, name: trimmed || undefined } : c
    ));
    if (userIdRef.current && supabaseConfigured) {
      void (async () => {
        try {
          const pending = pendingCreates.current.get(id);
          if (pending) await pending;
          const { error } = await supabase.from('conversations').update({ name: trimmed || null }).eq('id', id);
          if (error) console.warn('[Chat] rename conversation failed:', error.message);
        } catch (err) {
          console.warn('[Chat] rename conversation failed:', err);
        }
      })();
    }
  }, []);

  const markRead = useCallback((conversationId: string) => {
    const now = Date.now();
    setReadTimestamps((prev) => ({ ...prev, [conversationId]: now }));
    persistReadState(conversationId, now);
  }, [persistReadState]);

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
