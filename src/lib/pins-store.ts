/**
 * The signed-in person's pins, shared by every surface that shows or edits
 * them (the profile shelf, the editor sheet, the tile menus).
 *
 * The truth is user_profiles.pinned, which arrives on AuthContext's
 * `profile`. This store is the optimistic copy: a toggle applies here at
 * once and writes through savePinned. It deliberately does NOT refresh
 * the profile afterwards — a refresh re-renders every profile consumer
 * mid-gesture (it closed the editor sheet under the finger) and buys
 * nothing, since this store is what the shelf and the editor read. The
 * store re-seeds only when the profile row brings a value it hasn't seen
 * before (sign-in, another device), never from the same stale value.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { savePinned } from './supabase-community';
import { isPinned as isPinnedIn, normalizePins, togglePin, MAX_PINS, type PinnedItem } from './pins';

type State = { userId: string | null; pins: PinnedItem[] };
let state: State = { userId: null, pins: [] };
/** The last user_profiles.pinned value we took a seed from. */
let lastProfileJson = '';
const listeners = new Set<() => void>();

const emit = () => { for (const l of listeners) l(); };
const set = (next: State) => { state = next; emit(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

/** Seed from the profile row, but only when the row says something new.
 *  After a local save the profile object is stale until its next load;
 *  its unchanged value must not roll the store back. */
function seed(userId: string | null, raw: unknown) {
  const pins = normalizePins(raw);
  const json = `${userId ?? ''}:${JSON.stringify(pins)}`;
  if (json === lastProfileJson) return;
  lastProfileJson = json;
  set({ userId, pins });
}

export type PinToggleResult = 'pinned' | 'unpinned' | 'full' | 'error' | 'signed-out';

export function usePins() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    seed(user?.id ?? null, profile?.pinned);
  }, [user?.id, profile?.pinned]);

  const isPinned = useCallback((pin: PinnedItem) => isPinnedIn(snap.pins, pin), [snap.pins]);

  /** Optimistic add/remove with a toast for each outcome. */
  const toggle = useCallback(async (pin: PinnedItem): Promise<PinToggleResult> => {
    const userId = user?.id;
    if (!userId) return 'signed-out';
    const prev = state.pins;
    const next = togglePin(prev, pin);
    if (!next) {
      showToast(`${MAX_PINS} pins is the limit`, { subtitle: 'Unpin something first.' });
      return 'full';
    }
    const added = next.length > prev.length;
    set({ userId, pins: next });
    const res = await savePinned(userId, next);
    if (!res.success) {
      set({ userId, pins: prev });
      showToast("Couldn't save that pin", { subtitle: res.error });
      return 'error';
    }
    showToast(added ? 'Pinned to your profile' : 'Unpinned');
    return added ? 'pinned' : 'unpinned';
  }, [user?.id, showToast]);

  /** Replace the whole set (the editor's reorder / bulk path). */
  const replace = useCallback(async (pins: PinnedItem[]): Promise<boolean> => {
    const userId = user?.id;
    if (!userId) return false;
    const prev = state.pins;
    const next = normalizePins(pins);
    set({ userId, pins: next });
    const res = await savePinned(userId, next);
    if (!res.success) {
      set({ userId, pins: prev });
      showToast("Couldn't save your pins", { subtitle: res.error });
      return false;
    }
    return true;
  }, [user?.id, showToast]);

  return { pins: snap.pins, isPinned, toggle, replace };
}
