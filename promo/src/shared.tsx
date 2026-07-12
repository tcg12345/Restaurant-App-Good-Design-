import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, FONTS, scoreColor } from './brand';

/* ── Brand mark ──────────────────────────────────────────────────
   The app's "G" logo: terracotta circle, serif italic G, soft shadow
   (Sidebar.tsx / AuthShell GMark / OnboardingKit BrandMark). */

export const GMark: React.FC<{ size: number; style?: React.CSSProperties }> = ({ size, style }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      background: COLORS.primary,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 8px 20px rgba(166,55,29,0.30)',
      ...style,
    }}
  >
    <span
      style={{
        fontFamily: FONTS.serif,
        fontStyle: 'italic',
        fontWeight: 600,
        color: '#fff',
        fontSize: size * 0.55,
        lineHeight: 1,
        transform: 'translateY(-2%)',
      }}
    >
      G
    </span>
  </div>
);

export const Wordmark: React.FC<{ size: number; color?: string }> = ({ size, color = COLORS.obInk }) => (
  <span
    style={{
      fontFamily: FONTS.serif,
      fontWeight: 700,
      letterSpacing: '-0.01em',
      fontSize: size,
      color,
    }}
  >
    Gourmet Canvas
  </span>
);

/* ── Score circle — the app's ScoreBadge (pastel circle, one decimal,
   tabular nums, band color from score.ts). ─────────────────────── */

export const ScoreCircle: React.FC<{
  score: number;
  size: number;
  style?: React.CSSProperties;
}> = ({ score, size, style }) => {
  const band = score >= 8
    ? { bg: '#f0fdf4', border: '#bbf7d0' }   // green-50 / green-200
    : score >= 5
      ? { bg: '#fefce8', border: '#fef08a' } // yellow-50 / yellow-200
      : { bg: '#fef2f2', border: '#fecaca' }; // red-50 / red-200
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: band.bg,
        border: `${Math.max(2, size * 0.02)}px solid ${band.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 800,
          fontVariantNumeric: 'tabular-nums',
          fontSize: size * 0.34,
          color: scoreColor(score),
        }}
      >
        {score.toFixed(1)}
      </span>
    </div>
  );
};

/* ── Motion helpers ──────────────────────────────────────────────── */

/** Springy entrance: returns {opacity, transform} for a pop-in that
 *  starts at `from` frames into the current sequence. */
export const usePop = (from: number, opts?: { damping?: number; y?: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({
    frame: frame - from,
    fps,
    config: { damping: opts?.damping ?? 14, mass: 0.8 },
  });
  const y = opts?.y ?? 34;
  return {
    opacity: interpolate(frame - from, [0, 8], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
    transform: `translateY(${(1 - s) * y}px) scale(${0.94 + s * 0.06})`,
  };
};

/** Simple clamped fade. */
export const useFade = (from: number, len = 10) => {
  const frame = useCurrentFrame();
  return interpolate(frame - from, [0, len], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
};

/* ── Tap ripple — visualizes a screen tap. Fires at `at` frames into
   the current sequence, centered where placed. ──────────────────── */

export const TapRipple: React.FC<{ at: number; size?: number; color?: string }> = ({
  at,
  size = 120,
  color = COLORS.primary,
}) => {
  const frame = useCurrentFrame();
  const t = frame - at;
  if (t < 0 || t > 22) return null;
  const scale = interpolate(t, [0, 22], [0.35, 1.35]);
  const opacity = interpolate(t, [0, 4, 22], [0, 0.5, 0]);
  return (
    <div
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: 999,
        border: `6px solid ${color}`,
        transform: `translate(-50%, -50%) scale(${scale})`,
        opacity,
        pointerEvents: 'none',
      }}
    />
  );
};

/** Eyebrow label — uppercase tracked kicker used across the app. */
export const Kicker: React.FC<{ children: React.ReactNode; color?: string; size?: number }> = ({
  children,
  color = COLORS.obLabel,
  size = 26,
}) => (
  <div
    style={{
      fontFamily: FONTS.sans,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.22em',
      fontSize: size,
      color,
    }}
  >
    {children}
  </div>
);
