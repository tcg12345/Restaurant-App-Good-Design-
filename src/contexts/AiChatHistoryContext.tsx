// Cloud-synced store for the "Ask a local" AI assistant chat history.
//
// Why a context: the history is read + written by LocationChat (the live
// conversation auto-saves into it) AND by the Add Recipe modal's "Create
// with AI" flow (a generated recipe is recorded as a one-turn chat). Both
// mount under this provider, so they share one source of truth that also
// persists to Supabase — meaning history follows the user across devices
// and deployments, not just this browser's localStorage.
//
// Persistence mirrors ListsContext: localStorage is the always-on cache
// (instant, offline-safe); Supabase is the cross-device sync layer, loaded
// + merged on sign-in and written debounced on change.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  loadSavedChats,
  persistSavedChats,
  mergeChats,
  boundChats,
  buildGeneratedRecipeChat,
  CHAT_USER_KEY,
  type SavedChat,
} from '../lib/ai-chat-history';
import { loadAiChatHistory, saveAiChatHistory } from '../lib/supabase-ai-chat';
import type { HomeMeal } from './ListsContext';

/** What a caller passes to upsert the live conversation — the context
 *  fills in createdAt (preserved across updates) and updatedAt. */
type UpsertChatInput = Pick<SavedChat, 'id' | 'title' | 'messages' | 'chatPlaces'>;

interface AiChatHistoryValue {
  savedChats: SavedChat[];
  /** Create or update a saved chat by id (used by the live conversation
   *  auto-save). createdAt is preserved when the id already exists. */
  upsertChat: (chat: UpsertChatInput) => void;
  deleteChat: (id: string) => void;
  /** Record a recipe drafted outside the chat (the modal generator) as a
   *  one-turn conversation so it shows up in history. */
  addGeneratedRecipeChat: (args: { prompt: string; draft: HomeMeal; rawInput: unknown }) => void;
}

const AiChatHistoryContext = createContext<AiChatHistoryValue | null>(null);

const CLOUD_SAVE_DEBOUNCE_MS = 800;

export const AiChatHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [savedChats, setSavedChatsState] = useState<SavedChat[]>(() => loadSavedChats());

  // Mirrors state so async flows (cloud merge) can read the freshest value
  // without adding it to effect deps.
  const savedChatsRef = useRef(savedChats);
  useEffect(() => { savedChatsRef.current = savedChats; }, [savedChats]);

  const userIdRef = useRef<string | null>(null);
  // Gates cloud writes until the initial cloud load + merge has run, so we
  // never clobber a device's cloud history with a half-loaded local set.
  const cloudReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Update state + localStorage together, always bounded + newest-first.
  const commit = useCallback((updater: (prev: SavedChat[]) => SavedChat[]) => {
    setSavedChatsState((prev) => {
      const next = boundChats(updater(prev));
      persistSavedChats(next);
      return next;
    });
  }, []);

  const upsertChat = useCallback((chat: UpsertChatInput) => {
    commit((prev) => {
      const now = Date.now();
      const idx = prev.findIndex((c) => c.id === chat.id);
      const full: SavedChat = {
        id: chat.id,
        title: chat.title,
        createdAt: idx >= 0 ? prev[idx].createdAt : now,
        updatedAt: now,
        messages: chat.messages,
        chatPlaces: chat.chatPlaces,
      };
      return idx >= 0 ? prev.map((c, i) => (i === idx ? full : c)) : [full, ...prev];
    });
  }, [commit]);

  const deleteChat = useCallback((id: string) => {
    commit((prev) => prev.filter((c) => c.id !== id));
  }, [commit]);

  const addGeneratedRecipeChat = useCallback(
    (args: { prompt: string; draft: HomeMeal; rawInput: unknown }) => {
      commit((prev) => [buildGeneratedRecipeChat(args), ...prev]);
    },
    [commit],
  );

  // Load + merge cloud history on sign-in (and clear another account's
  // local cache if a different user signs in on this device).
  useEffect(() => {
    userIdRef.current = userId;
    if (!userId) { cloudReadyRef.current = false; return; }

    let cancelled = false;
    cloudReadyRef.current = false;

    let accountSwitched = false;
    try {
      const storedUser = localStorage.getItem(CHAT_USER_KEY);
      accountSwitched = !!storedUser && storedUser !== userId;
      localStorage.setItem(CHAT_USER_KEY, userId);
    } catch { /* ignore storage errors */ }

    // Drop the previous account's chats from the UI immediately.
    if (accountSwitched) { setSavedChatsState([]); savedChatsRef.current = []; }

    (async () => {
      const cloud = await loadAiChatHistory(userId);
      if (cancelled || userIdRef.current !== userId) return;
      const base = accountSwitched ? [] : savedChatsRef.current;
      const merged = mergeChats(base, cloud);
      setSavedChatsState(merged);
      persistSavedChats(merged);
      savedChatsRef.current = merged;
      cloudReadyRef.current = true;
      // Push merged back so local-only chats land in the cloud too.
      saveAiChatHistory(userId, merged);
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // Debounced cloud write on every change once hydrated.
  useEffect(() => {
    if (!userId || !cloudReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (userIdRef.current) saveAiChatHistory(userIdRef.current, savedChatsRef.current);
    }, CLOUD_SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [savedChats, userId]);

  return (
    <AiChatHistoryContext.Provider value={{ savedChats, upsertChat, deleteChat, addGeneratedRecipeChat }}>
      {children}
    </AiChatHistoryContext.Provider>
  );
};

export function useAiChatHistory(): AiChatHistoryValue {
  const ctx = useContext(AiChatHistoryContext);
  if (!ctx) throw new Error('useAiChatHistory must be used within AiChatHistoryProvider');
  return ctx;
}
