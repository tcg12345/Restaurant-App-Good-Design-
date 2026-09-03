/**
 * The Pro marks. The plan's copy rule: the tag is the word "Pro" in small
 * caps, in the champagne accent the design system reserves for verified
 * and featured treatments. Never a star, never a crown, never a new hue.
 *
 *   <ProTag />            the word, on a control that's Pro-only
 *   <ProTag locked />     the same with a lock glyph (the Opus row)
 */
import React from 'react';
import { Lock } from 'lucide-react';
import { cn } from '../../lib/utils';

export const ProTag: React.FC<{ locked?: boolean; className?: string; size?: 'sm' | 'md' }> = ({ locked = false, className, size = 'sm' }) => (
  <span
    className={cn('inline-flex items-center gap-1 rounded-[5px] align-middle', size === 'sm' ? 'px-1.5 py-[2px]' : 'px-2 py-[3px]', className)}
    style={{
      fontSize: size === 'sm' ? '9.5px' : '10.5px',
      fontWeight: 700,
      letterSpacing: '0.16em',
      textTransform: 'uppercase',
      color: 'var(--color-accent-ink, #7a6534)',
      background: 'color-mix(in srgb, var(--color-accent) 22%, transparent)',
    }}
    aria-label="Pro"
  >
    {locked && <Lock size={size === 'sm' ? 9 : 10} strokeWidth={2.4} />}
    Pro
  </span>
);
