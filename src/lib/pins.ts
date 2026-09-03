/**
 * Pinned items — the three things a person puts at the top of their profile.
 *
 * A pin is a reference: what kind of thing and its id. The profile pages
 * resolve references against data the viewer can already read (the
 * owner's own ratings, recipes and guides locally; a public profile's
 * items through the same reads its tabs use), so a pin to something the
 * viewer can't see simply doesn't render. Pinning never makes anything
 * visible that wasn't.
 *
 * Stored on user_profiles.pinned (migration 085), capped at three there
 * and here. Pure: no React, no network.
 */

export const MAX_PINS = 3;

export type PinnedType = 'restaurant' | 'recipe' | 'meal' | 'guide' | 'post' | 'reel';

export interface PinnedItem {
  type: PinnedType;
  /** restaurant → Google place id; recipe → recipes.id; meal → home meal id;
   *  guide → guides.id; post → posts.id; reel → reels.id. */
  id: string;
}

const PIN_TYPES: ReadonlySet<string> = new Set<PinnedType>(['restaurant', 'recipe', 'meal', 'guide', 'post', 'reel']);
const isPinnedType = (t: unknown): t is PinnedType => typeof t === 'string' && PIN_TYPES.has(t);

export const samePin = (a: PinnedItem, b: PinnedItem) => a.type === b.type && a.id === b.id;

export const isPinned = (pins: readonly PinnedItem[] | null | undefined, pin: PinnedItem) =>
  !!pins && pins.some((p) => samePin(p, pin));

/** Drop anything that isn't a well-formed pin, dedupe, cap. Runs on every
 *  read so a hand-edited or stale row can't crash a profile. */
export function normalizePins(raw: unknown): PinnedItem[] {
  if (!Array.isArray(raw)) return [];
  const out: PinnedItem[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const { type, id } = x as { type?: unknown; id?: unknown };
    if (typeof id !== 'string' || !id) continue;
    if (!isPinnedType(type)) continue;
    const pin: PinnedItem = { type, id };
    if (!out.some((p) => samePin(p, pin))) out.push(pin);
    if (out.length >= MAX_PINS) break;
  }
  return out;
}

/** Add or remove a pin. Adding a fourth returns `null` so the caller can
 *  say "three is the limit" instead of silently dropping one. */
export function togglePin(pins: readonly PinnedItem[], pin: PinnedItem): PinnedItem[] | null {
  if (isPinned(pins, pin)) return pins.filter((p) => !samePin(p, pin));
  if (pins.length >= MAX_PINS) return null;
  return [...pins, pin];
}
