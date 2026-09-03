/**
 * ProGate — wrap a control or a section that belongs to Pro.
 *
 *   variant="tag"     the children render as usual with a Pro tag beside
 *                     them; a tap opens the paywall instead of the action.
 *                     The control is never greyed out — it's an invitation.
 *   variant="teaser"  the children render blurred (real data, not
 *                     placeholder) with one line beneath: "Unlock with Pro".
 *
 * Renders the children plainly while the person is Pro or the answer is
 * still unknown — a paying customer never sees a flash of the gate.
 */
import React from 'react';
import { cn } from '../../lib/utils';
import { usePlan } from '../../contexts/PlanContext';
import { usePaywall } from '../../contexts/PaywallContext';
import type { FeatureKey } from '../../lib/entitlements';
import { FEATURES } from '../../lib/entitlements';
import { ProTag } from './ProMark';

export const ProGate: React.FC<{
  feature: FeatureKey;
  variant?: 'tag' | 'teaser';
  /** Teaser only: the line under the blur. */
  unlockLine?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ feature, variant = 'tag', unlockLine, className, children }) => {
  const { checked, isPro } = usePlan();
  const { openPaywall } = usePaywall();
  if (!checked || isPro) return <>{children}</>;

  if (variant === 'teaser') {
    return (
      <div className={cn('relative', className)}>
        <div className="pointer-events-none select-none" style={{ filter: 'blur(6px)' }} aria-hidden>{children}</div>
        <button
          type="button"
          onClick={() => openPaywall(`teaser:${feature}`, feature)}
          className="absolute inset-0 flex items-end justify-start"
          aria-label={`Unlock ${FEATURES[feature].label} with Pro`}
        >
          <span className="inline-flex items-center gap-2 text-on-surface" style={{ fontSize: '13px', fontWeight: 600 }}>
            <ProTag /> {unlockLine ?? `Unlock ${FEATURES[feature].label.toLowerCase()} with Pro`}
          </span>
        </button>
      </div>
    );
  }

  return (
    <span
      className={cn('relative inline-flex items-center gap-2', className)}
      onClickCapture={(e) => { e.preventDefault(); e.stopPropagation(); openPaywall(`tag:${feature}`, feature); }}
    >
      {children}
      <ProTag locked />
    </span>
  );
};
