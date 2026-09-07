/** Shared onboarding controls: system typography, quiet surfaces,
 * keyboard-aware layout, accessible actions, and reduced-motion support. */
import React from 'react';
import { motion, MotionConfig, useReducedMotion } from 'motion/react';
import './Onboarding.css';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { Logo } from '../Logo';

/* Aliases follow the active app theme. */
export const CREAM = 'var(--ob-bg)';
export const INK = 'var(--ob-ink)';
export const SECONDARY = 'var(--ob-secondary)';
export const LABEL_GREY = 'var(--ob-label)';
export const BORDER = 'var(--ob-border)';
export const TERRA = 'var(--ob-terra)';
export const TERRA_HOVER = 'var(--ob-terra-hover)';
/** What reads on top of TERRA — white by day, graphite by night. */
export const ON_TERRA = 'var(--ob-on-terra)';
export const SERIF = '-apple-system, BlinkMacSystemFont, system-ui, sans-serif';
/** System typography throughout account setup. */
export const DISPLAY = SERIF;

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
}> = ({ children, i = 0, blur, className, style }) => {
  const reduce = useReducedMotion();
  return (
  <motion.div
    className={className}
    style={style}
    initial={reduce ? false : { opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: reduce ? 0 : 0.3, delay: reduce ? 0 : 0.035 * i, ease: EASE }}
  >
    {children}
  </motion.div>
); };

/** One scroll container keeps fields, suggestions and actions reachable above
 * the keyboard. The app theme owns the status bar and all surface colors. */
export const OnboardingScreen: React.FC<{
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  glow?: 'corner' | 'center';
  contentKey?: React.Key;
}> = ({ children, header, footer, contentKey }) => {
  const content = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (contentKey === undefined) return;
    content.current?.scrollTo({ top: 0 });
    content.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
  }, [contentKey]);
  return (
  <MotionConfig reducedMotion="user">
    <main className={`onboarding-screen ${footer ? 'ob-pinned' : 'ob-form-screen'}`}>
      <div className="ob-shell">
        {header && <header className="ob-navigation">{header}</header>}
        <div className="ob-content" ref={content}>{children}</div>
        {footer && <footer className="ob-footer">{footer}</footer>}
      </div>
    </main>
  </MotionConfig>
  );
};

/* Brand mark */
/** The shared GoodEats mark follows the active theme. */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 54 }) => (
  <Logo
    size={size}
    className="rounded-full"
    style={{
      color: TERRA,
      boxShadow: 'none',
    }}
  />
);

/* ── Typography ─────────────────────────────────────────────────────────── */
/** Quiet micro-label. The flows no longer lead with these — headlines carry
 *  the screen — but form sections and older pages still use it. */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', padding: '5px 10px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontSize: 9.5, letterSpacing: '0.18em', fontWeight: 600, color: TERRA, background: 'var(--ob-badge-bg)', textTransform: 'uppercase' }}>{children}</div>
);

/** One clear headline per step. */
export const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 32 }) => (
  <h1 tabIndex={-1} style={{ fontFamily: DISPLAY, fontWeight: 650, fontSize: size, lineHeight: 1.12, letterSpacing: '-0.045em', margin: 0, textWrap: 'balance' } as React.CSSProperties}>{children}</h1>
);

export const Subtitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 15, lineHeight: 1.6, color: SECONDARY, margin: '10px 0 0', maxWidth: 320 }}>{children}</p>
);

/** Step headline + optional one-liner, with the entrance built in: the
 *  title blurs in first, the subtitle rises after it. */
export const StepHeader: React.FC<{
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  topGap?: number;
}> = ({ title, subtitle, topGap = 26 }) => (
  <div style={{ marginTop: topGap }}>
    <Reveal blur><Title>{title}</Title></Reveal>
    {subtitle && <Reveal i={1}><Subtitle>{subtitle}</Subtitle></Reveal>}
  </div>
);

export const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 13, letterSpacing: '-0.01em', fontWeight: 600, color: SECONDARY, marginBottom: 9 }}>{children}</div>
);

/* ── Inputs ─────────────────────────────────────────────────────────────── */
/** iOS-style filled field: recessed neutral fill, no hairline at rest, a
 *  primary ring on focus. */
