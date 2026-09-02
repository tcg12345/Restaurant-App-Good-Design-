import React from 'react';
import { cn } from '../lib/utils';

/**
 * Shared empty-state primitive. Replaces the half-dozen bespoke "no results"
 * blocks scattered through the app so every empty screen has the same shape:
 * a big muted icon, a tight heading, a supporting line, and an optional CTA.
 *
 * Size floors match the rest of the design system:
 *  - icon: 48px, rendered in muted on-surface
 *  - heading: 18px semibold
 *  - description: 14px, muted
 *  - action: primary-style pill button
 */
interface EmptyStateProps {
  icon: React.ReactNode;
  heading: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  heading,
  description,
  action,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center px-6 py-12',
        className,
      )}
    >
      <div className="text-on-surface/25 mb-4" aria-hidden="true">
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-on-surface/80 mb-1">
        {heading}
      </h3>
      {description && (
        <p className="text-sm text-on-surface/50 max-w-[280px] leading-relaxed">
          {description}
        </p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-5 px-5 py-2.5 rounded-full bg-primary text-on-primary text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
};
