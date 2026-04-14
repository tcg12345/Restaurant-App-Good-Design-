import React, { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { supabaseConfigured } from '../lib/supabase';
import { loadUserData, saveChats } from '../lib/supabase-db';

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

export interface ChatMessage {
  id: string;
  senderId: string;
  text: string;
  sharedRestaurant?: SharedRestaurant;
  sharedRecipe?: SharedRecipe;
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

interface ChatContextValue {
  conversations: Conversation[];
  createConversation: (participantIds: string[], name?: string) => Conversation;
  sendMessage: (conversationId: string, text: string, sharedRestaurant?: SharedRestaurant, sharedRecipe?: SharedRecipe) => void;
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
  localStorage.setItem(key, JSON.stringify(value));
}

const ChatContext = createContext<ChatContextValue | null>(null);

export const ChatProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const [conversations, setConversations] = useState<Conversation[]>(() => loadFromStorage(STORAGE_KEY, []));
  // Track last-read timestamps per conversation
  const [readTimestamps, setReadTimestamps] = useState<Record<string, number>>(() => loadFromStorage(READ_KEY, {}));
  const [cloudLoaded, setCloudLoaded] = useState(false);

  // ── Load from Supabase on sign-in ──
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let cancelled = false;

    (async () => {
      try {
        const cloud = await loadUserData(userId);
        if (cancelled) return;
        if (cloud) {
          const cloudChats = cloud.chats || [];
          const cloudRead = cloud.chatsRead || {};

          if (cloudChats.length > 0 || conversations.length === 0) {
            setConversations(cloudChats);
            setReadTimestamps(cloudRead);
            saveToStorage(STORAGE_KEY, cloudChats);
            saveToStorage(READ_KEY, cloudRead);
          }
        }
        setCloudLoaded(true);
      } catch (err) {
        console.warn('[Chat] Failed to load from cloud:', err);
        setCloudLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // ── Sync to cloud helper ──
  const syncToCloud = useCallback((chats: Conversation[], read: Record<string, number>) => {
    if (userIdRef.current && supabaseConfigured) {
      saveChats(userIdRef.current, chats, read);
    }
  }, []);

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

  const sendMessage = useCallback((conversationId: string, text: string, sharedRestaurant?: SharedRestaurant, sharedRecipe?: SharedRecipe) => {
    if (!userId) return;
    const msg: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderId: userId,
      text,
      sharedRestaurant,
      sharedRecipe,
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
      findDirectConversation, deleteConversation, renameConversation, markRead,
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