export const Field: React.FC<{
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; icon?: React.ReactNode; prefix?: React.ReactNode;
  rightSlot?: React.ReactNode; autoFocus?: boolean; autoComplete?: string;
  invalid?: boolean; autoCapitalize?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  name?: string; label?: string; onSubmit?: () => void; onFocus?: () => void; onBlur?: () => void;
}> = ({ value, onChange, placeholder, type = 'text', icon, prefix, rightSlot,
  autoFocus, autoComplete, autoCapitalize, inputMode, name, label, onSubmit, onFocus, onBlur, invalid }) => {
  const id = React.useId();
  const ref = React.useRef<HTMLInputElement>(null);
  return <div className="ob-field-group">
    {label && <label className="ob-input-label" htmlFor={id}>{label}</label>}
    <div className="ob-field" data-keep-keyboard onClick={(event) => {
      if (!(event.target as HTMLElement).closest('button')) ref.current?.focus();
    }}>
      {(icon || prefix) && <span className="ob-field-leading" aria-hidden>{icon || prefix}</span>}
      <input ref={ref} id={id} type={type} name={name}
        aria-label={label || name || placeholder || type} aria-invalid={invalid || undefined} value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onSubmit ? (e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); onSubmit(); } } : undefined}
        onFocus={onFocus} onBlur={onBlur} placeholder={placeholder}
        autoFocus={autoFocus} autoComplete={autoComplete} autoCapitalize={autoCapitalize}
        autoCorrect="off" spellCheck={false} inputMode={inputMode}
        enterKeyHint={onSubmit ? 'go' : 'next'}
      />
      {rightSlot && <span className="ob-field-trailing" onPointerDown={(e) => e.preventDefault()}>{rightSlot}</span>}
    </div>
  </div>;
};

