import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowUpRight, Heart, MapPin, Smartphone, Sparkles, Star, Users,
} from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';

/** Which step of the pre-auth flow is showing — drives the editorial
 *  left-panel variant so each step gets its own visual story. */
export type AuthPanelVariant = 'email' | 'password' | 'signup' | 'profile';

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

// ── Shared bits used by every panel ─────────────────────────────────────
const HeroHeading: React.FC<{ line1: string; line2: string }> = ({ line1, line2 }) => (
  <h2 className="font-display tracking-tight leading-[0.92] italic font-semibold">
    <span className="block text-4xl xl:text-5xl 2xl:text-6xl text-on-surface">{line1}</span>
    <span className="block text-5xl xl:text-6xl 2xl:text-7xl text-primary mt-1">{line2}</span>
  </h2>
);

const PressQuote: React.FC<{ quote: string; source: string }> = ({ quote, source }) => (
  <div className="max-w-md">
    <div className="flex items-start gap-2 text-on-surface/65 italic font-serif text-sm xl:text-base leading-snug">
      <span className="text-primary text-3xl leading-[0.5] mt-1.5 font-serif select-none">&ldquo;</span>
      <span>{quote}</span>
    </div>
    <div className="mt-2 text-[10px] xl:text-[11px] tracking-[0.18em] uppercase text-on-surface/40 font-semibold">
      — {source}
    </div>
  </div>
);

