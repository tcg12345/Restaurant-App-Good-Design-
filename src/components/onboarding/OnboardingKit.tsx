/**
 * Onboarding design kit — the account-creation flow's primitives, in the
 * MAIN APP'S design language: clean surface background (white / graphite),
 * the app serif for headings, terracotta `--color-primary` accents, iOS-
 * style recessed input fills, capsule buttons, and liquid-glass chrome for
 * the navigation layer (the back button rides `.glass-control`, exactly
 * like the app's own top bars).
 *
 * Motion: springs from one shared config, and a `Reveal` primitive that
 * staggers step content in (soft blur on the title, rise + fade on the
 * rest). Glass stays navigation-only — in-content controls are solid, per
 * the same doctrine as the rest of the app (see index.css `.glass-control`).
 *
 * All colour resolves through the `--ob-*` custom properties in index.css,
 * which now mirror the app palette and flip with `.dark`.
 */
import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { GlassButton } from '../../lib/glass-buttons';

/* Colour values resolve through CSS custom properties (index.css) so the
   whole flow flips with the app's `.dark` class. */
export const CREAM = 'var(--ob-bg)'; // historical name — now the app surface
export const INK = 'var(--ob-ink)';
export const SECONDARY = 'var(--ob-secondary)';
export const LABEL_GREY = 'var(--ob-label)';
export const BORDER = 'var(--ob-border)';
export const TERRA = 'var(--ob-terra)';
export const TERRA_HOVER = 'var(--ob-terra-hover)';
export const SERIF = 'var(--font-serif)'; // the app's heading serif

/* ── Motion vocabulary ──────────────────────────────────────────────────── */
/** The app's arrival curve (--ease-out-strong), as a motion-usable tuple. */
export const EASE = [0.22, 1, 0.36, 1] as const;
/** Snappy, no-wobble spring for presses and step slides. */
export const SPRING = { type: 'spring' as const, stiffness: 420, damping: 38, mass: 0.9 };
/** Softer spring for things that travel (progress fill, pops). */
export const SPRING_SOFT = { type: 'spring' as const, stiffness: 260, damping: 30 };

/** Staggered entrance for step content: rise + fade, with an optional soft
 *  blur-in for the headline. `i` is the stagger slot (0, 1, 2, …). */
export const Reveal: React.FC<{
  children: React.ReactNode;
  i?: number;
  blur?: boolean;
  className?: string;
  style?: React.CSSProperties;
}> = ({ children, i = 0, blur, className, style }) => (
  <motion.div
    className={className}
    style={style}
    initial={blur ? { opacity: 0, y: 16, filter: 'blur(6px)' } : { opacity: 0, y: 14 }}
    animate={blur ? { opacity: 1, y: 0, filter: 'blur(0px)' } : { opacity: 1, y: 0 }}
    transition={{ duration: 0.55, delay: 0.07 * i, ease: EASE }}
  >
    {children}
  </motion.div>
);

/* ── Screen wrapper ─────────────────────────────────────────────────────── */
/** The screen is a fixed-height column, not a min-height one: `children`
 *  scrolls in its own region while `header` and `footer` sit outside that
 *  scroll, so the back button/progress bar and the primary action both land
 *  on the exact same pixel on every step regardless of how much content
 *  that step has — a short question and a long picked-list put "Continue"
 *  in the same place, and a step tall enough to need scrolling scrolls
 *  UNDER a footer (and BENEATH a header) that never move. Pass `footer` on
 *  every onboarding screen; omitting it falls back to the old
 *  content-decides-the-bottom layout for any screen not yet moved over. */
