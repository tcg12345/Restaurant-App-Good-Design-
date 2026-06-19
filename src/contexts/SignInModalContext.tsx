import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useAuth } from './AuthContext';
import { Auth } from '../pages/Auth';

/**
 * On-demand sign-in. Guests browse the app freely (App Store Guideline
 * 5.1.1(v)); when they tap an account-only action we call `requireSignIn`,
 * which presents the full `Auth` screen as a root overlay. Reusing `Auth`
 * keeps a single source of truth for email/OAuth/Sign-in-with-Apple (so the
 * SIWA name pre-fill applies here too) and returns the user to exactly where
 * they were — the underlying route never unmounts.
 *
 * Success needs no callback: `Auth` signs the user in via Supabase, which
 * flips `isSignedIn` through `onAuthStateChange`; the overlay watches that
 * and closes itself. If the freshly-signed-in user has no profile yet,
 * App.tsx's `isSignedIn && !profileComplete` branch renders ProfileSetup
 * over everything, so the overlay simply unmounts.
 */
interface SignInModalContextValue {
  /** Open the sign-in overlay. `reason` is shown as a short prompt header. */
  requireSignIn: (reason?: string) => void;
  open: boolean;
  close: () => void;
}

const SignInModalContext = createContext<SignInModalContextValue | null>(null);

export function useSignInModal(): SignInModalContextValue {
  const ctx = useContext(SignInModalContext);
  if (!ctx) throw new Error('useSignInModal must be used within SignInModalProvider');
  return ctx;
}

export const SignInModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);

  const requireSignIn = useCallback((r?: string) => {
    setReason(r ?? null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setReason(null);
  }, []);

  // Auto-close once a session exists (sign-in succeeded). If the user now
  // needs a profile, App.tsx takes over full-screen and this unmounts anyway.
  useEffect(() => {
    if (isSignedIn && open) close();
  }, [isSignedIn, open, close]);

  return (
    <SignInModalContext.Provider value={{ requireSignIn, open, close }}>
      {children}
      <AnimatePresence>
        {open && (
          <motion.div
            key="signin-overlay"
            className="fixed inset-0 z-[100] bg-surface"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="dialog"
            aria-modal="true"
            aria-label="Sign in"
          >
            {/* Close (stay a guest) */}
            <button
              type="button"
              onClick={close}
              aria-label="Close sign in"
              className="absolute z-10 top-[max(0.75rem,env(safe-area-inset-top))] right-4 w-9 h-9 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/[0.12] active:bg-on-surface/[0.16] grid place-items-center text-on-surface/65 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            {reason && (
              <div className="absolute z-10 top-[max(0.75rem,env(safe-area-inset-top))] left-0 right-14 px-5 text-center pointer-events-none">
                <span className="inline-block max-w-full truncate text-[13px] font-semibold text-on-surface/70 bg-on-surface/[0.05] rounded-full px-3 py-1">
                  {reason}
                </span>
              </div>
            )}
            {/* In the overlay, "Browse without an account" just dismisses. */}
            <Auth onBrowseAsGuest={close} />
          </motion.div>
        )}
      </AnimatePresence>
    </SignInModalContext.Provider>
  );
};
