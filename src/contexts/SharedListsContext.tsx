/**
 * Shared lists — the signed-in person's collaborative lists, loaded once
 * per sign-in and kept fresh by realtime (when the database publishes the
 * tables) and by a refetch on foreground.
 *
 * Entries are loaded per list on demand (the Pantry asks for the one on
 * screen) and cached here so switching between lists doesn't refetch, and
 * so a realtime change to one entry patches the cache in place.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { supabase, supabaseConfigured } from '../lib/supabase';
import {
  getMySharedLists, getSharedListEntries, createSharedList, updateSharedList, deleteSharedList, leaveSharedList,
  addSharedListEntry, removeSharedListEntry, setSharedGroupScore,
  type SharedList, type SharedListEntry, type SharedRatingMode,
} from '../lib/supabase-shared-lists';
import type { RestaurantMeta } from './ListsContext';

interface SharedListsValue {
  sharedLists: SharedList[];
  loaded: boolean;
  refresh: () => Promise<void>;
  /** Entries for a list, or undefined until first loaded. */
  entriesFor: (listId: string) => SharedListEntry[] | undefined;
  loadEntries: (listId: string) => Promise<SharedListEntry[]>;
  create: (input: { name: string; emoji: string; ratingMode: SharedRatingMode; memberIds: string[] }) => Promise<{ list: SharedList } | { error: string }>;
  update: (id: string, patch: Partial<{ name: string; emoji: string; ratingMode: SharedRatingMode; memberIds: string[] }>) => Promise<{ success: boolean; error?: string }>;
  remove: (id: string) => Promise<boolean>;
  leave: (id: string) => Promise<boolean>;
  addPlace: (listId: string, meta: RestaurantMeta) => Promise<{ success: boolean; error?: string }>;
  removePlace: (listId: string, restaurantId: string) => Promise<boolean>;
  setGroupScore: (listId: string, restaurantId: string, score: number | null, notes?: string) => Promise<boolean>;
}

const Ctx = createContext<SharedListsValue | null>(null);

export const SharedListsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [sharedLists, setSharedLists] = useState<SharedList[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<Record<string, SharedListEntry[]>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const refresh = useCallback(async () => {
    if (!userId || !supabaseConfigured) { setSharedLists([]); setLoaded(true); return; }
    const lists = await getMySharedLists();
    setSharedLists(lists);
    setLoaded(true);
  }, [userId]);

  useEffect(() => {
    setEntries({});
    setLoaded(false);
    void refresh();
  }, [refresh]);

  // Foreground refetch: cheap, and covers a database without realtime.
  useEffect(() => {
    if (!userId) return;
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [userId, refresh]);

  // Realtime: patch entries in place; reload the list rows on any list change
  // (membership edits arrive here too — being removed makes the row vanish).
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      channel = supabase.channel(`shared-lists-${userId}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_lists' }, () => { void refresh(); })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_list_entries' }, (payload) => {
          const row = (payload.new && Object.keys(payload.new).length ? payload.new : payload.old) as { list_id?: string } | null;
          const listId = row?.list_id;
          if (!listId || !(listId in entriesRef.current)) return;
          void getSharedListEntries(listId).then((rows) => setEntries((prev) => ({ ...prev, [listId]: rows })));
        })
        .subscribe();
    } catch { /* realtime unavailable — foreground refetch covers it */ }
    return () => { if (channel) void supabase.removeChannel(channel); };
  }, [userId, refresh]);

  const loadEntries = useCallback(async (listId: string) => {
    const rows = await getSharedListEntries(listId);
    setEntries((prev) => ({ ...prev, [listId]: rows }));
    return rows;
  }, []);

  const entriesFor = useCallback((listId: string) => entries[listId], [entries]);

  const create = useCallback<SharedListsValue['create']>(async (input) => {
    if (!userId) return { error: 'Sign in to create a shared list.' };
    const res = await createSharedList({ ownerId: userId, ...input });
    if ('list' in res) {
      setSharedLists((prev) => [res.list, ...prev]);
      setEntries((prev) => ({ ...prev, [res.list.id]: [] }));
    }
    return res;
  }, [userId]);

  const update = useCallback<SharedListsValue['update']>(async (id, patch) => {
    const prev = sharedLists;
    setSharedLists((ls) => ls.map((l) => l.id === id ? { ...l, ...(patch.name !== undefined ? { name: patch.name } : {}), ...(patch.emoji !== undefined ? { emoji: patch.emoji } : {}), ...(patch.ratingMode !== undefined ? { ratingMode: patch.ratingMode } : {}), ...(patch.memberIds !== undefined ? { memberIds: patch.memberIds } : {}) } : l));
    const res = await updateSharedList(id, patch);
    if (!res.success) setSharedLists(prev);
    return res;
  }, [sharedLists]);

  const remove = useCallback(async (id: string) => {
    const ok = await deleteSharedList(id);
    if (ok) setSharedLists((ls) => ls.filter((l) => l.id !== id));
    return ok;
  }, []);

  const leave = useCallback(async (id: string) => {
    const ok = await leaveSharedList(id);
    if (ok) setSharedLists((ls) => ls.filter((l) => l.id !== id));
    return ok;
  }, []);

  const addPlace = useCallback<SharedListsValue['addPlace']>(async (listId, meta) => {
    if (!userId) return { success: false, error: 'Sign in first.' };
    const res = await addSharedListEntry(listId, userId, meta);
    if ('error' in res) return { success: false, error: res.error };
    setEntries((prev) => {
      const cur = prev[listId] || [];
      if (cur.some((e) => e.restaurantId === res.entry.restaurantId)) return prev;
      return { ...prev, [listId]: [...cur, res.entry] };
    });
    return { success: true };
  }, [userId]);

  const removePlace = useCallback(async (listId: string, restaurantId: string) => {
    const before = entriesRef.current[listId];
    setEntries((prev) => ({ ...prev, [listId]: (prev[listId] || []).filter((e) => e.restaurantId !== restaurantId) }));
    const ok = await removeSharedListEntry(listId, restaurantId);
    if (!ok && before) setEntries((prev) => ({ ...prev, [listId]: before }));
    return ok;
  }, []);

  const setGroupScore = useCallback<SharedListsValue['setGroupScore']>(async (listId, restaurantId, score, notes = '') => {
    if (!userId) return false;
    const before = entriesRef.current[listId];
    setEntries((prev) => ({
      ...prev,
      [listId]: (prev[listId] || []).map((e) => e.restaurantId === restaurantId
        ? { ...e, groupScore: score, groupNotes: notes, groupScoredBy: score == null ? null : userId, groupScoredAt: score == null ? null : new Date().toISOString() }
        : e),
    }));
    const ok = await setSharedGroupScore(listId, restaurantId, userId, score, notes);
    if (!ok && before) setEntries((prev) => ({ ...prev, [listId]: before }));
    return ok;
  }, [userId]);

  const value = useMemo<SharedListsValue>(() => ({
    sharedLists, loaded, refresh, entriesFor, loadEntries, create, update, remove, leave, addPlace, removePlace, setGroupScore,
  }), [sharedLists, loaded, refresh, entriesFor, loadEntries, create, update, remove, leave, addPlace, removePlace, setGroupScore]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useSharedLists(): SharedListsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSharedLists must be used within SharedListsProvider');
  return v;
}
