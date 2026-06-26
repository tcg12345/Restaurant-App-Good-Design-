import React from 'react';
import { motion, useMotionValue, useTransform, animate } from 'motion/react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * Progress fill painted over the primary pill while a reel / post uploads.
 *
 * The pill itself (overflow-hidden, rounded-full) clips this, so the fill hugs
 * the rounded left edge and ends in one clean vertical wavefront — no floating
 * sub-pill or clipped baseline line. It eases toward each real-progress target
 * (so it glides instead of stepping between byte events) and only ever
 * advances, so network jitter can't make it stutter backwards. Reads clearly
 * because the pill stays in its high-contrast dark style during upload.
 */
const PrimaryUploadProgress: React.FC<{ progress: number }> = ({ progress }) => {
  const target = Math.max(0, Math.min(1, progress));
  const value = useMotionValue(0);

  React.useEffect(() => {
    const from = value.get();
    const to = Math.max(from, target); // monotonic — never rewind
    if (to === from) return;
    // Eased tween between targets keeps the sweep buttery and guarantees it
    // settles exactly on the target (a spring would only approach it).
    const controls = animate(value, to, { duration: 0.4, ease: [0.33, 1, 0.68, 1] });
    return () => controls.stop();
  }, [target, value]);

  const width = useTransform(value, (v) => `${Math.min(100, Math.max(0, v * 100))}%`);

  return (
    <motion.span
      aria-hidden
      className="absolute inset-y-0 left-0 bg-surface/25"
      style={{ width }}
    >
      {/* Crisp bright wavefront marking the exact percentage reached. */}
      <span className="absolute inset-y-0 right-0 w-[2px] bg-surface/80" />
    </motion.span>
  );
};

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
            // While uploading the button is disabled, but we keep the prominent
            // dark style (not the dim grey one) so the progress fill + percentage
            // read clearly instead of washing out.
            primaryDisabled && !(progress != null && progress > 0)
              ? 'bg-on-surface/10 text-on-surface/35 cursor-not-allowed'
              : 'bg-on-surface text-surface shadow-xl shadow-black/20',
          )}
        >
          {progress != null && progress > 0 && (
            <PrimaryUploadProgress progress={progress} />
          )}
          <span className="relative z-10 inline-flex items-center justify-center gap-2">
            {children}
          </span>
        </motion.button>
      </div>
    </div>
  </div>
);
