/**
 * QuotaMeter — "2 of 5 left this week", shown only when it matters.
 *
 * Reads the plan context's quota for an endpoint. Nothing renders while
 * the person is Pro, while the answer is unknown, or while there's plenty
 * left (more than `threshold`); the meter is a nudge as the allowance
 * runs down, not a permanent counter. Tapping opens the paywall with the
 * feature's context.
 */
import React, { useEffect } from 'react';
import { cn } from '../../lib/utils';
import { usePlan } from '../../contexts/PlanContext';
import { usePaywall } from '../../contexts/PaywallContext';
import { FEATURES, type FeatureKey } from '../../lib/entitlements';

const WINDOW_WORD: Record<string, string> = { hour: 'this hour', day: 'today', week: 'this week', month: 'this month' };

export const QuotaMeter: React.FC<{ feature: FeatureKey; threshold?: number; className?: string }> = ({ feature, threshold = 2, className }) => {
  const { checked, isPro, quota, refreshQuota } = usePlan();
  const { openPaywall } = usePaywall();
  const endpoint = FEATURES[feature].endpoint;

  useEffect(() => { if (checked && !isPro && endpoint && !quota) void refreshQuota(); }, [checked, isPro, endpoint, quota, refreshQuota]);

  if (!checked || isPro || !endpoint) return null;
  const q = quota?.[endpoint];
  if (!q || q.proOnly || q.remaining > threshold) return null;
  const pct = q.max > 0 ? Math.max(0, Math.min(1, (q.max - q.remaining) / q.max)) : 1;

  return (
    <button
      type="button"
      onClick={() => openPaywall(`meter:${feature}`, feature, { reason: `You have ${q.remaining} of ${q.max} ${FEATURES[feature].label.toLowerCase()} left ${WINDOW_WORD[q.window] ?? ''}.` })}
      className={cn('inline-flex items-center gap-2 rounded-full border border-on-surface/[0.14] px-2.5 h-7 text-on-surface/70 active:opacity-70 transition-opacity', className)}
      style={{ fontSize: '11px', fontWeight: 700 }}
      aria-label={`${q.remaining} of ${q.max} left ${WINDOW_WORD[q.window] ?? ''}`}
    >
      <span className="relative inline-block w-8 h-1 rounded-full bg-on-surface/[0.12] overflow-hidden" aria-hidden>
        <span className="absolute inset-y-0 left-0 bg-on-surface/70" style={{ width: `${pct * 100}%` }} />
      </span>
      {q.remaining} of {q.max} left
    </button>
  );
};
