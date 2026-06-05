import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';

interface ModalFloatingNavProps {
  /** When provided, a round back button renders to the left of the primary. */
  onBack?: () => void;
  backDisabled?: boolean;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  /** Primary button content (label + icons + spinner). The pill hugs it. */
  children: React.ReactNode;
  /** 0..1 — draws a thin progress line along the bottom of the primary pill. */
  progress?: number;
  /** Optional notice (errors / sign-in prompt) shown floating above the row. */
  notice?: React.ReactNode;
  primaryAriaLabel?: string;
}

/**
 * Floating, minimalist action area for the multi-step Add Reel / Add Post
 * modals. A compact dark pill (hugging its dynamic label) sits bottom-right
 * with an optional round back button beside it, floating over a soft fade so
 * the step content scrolls behind it instead of being pinned under a bar.
 *
 * Render this as the LAST child of a `relative` modal root; give the scroll
 * body enough bottom padding (~pb-28) so its last content clears the pill.
 */
export const ModalFloatingNav: React.FC<ModalFloatingNavProps> = ({
  onBack,
  backDisabled,
  onPrimary,
  primaryDisabled,
  children,
  progress,
  notice,
  primaryAriaLabel,
}) => (
  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20">
    {/* Fade so content scrolling behind stays legible beneath the buttons. */}
    <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-surface via-surface/90 to-transparent" />
    <div
      className="relative px-5 pt-5"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      {/* Only the buttons capture taps; empty areas let the content behind
          (which scrolls under the fade) stay interactive. */}
      {notice && <div className="pointer-events-auto mb-2.5 space-y-2">{notice}</div>}
      <div className="flex items-center justify-end gap-3">
        {onBack && (
          <motion.button
            type="button"
            onClick={onBack}
            disabled={backDisabled}
            whileTap={!backDisabled ? { scale: 0.9 } : undefined}
            aria-label="Back"
            className="pointer-events-auto h-12 w-12 shrink-0 rounded-full bg-surface/70 backdrop-blur-xl border border-on-surface/10 shadow-lg shadow-black/5 flex items-center justify-center text-on-surface/70 disabled:opacity-40 transition-colors"
          >
            <ChevronLeft size={20} />
          </motion.button>
        )}
        <motion.button
          type="button"
          onClick={onPrimary}
          disabled={primaryDisabled}
          whileTap={!primaryDisabled ? { scale: 0.97 } : undefined}
          aria-label={primaryAriaLabel}
          className={cn(
            'pointer-events-auto relative h-12 px-6 rounded-full text-[15px] font-bold inline-flex items-center justify-center gap-2 overflow-hidden transition-all',
            primaryDisabled
              ? 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed'
              : 'bg-on-surface text-surface shadow-xl shadow-black/20',
          )}
        >
          {children}
          {progress != null && progress > 0 && (
            <span
              className="absolute left-0 bottom-0 h-0.5 bg-surface/40"
              style={{ width: `${Math.round(progress * 100)}%`, transition: 'width 200ms ease-out' }}
            />
          )}
        </motion.button>
      </div>
    </div>
  </div>
);
