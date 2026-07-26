import React from 'react';
import { scoreTintStyle, SCORE_TIER_HEX } from '../../lib/score';
import { tierOfScore } from '../../lib/settleScores';

/** Sentiment-tier dot color for a score (loved/fine/disliked bands). */
const tierDotHex = (score: number): string => {
  const t = tierOfScore(score);
  return t === 'loved' ? SCORE_TIER_HEX.high : t === 'fine' ? SCORE_TIER_HEX.mid : SCORE_TIER_HEX.low;
};

/**
 * Soft tiered score circle with an inset ring — the score treatment from the
 * Restaurant Cards Redesign (green ≥8 / amber 5–7 / red <5). Sized in px so
 * callers can match each layout (46 mobile row, 48 desktop list, 44 grid).
 * Renders nothing when there's no score.
 *
 * `onPhoto` switches to the photo-overlay treatment (white fill + colored ring
 * + drop shadow) so it stays legible sitting over a recipe cover image.
 *
 * `locked` renders the Beli-style score-lock variant — the sentiment emoji
 * instead of digits. Pass it only for the user's OWN scores while
 * useLists().scoresUnlocked is false; community scores never lock.
 */
export const ScoreRing: React.FC<{ score?: number; size?: number; onPhoto?: boolean; locked?: boolean; className?: string }> = ({
  score,
  size = 48,
  onPhoto = false,
  locked = false,
  className,
}) => {
  if (score === undefined || score === null || score <= 0) return null;
  if (locked) {
    return (
      <div
        className={className}
        aria-label="Score hidden until you rate more places"
        style={{
          width: size,
          height: size,
          borderRadius: 9999,
          background: onPhoto ? 'var(--color-paper)' : 'color-mix(in srgb, var(--color-on-surface) 4%, transparent)',
          boxShadow: onPhoto
            ? '0 2px 10px rgba(0,0,0,0.16), inset 0 0 0 1.5px color-mix(in srgb, var(--color-on-surface) 12%, transparent)'
            : 'inset 0 0 0 1.5px color-mix(in srgb, var(--color-on-surface) 10%, transparent)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        <span
          style={{
            width: Math.max(6, Math.round(size * 0.2)),
            height: Math.max(6, Math.round(size * 0.2)),
            borderRadius: 9999,
            background: tierDotHex(score),
          }}
        />
      </div>
    );
  }
  // Token-backed tier pack (lib/score → --color-score-* in index.css):
  // tint fill + ring + readable text, all adapting in dark mode.
  const pack = scoreTintStyle(score);
  const tier = { bg: pack.background, ring: pack.ring, text: pack.color };
  return (
    <div
      className={className}
      aria-label={`Score ${score.toFixed(1)}`}
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: onPhoto ? 'var(--color-paper)' : tier.bg,
        boxShadow: onPhoto
          ? `0 2px 10px rgba(0,0,0,0.16), inset 0 0 0 1.5px ${tier.ring}`
          : `inset 0 0 0 1.5px ${tier.ring}`,
        color: tier.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'var(--font-serif)',
        fontWeight: 700,
        fontSize: Math.round(size * 0.34),
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
        letterSpacing: '-0.01em',
      }}
    >
      {score.toFixed(1)}
    </div>
  );
};
