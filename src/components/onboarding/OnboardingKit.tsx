/**
 * Onboarding design kit — the warm-cream / terracotta editorial look used
 * across the account-creation flow (Welcome → Create account → 5-step profile
 * wizard → All set, plus Sign in). One cohesive design for every viewport: a
 * centred phone-width column on a cream page with a soft radial glow.
 *
 * Newsreader (serif) for headings; the app's sans for UI/body. Terracotta
 * accent, 56–58px inputs with a 15px radius and a terracotta focus ring.
 */
import React from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';

export const CREAM = '#FBF4F0';
export const INK = '#211C19';
export const SECONDARY = '#7A716B';
export const LABEL_GREY = '#A99E97';
export const BORDER = '#ECE1DA';
export const TERRA = '#A6371D';
export const TERRA_HOVER = '#8C2E18';
export const SERIF = '"Newsreader", Georgia, serif';

/* ── Screen wrapper ─────────────────────────────────────────────────────── */
export const OnboardingScreen: React.FC<{
  children: React.ReactNode;
  /** Corner glow (most screens) or a centred glow (the success screen). */
  glow?: 'corner' | 'center';
}> = ({ children, glow = 'corner' }) => (
  <div className="relative w-full overflow-hidden" style={{ minHeight: '100dvh', background: CREAM, color: INK }}>
    <div
      className="pointer-events-none absolute inset-x-0 top-0"
      style={{
        height: glow === 'center' ? 440 : 340,
        background:
          glow === 'center'
            ? 'radial-gradient(120% 70% at 50% 0%, rgba(214,150,120,0.22), rgba(214,150,120,0) 62%)'
            : 'radial-gradient(120% 80% at 82% 0%, rgba(214,150,120,0.18), rgba(214,150,120,0) 60%)',
      }}
    />
    <div
      className="relative z-10 mx-auto flex w-full max-w-[420px] flex-col"
      style={{
        minHeight: '100dvh',
        paddingTop: 'max(56px, calc(env(safe-area-inset-top) + 28px))',
        paddingBottom: 'max(28px, env(safe-area-inset-bottom))',
        paddingLeft: 26,
        paddingRight: 26,
      }}
    >
      {children}
    </div>
  </div>
);

/* ── Brand mark (G in a terracotta disc) ────────────────────────────────── */
export const BrandMark: React.FC<{ size?: number }> = ({ size = 54 }) => (
  <div
    className="flex items-center justify-center"
    style={{ width: size, height: size, borderRadius: '50%', background: TERRA, boxShadow: '0 8px 20px rgba(166,55,29,0.30)' }}
  >
    <span style={{ fontFamily: SERIF, fontStyle: 'italic', fontWeight: 600, fontSize: size * 0.52, color: '#fff', lineHeight: 1 }}>G</span>
  </div>
);

/* ── Typography ─────────────────────────────────────────────────────────── */
export const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 11, letterSpacing: '1.6px', fontWeight: 700, color: TERRA, textTransform: 'uppercase' }}>{children}</div>
);

export const Title: React.FC<{ children: React.ReactNode; size?: number }> = ({ children, size = 32 }) => (
  <h1 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: size, lineHeight: 1.04, letterSpacing: '-0.01em', margin: 0 }}>{children}</h1>
);

export const Subtitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p style={{ fontSize: 15, lineHeight: 1.5, color: SECONDARY, margin: '11px 0 0', maxWidth: 300 }}>{children}</p>
);

export const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 10, letterSpacing: '1.4px', fontWeight: 700, color: LABEL_GREY, textTransform: 'uppercase', marginBottom: 9 }}>{children}</div>
);

/* ── Inputs ─────────────────────────────────────────────────────────────── */
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
      className="w-full rounded-[15px] bg-white outline-none transition-all focus:border-[#A6371D] focus:[box-shadow:0_0_0_4px_rgba(166,55,29,0.10)]"
      style={{
        height: 57,
        border: `1.5px solid ${BORDER}`,
        paddingLeft: icon ? 46 : prefix ? 42 : 16,
        paddingRight: rightSlot ? 50 : 16,
        fontSize: 16.5,
        color: INK,
        boxShadow: '0 1px 2px rgba(40,24,14,0.03)',
      }}
    />
    {rightSlot && <div className="absolute right-2 top-1/2 -translate-y-1/2">{rightSlot}</div>}
  </div>
);

/* ── Buttons ────────────────────────────────────────────────────────────── */
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
    whileTap={!disabled && !loading ? { scale: 0.99 } : undefined}
    className="w-full flex items-center justify-center gap-2 rounded-[15px] font-semibold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
    style={{ height: 54, border: 'none', background: TERRA, color: '#fff', fontSize: 16, boxShadow: '0 8px 20px rgba(166,55,29,0.26)' }}
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
    style={{ height: 50, color: '#6E635D', fontSize: 15 }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = INK)}
    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#6E635D')}
  >
    <span>{children}</span>
    {trailing && <ArrowRight size={15} strokeWidth={2} />}
  </button>
);