export const OnboardingScreen: React.FC<{
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  /** Kept for API compatibility. The page is a clean app surface now — the
   *  old cream radial glows are gone; depth comes from glass and motion. */
  glow?: 'corner' | 'center';
}> = ({ children, header, footer }) => (
  // Without a footer, height stays a MINIMUM: a screen whose content grows
  // past one viewport (an error row, a reset notice, a keyboard-shrunk
  // viewport) still needs the page itself to scroll, same as always. Only
  // a footer screen gets the hard-height + internal-scroll treatment below
  // — that trade only makes sense once something is actually pinned to it.
  <div className="relative w-full overflow-hidden" style={footer ? { height: '100dvh', background: CREAM, color: INK } : { minHeight: '100dvh', background: CREAM, color: INK }}>
    <div
      className="relative z-10 mx-auto flex w-full max-w-[430px] flex-col"
      style={{
        ...(footer ? { height: '100dvh' } : { minHeight: '100dvh' }),
        paddingTop: 'max(54px, calc(env(safe-area-inset-top) + 26px))',
        paddingBottom: footer ? 0 : 'max(28px, env(safe-area-inset-bottom))',
        paddingLeft: 24,
        paddingRight: 24,
      }}
    >
      {footer ? (
        <>
          {header && <div className="flex-shrink-0">{header}</div>}
          {/* min-h-0 overrides the flex-item default of min-height:auto —
              without it, content taller than the column refuses to shrink
              and overflow-y-auto never actually scrolls.
              overflow-x-hidden is NOT redundant: `overflow-y: auto` makes
              the x axis compute to `auto` too, so the step-change slide
              (x: ±24 → 0) would flash a real horizontal scrollbar. */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden" style={{ paddingBottom: 20 }}>
            {children}
          </div>
          <div className="flex-shrink-0" style={{ paddingBottom: 'max(28px, env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        </>
      ) : (
        <>
          {header}
          {children}
        </>
      )}
    </div>
  </div>
);

/* ── Brand mark (G in a terracotta disc) ────────────────────────────────── */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 54 }) => (
  <div
    className="flex items-center justify-center"
    style={{
      width: size, height: size, borderRadius: '50%', background: TERRA,
      boxShadow: '0 10px 26px -8px color-mix(in srgb, var(--ob-terra) 55%, transparent)',
    }}
  >
    <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 600, fontSize: size * 0.52, color: '#fff', lineHeight: 1 }}>G</span>
  </div>
);

/* ── Typography ─────────────────────────────────────────────────────────── */
/** Quiet micro-label. The flows no longer lead with these — headlines carry
 *  the screen — but form sections and older pages still use it. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 11, letterSpacing: '1.4px', fontWeight: 700, color: LABEL_GREY, textTransform: 'uppercase' }}>{children}</div>
);

export const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 34 }) => (
  <h1 style={{ fontFamily: SERIF, fontWeight: 700, fontSize: size, lineHeight: 1.06, letterSpacing: '-0.02em', margin: 0 }}>{children}</h1>
);

export const Subtitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 15.5, lineHeight: 1.5, color: SECONDARY, margin: '10px 0 0', maxWidth: 320 }}>{children}</p>
);

/** Step headline + optional one-liner, with the entrance built in: the
 *  title blurs in first, the subtitle rises after it. */
export const StepHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  topGap?: number;
}> = ({ title, subtitle, topGap = 40 }) => (
  <div style={{ marginTop: topGap }}>
    <Reveal blur><Title>{title}</Title></Reveal>
    {subtitle && <Reveal i={1}><Subtitle>{subtitle}</Subtitle></Reveal>}
  </div>
);

export const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10.5, letterSpacing: '1.3px', fontWeight: 700, color: LABEL_GREY, textTransform: 'uppercase', marginBottom: 9 }}>{children}</div>
);

/* ── Inputs ─────────────────────────────────────────────────────────────── */
/** iOS-style filled field: recessed neutral fill, no hairline at rest, a
 *  primary ring on focus. */
export const Field: React.FC<{
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  icon?: React.ReactNode;
  /** A textual prefix shown inside the field (e.g. the "@" for a handle). */
  prefix?: React.ReactNode;
  rightSlot?: React.ReactNode;
  autoFocus?: boolean;
  autoComplete?: string;
  autoCapitalize?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  name?: string;
  onSubmit?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
}> = ({ value, onChange, placeholder, type = 'text', icon, prefix, rightSlot, autoFocus, autoComplete, autoCapitalize, inputMode, name, onSubmit, onFocus, onBlur }) => (
  <div className="relative">
    {icon && (
      <span className="absolute left-4 top-1/2 -translate-y-1/2 flex pointer-events-none" style={{ color: LABEL_GREY }}>{icon}</span>
    )}
    {prefix && (
      <span className="absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" style={{ fontSize: 18, fontWeight: 600, color: LABEL_GREY }}>{prefix}</span>
    )}
    <input
      type={type}
      name={name}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onSubmit ? (e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(); } } : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      autoFocus={autoFocus}
      autoComplete={autoComplete}
      autoCapitalize={autoCapitalize}
      autoCorrect="off"
      inputMode={inputMode}
      className="w-full rounded-2xl outline-none transition-all focus:[box-shadow:0_0_0_3.5px_var(--ob-focus-ring)]"
      style={{
        height: 54,
        background: 'var(--ob-field)',
        border: 'none',
        paddingLeft: icon ? 46 : prefix ? 42 : 16,
        paddingRight: rightSlot ? 50 : 16,
        fontSize: 16.5,
        color: INK,
      }}
    />
    {rightSlot && <div className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</div>}
  </div>
);

