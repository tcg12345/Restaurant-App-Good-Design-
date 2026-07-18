import React, { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Heart, HeartOff, Check, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSettings } from './SettingsContext';

export type ToastVariant = 'wishlist-add' | 'wishlist-remove' | 'rated' | 'rating-updated' | 'success';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  message: string;
  subtitle?: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastContextValue {
  showToast: (
    message: string,
    opts?: { subtitle?: string; variant?: ToastVariant; action?: ToastAction; durationMs?: number },
  ) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

const TOAST_DURATION_MS = 2200;
// Toasts with an action (e.g. Undo) linger longer so there's time to tap it.
const TOAST_ACTION_DURATION_MS = 6000;

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<Toast | null>(null);
  const timerRef = useRef<number | null>(null);
  const { phoneMode } = useSettings();

  const dismiss = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback<ToastContextValue['showToast']>((message, opts) => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    setToast({
      id: Date.now() + Math.random(),
      message,
      subtitle: opts?.subtitle,
      variant: opts?.variant ?? 'success',
      action: opts?.action,
    });
    const duration = opts?.durationMs ?? (opts?.action ? TOAST_ACTION_DURATION_MS : TOAST_DURATION_MS);
    timerRef.current = window.setTimeout(() => {
      setToast(null);
      timerRef.current = null;
    }, duration);
  }, []);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const Icon = toast?.variant === 'wishlist-remove' ? HeartOff
    : toast?.variant === 'wishlist-add' ? Heart
    : toast?.variant === 'rated' || toast?.variant === 'rating-updated' ? Star
    : Check;

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: 28, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 12, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', damping: 24, stiffness: 320, mass: 0.7 }}
            onClick={dismiss}
            className={cn(
              'fixed left-1/2 -translate-x-1/2 z-[300] pointer-events-auto cursor-pointer',
              // Sit above the bottom nav. Phone mode the nav is taller and
              // pinned inside the phone frame, so lift the toast a bit more.
              phoneMode ? 'bottom-24' : 'bottom-24 sm:bottom-10',
            )}
          >
            <div
              className={cn(
                'flex items-center gap-3 pl-3.5 pr-4 py-2.5',
                'rounded-full bg-on-surface/95 backdrop-blur-md',
                'shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.18)]',
                'ring-1 ring-white/10',
              )}
            >
              <motion.span
                initial={{ scale: 0.6, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', damping: 14, stiffness: 380, delay: 0.04 }}
                className={cn(
                  'flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0',
                  toast.variant === 'wishlist-add' ? 'bg-red-500/95 text-white'
                    : toast.variant === 'wishlist-remove' ? 'bg-white/10 text-white/80'
                    : toast.variant === 'rated' ? 'bg-amber-400/95 text-white'
                    : toast.variant === 'rating-updated' ? 'bg-amber-400/20 text-amber-300'
                    : 'bg-emerald-500/95 text-white',
                )}
              >
                <Icon
                  size={14}
                  className={
                    toast.variant === 'wishlist-add' ? 'fill-white'
                      : toast.variant === 'rated' ? 'fill-white'
                      : toast.variant === 'rating-updated' ? 'fill-amber-300'
                      : ''
                  }
                  strokeWidth={2.4}
                />
              </motion.span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-surface leading-tight whitespace-nowrap">
                  {toast.message}
                </p>
                {toast.subtitle && (
                  <p className="text-[11px] text-surface/55 leading-tight mt-0.5 truncate max-w-[60vw]">
                    {toast.subtitle}
                  </p>
                )}
              </div>
              {toast.action && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toast.action?.onClick();
                    dismiss();
                  }}
                  className="ml-1 flex-shrink-0 rounded-full px-3 py-1 text-[12px] font-semibold text-amber-300 hover:text-amber-200 hover:bg-white/10 transition-colors"
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};