export const SocialButton: React.FC<{ children: React.ReactNode; icon: React.ReactNode; onClick?: () => void; disabled?: boolean }> = ({ children, icon, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="w-full flex items-center justify-center gap-2.5 rounded-[15px] bg-white font-semibold cursor-pointer transition-colors disabled:opacity-60"
    style={{ height: 54, border: `1.5px solid ${BORDER}`, color: INK, fontSize: 15.5 }}
    onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.background = '#FAF4F0'; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = '#fff'; }}
  >
    {icon}
    <span>{children}</span>
  </button>
);

export const Divider: React.FC<{ children?: React.ReactNode }> = ({ children = 'OR' }) => (
  <div className="flex items-center gap-3.5" style={{ margin: '22px 0' }}>
    <div className="flex-1" style={{ height: 1, background: '#EADFD8' }} />
    <span style={{ fontSize: 11, letterSpacing: '1.5px', fontWeight: 700, color: '#B6ABA4' }}>{children}</span>
    <div className="flex-1" style={{ height: 1, background: '#EADFD8' }} />
  </div>
);

/* ── Navigation chrome ──────────────────────────────────────────────────── */
export const RoundBackButton: React.FC<{ onClick?: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label="Back"
    className="flex items-center justify-center rounded-full bg-white cursor-pointer flex-shrink-0 p-0 transition-colors"
    style={{ width: 40, height: 40, border: `1.5px solid ${BORDER}` }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#FAF4F0')}
    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#fff')}
  >
    <ArrowLeft size={17} strokeWidth={2.2} style={{ color: '#3A322E' }} />
  </button>
);

/** Back chip + continuous progress bar + "Step N of total". */
export const ProgressHeader: React.FC<{ step: number; total: number; onBack?: () => void }> = ({ step, total, onBack }) => (
  <div className="flex items-center gap-3.5">
    <RoundBackButton onClick={onBack} />
    <div className="flex-1 overflow-hidden" style={{ height: 5, borderRadius: 3, background: '#EADFD8' }}>
      <div style={{ height: '100%', borderRadius: 3, background: TERRA, width: `${Math.min(100, (step / total) * 100)}%`, transition: 'width .3s ease' }} />
    </div>
    <span className="flex-shrink-0" style={{ fontSize: 12, fontWeight: 600, color: LABEL_GREY }}>Step {step} of {total}</span>
  </div>
);

/** An editable email chip ("you@example.com" with a pencil) that jumps back to
 *  the welcome screen. */
export const EmailPill: React.FC<{ email: string; onClick?: () => void }> = ({ email, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-2 rounded-full cursor-pointer border-none transition-colors max-w-full"
    style={{ background: '#F1E8E2', padding: '9px 14px', fontSize: 14, fontWeight: 500, color: '#5C534E' }}
    onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#EADFD8')}
    onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = '#F1E8E2')}
  >
    <span className="truncate">{email}</span>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10l7.5-7.5z" stroke="#9A8F89" strokeWidth="1.4" strokeLinejoin="round" /></svg>
  </button>
);

/** A large selectable option card (radio) — account type, visibility. */
export const RadioCard: React.FC<{
  selected: boolean;
  onClick: () => void;
  title: React.ReactNode;
  description: string;
}> = ({ selected, onClick, title, description }) => (
  <div
    onClick={onClick}
    role="button"
    tabIndex={0}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
    className="flex items-start gap-3.5 cursor-pointer transition-colors"
    style={{
      borderRadius: 18,
      padding: '17px 18px',
      border: `1.5px solid ${selected ? TERRA : BORDER}`,
      background: selected ? '#FBEFEA' : '#fff',
    }}
  >
    <span
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: 24, height: 24, borderRadius: '50%', marginTop: 1, background: selected ? TERRA : 'transparent', border: selected ? 'none' : '2px solid #D2C5BC' }}
    >
      {selected && <span style={{ width: 9, height: 9, borderRadius: '50%', background: '#fff' }} />}
    </span>
    <div className="flex-1 min-w-0">
      <div style={{ fontSize: 16, fontWeight: 600, color: INK }}>{title}</div>
      <div style={{ fontSize: 13, color: '#8B817B', marginTop: 3, lineHeight: 1.45 }}>{description}</div>
    </div>
  </div>
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
  <div className="flex items-center gap-1.5" style={{ marginTop: 9, color: '#C0392B', fontSize: 13, fontWeight: 500 }}>
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><circle cx="8" cy="8" r="6.5" stroke="#C0392B" strokeWidth="1.4" /><path d="M8 4.6v4M8 11.1v.05" stroke="#C0392B" strokeWidth="1.5" strokeLinecap="round" /></svg>
    <span>{children}</span>
  </div>
);
