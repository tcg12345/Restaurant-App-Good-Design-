import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import type { User } from '@supabase/supabase-js';

/**
 * Durable storage for the Supabase auth session.
 *
 * Why this exists: supabase-js defaults to window.localStorage, and inside
 * the iOS shell that lives in WKWebView website data — storage iOS may evict
 * under disk pressure and does not treat as precious app data. When it's
 * purged the refresh token goes with it and the user wakes up signed out.
 * On native we keep the session in @capacitor/preferences (UserDefaults),
 * which is real app-container data that survives eviction, backups, and OS
 * updates. On the web this is a plain localStorage pass-through.
 *
 * Migration: the first native read that misses Preferences falls back to
 * localStorage and copies the value across, so users already signed in when
 * this shipped stay signed in.
 */

const isNative = Capacitor.isNativePlatform();

/** The storage key supabase-js would derive on its own
 *  (`sb-<project-ref>-auth-token`). Computed here — and passed to
 *  createClient explicitly — so readStoredSession() and the client always
 *  agree, and existing sessions keep their key across this change. */
export function authStorageKey(supabaseUrl: string): string {
  let ref = 'placeholder';
  try { ref = new URL(supabaseUrl).hostname.split('.')[0] || ref; } catch { /* placeholder */ }
  return `sb-${ref}-auth-token`;
}

function localGet(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function localSet(key: string, value: string): void {
  try { window.localStorage.setItem(key, value); } catch { /* private mode / full */ }
}
function localRemove(key: string): void {
  try { window.localStorage.removeItem(key); } catch { /* noop */ }
}

// Serialize bridge reads/writes, including the boot fallback reader. Keep a
// write-ahead intent until Preferences succeeds: otherwise a failed native
// write leaves an old refresh token that wins over the newer local mirror.
const nativeQueue = new Map<string, Promise<unknown>>();
const pendingWrites = new Map<string, { value: string | null }>();
function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const task = (nativeQueue.get(key) ?? Promise.resolve()).catch(() => {}).then(operation);
  nativeQueue.set(key, task);
  void task.finally(() => { if (nativeQueue.get(key) === task) nativeQueue.delete(key); }).catch(() => {});
  return task;
}
const pendingKey = (key: string) => `${key}:pending-native`;
function pendingWrite(key: string): { value: string | null } | null {
  if (pendingWrites.has(key)) return pendingWrites.get(key)!;
  try {
    const record = JSON.parse(localGet(pendingKey(key)) || 'null');
    if (record && (record.value === null || typeof record.value === 'string')) return record;
  } catch { /* No usable write intent. */ }
  return null;
}
async function flushNative(key: string, record: { value: string | null }): Promise<void> {
  try {
    if (record.value === null) await Preferences.remove({ key });
    else await Preferences.set({ key, value: record.value });
    pendingWrites.delete(key);
    localRemove(pendingKey(key));
  } catch { /* Read the newest intent until the bridge recovers. */ }
}

/** supabase-js custom storage adapter (async form is supported). */
export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNative) return localGet(key);
    return serial(key, async () => {
      const pending = pendingWrite(key);
      if (pending) { await flushNative(key, pending); return pending.value; }
      try {
        const { value } = await Preferences.get({ key });
        if (value != null) return value;
      } catch { /* bridge hiccup — fall back to localStorage */ }
      const legacy = localGet(key);
      if (legacy != null) {
        try { await Preferences.set({ key, value: legacy }); } catch { /* keep legacy */ }
      }
      return legacy;
    });
  },
  async setItem(key: string, value: string): Promise<void> {
    if (!isNative) { localSet(key, value); return; }
    return serial(key, async () => {
      const record = { value };
      pendingWrites.set(key, record);
      localSet(pendingKey(key), JSON.stringify(record));
      localSet(key, value);
      await flushNative(key, record);
    });
  },
  async removeItem(key: string): Promise<void> {
    if (!isNative) { localRemove(key); return; }
    return serial(key, async () => {
      const record = { value: null };
      pendingWrites.set(key, record);
      localSet(pendingKey(key), JSON.stringify(record));
      localRemove(key);
      await flushNative(key, record);
    });
  },
};

/**
 * Read the persisted session straight from storage, bypassing supabase-js.
 * Used by the boot path as a stale-while-revalidate fallback: when
 * getSession() can't produce a session because a token refresh timed out or
 * the device is offline, the tokens are usually still right here — the user
 * is signed in, just not refreshed yet. Returns null when storage really has
 * no session (signed out / revoked, since supabase-js removes the entry on a
 * definitive auth failure).
 */
export async function readStoredSession(key: string): Promise<{ user: User } | null> {
  try {
    const raw = await authStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: User; currentSession?: { user?: User } };
    const user = parsed.user ?? parsed.currentSession?.user ?? null;
    return user ? { user } : null;
  } catch {
    return null;
  }
}
