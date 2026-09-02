import React from 'react';
import { VerifiedBadge, Avatar } from 'goodeats';

/** The one verified-user mark, used everywhere a verified account appears —
 *  feeds, profiles, comments, messages, cards. A lucide `BadgeCheck` with the
 *  seal filled in brand primary and the check knocked out in white. It
 *  replaced the app's older amber Star/Crown "expert" indicators; do not
 *  reintroduce those. */
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 18 }}>
    {[11, 12, 13, 15, 24, 38].map((size) => (
      <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <VerifiedBadge size={size} />
        <span style={{ fontSize: 10.5, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>{size}</span>
      </div>
    ))}
  </div>
);

/** Beside a name, which is the common call. `size` should match roughly the
 *  cap height of the name it follows — 11–13 in dense feed and card rows,
 *  15 in a profile header, 38 only in the verification-outcome modal. */
export const NextToAName = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    {[
      ['Ana Reyes', 12, 13.5],
      ['Marcus Webb', 13, 15],
      ['Sofia Marchetti', 15, 19],
    ].map(([name, badge, type]) => (
      <span key={name as string} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: type as number, letterSpacing: '-0.02em' }}>
          {name as string}
        </span>
        <VerifiedBadge size={badge as number} />
      </span>
    ))}
  </div>
);

/** `inline` adds the baseline nudge (`align-[-0.12em]`) for a badge sitting
 *  inside running text rather than in a flex row — the feed's activity lines. */
export const InRunningText = () => (
  <p style={{ fontSize: 14, lineHeight: 1.65, width: 470 }}>
    <strong style={{ fontWeight: 600 }}>Ana Reyes</strong>
    <VerifiedBadge size={12} inline className="ml-1" />
    <span style={{ opacity: 0.6 }}> rated </span>
    <strong style={{ fontWeight: 600 }}>Jungsik</strong>
    <span style={{ opacity: 0.6 }}> and added it to </span>
    <strong style={{ fontWeight: 600 }}>Best of NYC</strong>
    <span style={{ opacity: 0.6 }}> · 2h</span>
  </p>
);

/** `fill` overrides the seal color for grounds where brand primary sinks.
 *  The default is `var(--color-primary)`, which in light mode is the deep
 *  brick #9f3012 — legible on paper, nearly lost over a dark cover photo.
 *  Passing the dark-mode primary (#d3623d) lifts it. The check is always
 *  white, so an override wants a mid-tone fill, never a pale one. */
export const OnDark = () => (
  <div
    style={{
      background: 'linear-gradient(140deg, #3f2a1d 0%, #241812 100%)',
      borderRadius: 16,
      padding: '18px 20px',
      width: 340,
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}
  >
    {[
      ['Sofia Marchetti', undefined, 'default — var(--color-primary)'],
      ['Sofia Marchetti', '#d3623d', 'fill="#d3623d"'],
    ].map(([name, fill, note], i) => (
      <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#fff' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 15 }}>{name as string}</span>
          <VerifiedBadge size={15} fill={fill as string | undefined} />
        </span>
        <span style={{ fontSize: 10.5, opacity: 0.5, marginLeft: 'auto' }}>{note as string}</span>
      </span>
    ))}
  </div>
);

/** Pinned to an avatar's corner — the circle/member-list treatment: the badge
 *  sits in a surface-filled disc with a matching ring so it reads as attached
 *  to the avatar rather than floating over it. */
export const AvatarCorner = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
    {[
      ['Ana Reyes', 48],
      ['Marcus Webb', 64],
    ].map(([name, size]) => (
      <span key={name as string} style={{ position: 'relative', display: 'inline-block' }}>
        <Avatar src={null} name={name as string} size={size as number} />
        <span
          className="ring-1 ring-surface"
          style={{
            position: 'absolute',
            bottom: -2,
            right: -2,
            width: (size as number) >= 60 ? 20 : 17,
            height: (size as number) >= 60 ? 20 : 17,
            borderRadius: 9999,
            background: 'var(--color-surface)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <VerifiedBadge size={(size as number) >= 60 ? 17 : 14} />
        </span>
      </span>
    ))}
  </div>
);
