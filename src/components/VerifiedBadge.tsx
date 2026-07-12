import React from 'react';
import { BadgeCheck } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * The one verified-user mark, everywhere a verified account appears —
 * feeds, profiles, comments, messages, cards. A brand-colored seal with a
 * white check (lucide BadgeCheck with the seal filled), replacing the old
 * amber Star/Crown "expert" indicators.
 *
 * Size is the icon's box in px; pick roughly the size the old Star used at
 * that call site (9–17). `inline` adds baseline alignment for use inside
 * running text (next to a name in a sentence).
 */
export const VerifiedBadge: React.FC<{
  size?: number;
  className?: string;
  inline?: boolean;
  /** Override the seal fill for dark/photo contexts; defaults to brand primary. */
  fill?: string;
}> = ({ size = 14, className, inline = false, fill = 'var(--color-primary)' }) => (
  <BadgeCheck
    size={size}
    aria-label="Verified"
    style={{ fill, color: '#fff' }}
    strokeWidth={1.8}
    className={cn('flex-shrink-0', inline && 'inline-block align-[-0.12em]', className)}
  />
);
