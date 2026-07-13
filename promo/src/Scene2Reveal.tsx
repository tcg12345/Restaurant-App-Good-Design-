import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { COLORS, FONTS } from './brand';
import { GMark, Wordmark, ScoreCircle, usePop, useFade, Kicker } from './shared';

/**
 * Scene 2 — the reveal. Warm onboarding cream, the real brand mark,
 * and the URR: one universal number, counted up live in the app's
 * pastel score circle with the app's own "out of 10" framing.
 */
export const Scene2Reveal: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const markPop = spring({ frame, fps, config: { damping: 12, mass: 0.7 } });
  const wordFade = useFade(8, 10);
  const kicker = usePop(26, { y: 20 });
  const headline = usePop(34);
  const circleIn = spring({ frame: frame - 52, fps, config: { damping: 13, mass: 0.9 } });
  const subFade = useFade(84, 12);

  // Count-up 0 → 8.7 with an ease-out, then hold.
  const count = interpolate(frame, [56, 92], [0, 8.7], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  // Soft radial glow behind the mark, like the onboarding hero.
  return (
    <AbsoluteFill style={{ background: COLORS.obBg }}>
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(620px 620px at 50% 26%, rgba(166,55,29,0.10), rgba(166,55,29,0) 70%)',
        }}
      />
      <AbsoluteFill style={{ alignItems: 'center', paddingTop: 210 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 26,
            transform: `scale(${0.7 + markPop * 0.3})`,
            opacity: interpolate(frame, [0, 6], [0, 1], { extrapolateRight: 'clamp' }),
          }}
        >
          <GMark size={104} />
          <div style={{ opacity: wordFade }}>
            <Wordmark size={64} />
          </div>
        </div>

        <div style={{ ...kicker, marginTop: 140 }}>
          <Kicker color={COLORS.obTerra}>The Universal Restaurant Rating</Kicker>
        </div>

        <h1
          style={{
            ...headline,
            fontFamily: FONTS.display,
            fontWeight: 620,
            fontSize: 112,
            lineHeight: 1.05,
            letterSpacing: '-0.015em',
            color: COLORS.obInk,
            textAlign: 'center',
            margin: '34px 0 0',
          }}
        >
          One number that
          <br />
          <span style={{ fontStyle: 'italic', color: COLORS.obTerra }}>means something.</span>
        </h1>

        <div
          style={{
            marginTop: 96,
            transform: `scale(${0.5 + Math.max(0, circleIn) * 0.5})`,
            opacity: interpolate(frame, [52, 60], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 22,
          }}
        >
          <ScoreCircle score={Math.max(count, 0.1)} size={330} />
          <span
            style={{
              fontFamily: FONTS.sans,
              fontWeight: 700,
              fontSize: 34,
              color: COLORS.obSecondary,
            }}
          >
            out of 10
          </span>
        </div>

        <p
          style={{
            opacity: subFade,
            fontFamily: FONTS.sans,
            fontWeight: 600,
            fontSize: 37,
            lineHeight: 1.45,
            color: COLORS.obSecondary,
            textAlign: 'center',
            margin: '76px 90px 0',
          }}
        >
          Comparable across every restaurant you rate —
          <br />
          built from your real taste, not five vague stars.
        </p>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
