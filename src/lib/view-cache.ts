/**
 * Per-user snapshot cache for screens whose first paint would otherwise
 * sit on a network round trip.
 *
 * The server stays the source of truth — a snapshot only decides what's on
 * screen for the few hundred milliseconds before the fetch lands, which is
 * the difference between "this page is loading" and "this page is here".
 * Read it in a layout effect (before paint) so the skeleton never flashes
 * for a returning visitor, and write it whenever a fetch settles.
 *
 * Scoped by user id so a device shared between accounts can never paint
 * one person's circle under another's name, and versioned so a change to a
 * snapshot's shape retires the old ones instead of hydrating garbage.
 */

const PREFIX = 'gourmad-view-cache';
const VERSION = 1;

const keyFor = (name: string, userId: string) => `${PREFIX}:v${VERSION}:${name}:${userId}`;

export function readViewCache<T>(name: string, userId: string | null | undefined): T | null {
  if (!userId) return null;
  try {
    const raw = localStorage.getItem(keyFor(name, userId));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeViewCache(name: string, userId: string | null | undefined, value: unknown): void {
  if (!userId) return;
  try {
    localStorage.setItem(keyFor(name, userId), JSON.stringify(value));
  } catch {
    // Quota exhausted or storage disabled (private mode). A snapshot is an
    // optimization, never a correctness requirement — drop it silently.
  }
}
