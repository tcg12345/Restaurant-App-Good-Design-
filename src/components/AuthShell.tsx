import React, { useEffect, useState } from 'react';
import { MapPin, Smartphone } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';

/** True when the current viewport is wide enough for the desktop
 *  split-screen sign-in layout. Updates live as the viewport resizes. */
export function useIsDesktopAuth(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

/** Whether the calling pre-auth screen should render the wide
 *  editorial split layout. Falls back to a single-column mobile view
 *  in the phone-frame preview, on native Capacitor, or on narrow
 *  viewports. */
export function useDesktopAuthLayout(): boolean {
  const { phoneMode, isNative } = useSettings();
  const isDesktop = useIsDesktopAuth();
  return isDesktop && !phoneMode && !isNative;
}

export const GMark: React.FC<{ size?: number; className?: string }> = ({ size = 36, className }) => (
  <div
    className={cn(
      'rounded-full bg-primary flex items-center justify-center text-white font-serif italic shadow-lg shadow-primary/25',
      className,
    )}
    style={{ width: size, height: size, fontSize: size * 0.55 }}
  >
    G
  </div>
);

/** Warm editorial brand panel rendered on the left side of the
 *  desktop pre-auth split. Pure presentation — no state. */
const EditorialPanel: React.FC = () => (
  <div className="relative h-full overflow-hidden bg-cream-2 text-on-surface">
    <div className="absolute inset-0 pointer-events-none">
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-primary/[0.07]" />
      <div className="absolute bottom-[-10%] right-[-8%] w-[28rem] h-[28rem] rounded-full bg-secondary/[0.08]" />
      <div className="absolute top-1/3 right-12 w-40 h-40 rounded-full bg-accent/15" />
    </div>

    <div className="relative h-full flex flex-col justify-between p-12 xl:p-16">
      <div className="flex items-center gap-3">
        <GMark size={36} />
        <span className="text-xl font-serif font-bold tracking-tight">Gourmet Canvas</span>
      </div>

      <div className="max-w-md">
        <p className="text-xs tracking-[0.18em] uppercase text-on-surface/45 font-semibold mb-5">
          Explore · Taste · Share
        </p>
        <h2 className="font-serif font-bold text-5xl xl:text-6xl leading-[1.05] tracking-tight mb-6">
          Save the places, score what mattered, cook what stayed.
        </h2>
        <p className="text-base xl:text-lg text-on-surface/55 font-light leading-relaxed">
          Your personal guide to extraordinary dining — a quiet, private atlas of the meals you'd
          recommend if anyone asked.
        </p>
      </div>

      <div className="max-w-md w-full">
        <div className="rounded-2xl bg-paper border border-line shadow-sm p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <div className="font-serif font-bold text-lg leading-tight">Atomix</div>
              <div className="flex items-center gap-1.5 mt-1 text-xs text-on-surface/55">
                <MapPin size={12} />
                <span>NoMad · New York</span>
              </div>
            </div>
            <div className="text-right">
              <div className="font-serif font-bold text-2xl leading-none text-primary">9.4</div>
              <div className="text-[10px] uppercase tracking-wider text-on-surface/40 mt-0.5">your rating</div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { k: 'Food', v: 9.6 },
              { k: 'Vibe', v: 9.0 },
              { k: 'Service', v: 9.6 },
            ].map((b) => (
              <div key={b.k} className="flex items-center gap-3">
                <span className="w-14 text-[11px] uppercase tracking-wider text-on-surface/50 font-semibold">
                  {b.k}
                </span>
                <span className="flex-1 h-1 rounded-full bg-on-surface/8 overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-primary/70"
                    style={{ width: `${b.v * 10}%` }}
                  />
                </span>
                <span className="text-xs tabular-nums text-on-surface/70 font-medium w-8 text-right">
                  {b.v.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </div>
);

/** Desktop split-screen shell for any pre-auth surface (sign-in,
 *  profile setup, etc.). Left side is the editorial brand panel,
 *  right side renders `children` inside a max-width form column with
 *  a small brand bar on top and a Terms/Privacy footer. Only the
 *  caller-controlled `headerRight` slot varies between screens. */
export const AuthShell: React.FC<{
  children: React.ReactNode;
  headerRight?: React.ReactNode;
}> = ({ children, headerRight }) => {
  const { phoneMode, togglePhoneMode } = useSettings();
  return (
    <div className="min-h-screen bg-surface text-on-surface flex">
      <div className="hidden lg:block lg:w-[44%] xl:w-[46%]">
        <EditorialPanel />
      </div>

      <div className="flex-1 min-h-screen flex flex-col bg-surface">
        <header className="flex items-center justify-between px-10 xl:px-16 py-6">
          <div className="flex items-center gap-2.5 lg:invisible">
            <GMark size={28} />
            <span className="text-base font-serif font-bold tracking-tight">Gourmet Canvas</span>
          </div>
          <div className="text-sm">{headerRight}</div>
        </header>

        <main className="flex-1 flex items-center justify-center px-10 xl:px-16 py-8">
          <div className="w-full max-w-md">{children}</div>
        </main>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 px-10 xl:px-16 py-6 text-xs text-on-surface/40">
          <span>© 2026 Gourmet Canvas</span>
          <span>·</span>
          <a href="#" className="hover:text-on-surface/70">Terms</a>
          <span>·</span>
          <a href="#" className="hover:text-on-surface/70">Privacy</a>
          <span>·</span>
          <a href="#" className="hover:text-on-surface/70">Help</a>
          <span className="ml-auto">
            <button
              type="button"
              onClick={togglePhoneMode}
              className="inline-flex items-center gap-1.5 text-on-surface/40 hover:text-on-surface/70 transition-colors"
              aria-pressed={phoneMode}
            >
              <Smartphone size={12} />
              <span>Phone preview</span>
            </button>
          </span>
        </footer>
      </div>
    </div>
  );
};
