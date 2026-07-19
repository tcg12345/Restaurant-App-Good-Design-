// Shared avatar helpers — a deterministic color + initials derived from a
// user id / display name, so friend chips and conversation avatars look
// consistent everywhere (Messages, ShareDialog, …).

const AVATAR_PALETTE = [
  'bg-emerald-700', 'bg-rose-700', 'bg-amber-600', 'bg-indigo-700',
  'bg-sky-700', 'bg-fuchsia-700', 'bg-orange-700', 'bg-teal-700',
];

/** Stable Tailwind bg-* class for a user id (same id → same color). */
export function pickAvatarColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

/** Stable hue (0–360) for a user id (fall back to a name only when no id
 *  exists). One hash for every hsl() monogram avatar — guide rails, recipe
 *  reviews, comment threads — so the same user gets the same hue on every
 *  surface instead of a per-file variant of this function. */
export function avatarHue(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

/** 1–2 letter initials from a display name. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
