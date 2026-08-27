import React from 'react';
import { ScoreRing } from 'gourmet-canvas';

// A stand-in for a card's cover photo. Previews never hotlink a remote
// image, so the photo ground is a CSS gradient.
const PHOTO: React.CSSProperties = {
  background: 'linear-gradient(140deg, #6b4b34 0%, #3f2a1d 45%, #241812 100%)',
  borderRadius: 16,
  padding: 18,
  width: 260,
  height: 132,
  position: 'relative',
};

/** The soft tiered score disc from the card system: tint fill plus a 1.5px
 *  inset ring, both token-backed (--color-score-*-tint / --color-score-*),
 *  with the number set in the serif face. Same three tiers as every other
 *  score surface — high >= 8 green, mid >= 5 amber, low < 5 red. Renders
 *  nothing when `score` is missing or <= 0. */
export const Tiers = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
    {[9.4, 8.0, 7.2, 5.0, 3.6].map((score) => (
      <ScoreRing key={score} score={score} size={48} />
    ))}
  </div>
);

/** `size` is raw px so each layout can match its own row metrics — the real
 *  call sites are 38 (feed), 44 (grid tile), 46 (mobile row) and 48 (desktop
 *  list). The face scales with the disc. */
export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
    {[38, 44, 46, 48, 64].map((size) => (
      <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <ScoreRing score={8.7} size={size} />
        <span style={{ fontSize: 10.5, opacity: 0.4, fontVariantNumeric: 'tabular-nums' }}>{size}</span>
      </div>
    ))}
  </div>
);

/** `onPhoto` is the overlay treatment for a disc sitting on cover imagery:
 *  the tint fill is swapped for solid `--color-paper`, the tier color moves
 *  entirely into the ring and the text, and a drop shadow lifts it off the
 *  image. Shown here against a dark ground — on the app's paper surface the
 *  variant would be invisible. */
export const OnPhoto = () => (
  <div style={{ display: 'flex', gap: 16 }}>
    {[9.2, 6.4].map((score) => (
      <div key={score} style={PHOTO}>
        <ScoreRing score={score} size={44} onPhoto />
      </div>
    ))}
  </div>
);

/** `locked` is the score-lock variant — pass it only for the user's OWN
 *  scores while useLists().scoresUnlocked is false; community scores never
 *  lock. The digits give way to a sentiment dot on the settleScores bands
 *  (loved >= 6.995, fine >= 3.995, else disliked), so 7.2 reads green here
 *  while its unlocked disc is amber. Locked honors `onPhoto` too. */
export const Locked = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      {[9.4, 7.2, 5.0, 3.6].map((score) => (
        <ScoreRing key={score} score={score} size={48} locked />
      ))}
    </div>
    <div style={{ ...PHOTO, width: 132, height: 88, padding: 0, display: 'grid', placeItems: 'center' }}>
      <ScoreRing score={9.4} size={44} locked onPhoto />
    </div>
  </div>
);

/** The list row it was drawn for: name, cuisine line, disc hard right. */
export const InACardRow = () => (
  <div style={{ display: 'flex', flexDirection: 'column', width: 360 }}>
    {[
      ['Jungsik', 'Korean · $$$$', 9.4],
      ['Odd Duck', 'American · $$$', 7.6],
      ['Nixta Taqueria', 'Mexican · $$', 8.8],
    ].map(([name, sub, score], i) => (
      <div
        key={name as string}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 4px',
          borderTop: i > 0 ? '1px solid color-mix(in srgb, var(--color-on-surface) 9%, transparent)' : undefined,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 15 }}>{name as string}</span>
          <span style={{ display: 'block', fontSize: 12.5, opacity: 0.55, marginTop: 3 }}>{sub as string}</span>
        </span>
        <ScoreRing score={score as number} size={46} />
      </div>
    ))}
  </div>
);
