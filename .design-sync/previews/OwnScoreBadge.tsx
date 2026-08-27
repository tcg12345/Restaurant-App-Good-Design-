import React from 'react';
import { OwnScoreBadge } from 'gourmet-canvas';

const RATINGS = [9.4, 8.2, 7.1, 5.6, 3.4];

/** The user's OWN score, once the score lock has opened. Delegates straight to
 *  `ScoreBadge`, so the tint is the standard three-tier scale from
 *  lib/score.ts: high >= 8 green (#2E7D5C), mid >= 5 amber (#C28F3A),
 *  low < 5 red (#A8392A). Callers pass `unlocked` from
 *  useLists().scoresUnlocked. Community and other-user scores never lock —
 *  they use `ScoreBadge` directly. */
export const Unlocked = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    {RATINGS.map((rating) => (
      <OwnScoreBadge key={rating} rating={rating} unlocked size="lg" />
    ))}
  </div>
);

/** The locked state — the app hides your numbers until you have rated
 *  SCORE_UNLOCK_THRESHOLD (10) restaurants. The digits are replaced by a
 *  neutral disc carrying a single sentiment dot, so a row keeps its rhythm
 *  and its verdict without leaking the number.
 *
 *  The dot runs on the SENTIMENT bands (settleScores.tierOfScore:
 *  loved >= 6.995, fine >= 3.995, else disliked), NOT on the >=8 / >=5
 *  display tiers. Same five ratings as `Unlocked` above: 7.1 shows an amber
 *  badge unlocked but a GREEN dot locked. That divergence is intended — the
 *  lock is meant to read as sentiment, not as a rounded-off score. */
export const Locked = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    {RATINGS.map((rating) => (
      <OwnScoreBadge key={rating} rating={rating} unlocked={false} size="lg" />
    ))}
  </div>
);

/** Both states across the full size ramp. The locked disc keeps the exact
 *  outer diameter of the unlocked badge at every size (xs 28 → xl 56), which
 *  is what lets the lock flip without reflowing a list. */
export const SizeRamp = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
    {[true, false].map((unlocked) => (
      <div key={String(unlocked)} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 74, fontSize: 11.5, fontWeight: 600, opacity: 0.45 }}>
          {unlocked ? 'unlocked' : 'locked'}
        </span>
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
          <OwnScoreBadge key={size} rating={8.6} unlocked={unlocked} size={size} />
        ))}
      </div>
    ))}
  </div>
);

/** Your Top List, unlocked — the `size="lg"` call site (pages/TopListPage). */
export const InYourTopList = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 340 }}>
    {[
      [1, 'Jungsik', 'Korean · $$$$', 9.4],
      [2, 'Le Bernardin', 'Seafood · $$$$', 9.1],
      [3, 'Casa Bianca', 'Italian · $$$', 8.2],
    ].map(([rank, name, sub, rating]) => (
      <div key={name as string} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
        <span style={{ width: 18, fontSize: 13, fontWeight: 700, opacity: 0.3, fontVariantNumeric: 'tabular-nums' }}>
          {rank as number}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{name as string}</span>
          <span style={{ display: 'block', fontSize: 12.5, opacity: 0.5, marginTop: 2 }}>{sub as string}</span>
        </span>
        <OwnScoreBadge rating={rating as number} unlocked size="lg" />
      </div>
    ))}
  </div>
);

/** The same list before the lock opens. The order is still the user's real
 *  ranking — only the numbers are withheld — and the app pairs it with the
 *  countdown copy from the rating flow ("N more ratings to go"). */
export const WhileLocked = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 340 }}>
    {[
      [1, 'Jungsik', 'Korean · $$$$', 9.4],
      [2, 'Le Bernardin', 'Seafood · $$$$', 9.1],
      [3, 'Casa Bianca', 'Italian · $$$', 8.2],
    ].map(([rank, name, sub, rating]) => (
      <div key={name as string} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 4px' }}>
        <span style={{ width: 18, fontSize: 13, fontWeight: 700, opacity: 0.3, fontVariantNumeric: 'tabular-nums' }}>
          {rank as number}
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{name as string}</span>
          <span style={{ display: 'block', fontSize: 12.5, opacity: 0.5, marginTop: 2 }}>{sub as string}</span>
        </span>
        <OwnScoreBadge rating={rating as number} unlocked={false} size="lg" />
      </div>
    ))}
    <p style={{ fontSize: 11.5, opacity: 0.4, marginTop: 8, paddingLeft: 4 }}>4 more ratings to go</p>
  </div>
);
