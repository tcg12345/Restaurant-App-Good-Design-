import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Apple } from 'lucide-react';
import { COLORS, FONTS } from './brand';
import { GMark, Wordmark, useFade, usePop } from './shared';

/**
 * Scene 5 — CTA. Brand mark, the app's own "worth the trip" line
 * (ProfileSetup.tsx / the transactional email footer), a store button,
 * and the press quote from the real auth hero.
 */
export const Scene5CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markPop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const nameFade = useFade(6, 10);
  const line = usePop(18);
  const btn = spring({ frame: frame - 34, fps, config: { damping: 13, mass: 0.8 } });
  const quoteFade = useFade(56, 12);

  return (
    <AbsoluteFill style={{ background: COLORS.obBg }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(700px 700px at 50% 34%, rgba(166,55,29,0.10), rgba(166,55,29,0) 70%)',
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 0 }}>
        <div style={{ transform: `scale(${0.6 + markPop * 0.4})`, opacity: interpolate(frame, [0, 5], [0, 1], { extrapolateRight: 'clamp' }) }}>
          <GMark size={168} />
        </div>
        <div style={{ opacity: nameFade, marginTop: 44 }}>
          <Wordmark size={78} />
        </div>

        <h2
          style={{
            ...line,
            fontFamily: FONTS.display,
            fontWeight: 560,
            fontSize: 62,
            letterSpacing: '-0.01em',
            color: COLORS.obSecondary,
            margin: '46px 0 0',
            textAlign: 'center',
          }}
        >
          Find something{' '}
          <span style={{ fontStyle: 'italic', color: COLORS.obTerra }}>worth the trip</span>.
        </h2>

        <div
          style={{
            marginTop: 92,
            transform: `scale(${0.7 + Math.max(0, btn) * 0.3})`,
            opacity: interpolate(frame, [34, 42], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            background: '#101010',
            borderRadius: 999,
            padding: '30px 58px',
            boxShadow: '0 24px 60px -18px rgba(30,27,26,0.45)',
          }}
        >
          <Apple size={52} color="#fff" fill="#fff" strokeWidth={0} />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
            <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 24, color: 'rgba(255,255,255,0.72)' }}>
              Download on the
            </span>
            <span style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 44, color: '#fff', letterSpacing: '-0.01em' }}>
              App Store
            </span>
          </div>
        </div>

        <p
          style={{
            opacity: quoteFade,
            fontFamily: FONTS.serif,
            fontStyle: 'italic',
            fontSize: 31,
            color: COLORS.obLabel,
            margin: '110px 90px 0',
            textAlign: 'center',
            lineHeight: 1.5,
          }}
        >
          “Like Goodreads, but for the meals that stick.”
          <span
            style={{
              display: 'block',
              fontFamily: FONTS.sans,
              fontStyle: 'normal',
              fontWeight: 800,
              letterSpacing: '0.18em',
              fontSize: 19,
              marginTop: 16,
            }}
          >
            — THE TABLE
          </span>
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
