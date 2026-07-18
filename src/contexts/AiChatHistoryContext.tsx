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
// (instant, offline-safe); Supabase is the cross-device sync layer.
//
// Sync model: every cloud sync is READ-MERGE-WRITE, not a blind overwrite —
// pull the cloud copy, union it with local (tombstones suppress deleted
// ids), commit the merge locally, and push only when something actually
// differs. Two live devices therefore converge instead of last-writer-wins
// clobbering each other's whole history, and a chat deleted on one device
// stays deleted everywhere (the tombstone outlives the other device's
// stale copy). Syncs run on sign-in, debounced after every change, and on
// returning to the foreground (throttled); the tab-hide/unmount flush is
// the one blind write — at teardown, finishing the write beats reading
// first, and any clobber it causes is healed by the next merged sync.

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import {
  loadSavedChats,
  persistSavedChats,
  loadChatTombstones,
  persistChatTombstones,
  mergeChats,
  mergeTombstones,
  boundChats,
  sameChatSet,
  sameTombstoneSet,
  buildGeneratedRecipeChat,
  collectChatImageDataUrls,
  replaceChatImageUrls,
  CHAT_USER_KEY,
  type SavedChat,
  type ChatTombstone,
} from '../lib/ai-chat-history';
import { loadAiChatHistory, saveAiChatHistory } from '../lib/supabase-ai-chat';
import { uploadPhoto } from '../lib/images';
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
/** Minimum gap between foreground-return pulls, so tab-switch-happy desktop
 *  use doesn't hammer the row. */
const FOREGROUND_PULL_MIN_MS = 60_000;
/** Quiet period before migrating inline draft images out of saved chats.
 *  Long enough that the live chat's own upload retry (LocationChat's
 *  cover-photo path) usually wins first — it also fixes the open
 *  conversation's state, where this migration can only fix the history. */
const CHAT_IMAGE_MIGRATE_DELAY_MS = 8_000;

