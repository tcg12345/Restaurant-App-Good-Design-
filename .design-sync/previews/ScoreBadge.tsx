import React from 'react';
import { ScoreBadge } from 'goodeats';

/** The app's signature mark: a 0–10 score whose tint carries the verdict
 *  before the number is read. Three tiers, from lib/score.ts:
 *  high >= 8 green (#2E7D5C), mid >= 5 amber (#C28F3A), low < 5 red (#A8392A).
 *  The badge picks its own tint from `rating` — there is no color prop. */
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => (
      <ScoreBadge key={size} rating={9.4} size={size} />
    ))}
  </div>
);

/** The tier boundaries, swept: 9.6/8.1 high, 7.0/5.4 mid, 3.2 low. */
export const ScoreRange = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
    {[9.6, 8.1, 7.0, 5.4, 3.2].map((rating) => (
      <ScoreBadge key={rating} rating={rating} size="lg" />
    ))}
  </div>
);

/** In a list, where it usually lives. */
export const InAList = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, width: 300 }}>
    {[
      ['Jungsik', 'Korean · $$$$', 9.4],
      ['Casa Bianca', 'Italian · $$$', 8.1],
      ['Odd Duck', 'American · $$$', 7.2],
    ].map(([name, sub, rating]) => (
      <div key={name as string} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 4px' }}>
        <ScoreBadge rating={rating as number} size="md" />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 14.5 }}>{name as string}</span>
          <span style={{ display: 'block', fontSize: 12.5, opacity: 0.5, marginTop: 2 }}>{sub as string}</span>
        </span>
      </div>
    ))}
  </div>
);
