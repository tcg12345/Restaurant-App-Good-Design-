import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

// ── Mesh background ─────────────────────────────────────────────────────
// Four warm, slowly drifting blurred blobs over a subtle noise texture
// with a soft vignette. Renders behind every mobile auth screen and is
// the main reason the layout can read as warm/editorial without any
// real photography.
export const MeshBackground: React.FC = () => (
  <div className="absolute inset-0 overflow-hidden pointer-events-none">
    <motion.div
      className="absolute -top-[18%] -left-[18%] w-[68%] h-[68%] rounded-full bg-primary/[0.22] blur-3xl"
      animate={{ x: [0, 24, -10, 0], y: [0, -14, 18, 0], scale: [1, 1.06, 0.96, 1] }}
      transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute top-[18%] -right-[22%] w-[62%] h-[62%] rounded-full bg-accent/[0.30] blur-3xl"
      animate={{ x: [0, -18, 14, 0], y: [0, 22, -12, 0], scale: [1, 0.94, 1.07, 1] }}
      transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute bottom-[6%] -left-[14%] w-[58%] h-[58%] rounded-full bg-secondary/[0.18] blur-3xl"
      animate={{ x: [0, 28, -6, 0], y: [0, -24, 6, 0], scale: [1, 1.08, 0.94, 1] }}
      transition={{ duration: 25, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute -bottom-[20%] right-[6%] w-[64%] h-[64%] rounded-full bg-persimmon/[0.16] blur-3xl"
      animate={{ x: [0, -12, 18, 0], y: [0, 12, -18, 0], scale: [1, 0.96, 1.04, 1] }}
      transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
    />
    {/* Grain — tiny SVG noise multiplied over the blobs */}
    <div
      className="absolute inset-0 opacity-[0.05] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
      }}
    />
    {/* Vignette */}
    <div
      className="absolute inset-0"
      style={{ background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.08) 100%)' }}
    />
  </div>
);

// ── Mobile field with stacked label inside the surface ──────────────────
export const MobileField: React.FC<{
  label: string;
  icon?: React.ReactNode;
  rightSlot?: React.ReactNode;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  name?: string;
}> = ({
  label,
  icon,
  rightSlot,
  type = 'text',
  value,
  onChange,
  placeholder,
  autoFocus,
  autoComplete,
  inputMode,
  name,
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <div
      className={cn(
        'relative rounded-2xl bg-white/65 backdrop-blur-md border transition-all',
        focused
          ? 'border-primary/50 shadow-xl shadow-primary/15'
          : 'border-on-surface/8 shadow-sm',
      )}
    >
      <label className="block text-[10px] uppercase tracking-[0.14em] text-on-surface/50 font-bold pt-2.5 px-4">
        {label}
      </label>
      <div className="flex items-center px-4 pb-2.5 pt-0.5 gap-3">
        {icon && <span className="text-on-surface/45 flex-shrink-0">{icon}</span>}
        <input
          type={type}
          name={name}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          inputMode={inputMode}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-on-surface placeholder:text-on-surface/30 text-base"
        />
        {rightSlot}
      </div>
    </div>
  );
};

// ── Primary CTA — solid pill with shine sweep ───────────────────────────
export const MobilePrimaryButton: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
}> = ({ children, onClick, disabled, loading, type = 'submit' }) => (
  <motion.button
    type={type}
    onClick={onClick}
    disabled={disabled || loading}
    whileTap={!disabled && !loading ? { scale: 0.985 } : undefined}
    className="relative w-full overflow-hidden rounded-2xl bg-primary text-white px-6 py-4 text-base font-semibold shadow-xl shadow-primary/40 disabled:opacity-60 disabled:cursor-not-allowed"
  >
    <motion.span
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      style={{
        background:
          'linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.28) 50%, transparent 70%)',
      }}
      animate={{ x: ['-110%', '110%'] }}
      transition={{ duration: 2.4, repeat: Infinity, repeatDelay: 2.6, ease: 'easeInOut' }}
    />
    <span className="relative flex items-center justify-center gap-2">
      {loading ? <Loader2 size={18} className="animate-spin" /> : children}
    </span>
  </motion.button>
);

// ── Ghost CTA — translucent outlined button for Apple / Google ──────────
export const MobileGhostButton: React.FC<{
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
}> = ({ children, icon, onClick, type = 'button' }) => (
  <motion.button
    type={type}
    onClick={onClick}
    whileTap={{ scale: 0.985 }}
    className="w-full flex items-center justify-center gap-3 rounded-2xl bg-white/65 backdrop-blur-md border border-on-surface/10 text-on-surface px-6 py-3.5 text-[15px] font-semibold shadow-sm"
  >
    {icon}
    <span>{children}</span>
  </motion.button>
);

// ── Email pill — tap to clear back to email entry ───────────────────────
export const MobileEmailPill: React.FC<{ email: string; onClear: () => void }> = ({
  email,
  onClear,
}) => (
  <button
    type="button"
    onClick={onClear}
    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-on-surface/[0.06] backdrop-blur-md border border-on-surface/10 text-on-surface/85 text-[13px] font-medium"
  >
    <span className="max-w-[210px] truncate">{email}</span>
    <ArrowLeft size={11} />
  </button>
);

// ── Back chip — top-left, safe-area-aware ───────────────────────────────
export const MobileBackButton: React.FC<{ onClick: () => void; label?: string }> = ({
  onClick,
  label,
}) => (
  <button
    type="button"
    onClick={onClick}
    className="inline-flex items-center gap-2 h-10 px-3 rounded-full bg-white/65 backdrop-blur-md border border-on-surface/10 text-on-surface/75 text-sm font-medium shadow-sm"
  >
    <ArrowLeft size={16} />
    {label && <span>{label}</span>}
  </button>
);

// ── Shell ──────────────────────────────────────────────────────────────
// Full-viewport canvas with the mesh painted behind a flex column. The
// outer div uses h-full so it fills both the phone-frame preview (which
// already constrains height) and a real mobile viewport. The safe-area
// utilities applied inside push the brand bar below the iOS status bar
// and lift the CTA above the home indicator on native builds.
export const MobileAuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // h-dvh tracks the dynamic viewport (excluding iOS URL bar / keyboard)
  // while h-screen is the fallback when dvh isn't supported. Inside the
  // desktop phone-frame preview, the wrapper already constrains us to
  // 100vh so this just fills it.
  <div className="relative h-screen h-dvh w-full overflow-hidden bg-surface text-on-surface">
    <MeshBackground />
    <div className="relative h-full w-full flex flex-col">{children}</div>
  </div>
);
