import React from 'react';
import { reportClientError } from '../lib/error-reporting';
import { Logo } from './Logo';

/**
 * Root crash screen + global error hooks.
 *
 * Three layers, all funneling into the same branded fallback so the app
 * never shows a blank white webview or a raw error string:
 *   1. <AppErrorBoundary> catches React render/lifecycle errors.
 *   2. window 'error' (uncaught errors outside React's render path) is
 *      logged + reported; it only paints the fallback when React never
 *      mounted (benign noise like ResizeObserver-loop is filtered).
 *   3. If a crash happens before React mounts at all, a minimal DOM
 *      version of the same fallback is painted straight into #root.
 */

const AppErrorFallback: React.FC<{ onTryAgain: () => void }> = ({ onTryAgain }) => (
  <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-5 px-8 text-center">
    <Logo size={48} className="text-primary" />
    <div className="space-y-1.5">
      <p className="font-serif text-xl text-on-surface">Something went wrong</p>
      <p className="text-sm text-on-surface/60 max-w-[280px]">
        An unexpected error occurred. You can try again, or reload to pick up
        where you left off.
      </p>
    </div>
    <div className="flex items-center gap-3">
      <button
        onClick={onTryAgain}
        className="mt-1 px-7 py-2.5 rounded-full bg-primary text-on-primary text-sm font-medium transition-transform active:scale-[0.97]"
      >
        Try again
      </button>
      <button
        onClick={() => window.location.reload()}
        className="mt-1 px-6 py-2.5 rounded-full border border-on-surface/15 text-on-surface/70 text-sm font-medium transition-transform active:scale-[0.97]"
      >
        Reload
      </button>
    </div>
  </div>
);

type BoundaryState = { hasError: boolean };
type BoundaryProps = { children?: unknown };

export class AppErrorBoundary extends React.Component {
  // The repo has no React type definitions (react ships none and
  // @types/react isn't installed), so the inherited members are declared
  // manually — `declare` adds types without emitting anything.
  declare props: BoundaryProps;
  declare setState: (state: BoundaryState) => void;

  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }) {
    reportClientError('render', error, info.componentStack);
  }

  // Clear the fallback when the user navigates (hardware/browser back or a
  // link from outside the crashed subtree) — a render error in one page
  // shouldn't dead-end the whole session behind a reload.
  private resetOnNav = () => {
    if ((this.state as BoundaryState).hasError) this.setState({ hasError: false });
  };

  componentDidMount() {
    window.addEventListener('popstate', this.resetOnNav);
  }

  componentWillUnmount() {
    window.removeEventListener('popstate', this.resetOnNav);
  }

  render() {
    if ((this.state as BoundaryState).hasError) {
      return <AppErrorFallback onTryAgain={() => this.setState({ hasError: false })} />;
    }
    return this.props.children;
  }
}

/**
 * Same fallback, no React — for errors thrown before the app mounts
 * (e.g. a module-eval failure). Inline styles only, since we can't assume
 * anything rendered. Colors mirror --color-surface / --color-primary in
 * index.css for both themes.
 */
function renderDetachedFallback() {
  const root = document.getElementById('root');
  // If React already painted something, leave it to the boundary.
  if (!root || root.childElementCount > 0) return;
  const dark = document.documentElement.classList.contains('dark');
  const bg = dark ? '#1b1c20' : '#f8f6f2';
  const fg = dark ? '#ededed' : '#1e1b1a';
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:0 32px;text-align:center;background:${bg};color:${fg};font-family:Manrope,system-ui,sans-serif;">
      <!-- The mark, hand-inlined. This path runs when the bundle itself
           failed to evaluate, so it cannot import components/Logo.tsx and
           cannot rely on a webfont having loaded — the geometry and the
           terracotta are literal here on purpose. Keep in sync with
           Logo.tsx and public/logo.svg. -->
      <svg width="48" height="48" viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="48" fill="#1c1a19"/>
        <rect x="23" y="40" width="54" height="6.5" rx="3.25" fill="#fff"/>
        <path d="M28 52 Q50 75 72 52 Z" fill="#fff"/>
      </svg>
      <div>
        <p style="margin:0 0 6px;font-family:'Noto Serif',serif;font-size:20px;">Something went wrong</p>
        <p style="margin:0;font-size:14px;opacity:0.6;max-width:280px;">An unexpected error occurred. Reload to pick up where you left off.</p>
      </div>
      <button id="app-error-reload" style="margin-top:4px;padding:10px 28px;border:none;border-radius:9999px;background:#2b2622;color:#fff;font-size:14px;font-weight:500;font-family:inherit;">Reload</button>
    </div>`;
  document.getElementById('app-error-reload')?.addEventListener('click', () => window.location.reload());
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    const msg = String(event.message || '');
    // Benign by spec: browsers fire this when a ResizeObserver's callbacks
    // can't all deliver within one frame (the app uses ResizeObserver in
    // several places, e.g. DraggableSheet). Nothing is wrong — swallowing
    // it silently is the documented handling.
    if (/ResizeObserver loop/i.test(msg)) return;
    // Opaque cross-origin "Script error." carries zero information and the
    // app demonstrably survives it — log-only.
    if (msg === 'Script error.' || msg === 'Script error') {
      console.warn('[app] opaque cross-origin script error');
      return;
    }
    reportClientError('uncaught', event.error ?? event.message);
    // While React is mounted it stays interactive after an async window
    // error — treat it like an unhandled rejection (log + report) rather
    // than nuking the whole session with the crash screen. The full-screen
    // fallback is reserved for genuine React render errors (the boundary's
    // componentDidCatch) and for crashes BEFORE React mounts, which the
    // detached fallback below covers (it no-ops once #root has content).
    renderDetachedFallback();
  });

  window.addEventListener('unhandledrejection', (event) => {
    // A missed .catch() never blanks the UI — React stays mounted and
    // interactive — so rejections are logged, not escalated. Swapping the
    // whole app for the crash screen on any transient background failure
    // (flaky network mid-scroll, a slow Supabase call timing out) would be
    // far worse than the failed request itself.
    console.error('[app] unhandled rejection:', event.reason);
    event.preventDefault();
  });
}
