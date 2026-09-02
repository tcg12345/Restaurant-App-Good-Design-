/**
 * One-time rename of every locally stored key from the app's old brand
 * prefixes to `goodeats-`.
 *
 * The app shipped as Gourmet Canvas, so an installed device holds ~40 keys
 * under `gourmad-` (ratings, lists, wishlist, home meals, recipe drafts,
 * chat cache, dark mode, onboarding + tour flags) and one under
 * `gourmet-canvas-` (recent searches). Renaming the constants without
 * moving the DATA would not read as a rename to anyone who already has the
 * app — it reads as "my ratings are gone and I have to onboard again".
 *
 * IMPORTED FOR ITS SIDE EFFECT, AND FIRST — see main.tsx. ES module imports
 * evaluate in order, and several modules read storage at import time (not
 * just inside `useState` initialisers), so this has to be the first import
 * in the entry file or it races the very reads it exists to fix.
 *
 * Deliberately NOT deleting the old keys on a device that still has them:
 * a user who updates, opens the app, and rolls back to a cached older
 * bundle would otherwise land on an empty account. Copy, mark done, and let
 * `clearLocalAppData` (which still lists the legacy prefixes) collect them
 * on the next sign-out.
 */

const LEGACY_PREFIXES = ['gourmad-', 'gourmet-canvas-'] as const;
const NEW_PREFIX = 'goodeats-';
/** Marks the migration as run. Under the new prefix, so it is itself
 *  subject to the normal purge rules. */
const DONE_KEY = 'goodeats-storage-migrated';

export function migrateBrandStorageKeys(): void {
  try {
    if (localStorage.getItem(DONE_KEY) === '1') return;

    // Snapshot the key list before writing: localStorage indices shift as
    // keys are added, so iterating it live would skip entries.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }

    for (const key of keys) {
      const prefix = LEGACY_PREFIXES.find((p) => key.startsWith(p));
      if (!prefix) continue;
      const renamed = NEW_PREFIX + key.slice(prefix.length);
      // Never clobber a newer value. A device that already ran the app on
      // the new prefix (and is only here because the flag was cleared) has
      // the fresher copy under the new name.
      if (localStorage.getItem(renamed) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(renamed, value);
    }

    localStorage.setItem(DONE_KEY, '1');
  } catch {
    /* storage blocked/full — the app still runs, it just starts empty. */
  }
}

migrateBrandStorageKeys();