// ── Visual 1 — stacked memory cards (Email step) ────────────────────────
const StackedCards: React.FC = () => (
  <div className="relative w-full max-w-[420px] h-[270px] mx-auto">
    {/* Recipe — top-left, smallest, most rotated */}
    <motion.div
      initial={false}
      style={{ rotate: -5 }}
      whileHover={{ rotate: -8, y: -8, x: -4, scale: 1.03 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      className="absolute top-0 left-0 w-[240px] rounded-2xl bg-paper border border-line shadow-md p-3.5 cursor-pointer z-10"
    >
      <div className="text-[10px] uppercase tracking-[0.14em] text-primary font-bold mb-1.5">
        Dish · Cacio e pepe
      </div>
      <div className="font-display font-bold text-lg leading-tight text-on-surface mb-0.5">
        Cacio e pepe
      </div>
      <div className="text-[11px] text-on-surface/55 mb-2">35 min · From your saved</div>
      <div className="flex flex-wrap gap-1.5">
        <span className="px-2 py-0.5 rounded-full bg-secondary/15 text-secondary text-[10px] font-bold">Pasta</span>
        <span className="px-2 py-0.5 rounded-full bg-on-surface/[0.05] text-on-surface/60 text-[10px] font-medium">5 ingredients</span>
      </div>
    </motion.div>

    {/* Friend activity — middle */}
    <motion.div
      initial={false}
      style={{ rotate: -1 }}
      whileHover={{ rotate: 1, y: -6, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      className="absolute top-[88px] left-[56px] w-[300px] rounded-2xl bg-paper border border-line shadow-md p-3.5 cursor-pointer z-20"
    >
      <div className="flex items-start gap-2.5">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-secondary to-primary flex items-center justify-center text-white font-bold flex-shrink-0 text-sm">
          M
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] leading-snug text-on-surface">
            <strong className="font-bold">Maya</strong> rated{' '}
            <strong className="font-bold">Don Angie</strong> a perfect 10
          </div>
          <div className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
            <Sparkles size={10} strokeWidth={2.5} />
            <span>first 10 this year</span>
          </div>
          <div className="text-[10px] text-on-surface/45 mt-1">2 hours ago · West Village</div>
        </div>
      </div>
    </motion.div>

    {/* Restaurant — bottom-right, biggest */}
    <motion.div
      initial={false}
      style={{ rotate: 2 }}
      whileHover={{ rotate: 4, y: -4, scale: 1.02 }}
      transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      className="absolute bottom-0 right-0 w-[280px] rounded-2xl bg-paper border border-line shadow-lg p-4 cursor-pointer z-30"
    >
      <div className="flex items-start justify-between gap-4 mb-2.5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.14em] text-on-surface/40 font-bold mb-0.5">Restaurant</div>
          <div className="font-display font-bold text-lg leading-tight">Atomix</div>
          <div className="flex items-center gap-1 mt-0.5 text-[11px] text-on-surface/55">
            <MapPin size={11} />
            <span>NoMad · New York</span>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display font-bold text-2xl leading-none text-primary">9.4</div>
          <div className="text-[9px] uppercase tracking-[0.14em] text-on-surface/40 mt-1 font-bold">your rating</div>
        </div>
      </div>
      <div className="space-y-1">
        {[
          { k: 'Food', v: 9.6 },
          { k: 'Vibe', v: 9.0 },
          { k: 'Service', v: 9.6 },
        ].map((b) => (
          <div key={b.k} className="flex items-center gap-2.5">
            <span className="w-12 text-[10px] uppercase tracking-wider text-on-surface/50 font-bold">{b.k}</span>
            <span className="flex-1 h-1 rounded-full bg-on-surface/[0.08] overflow-hidden">
              <span className="block h-full rounded-full bg-primary/70" style={{ width: `${b.v * 10}%` }} />
            </span>
            <span className="text-[10px] tabular-nums text-on-surface/70 font-bold w-6 text-right">{b.v.toFixed(1)}</span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5">
        <span className="px-2 py-0.5 rounded-full bg-on-surface/[0.05] text-on-surface/60 text-[10px] font-medium">Tasting menu</span>
        <span className="px-2 py-0.5 rounded-full bg-on-surface/[0.05] text-on-surface/60 text-[10px] font-medium">Visited · May 2026</span>
      </div>
    </motion.div>
  </div>
);

// ── Visual 2 — your year + recent visits (Password step) ────────────────
const YearInReview: React.FC = () => {
  const stats = [
    { v: 47, k: 'places rated' },
    { v: 12, k: 'perfect 10s' },
    { v: 28, k: 'meals cooked' },
  ];
  const visits = [
    { name: 'Maison Verte', loc: 'Paris', score: 9.6, dot: 'bg-primary' },
    { name: 'Tiny Restaurant', loc: 'Manhattan', score: 8.4, dot: 'bg-secondary' },
    { name: 'Birds of a Feather', loc: 'Williamsburg', score: 9.0, dot: 'bg-accent' },
  ];
  return (
    <div className="w-full max-w-[400px] mx-auto space-y-2.5">
      <motion.div
        initial={false}
        whileHover={{ y: -3, scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="rounded-2xl bg-paper border border-line shadow-md p-4 cursor-pointer"
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-bold">
            Your year, so far
          </span>
          <ArrowUpRight size={14} className="text-on-surface/35" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.k}>
              <div className="font-display font-bold text-2xl xl:text-3xl leading-none text-on-surface tabular-nums">
                {s.v}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-on-surface/45 mt-1 font-bold leading-tight">
                {s.k}
              </div>
            </div>
          ))}
        </div>
      </motion.div>

      <div className="space-y-1 pt-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-bold px-1 mb-1">
          Recently visited
        </div>
        {visits.map((v) => (
          <motion.div
            key={v.name}
            initial={false}
            whileHover={{ x: 4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex items-center gap-3 px-3.5 py-2.5 rounded-xl bg-paper/70 hover:bg-paper border border-line/60 hover:border-line transition-colors cursor-pointer"
          >
            <span className={cn('w-1.5 h-1.5 rounded-full', v.dot)} />
            <div className="flex-1 min-w-0">
              <div className="font-display font-bold text-sm leading-tight text-on-surface truncate">
                {v.name}
              </div>
              <div className="text-[10px] text-on-surface/55 mt-0.5">{v.loc}</div>
            </div>
            <span className="font-display font-bold text-primary text-sm tabular-nums">{v.score.toFixed(1)}</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// ── Visual 3 — three steps (Signup step) ────────────────────────────────
const HowItWorks: React.FC = () => {
  const steps = [
    {
      n: '01',
      icon: MapPin,
      title: 'Pin places worth remembering',
      desc: 'A private atlas of restaurants, cafés, and bakeries — the spots you keep returning to.',
    },
    {
      n: '02',
      icon: Star,
      title: 'Score what actually mattered',
      desc: 'Rate food, vibe, and service on a 10-point scale that belongs only to you.',
    },
    {
      n: '03',
      icon: Users,
      title: 'Follow the people you trust',
      desc: 'No algorithm. Just friends and tastemakers whose recommendations you actually want.',
    },
  ];
  return (
    <div className="w-full max-w-[420px] mx-auto space-y-2.5">
      {steps.map((s) => (
        <motion.div
          key={s.n}
          initial={false}
          whileHover={{ y: -3, scale: 1.01 }}
          transition={{ type: 'spring', stiffness: 220, damping: 20 }}
          className="group flex items-start gap-3.5 p-3.5 rounded-2xl bg-paper border border-line hover:border-primary/30 hover:shadow-md transition-[border-color,box-shadow] cursor-pointer"
        >
          <div className="flex flex-col items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] tracking-[0.14em] uppercase text-on-surface/40 font-bold font-mono">
              {s.n}
            </span>
            <div className="w-9 h-9 rounded-full bg-primary/10 group-hover:bg-primary/15 flex items-center justify-center text-primary transition-colors">
              <s.icon size={16} strokeWidth={2} />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-base leading-tight text-on-surface">{s.title}</div>
            <div className="text-[12px] text-on-surface/55 mt-0.5 leading-snug">{s.desc}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
};

// ── Visual 4 — profile preview (Profile setup) ──────────────────────────
const ProfilePreview: React.FC = () => {
  const lists = [
    { name: 'NYC favorites', count: 14 },
    { name: 'Date night', count: 7 },
    { name: 'Cooking goals', count: 9 },
  ];
  return (
    <div className="w-full max-w-[380px] mx-auto space-y-2.5">
      <motion.div
        initial={false}
        whileHover={{ y: -3, scale: 1.01 }}
        transition={{ type: 'spring', stiffness: 220, damping: 20 }}
        className="rounded-2xl bg-paper border border-line shadow-md overflow-hidden cursor-pointer"
      >
        <div className="h-14 bg-gradient-to-br from-primary/30 via-accent/40 to-secondary/30 relative">
          <div className="absolute inset-0 opacity-40" style={{
            backgroundImage: 'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.5) 0%, transparent 50%), radial-gradient(circle at 80% 70%, rgba(255,255,255,0.3) 0%, transparent 50%)',
          }} />
        </div>
        <div className="px-4 pb-4 -mt-8 relative">
          <div className="w-16 h-16 rounded-full border-4 border-paper shadow-md flex items-center justify-center bg-gradient-to-br from-primary to-secondary text-white font-serif italic text-2xl">
            T
          </div>
          <div className="mt-2">
            <div className="font-display font-bold text-xl leading-tight text-on-surface">Your name</div>
            <div className="text-xs text-on-surface/55">@your_handle</div>
          </div>
          <div className="flex items-center gap-1 mt-1.5 text-[11px] text-on-surface/55">
            <MapPin size={11} />
            <span>Your home city</span>
          </div>
          <div className="flex items-center gap-5 mt-3">
            {['places', 'followers', 'following'].map((k) => (
              <div key={k}>
                <div className="font-display font-bold text-base leading-none tabular-nums">0</div>
                <div className="text-[10px] uppercase tracking-wider text-on-surface/45 mt-1 font-bold">{k}</div>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Suggested starter lists */}
      <div className="space-y-1">
        <div className="text-[10px] uppercase tracking-[0.14em] text-on-surface/45 font-bold px-1 mb-1">
          Starter lists you'll get
        </div>
        {lists.map((l) => (
          <motion.div
            key={l.name}
            initial={false}
            whileHover={{ x: 4 }}
            transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            className="flex items-center gap-3 px-3.5 py-2 rounded-xl bg-paper/70 hover:bg-paper border border-line/60 hover:border-line transition-colors cursor-pointer"
          >
            <Heart size={13} className="text-primary/70" />
            <span className="font-display font-bold text-[13px] flex-1 text-on-surface">{l.name}</span>
            <span className="text-[10px] text-on-surface/45 tabular-nums">{l.count} places</span>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

// ── Panel definitions ───────────────────────────────────────────────────
const PANELS: Record<AuthPanelVariant, {
  bg: string;
  heading: { line1: string; line2: string };
  subtitle: string;
  visual: React.ReactNode;
  quote: { text: string; source: string };
}> = {
  email: {
    bg: 'bg-[linear-gradient(135deg,#fdeee5_0%,#fbe1d2_45%,#f7dcc7_100%)]',
    heading: { line1: 'Taste,', line2: 'remembered.' },
    subtitle:
      'A personal canvas for the meals you love, the friends who feed you, and the restaurants worth a second visit.',
    visual: <StackedCards />,
    quote: {
      text: 'Like Goodreads, but for the meals that stick.',
      source: 'THE TABLE, 2026',
    },
  },
  password: {
    bg: 'bg-[linear-gradient(135deg,#eef1de_0%,#e5e9d2_50%,#eef0d8_100%)]',
    heading: { line1: 'Right where', line2: 'you left off.' },
    subtitle:
      'Your saved meals, the latest from friends, and the list of places you keep meaning to try.',
    visual: <YearInReview />,
    quote: {
      text: 'Returning to a place is its own kind of review.',
      source: 'PALATE WEEKLY, 2026',
    },
  },
  signup: {
    bg: 'bg-[linear-gradient(135deg,#f7f0e2_0%,#f2e6cf_50%,#fbf2db_100%)]',
    heading: { line1: 'A canvas', line2: 'of your own.' },
    subtitle:
      'Start with one place, one meal, one friend you trust. The atlas grows from there.',
    visual: <HowItWorks />,
    quote: {
      text: "The best food guide is the one that's yours.",
      source: 'THE GOURMET REVIEW, 2026',
    },
  },
  profile: {
    bg: 'bg-[linear-gradient(135deg,#f6e7e2_0%,#f1dcd5_50%,#f8ebe5_100%)]',
    heading: { line1: 'Make it', line2: 'yours.' },
    subtitle:
      'Your name, your handle, your home city — the small details that make this canvas yours.',
    visual: <ProfilePreview />,
    quote: {
      text: 'Identity is the salt of any good guide.',
      source: 'TABLEAU MAGAZINE, 2026',
    },
  },
};

const EditorialPanel: React.FC<{ variant: AuthPanelVariant }> = ({ variant }) => {
  const p = PANELS[variant];
  return (
    <div className={cn('relative h-full overflow-hidden text-on-surface', p.bg)}>
      {/* Soft blurred shapes for depth — common to every panel */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-32 -right-24 w-96 h-96 rounded-full bg-primary/[0.06] blur-2xl" />
        <div className="absolute bottom-[-15%] left-[-12%] w-[32rem] h-[32rem] rounded-full bg-accent/[0.18] blur-3xl" />
        <div className="absolute top-[35%] right-[20%] w-32 h-32 rounded-full bg-secondary/[0.10] blur-2xl" />
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={variant}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
          className="relative h-full flex flex-col p-8 xl:p-12"
        >
          {/* Brand bar */}
          <div className="flex items-center gap-3 mb-5 xl:mb-7 flex-shrink-0">
            <GMark size={32} />
            <span className="text-lg font-serif font-bold tracking-tight">Gourmet Canvas</span>
          </div>

          {/* Heading + subtitle */}
          <div className="max-w-md flex-shrink-0">
            <HeroHeading line1={p.heading.line1} line2={p.heading.line2} />
            <p className="text-sm xl:text-base text-on-surface/55 font-light leading-relaxed mt-4">
              {p.subtitle}
            </p>
          </div>

          {/* Visual composition — flex-1 so cards center vertically and
              clip cleanly on short viewports rather than spilling over. */}
          <div className="flex-1 min-h-0 flex items-center justify-center my-4 overflow-hidden">
            {p.visual}
          </div>

          {/* Pull quote */}
          <div className="flex-shrink-0">
            <PressQuote quote={p.quote.text} source={p.quote.source} />
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

/** Desktop split-screen shell for any pre-auth surface (sign-in,
 *  profile setup, etc.). Left side is the editorial brand panel —
 *  varies by `panel` prop — and the right side renders `children`
 *  inside a max-width form column with a small brand bar on top and
 *  a Terms/Privacy footer. */
export const AuthShell: React.FC<{
  children: React.ReactNode;
  headerRight?: React.ReactNode;
  panel?: AuthPanelVariant;
}> = ({ children, headerRight, panel = 'email' }) => {
  const { phoneMode, togglePhoneMode } = useSettings();
  return (
    <div className="h-screen overflow-hidden bg-surface text-on-surface flex">
      <div className="hidden lg:block lg:w-[44%] xl:w-[46%] h-screen">
        <EditorialPanel variant={panel} />
      </div>

      <div className="flex-1 h-screen flex flex-col bg-surface min-w-0">
        <header className="flex items-center justify-between px-8 xl:px-14 py-5 flex-shrink-0">
          <div className="flex items-center gap-2.5 lg:invisible">
            <GMark size={28} />
            <span className="text-base font-serif font-bold tracking-tight">Gourmet Canvas</span>
          </div>
          <div className="text-sm">{headerRight}</div>
        </header>

        <main className="flex-1 min-h-0 flex items-center justify-center px-8 xl:px-14 py-2 overflow-hidden">
          <div className="w-full max-w-md">{children}</div>
        </main>

        <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 px-8 xl:px-14 py-4 text-xs text-on-surface/40 flex-shrink-0">
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
