/**
 * The sheet chrome every shared-list dialog shares: a bottom sheet on the
 * phone (handle-only drag, so lists inside can scroll and drag freely), a
 * centered card on desktop. Same bones as the profile's editor sheets so
 * the family reads as one.
 */
import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useSettings } from '../../contexts/SettingsContext';
import { useBottomSheet } from '../../lib/useBottomSheet';

export const SheetShell: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: React.ReactNode;
  ariaLabel?: string;
  children: React.ReactNode;
  /** Sticky footer (CTA row). */
  footer?: React.ReactNode;
  zIndex?: number;
}> = ({ open, onClose, title, subtitle, ariaLabel, children, footer, zIndex = 70 }) => {
  const { phoneMode } = useSettings();
  const { dragProps, startDrag } = useBottomSheet(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn('fixed inset-0', phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4')}
          style={{ zIndex }}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { duration: 0.42, ease: [0.32, 0.72, 0, 1] as const }, ...dragProps }
              : { initial: { opacity: 0, scale: 0.94, y: -12 }, animate: { opacity: 1, scale: 1, y: 0 }, exit: { opacity: 0, scale: 0.96, y: -8 }, transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const } })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'bg-surface flex flex-col overflow-hidden',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl max-h-[88vh]'
                : 'w-full max-w-xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel || title}
          >
            {phoneMode && (
              <div onPointerDown={startDrag} className="flex justify-center pt-3 pb-1 touch-none cursor-grab active:cursor-grabbing">
                <div className="w-10 h-1 rounded-full bg-on-surface/15" />
              </div>
            )}
            <div className={cn('flex flex-shrink-0 items-start justify-between gap-4 border-b border-on-surface/[0.06]', phoneMode ? 'px-5 pb-4 pt-3' : 'px-7 pb-5 pt-6')}>
              <div className="min-w-0">
                <h3 className={cn('font-serif font-bold leading-tight text-on-surface', phoneMode ? 'text-[21px]' : 'text-[25px]')}>{title}</h3>
                {subtitle && <p className="mt-1 text-[12.5px] leading-snug text-on-surface/45">{subtitle}</p>}
              </div>
              <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface/45 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface">
                <X size={17} />
              </button>
            </div>
            <div className={cn('flex-1 overflow-y-auto', phoneMode ? 'px-5 py-5' : 'px-7 py-6')}>
              {children}
            </div>
            {footer && (
              <div className={cn('flex-shrink-0 border-t border-on-surface/[0.06]', phoneMode ? 'px-5 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]' : 'px-7 py-4')}>
                {footer}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

/** The app's one-accent CTA, full width. */
export const SheetCta: React.FC<{ onClick: () => void; disabled?: boolean; children: React.ReactNode; danger?: boolean }> = ({ onClick, disabled, children, danger }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'w-full h-12 rounded-full transition-opacity active:opacity-85 disabled:opacity-40',
      danger ? 'bg-score-low text-white' : 'bg-primary text-on-primary',
    )}
    style={{ fontSize: '14px', fontWeight: 700 }}
  >
    {children}
  </button>
);
