import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame } from 'remotion';
import { Star } from 'lucide-react';
import { COLORS, FONTS } from './brand';
import { usePop, useFade } from './shared';

/**
 * Scene 1 — the problem. A wall of interchangeable review cards, every
 * one of them "4.3", drifting on ink. Names are skeleton bars on
 * purpose: the restaurants are interchangeable — that's the point.
 */

const RATING = '4.3';

const ReviewCard: React.FC<{ delay: number; barW: number }> = ({ delay, barW }) => {
  const frame = useCurrentFrame();
  const enter = interpolate(frame - delay, [0, 14], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return (
    <div
      style={{
        width: 306,
        borderRadius: 22,
        background: 'rgba(255,255,255,0.045)',
        border: '1px solid rgba(255,255,255,0.08)',
        padding: '26px 26px 24px',
        opacity: enter * 0.95,
        transform: `translateY(${(1 - enter) * 26}px)`,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
    >
      {/* skeleton "name" */}
      <div style={{ width: barW, height: 17, borderRadius: 9, background: 'rgba(255,255,255,0.16)' }} />
      <div style={{ width: barW * 0.55, height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.08)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', gap: 3 }}>
          {[0, 1, 2, 3].map((i) => (
            <Star key={i} size={24} fill="#8b8580" color="#8b8580" strokeWidth={0} />
          ))}
          <Star size={24} fill="none" color="#8b8580" strokeWidth={2} opacity={0.5} />
        </div>
        <span
          style={{
            fontFamily: FONTS.sans,
            fontWeight: 800,
            fontSize: 25,
            color: '#b6b0aa',
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {RATING}
        </span>
      </div>
    </div>
  );
};

export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const headline = usePop(16);
  const subFade = useFade(50, 12);
  // Slow upward drift of the whole card field; dim + blur out at the end.
  const drift = interpolate(frame, [0, 115], [0, -110]);
  const dimOut = interpolate(frame, [96, 115], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const cards: Array<{ x: number; y: number; d: number; w: number }> = [
    { x: 60, y: 240, d: 0, w: 190 },
    { x: 410, y: 190, d: 4, w: 150 },
    { x: 745, y: 260, d: 8, w: 205 },
    { x: 105, y: 560, d: 6, w: 160 },
    { x: 455, y: 520, d: 10, w: 195 },
    { x: 760, y: 590, d: 13, w: 140 },
    { x: 55, y: 880, d: 12, w: 200 },
    { x: 400, y: 850, d: 15, w: 165 },
    { x: 735, y: 910, d: 18, w: 185 },
    { x: 150, y: 1190, d: 17, w: 175 },
    { x: 500, y: 1170, d: 20, w: 200 },
    { x: 120, y: 1490, d: 22, w: 185 },
    { x: 470, y: 1470, d: 24, w: 155 },
    { x: 770, y: 1420, d: 21, w: 175 },
  ];

  return (
    <AbsoluteFill style={{ background: COLORS.ink, opacity: dimOut }}>
      {/* card field */}
      <div style={{ position: 'absolute', inset: 0, transform: `translateY(${drift}px)`, opacity: 0.85 }}>
        {cards.map((c, i) => (
          <div key={i} style={{ position: 'absolute', left: c.x, top: c.y }}>
            <ReviewCard delay={c.d} barW={c.w} />
          </div>
        ))}
      </div>
      {/* legibility wash */}
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(30,27,26,0.42) 0%, rgba(30,27,26,0.78) 42%, rgba(30,27,26,0.42) 78%)',
        }}
      />
      {/* copy */}
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center', padding: '0 90px' }}>
        <h1
          style={{
            ...headline,
            fontFamily: FONTS.display,
            fontWeight: 620,
            fontSize: 104,
            lineHeight: 1.06,
            letterSpacing: '-0.015em',
            color: '#f4efe9',
            textAlign: 'center',
            margin: 0,
          }}
        >
          Every restaurant
          <br />
          is a{' '}
          <span style={{ fontStyle: 'italic', color: '#b6b0aa' }}>{RATING}</span>.
        </h1>
        <p
          style={{
            opacity: subFade,
            fontFamily: FONTS.sans,
            fontWeight: 600,
            fontSize: 38,
            color: '#a19a8e',
            marginTop: 44,
            textAlign: 'center',
          }}
        >
          Star ratings stopped meaning anything.
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