/* ── Buttons ────────────────────────────────────────────────────────────── */
/** Primary action, with a subtle press response. */
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
    aria-busy={!!loading}
    disabled={disabled || loading}
    whileTap={!disabled && !loading ? { scale: 0.97 } : undefined}
    transition={SPRING}
    className="ob-primary w-full flex items-center justify-center gap-2 rounded-full font-semibold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    style={{
      height: 56, borderRadius: 18, border: 'none', background: TERRA, color: ON_TERRA, fontSize: 16,
      boxShadow: '0 2px 6px rgba(0,0,0,.12)',
    }}
    onMouseEnter={(e) => { if (!disabled && !loading) (e.currentTarget as HTMLButtonElement).style.background = TERRA_HOVER; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = TERRA; }}
  >
    {loading ? <><Loader2 size={18} className="animate-spin" /><span>{children}</span></> : (
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

/** The outlined sibling of PrimaryButton — for the action that deserves a
 *  real button but must not compete with the primary (the landing screen's
 *  "Sign in", the city step's "Use my location"). A GhostButton is a line
 *  of text; this is a surface you can aim a thumb at. */
export const SecondaryButton: React.FC<{
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
}> = ({ children, icon, onClick, disabled, loading }) => (
  <motion.button
    type="button"
    onClick={onClick}
    aria-busy={!!loading}
    disabled={disabled || loading}
    whileTap={!disabled && !loading ? { scale: 0.98 } : undefined}
    transition={SPRING}
    className="w-full flex items-center justify-center gap-2.5 rounded-full font-semibold cursor-pointer transition-colors disabled:opacity-60"
    style={{ height: 54, borderRadius: 18, background: 'var(--ob-card)', border: `1.5px solid ${BORDER}`, color: INK, fontSize: 15.5, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
    onMouseEnter={(e) => { if (!disabled && !loading) (e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card-hover)'; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'var(--ob-card)'; }}
  >
    {loading ? <Loader2 size={17} className="animate-spin" /> : (
      <>
        {icon}
        <span>{children}</span>
      </>
    )}
  </motion.button>
);

export const SocialButton: React.FC<{ children: React.ReactNode; icon: React.ReactNode; onClick?: () => void; disabled?: boolean }> = ({ children, icon, onClick, disabled }) => (
  <motion.button
    type="button"
    onClick={onClick}
    disabled={disabled}
    whileTap={!disabled ? { scale: 0.98 } : undefined}
    transition={SPRING}
    className="w-full flex items-center justify-center gap-2.5 rounded-full font-semibold cursor-pointer transition-colors disabled:opacity-60"
    style={{ height: 54, borderRadius: 18, background: 'var(--ob-card)', border: `1px solid ${BORDER}`, color: INK, fontSize: 15.5, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)' }}
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

export const RoundBackButton: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <button type="button" className="ob-back" aria-label="Back" onClick={onClick}>
    <ArrowLeft size={20} strokeWidth={1.8} />
  </button>
);

export const ProgressHeader: React.FC<{ step: number; total: number; onBack?: () => void; label?: string }> = ({ step, total, onBack, label = 'Your taste' }) => (
  <div className="ob-progress-header">
    <RoundBackButton onClick={onBack} />
    <div className="ob-progress-body">
      <div className="ob-progress-caption"><span>{label}</span><span>{step} of {total}</span></div>
      <div className="ob-progress-track" role="progressbar" aria-label={`${label} progress`}
        aria-valuemin={0} aria-valuemax={total} aria-valuenow={step}>
        <motion.div initial={false} animate={{ width: `${Math.min(step / total, 1) * 100}%` }} transition={SPRING_SOFT} />
      </div>
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

/** A large selectable option card — a radio by default, a checkbox with
 *  `multi` (the dietary step, where several can be true at once). */
export const RadioCard: React.FC<{
  selected: boolean;
  onClick: () => void;
  title: React.ReactNode;
  description: string;
  multi?: boolean;
}> = ({ selected, onClick, title, description, multi }) => (
  <motion.button
    type="button"
    onClick={onClick}
    role={multi ? 'checkbox' : 'radio'}
    aria-checked={selected}
    tabIndex={0}
    whileTap={{ scale: 0.985 }}
    transition={SPRING}
    className="ob-radio-card w-full text-left flex items-start gap-3.5 cursor-pointer transition-colors"
    style={{
      borderRadius: 16,
      padding: '16px 17px',
      border: `1.5px solid ${selected ? TERRA : BORDER}`,
      background: selected ? 'var(--ob-radio-selected)' : 'var(--ob-card)',
      backdropFilter: 'blur(18px)',
      WebkitBackdropFilter: 'blur(18px)',
    }}
  >
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: 24, height: 24, borderRadius: multi ? 8 : '50%', marginTop: 1, background: selected ? TERRA : 'transparent', border: selected ? 'none' : '2px solid var(--ob-radio-ring)', transition: 'background .18s var(--ease-out-strong)' }}
    >
      {selected && (
        <motion.span
          className="inline-flex"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={SPRING_SOFT}
          style={multi ? { color: ON_TERRA } : { width: 9, height: 9, borderRadius: '50%', background: ON_TERRA }}
        >
          {multi && <Check size={14} strokeWidth={3} />}
        </motion.span>
      )}
    </span>
    <div className="flex-1 min-w-0">
      <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--ob-secondary)', marginTop: 3, lineHeight: 1.45 }}>{description}</div>
    </div>
  </motion.button>
);

/* ── Social glyphs ──────────────────────────────────────────────────────── */
/** Apple's own logo where the platform has it: U+F8FF is the Apple mark
 *  in every system font on iOS and macOS. Elsewhere that code point is
 *  private-use and draws nothing, so the traced path stands in. */
const HAS_APPLE_MARK = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
export const AppleGlyph: React.FC<{ color?: string; size?: number }> = ({ color = INK, size = 17 }) => HAS_APPLE_MARK ? (
  <span aria-hidden style={{ fontFamily: '-apple-system, system-ui', fontSize: size, lineHeight: 1, color, display: 'inline-block', transform: 'translateY(-1px)' }}>{'\uF8FF'}</span>
) : (
  <svg width={size} height={size} viewBox="0 0 16 16" fill={color}><path d="M11 0c.1.9-.27 1.78-.84 2.42-.6.66-1.55 1.17-2.48 1.1-.12-.86.3-1.78.83-2.34C9.16.5 10.15.04 11 0zm2.78 11.6c.45.66.66.96 1.22 1.7-.62 1.18-1.5 2.65-2.6 2.66-.98.01-1.3-.64-2.42-.64-1.12 0-1.47.62-2.4.65-1.06.04-1.86-1.27-2.49-2.45-1.32-2.5-2.33-7.07-.97-9.16.67-1.04 1.87-1.7 3.16-1.72 1.01-.02 1.96.68 2.42.68.46 0 1.62-.84 2.73-.72.46.02 1.77.19 2.6 1.42-2.27 1.48-1.9 4.72.75 5.59z" /></svg>
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
    role="alert"
    className="flex items-center gap-1.5"
    style={{ marginTop: 9, color: 'var(--ob-error)', fontSize: 13, fontWeight: 500 }}
  >
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><circle cx="8" cy="8" r="6.5" stroke="var(--ob-error)" strokeWidth="1.4" /><path d="M8 4.6v4M8 11.1v.05" stroke="var(--ob-error)" strokeWidth="1.5" strokeLinecap="round" /></svg>
    <span>{children}</span>
  </motion.div>
);
