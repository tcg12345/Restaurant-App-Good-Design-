import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { useBottomSheet } from '../lib/useBottomSheet';
import { cn } from '../lib/utils';
import './filterSheet.css';

/**
 * Shared chrome for every filter popup in the app (Discover, Pantry,
 * wishlist, recipes, public profile). Provides the overlay, the
 * desktop-card / phone-bottom-sheet container, drag-to-dismiss handle,
 * header (title + optional icon/subtitle), a scrollable body slot, and a
 * Reset / Apply footer — matching the Location page's reference design.
 *
 * Callers compose the body from the primitives in `filterPrimitives.tsx`
 * (FilterSection, Pill, Segment, RangeSlider, FilterDropdown) plus the
 * shared `MichelinDistinctionFilter`. Filter LOGIC stays in each caller;
 * this component is presentation only.
 */
interface FilterSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional rounded icon chip left of the title (wishlist / recipes). */
  titleIcon?: React.ReactNode;
  /** Optional line under the title (e.g. active-filter count). */
  subtitle?: React.ReactNode;
  onReset: () => void;
  resetLabel?: string;
  applyLabel?: string;
  /** Defaults to onClose; Discover passes its nearby-fetch trigger. */
  onApply?: () => void;
  /** Overlay stacking; defaults to 60. Wishlist/Recipe keep 120. */
  zIndex?: number;
  children: React.ReactNode;
}

export const FilterSheet: React.FC<FilterSheetProps> = ({
  open,
  onClose,
  title,
  titleIcon,
  subtitle,
  onReset,
  resetLabel = 'Reset',
  applyLabel = 'Apply',
  onApply,
  zIndex = 60,
  children,
}) => {
  const { phoneMode } = useSettings();
  const { dragProps, startDrag } = useBottomSheet(open, onClose);
  const handleApply = onApply ?? onClose;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className="fs-overlay"
          style={{ zIndex }}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? {
                  initial: { y: '100%' },
                  animate: { y: 0 },
                  exit: { y: '100%' },
                  transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                  ...dragProps,
                }
              : {
                  initial: { opacity: 0, scale: 0.96, y: -8 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.97, y: -4 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn('fs-sheet', phoneMode ? 'is-phone' : 'is-desktop')}
          >
            {phoneMode && (
              <div
                className="fs-drag-handle"
                onPointerDown={startDrag}
                style={{ touchAction: 'none' }}
                aria-hidden="true"
              >
                <span />
              </div>
            )}

            <div className="fs-head">
              <div className="fs-head-main">
                {titleIcon && <span className="fs-title-icon">{titleIcon}</span>}
                <div className="fs-head-text">
                  <h3 className="fs-title">{title}</h3>
                  {subtitle && <p className="fs-subtitle">{subtitle}</p>}
                </div>
              </div>
              <button type="button" onClick={onClose} className="fs-close" aria-label="Close filters">
                <X size={16} />
              </button>
            </div>

            <div className="fs-body">{children}</div>

            <div className="fs-foot">
              <button type="button" onClick={onReset} className="fs-reset">
                {resetLabel}
              </button>
              <button type="button" onClick={handleApply} className="fs-apply">
                {applyLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default FilterSheet;
