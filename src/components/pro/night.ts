/** Always-dark Pro surfaces use the shared Mint endpoint in both themes. */
import type React from 'react';

export const NIGHT_BG = 'radial-gradient(90% 55% at 50% 0%, #304b3d 0%, #1b1c20 60%, #121316 100%)';
export const NIGHT_INK = '#e9e9ec';
export const NIGHT_INK_SOFT = 'rgba(233, 233, 236, 0.65)';
export const NIGHT_INK_FAINT = 'rgba(233, 233, 236, 0.45)';
export const PALE = 'var(--brand-mint)';
export const ON_PALE = 'var(--brand-on-mint)';
export const GOLD = 'var(--brand-mint)';

export const glass: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.07)',
  border: '1px solid rgba(255, 255, 255, 0.14)',
  backdropFilter: 'blur(18px)',
  WebkitBackdropFilter: 'blur(18px)',
  boxShadow: '0 30px 60px -30px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
};

export const eyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '9.5px',
  fontWeight: 600,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: PALE,
  background: 'rgba(168, 208, 184, 0.14)',
  padding: '5px 10px',
  borderRadius: 999,
  display: 'inline-flex',
  alignItems: 'center',
};

/** The two-line serif: light weight, the second line italic. */
export const headline: React.CSSProperties = {
  fontFamily: 'var(--font-display)',
  fontWeight: 300,
  lineHeight: 1.02,
  letterSpacing: '-0.02em',
  color: NIGHT_INK,
  textWrap: 'balance',
} as React.CSSProperties;

export const EASE = [0.22, 1, 0.36, 1] as const;
