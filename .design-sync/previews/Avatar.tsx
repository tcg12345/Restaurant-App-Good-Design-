import React from 'react';
import { Avatar } from 'gourmet-canvas';

/** lib/avatar.avatarHue — the app's stable hash from a user id to a hue, so
 *  the same person gets the same monogram tint on every surface. Replicated
 *  here so the preview's tints are the real ones. */
const avatarHue = (key: string): number => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
};

// An inline SVG stand-in for an uploaded profile photo — previews never
// hotlink a remote image.
const PORTRAIT =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='0' y2='1'%3E%3Cstop offset='0' stop-color='%23d8c6ad'/%3E%3Cstop offset='1' stop-color='%23a98a68'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='100' height='100' fill='url(%23g)'/%3E%3Ccircle cx='50' cy='40' r='19' fill='%23574033'/%3E%3Cpath d='M10 100c0-23 18-36 40-36s40 13 40 36z' fill='%23574033'/%3E%3C/svg%3E";

/** The default monogram — the first letter of `name`, uppercased, over the
 *  app's primary wash (bg-primary/[0.12] + text-primary). This is not a
 *  loading placeholder: most accounts never upload a photo, so for them the
 *  monogram IS the avatar and it has to look composed. */
export const Monogram = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    {['Tyler Gorin', 'Ana Reyes', 'Marcus Webb', 'Priya Raman'].map((name) => (
      <Avatar key={name} src={null} name={name} size={54} />
    ))}
  </div>
);

/** `fallbackStyle` carries the hue-per-user monogram that classes can't
 *  express — `hsl(avatarHue(userId) 52% 92%)` behind
 *  `hsl(hue 45% 34%)` ink, the pairing used on the suggested-people rail.
 *  Same four names as above, each keyed to its own user id. */
export const HuePerUser = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    {[
      ['Tyler Gorin', 'u_8f21'],
      ['Ana Reyes', 'u_3c07'],
      ['Marcus Webb', 'u_b49a'],
      ['Priya Raman', 'u_57de'],
      ['Sofia Marchetti', 'u_e10c'],
    ].map(([name, id]) => {
      const hue = avatarHue(id);
      return (
        <Avatar
          key={id}
          src={null}
          name={name}
          size={54}
          fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
        />
      );
    })}
  </div>
);

/** `size` is px and the letter defaults to ~40% of it; `letterSize` overrides
 *  that where the default reads too big (the 84px profile header ships
 *  `letterSize={34}`). Real call sites: 28 comment, 36 row, 54 rail, 84 header. */
export const SizeRamp = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
    {[
      [28, undefined],
      [36, undefined],
      [54, undefined],
      [84, 34],
    ].map(([size, letterSize]) => (
      <div key={size as number} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <Avatar src={null} name="Ana Reyes" size={size as number} letterSize={letterSize as number | undefined} />
        <span style={{ fontSize: 10.5, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>{size as number}</span>
      </div>
    ))}
  </div>
);

/** With `src` set: the photo fills the disc `object-cover` and is clipped by
 *  the same rounded box. If the URL 404s — a cleared Storage bucket, a stale
 *  row — an internal error latch drops back to the MONOGRAM rather than the
 *  browser's broken-image glyph.
 *
 *  The silhouette below is only this preview's stand-in image (an inline SVG,
 *  since previews never hotlink a remote photo). The component has no
 *  silhouette or person-glyph fallback — the fallback is always the monogram. */
export const WithPhoto = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
    {[36, 54, 84].map((size) => (
      <Avatar key={size} src={PORTRAIT} name="Ana Reyes" size={size} />
    ))}
  </div>
);

/** The person row it mostly lives in — avatar, name, and the subtitle line
 *  that says why they are being suggested. */
export const InAPersonRow = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 320 }}>
    {[
      ['Ana Reyes', '@anareyes', '12 places in common', 'u_3c07'],
      ['Marcus Webb', '@mwebb', 'Follows you', 'u_b49a'],
      ['Priya Raman', '@priyar', 'From your contacts', 'u_57de'],
    ].map(([name, handle, sub, id]) => {
      const hue = avatarHue(id);
      return (
        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
          <Avatar
            src={null}
            name={name}
            size={44}
            fallbackStyle={{ backgroundColor: `hsl(${hue} 52% 92%)`, color: `hsl(${hue} 45% 34%)` }}
          />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontWeight: 600, fontSize: 14.5 }}>{name}</span>
            <span style={{ display: 'block', fontSize: 12, opacity: 0.5, marginTop: 2 }}>
              {handle} · {sub}
            </span>
          </span>
        </div>
      );
    })}
  </div>
);