/* ── Buttons ────────────────────────────────────────────────────────────── */
/** The flow's one solid action: a full-width terracotta capsule, same as
 *  the app's primary actions, with spring press physics. */
export const PrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  loading?: boolean;
  disabled?: boolean;
  /** Trailing icon: arrow (default), check, or none. */
  trailing?: 'arrow' | 'check' | 'none';
}> = ({ children, onClick, type = 'button', loading, disabled, trailing = 'arrow' }) => (
  <motion.button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    whileTap={!disabled && !loading ? { scale: 0.97 } : undefined}
    transition={SPRING}
    className="w-full flex items-center justify-center gap-2 rounded-full font-semibold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    style={{
      height: 52, border: 'none', background: TERRA, color: '#fff', fontSize: 16,
      boxShadow: '0 10px 22px -10px color-mix(in srgb, var(--ob-terra) 60%, transparent)',
    }}
    onMouseEnter={(e) => { if (!disabled && !loading) (e.currentTarget as HTMLButtonElement).style.background = TERRA_HOVER; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = TERRA; }}
  >
    {loading ? <Loader2 size={18} className="animate-spin" /> : (
      <>
        <span>{children}</span>
        {trailing === 'arrow' && <ArrowRight size={17} strokeWidth={2.2} />}
        {trailing === 'check' && <Check size={18} strokeWidth={2.4} />}
      </>
    )}
  </motion.button>
);

export const GhostButton: React.FC<{ children: React.ReactNode; onClick?: () => void; trailing?: boolean }> = ({ children, onClick, trailing }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center justify-center gap-2 font-semibold cursor-pointer bg-transparent border-none transition-colors"
    style={{ height: 46, color: 'var(--ob-ghost)', fontSize: 15 }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = INK)}
    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = 'var(--ob-ghost)')}
  >
    <span>{children}</span>
    {trailing && <ArrowRight size={15} strokeWidth={2} />}
  </button>
);

export const SocialButton: React.FC<{ children: React.ReactNode; icon: React.ReactNode; onClick?: () => void; disabled?: boolean }> = ({ children, icon, onClick, disabled }) => (
  <motion.button
    type="button"
    onClick={onClick}
    disabled={disabled}
    whileTap={!disabled ? { scale: 0.98 } : undefined}
    transition={SPRING}
    className="w-full flex items-center justify-center gap-2.5 rounded-full font-semibold cursor-pointer transition-colors disabled:opacity-60"
    style={{ height: 52, background: 'var(--ob-card)', border: `1px solid ${BORDER}`, color: INK, fontSize: 15.5, boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
    onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card-hover)'; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card)'; }}
  >
    {icon}
    <span>{children}</span>
  </motion.button>
);

export const Divider: React.FC<{ children?: React.ReactNode }> = ({ children = 'OR' }) => (
  <div className="flex items-center gap-3.5" style={{ margin: '22px 0' }}>
    <div className="flex-1" style={{ height: 1, background: 'var(--ob-divider)' }} />
    <span style={{ fontSize: 11, letterSpacing: '1.5px', fontWeight: 700, color: 'var(--ob-label)' }}>{children}</span>
    <div className="flex-1" style={{ height: 1, background: 'var(--ob-divider)' }} />
  </div>
);

/* ── Navigation chrome ──────────────────────────────────────────────────── */
/** The back capsule — real liquid glass, via the same native handover every
 *  other back button in the app makes (TopBar, Search, GuideDetail). This
 *  used to paint `.glass-control` by hand, which is only the FALLBACK
 *  material: CSS cannot refract, so on a flat onboarding background — where
 *  there is nothing behind the capsule for `backdrop-filter` to bend — it
 *  read as a plain dark disc. `GlassButton` registers the box with the
 *  native layer, which draws a genuine `UIGlassEffect` over it on iOS 26 and
 *  falls back to the same CSS everywhere else. */
export const RoundBackButton: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <GlassButton
    id="onboarding-back"
    symbol="arrow.left"
    label="Back"
    onClick={() => onClick?.()}
    className="flex items-center justify-center rounded-full cursor-pointer flex-shrink-0 p-0 border-none active:scale-90 transition-transform"
    style={{ width: 42, height: 42 }}
  >
    <ArrowLeft size={17} strokeWidth={2.2} style={{ color: 'var(--ob-ink-soft)' }} />
  </GlassButton>
);

/** Glass back capsule + a slim spring-animated progress track. The bar is
 *  the progress statement — no "Step N of total" caption. */
