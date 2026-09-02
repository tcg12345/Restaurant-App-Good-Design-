import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Compass, Crown, PenLine, Sprout, Utensils, Wine, type LucideIcon } from 'lucide-react';
import type { TasteTier } from '../../lib/taste-tier';

/** One icon per rung — the emblem is how a tier is recognised at a glance
 *  on the card, the page masthead and the leaderboard rows. */
export const TIER_ICONS: Record<TasteTier['key'], LucideIcon> = {
  newcomer: Sprout,
  regular: Utensils,
  explorer: Compass,
  connoisseur: Wine,
  critic: PenLine,
  legend: Crown,
};

/**
 * The tier emblem: the tier's icon inside a ring that fills toward the
 * next tier. The ring is the "this moves" signal — it is drawn on mount
 * (once, from zero) so opening the page shows the progress being earned
 * rather than a static badge.
 */
export const TierEmblem: React.FC<{
  tier: TasteTier;
  /** 0..1 — progress within the tier toward the next floor. */
  progress: number;
  size?: number;
  /** Draw the ring on mount (page masthead); off for dense lists. */
  animate?: boolean;
  /**
   * Draw the progress ring at all. Off where progress is already stated
   * in words nearby (the profile card's ladder bar): two readings of the
   * same number is one too many, and a low fill renders as a short arc
   * floating off the disc, which reads as a rendering artifact rather
   * than as progress.
   */
  ring?: boolean;
  className?: string;
}> = ({ tier, progress, size = 56, animate = true, ring = true, className }) => {
  const reduce = useReducedMotion();
  const Icon = TIER_ICONS[tier.key];
  const stroke = Math.max(3, Math.round(size / 14));
  const r = (size - stroke) / 2;
  const c = size / 2;
  const p = Math.max(0, Math.min(1, progress));
  const iconSize = Math.round(size * 0.42);
  return (
    <span
      className={className}
      style={{ position: 'relative', width: size, height: size, display: 'inline-block', flex: 'none' }}
      aria-label={ring ? `${tier.name}, ${Math.round(p * 100)}% to the next tier` : tier.name}
      role="img"
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute', inset: 0 }} aria-hidden>
        {/* Colours via style: CSS variables don't resolve in SVG attributes. */}
        <circle cx={c} cy={c} r={r} style={{ fill: 'color-mix(in srgb, var(--color-on-surface) 6%, transparent)' }} />
        <circle cx={c} cy={c} r={r} fill="none" style={{ stroke: 'color-mix(in srgb, var(--color-on-surface) 10%, transparent)' }} strokeWidth={ring ? stroke : 1} />
        {ring && (
          <motion.circle
            cx={c} cy={c} r={r} fill="none"
            style={{ stroke: 'var(--color-primary)' }}
            strokeWidth={stroke}
            strokeLinecap="round"
            transform={`rotate(-90 ${c} ${c})`}
            initial={animate && !reduce ? { pathLength: 0 } : { pathLength: p }}
            animate={{ pathLength: p }}
            transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
          />
        )}
      </svg>
      <span
        className="text-primary"
        style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}
      >
        <Icon size={iconSize} strokeWidth={2.1} />
      </span>
    </span>
  );
};
