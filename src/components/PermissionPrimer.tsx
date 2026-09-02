import React from 'react';
import { cn } from '../lib/utils';

/**
 * The screen that stands in front of a system permission prompt.
 *
 * iOS shows each permission dialog exactly once, and a denial cannot be
 * re-prompted from inside the app — the user has to find the toggle in
 * Settings. So the choice has to be made somewhere the app can explain
 * itself first, which is what this is: say what the permission buys,
 * then trigger the real dialog from a deliberate tap.
 *
 * It doubles as the DENIED state (with an "Open Settings" CTA), because
 * the shape of the answer is the same either way: an icon, a sentence
 * about what is missing, and the one action that fixes it.
 *
 * Lifted out of PhotoLibraryGrid, where it was private, when contacts
 * needed the identical four-state flow (loading → primer → granted, plus
 * a limited/partial banner). Two copies of a permission explainer is how
 * they drift apart.
 */
export const PermissionPrimer: React.FC<{
  title: string;
  body: string;
  cta: string;
  icon?: React.ReactNode;
  onAction: () => void;
  className?: string;
  /** Shown under the CTA — e.g. "Not now", or a secondary explanation. */
  footer?: React.ReactNode;
}> = ({ title, body, cta, icon, onAction, className, footer }) => (
  <div className={cn('flex flex-col items-center justify-center text-center py-12 px-6', className)}>
    {icon && (
      <div className="w-14 h-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
        {icon}
      </div>
    )}
    <p className="font-serif font-bold text-[17px] leading-tight">{title}</p>
    <p className="text-[12.5px] text-on-surface/55 mt-1.5 max-w-[280px] leading-relaxed">{body}</p>
    <button
      type="button"
      onClick={onAction}
      className="mt-4 px-5 py-2 rounded-full bg-primary text-white text-[13px] font-semibold active:opacity-80 transition-opacity"
    >
      {cta}
    </button>
    {footer && <div className="mt-3">{footer}</div>}
  </div>
);