export const AiChatHistoryProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [savedChats, setSavedChatsState] = useState<SavedChat[]>(() => loadSavedChats());

  // Mirrors state so async flows (cloud merge) can read the freshest value
  // without adding it to effect deps.
  const savedChatsRef = useRef(savedChats);
  useEffect(() => { savedChatsRef.current = savedChats; }, [savedChats]);

  // Deletion tombstones — plain ref (never rendered), lazily hydrated from
  // localStorage once. Kept in lockstep with the persisted copy.
  const tombstonesLoadedRef = useRef(false);
  const tombstonesRef = useRef<ChatTombstone[]>([]);
  if (!tombstonesLoadedRef.current) {
    tombstonesLoadedRef.current = true;
    tombstonesRef.current = loadChatTombstones();
  }

  const userIdRef = useRef<string | null>(null);
  // Gates cloud writes until the initial cloud load + merge has run, so we
  // never clobber a device's cloud history with a half-loaded local set.
  const cloudReadyRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncInFlightRef = useRef(false);
  const syncQueuedRef = useRef(false);
  const lastPullAtRef = useRef(0);

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
    // Tombstone BEFORE dropping the chat: the merge is a union, so without
    // a tombstone the cloud's (or another device's) copy would resurrect
    // the chat on the very next sync. A later upsert of the same id stamps
    // a fresh updatedAt, which outranks the tombstone in mergeChats — so
    // deliberately continuing a conversation still works.
    tombstonesRef.current = mergeTombstones(tombstonesRef.current, [{ id, deletedAt: Date.now() }]);
    persistChatTombstones(tombstonesRef.current);
    commit((prev) => prev.filter((c) => c.id !== id));
  }, [commit]);

  const addGeneratedRecipeChat = useCallback(
    (args: { prompt: string; draft: HomeMeal; rawInput: unknown }) => {
      commit((prev) => [buildGeneratedRecipeChat(args), ...prev]);
    },
    [commit],
  );

  // One read-merge-write sync cycle. Pull the cloud copy, fold it into
  // local (tombstone union first, then the tombstone-aware chat merge),
  // commit locally when the merge changed anything, and push back only when
  // the cloud copy differs from the merge. Serialized: a request that lands
  // mid-cycle queues one follow-up cycle rather than racing it. A failed
  // READ aborts the cycle without writing — pushing local over an
  // unreadable cloud copy is exactly the clobbering this replaces.
  const syncWithCloud = useCallback(async () => {
    if (syncInFlightRef.current) { syncQueuedRef.current = true; return; }
    syncInFlightRef.current = true;
    try {
      do {
        syncQueuedRef.current = false;
        const uid = userIdRef.current;
        if (!uid || !cloudReadyRef.current) return;
        const cloud = await loadAiChatHistory(uid);
        if (userIdRef.current !== uid) return; // account changed mid-flight
        if (cloud === null) return; // cloud unreadable — retry on the next trigger
        lastPullAtRef.current = Date.now();
        const tombstones = mergeTombstones(tombstonesRef.current, cloud.tombstones);
        if (!sameTombstoneSet(tombstones, tombstonesRef.current)) {
          tombstonesRef.current = tombstones;
          persistChatTombstones(tombstones);
        }
        const merged = mergeChats(savedChatsRef.current, cloud.chats, tombstones);
        if (!sameChatSet(merged, savedChatsRef.current)) {
          savedChatsRef.current = merged;
          setSavedChatsState(merged);
          persistSavedChats(merged);
        }
        if (!sameChatSet(merged, cloud.chats) || !sameTombstoneSet(tombstones, cloud.tombstones)) {
          await saveAiChatHistory(uid, merged, tombstones);
        }
      } while (syncQueuedRef.current);
    } finally {
      syncInFlightRef.current = false;
    }
  }, []);

  // Push the current chats to the cloud for `uid` NOW, cancelling any pending
  // debounce. Called on sign-out / account-switch, tab-hide, and unmount so a
  // chat made in the last debounce window still syncs instead of being lost
  // with the timer. This is the one BLIND write: at teardown a read-then-write
  // would often complete neither, and any clobber is healed by the next
  // read-merge-write sync. No-ops before the initial hydrate (cloudReadyRef)
  // so we never clobber the cloud with a half-loaded set.
  const flushCloudSave = useCallback((uid: string | null) => {
    if (saveTimerRef.current) { clearTimeout(saveTimerRef.current); saveTimerRef.current = null; }
    if (!uid || !cloudReadyRef.current) return;
    saveAiChatHistory(uid, savedChatsRef.current, tombstonesRef.current);
  }, []);

  // On sign-out / account switch, flush the PREVIOUS user's latest chats to
  // their cloud before the load effect below resets cloudReady and (maybe)
  // wipes local. Defined before that effect so it runs first on a userId
  // change, while cloudReadyRef still reflects the prior session.
  const prevUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevUserIdRef.current;
    if (prev && prev !== userId) flushCloudSave(prev);
    prevUserIdRef.current = userId;
  }, [userId, flushCloudSave]);

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

    // Drop the previous account's chats AND tombstones from this device.
    if (accountSwitched) {
      setSavedChatsState([]);
      savedChatsRef.current = [];
      tombstonesRef.current = [];
      persistChatTombstones([]);
    }

    (async () => {
      const cloud = await loadAiChatHistory(userId);
      if (cancelled || userIdRef.current !== userId) return;
      if (cloud === null) {
        // Read failed (offline / column missing). Go ready WITHOUT pushing:
        // later sync cycles read-merge-write, so nothing local is lost and
        // an unreadable cloud copy is never overwritten blind.
        cloudReadyRef.current = true;
        return;
      }
      lastPullAtRef.current = Date.now();
      const tombstones = mergeTombstones(tombstonesRef.current, cloud.tombstones);
      tombstonesRef.current = tombstones;
      persistChatTombstones(tombstones);
      const base = accountSwitched ? [] : savedChatsRef.current;
      const merged = mergeChats(base, cloud.chats, tombstones);
      setSavedChatsState(merged);
      persistSavedChats(merged);
      savedChatsRef.current = merged;
      cloudReadyRef.current = true;
      // Push back only when the merge differs from the cloud copy (local-only
      // chats, suppressed deletions, fresh tombstones).
      if (!sameChatSet(merged, cloud.chats) || !sameTombstoneSet(tombstones, cloud.tombstones)) {
        saveAiChatHistory(userId, merged, tombstones);
      }
    })();

    return () => { cancelled = true; };
  }, [userId]);

  // Debounced sync on every change once hydrated. The cycle's own state
  // commit re-triggers this effect, but the follow-up cycle finds nothing
  // changed and writes nothing — it settles after one extra read.
  useEffect(() => {
    if (!userId || !cloudReadyRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => { void syncWithCloud(); }, CLOUD_SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [savedChats, userId, syncWithCloud]);

  // Migrate inline draft images out of saved history. The draft sheet
  // uploads covers to Storage before applying, so a data: URL in a saved
  // chat means an upload fell back inline (offline, signed out, legacy
  // data from before uploads existed) — persisted whole, one such image
  // can trip persistSavedChats' quota fallback and evict the oldest chats.
  // After a quiet period (so the live chat's own retry gets first crack),
  // upload each inline image and swap the URL in place; the bumped
  // updatedAt makes the slimmed copy win the cross-device merge. Failures
  // stay inline and re-arm on the next history change or app start.
  const chatImageMigrateInFlightRef = useRef(false);
  useEffect(() => {
    if (!userId) return; // uploads need a session
    if (collectChatImageDataUrls(savedChats).length === 0) return;
    const t = setTimeout(() => {
      if (chatImageMigrateInFlightRef.current) return;
      chatImageMigrateInFlightRef.current = true;
      void (async () => {
        try {
          const pending = collectChatImageDataUrls(savedChatsRef.current);
          const replacements = new Map<string, string>();
          for (const url of pending) {
            try {
              replacements.set(url, await uploadPhoto(url));
            } catch { /* still offline / no session — retried on the next change */ }
          }
          if (replacements.size > 0) {
            commit((prev) => replaceChatImageUrls(prev, replacements, Date.now()));
          }
        } finally {
          chatImageMigrateInFlightRef.current = false;
        }
      })();
    }, CHAT_IMAGE_MIGRATE_DELAY_MS);
    return () => clearTimeout(t);
  }, [savedChats, userId, commit]);

  // Flush on tab-hide / background / close and on unmount, so a chat made
  // right before leaving the app still reaches the cloud rather than dying
  // with the pending debounce timer. visibilitychange fires reliably on
  // mobile backgrounding and most desktop tab closes. Returning to the
  // foreground instead PULLS (throttled): another device may have been the
  // active one meanwhile, and sign-in was previously the only time we read.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        flushCloudSave(userIdRef.current);
      } else if (Date.now() - lastPullAtRef.current > FOREGROUND_PULL_MIN_MS) {
        void syncWithCloud();
      }
    };
    const onPageHide = () => flushCloudSave(userIdRef.current);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      flushCloudSave(userIdRef.current);
    };
  }, [flushCloudSave, syncWithCloud]);

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
