import React from 'react';

/**
 * Soft tiered score circle with an inset ring — the score treatment from the
 * Restaurant Cards Redesign (green ≥8 / amber 5–7 / red <5). Sized in px so
 * callers can match each layout (46 mobile row, 48 desktop list, 44 grid).
 * Renders nothing when there's no score.
 *
 * `onPhoto` switches to the photo-overlay treatment (white fill + colored ring
 * + drop shadow) so it stays legible sitting over a recipe cover image.
 */
export const ScoreRing: React.FC<{ score?: number; size?: number; onPhoto?: boolean; className?: string }> = ({
  score,
  size = 48,
  onPhoto = false,
  className,
}) => {
  if (score === undefined || score === null || score <= 0) return null;
  const tier =
    score >= 8 ? { bg: '#ecfdf5', ring: 'rgba(16,185,129,0.5)', text: '#059669' }
    : score >= 5 ? { bg: '#fffbeb', ring: 'rgba(245,158,11,0.55)', text: '#b45309' }
    : { bg: '#fef2f2', ring: 'rgba(239,68,68,0.5)', text: '#dc2626' };
  return (
    <div
      className={className}
      aria-label={`Score ${score.toFixed(1)}`}
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: onPhoto ? '#fff' : tier.bg,
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