export const ProgressHeader: React.FC<{ step: number; total: number; onBack?: () => void }> = ({ step, total, onBack }) => (
  <div className="flex items-center" style={{ gap: 16 }}>
    <RoundBackButton onClick={onBack} />
    <div
      className="flex-1 overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={step}
      style={{ height: 4, borderRadius: 2, background: 'var(--ob-divider)' }}
    >
      <motion.div
        style={{ height: '100%', borderRadius: 2, background: TERRA }}
        initial={false}
        animate={{ width: `${Math.min(100, (step / total) * 100)}%` }}
        transition={SPRING_SOFT}
      />
    </div>
  </div>
);

/** An editable email chip ("you@example.com" with a pencil) that jumps back to
 *  the welcome screen. */
export const EmailPill: React.FC<{ email: string; onClick?: () => void }> = ({ email, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-2 rounded-full cursor-pointer border-none transition-colors max-w-full"
    style={{ background: 'var(--ob-pill-bg)', padding: '9px 14px', fontSize: 14, fontWeight: 500, color: 'var(--ob-pill-text)' }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-pill-bg-hover)')}
    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-pill-bg)')}
  >
    <span className="truncate">{email}</span>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="var(--ob-label)" strokeWidth="1.4" strokeLinejoin="round" /></svg>
  </button>
);

/** A large selectable option card (radio) — account type, visibility. */
export const RadioCard: React.FC<{
  selected: boolean;
  onClick: () => void;
  title: React.ReactNode;
  description: string;
}> = ({ selected, onClick, title, description }) => (
  <motion.div
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    whileTap={{ scale: 0.985 }}
    transition={SPRING}
    className="flex items-start gap-3.5 cursor-pointer transition-colors"
    style={{
      borderRadius: 16,
      padding: '16px 17px',
      border: `1.5px solid ${selected ? TERRA : BORDER}`,
      background: selected ? 'var(--ob-radio-selected)' : 'var(--ob-card)',
    }}
  >
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: 24, height: 24, borderRadius: '50%', marginTop: 1, background: selected ? TERRA : 'transparent', border: selected ? 'none' : '2px solid var(--ob-radio-ring)', transition: 'background .18s var(--ease-out-strong)' }}
    >
      {selected && (
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={SPRING_SOFT}
          style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff' }}
        />
      )}
    </span>
    <div className="flex-1 min-w-0">
      <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--ob-secondary)', marginTop: 3, lineHeight: 1.45 }}>{description}</div>
    </div>
  </motion.div>
);

/* ── Social glyphs ──────────────────────────────────────────────────────── */
export const AppleGlyph: React.FC = () => (
  <svg width="17" height="17" viewBox="0 0 16 16" fill={INK}><path d="M11 0c.1.9-.27 1.78-.84 2.42-.6.66-1.55 1.17-2.48 1.1-.12-.86.3-1.78.83-2.34C9.16.5 10.15.04 11 0zm2.78 11.6c.45.66.66.96 1.22 1.7-.62 1.18-1.5 2.65-2.6 2.66-.98.01-1.3-.64-2.42-.64-1.12 0-1.47.62-2.4.65-1.06.04-1.86-1.27-2.49-2.45-1.32-2.5-2.33-7.07-.97-9.16.67-1.04 1.87-1.7 3.16-1.72 1.01-.02 1.96.68 2.42.68.46 0 1.62-.84 2.73-.72.46.02 1.77.19 2.6 1.42-2.27 1.48-1.9 4.72.75 5.59z" /></svg>
);
export const GoogleGlyph: React.FC = () => (
  <svg width="17" height="17" viewBox="0 0 18 18"><path d="M17.6 9.2c0-.6-.05-1.18-.15-1.74H9v3.3h4.84a4.14 4.14 0 01-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.54z" fill="#4285F4" /><path d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.95v2.33A9 9 0 009 18z" fill="#34A853" /><path d="M3.97 10.72a5.4 5.4 0 010-3.44V4.95H.95a9 9 0 000 8.1l3.02-2.33z" fill="#FBBC05" /><path d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.59C13.47.9 11.43 0 9 0A9 9 0 00.95 4.95l3.02 2.33C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335" /></svg>
);

/** Inline error row (red, with a small circle-i). */
export const ErrorRow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: -4 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.25, ease: EASE }}
    className="flex items-center gap-1.5"
    style={{ marginTop: 9, color: 'var(--ob-error)', fontSize: 13, fontWeight: 500 }}
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><circle cx="8" cy="8" r="6.5" stroke="var(--ob-error)" strokeWidth="1.4" /><path d="M8 4.6v4M8 11.1v.05" stroke="var(--ob-error)" strokeWidth="1.5" strokeLinecap="round" /></svg>
    <span>{children}</span>
  </motion.div>
);
