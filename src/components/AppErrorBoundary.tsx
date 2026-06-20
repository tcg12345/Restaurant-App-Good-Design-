import React from 'react';

/**
 * Root crash screen + global error hooks.
 *
 * Three layers, all funneling into the same branded fallback so the app
 * never shows a blank white webview or a raw error string:
 *   1. <AppErrorBoundary> catches React render/lifecycle errors.
 *   2. window 'error' (uncaught synchronous errors outside React's render
 *      path) flips the mounted boundary to the fallback.
 *   3. If a crash happens before React mounts at all, a minimal DOM
 *      version of the same fallback is painted straight into #root.
 */

/** Lets the global 'error' listener flip the mounted boundary. */
let showBoundaryFallback: (() => void) | null = null;

const AppErrorFallback: React.FC = () => (
  <div className="min-h-screen bg-surface flex flex-col items-center justify-center gap-5 px-8 text-center">
    <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-2xl">
      G
    </div>
    <div className="space-y-1.5">
      <p className="font-serif text-xl text-on-surface">Something went wrong</p>
      <p className="text-sm text-on-surface/60 max-w-[280px]">
        An unexpected error occurred. Reload to pick up where you left off.
      </p>
    </div>
    <button
      onClick={() => window.location.reload()}
      className="mt-1 px-7 py-2.5 rounded-full bg-primary text-white text-sm font-medium transition-transform active:scale-[0.97]"
    >
      Reload
    </button>
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
    console.error('[app] render error:', error, info.componentStack);
  }

  componentDidMount() {
    showBoundaryFallback = () => this.setState({ hasError: true });
  }

  componentWillUnmount() {
    showBoundaryFallback = null;
  }

  render() {
    if ((this.state as BoundaryState).hasError) return <AppErrorFallback />;
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
  const bg = dark ? '#0e0e0f' : '#ffffff';
  const fg = dark ? '#ededed' : '#1e1b1a';
  root.innerHTML = `
    <div style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;padding:0 32px;text-align:center;background:${bg};color:${fg};font-family:Manrope,system-ui,sans-serif;">
      <div style="width:48px;height:48px;border-radius:9999px;background:#9f3012;color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Noto Serif',serif;font-style:italic;font-size:24px;">G</div>
      <div>
        <p style="margin:0 0 6px;font-family:'Noto Serif',serif;font-size:20px;">Something went wrong</p>
        <p style="margin:0;font-size:14px;opacity:0.6;max-width:280px;">An unexpected error occurred. Reload to pick up where you left off.</p>
      </div>
      <button id="app-error-reload" style="margin-top:4px;padding:10px 28px;border:none;border-radius:9999px;background:#9f3012;color:#fff;font-size:14px;font-weight:500;font-family:inherit;">Reload</button>
    </div>`;
  document.getElementById('app-error-reload')?.addEventListener('click', () => window.location.reload());
}

export function installGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    console.error('[app] uncaught error:', event.error ?? event.message);
    if (showBoundaryFallback) {
      showBoundaryFallback();
    } else {
      renderDetachedFallback();
    }
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
