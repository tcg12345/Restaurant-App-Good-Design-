import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useAuth } from './AuthContext';
import { Auth } from '../pages/Auth';
import { acquireHardScrollLock, liftOverlayToTopLayer } from '../lib/useBottomSheet';
import { pushOverlay } from '../lib/overlay-registry';

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
          <SignInSurface key="signin-overlay" onClose={close}>
            {/* Close (stay a guest) */}
            <button
              type="button"
              onClick={close}
              aria-label="Close sign in"
              className="hit-44 absolute z-30 top-[max(0.75rem,env(safe-area-inset-top))] right-4 w-9 h-9 rounded-full bg-on-surface/[0.06] hover:bg-on-surface/[0.12] active:bg-on-surface/[0.16] grid place-items-center text-on-surface/65 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            {reason && (
              <div className="absolute z-30 top-[max(0.75rem,env(safe-area-inset-top))] left-0 right-14 px-5 text-center pointer-events-none">
                <span className="inline-block max-w-full truncate text-[13px] font-semibold text-on-surface/70 bg-on-surface/[0.05] rounded-full px-3 py-1">
                  {reason}
                </span>
              </div>
            )}
            {/* In the overlay, "Browse without an account" just dismisses. */}
            <Auth onBrowseAsGuest={close} />
          </SignInSurface>
        )}
      </AnimatePresence>
    </SignInModalContext.Provider>
  );
};

/** Keep presentation/focus ownership through the exit animation. */
const SignInSurface: React.FC<{ children: ReactNode; onClose: () => void }> = ({ children, onClose }) => {
  const layer = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const el = layer.current;
    if (!el) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    liftOverlayToTopLayer(el);
    const releaseLock = acquireHardScrollLock();
    const releaseOverlay = pushOverlay({ dimPresenter: false });
    // Remove the presenting sheet and page from keyboard/assistive navigation
    // while retaining their state for cancellation. Never inert an ancestor.
    const background: Array<{ node: HTMLElement; inert: boolean; hidden: string | null }> = [];
    for (let branch: HTMLElement | null = el; branch?.parentElement; branch = branch.parentElement) {
      for (const sibling of Array.from(branch.parentElement.children)) {
        if (!(sibling instanceof HTMLElement) || sibling === branch) continue;
        background.push({ node: sibling, inert: sibling.inert, hidden: sibling.getAttribute('aria-hidden') });
        sibling.inert = true; sibling.setAttribute('aria-hidden', 'true');
      }
      if (branch.parentElement === document.body) break;
    }
    // Focus the surface, not an input: opening sign-in should not summon the keyboard.
    el.focus({ preventScroll: true });
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = (Array.from(el.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')) as HTMLElement[])
        .filter(control => control.getClientRects().length > 0 && !control.closest('[inert],[hidden]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (!first) { event.preventDefault(); el.focus(); return; }
      const active = document.activeElement;
      if (event.shiftKey && (active === first || active === el || !el.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (active === last || active === el || !el.contains(active))) { event.preventDefault(); first.focus(); }
    };
    el.addEventListener('keydown', keyboard);
    return () => {
      el.removeEventListener('keydown', keyboard);
      for (const { node, inert, hidden } of background) {
        node.inert = inert;
        if (hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', hidden);
      }
      releaseOverlay(); releaseLock();
      if (previous?.isConnected && (document.activeElement === document.body || el.contains(document.activeElement))) previous.focus({ preventScroll: true });
    };
  }, []);
  return <motion.div ref={layer} className="fixed inset-0 z-[100] bg-surface overflow-y-auto"
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reduced ? 0 : .2, ease: [.22, 1, .36, 1] }}
    role="dialog" aria-modal="true" aria-label="Sign in" tabIndex={-1}>{children}</motion.div>;
};
