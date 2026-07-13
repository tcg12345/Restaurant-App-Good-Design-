import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Sparkles, SkipForward } from 'lucide-react';
import { COLORS, FONTS } from './brand';
import { DeviceFrame } from './DeviceFrame';
import { ScoreCircle, TapRipple, usePop, useFade } from './shared';

/**
 * Scene 3 — how it works: the head-to-head flow, reconstructed
 * faithfully from HeadToHeadRatingPages.tsx (copy verbatim: "Which did
 * you enjoy more?", "Rating now" / "Already rated", "VS", "Too close
 * to call", "Skip", "We ranked it at", "out of 10", "Based on n
 * comparisons.", "Use this score").
 *
 * The "Rating now" card stays put; only the "Already rated" opponent
 * swaps between comparisons — exactly like the real flow.
 */

const OPPONENTS = [
  { name: 'Café Marlow', meta: 'French · $$', score: 8.2 },
  { name: 'Sichuan House', meta: 'Chinese · $$', score: 8.9 },
  { name: 'Taqueria Norte', meta: 'Mexican · $', score: 8.5 },
];

// Beat map (scene-local frames).
const PAIR_START = 18;
const SWAPS = [58, 98];           // opponent swap moments
const TAPS = [42, 82, 112];       // tap moments (which card: A, B, A)
const TAP_TARGETS: Array<'A' | 'B'> = ['A', 'B', 'A'];
const RESULT_AT = 128;

const CardShell: React.FC<{
  children: React.ReactNode;
  highlight?: number; // 0..1 — terracotta ring + lift on tap
  dim?: number;       // 0..1
}> = ({ children, highlight = 0, dim = 0 }) => (
  <div
    style={{
      background: '#fff',
      borderRadius: 26,
      border: `1.5px solid ${COLORS.line}`,
      boxShadow: highlight
        ? `0 0 0 ${3 * highlight}px ${COLORS.primary}, 0 ${14 * highlight}px ${34 * highlight}px rgba(159,48,18,0.18)`
        : '0 2px 10px rgba(30,27,26,0.05)',
      transform: `scale(${1 + highlight * 0.025})`,
      opacity: 1 - dim * 0.45,
      padding: '30px 32px',
      display: 'flex',
      alignItems: 'center',
      gap: 20,
      position: 'relative',
    }}
  >
    {children}
  </div>
);

const Chip: React.FC<{ children: React.ReactNode; primary?: boolean }> = ({ children, primary }) => (
  <span
    style={{
      alignSelf: 'flex-start',
      fontFamily: FONTS.sans,
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.14em',
      fontSize: 15,
      padding: '7px 14px',
      borderRadius: 999,
      background: primary ? 'rgba(159,48,18,0.10)' : COLORS.muted,
      color: primary ? COLORS.primary : COLORS.ink3,
    }}
  >
    {children}
  </span>
);

export const Scene3H2H: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headline = usePop(0);
  const phoneIn = spring({ frame: frame - 8, fps, config: { damping: 15, mass: 1 } });
  const captionFade = useFade(34, 12);

  // Which opponent is showing + swap transition progress.
  let pairIdx = 0;
  for (const swapAt of SWAPS) if (frame >= swapAt) pairIdx++;
  const lastSwap = pairIdx === 0 ? PAIR_START : SWAPS[pairIdx - 1];
  const swapT = interpolate(frame - lastSwap, [0, 9], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const opponent = OPPONENTS[Math.min(pairIdx, OPPONENTS.length - 1)];

  // Tap highlight envelope around each tap moment.
  const tapEnv = (at: number) =>
    interpolate(frame - at, [0, 4, 14, 20], [0, 1, 1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
  let highlightA = 0;
  let highlightB = 0;
  TAPS.forEach((at, i) => {
    const e = tapEnv(at);
    if (TAP_TARGETS[i] === 'A') highlightA = Math.max(highlightA, e);
    else highlightB = Math.max(highlightB, e);
  });

  // Result overlay.
  const resultIn = spring({ frame: frame - RESULT_AT, fps, config: { damping: 16, mass: 0.9 } });
  const showResult = frame >= RESULT_AT;
  const resultCount = interpolate(frame, [RESULT_AT + 6, RESULT_AT + 26], [0, 8.7], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: (t) => 1 - Math.pow(1 - t, 3),
  });

  const contentFade = useFade(PAIR_START, 8);

  return (
    <AbsoluteFill style={{ background: COLORS.obBg }}>
      <AbsoluteFill style={{ alignItems: 'center' }}>
        <h2
          style={{
            ...headline,
            fontFamily: FONTS.display,
            fontWeight: 620,
            fontSize: 92,
            letterSpacing: '-0.015em',
            color: COLORS.obInk,
            margin: '104px 0 0',
          }}
        >
          Rate by <span style={{ fontStyle: 'italic', color: COLORS.obTerra }}>choosing</span>.
        </h2>
        <p
          style={{
            opacity: captionFade,
            fontFamily: FONTS.sans,
            fontWeight: 600,
            fontSize: 34,
            color: COLORS.obSecondary,
            margin: '26px 0 0',
          }}
        >
          Quick this-or-that taps — an honest score in seconds.
        </p>

        <div
          style={{
            marginTop: 64,
            transform: `translateY(${(1 - phoneIn) * 180}px)`,
            opacity: interpolate(frame, [8, 18], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            }),
          }}
        >
          <DeviceFrame width={640}>
            {/* ── Screen: the comparison page ── */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                padding: '96px 36px 40px',
                display: 'flex',
                flexDirection: 'column',
                opacity: contentFade,
              }}
            >
              {/* header row */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 26, color: COLORS.ink }}>
                  Rate Restaurant
                </span>
                <span
                  style={{
                    fontFamily: FONTS.sans,
                    fontWeight: 700,
                    fontSize: 20,
                    color: COLORS.ink3,
                    background: COLORS.muted,
                    borderRadius: 999,
                    padding: '6px 16px',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {Math.min(pairIdx + 2, 4)} / 6
                </span>
              </div>

              <h3
                style={{
                  fontFamily: FONTS.serif,
                  fontWeight: 700,
                  fontSize: 40,
                  lineHeight: 1.15,
                  color: COLORS.ink,
                  margin: '40px 0 34px',
                }}
              >
                Which did you enjoy more?
              </h3>

              {/* Card A — Rating now (constant) */}
              <div style={{ position: 'relative' }}>
                <CardShell highlight={highlightA} dim={highlightB * 0.8}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    <Chip primary>Rating now</Chip>
                    <span style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 33, color: COLORS.ink }}>
                      Osteria Ponte
                    </span>
                    <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 21, color: COLORS.ink3 }}>
                      Italian · $$$
                    </span>
                  </div>
                </CardShell>
                {TAPS.map((at, i) =>
                  TAP_TARGETS[i] === 'A' ? (
                    <div key={at} style={{ position: 'absolute', left: '74%', top: '58%' }}>
                      <TapRipple at={at} />
                    </div>
                  ) : null,
                )}
              </div>

              {/* VS divider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '24px 0' }}>
                <div style={{ flex: 1, height: 1.5, background: COLORS.line2 }} />
                <span
                  style={{
                    fontFamily: FONTS.serif,
                    fontWeight: 700,
                    fontSize: 20,
                    letterSpacing: '0.2em',
                    color: COLORS.ink4,
                  }}
                >
                  VS
                </span>
                <div style={{ flex: 1, height: 1.5, background: COLORS.line2 }} />
              </div>

              {/* Card B — Already rated (opponent swaps) */}
              <div
                style={{
                  position: 'relative',
                  opacity: swapT,
                  transform: `translateX(${(1 - swapT) * 46}px)`,
                }}
              >
                <CardShell highlight={highlightB} dim={highlightA * 0.8}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
                    <Chip>Already rated</Chip>
                    <span style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 33, color: COLORS.ink }}>
                      {opponent.name}
                    </span>
                    <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 21, color: COLORS.ink3 }}>
                      {opponent.meta}
                    </span>
                  </div>
                  <ScoreCircle score={opponent.score} size={96} />
                </CardShell>
                {TAPS.map((at, i) =>
                  TAP_TARGETS[i] === 'B' ? (
                    <div key={at} style={{ position: 'absolute', left: '70%', top: '55%' }}>
                      <TapRipple at={at} />
                    </div>
                  ) : null,
                )}
              </div>

              {/* Tie / skip row — verbatim buttons */}
              <div style={{ display: 'flex', gap: 16, marginTop: 44 }}>
                <div
                  style={{
                    flex: 1,
                    border: `1.5px solid ${COLORS.line2}`,
                    borderRadius: 999,
                    padding: '20px 0',
                    textAlign: 'center',
                    fontFamily: FONTS.sans,
                    fontWeight: 700,
                    fontSize: 24,
                    color: COLORS.ink2,
                  }}
                >
                  Too close to call
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    borderRadius: 999,
                    padding: '20px 34px',
                    fontFamily: FONTS.sans,
                    fontWeight: 700,
                    fontSize: 24,
                    color: COLORS.ink4,
                  }}
                >
                  <SkipForward size={24} /> Skip
                </div>
              </div>
            </div>

            {/* ── Result overlay — "We ranked it at" ── */}
            {showResult && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: COLORS.obBg,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 30,
                  transform: `translateY(${(1 - resultIn) * 120}px)`,
                  opacity: interpolate(frame - RESULT_AT, [0, 8], [0, 1], {
                    extrapolateLeft: 'clamp',
                    extrapolateRight: 'clamp',
                  }),
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 10,
                    fontFamily: FONTS.sans,
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    letterSpacing: '0.16em',
                    fontSize: 20,
                    color: COLORS.obTerra,
                    background: COLORS.obBadgeBg,
                    borderRadius: 999,
                    padding: '12px 26px',
                  }}
                >
                  <Sparkles size={22} /> We ranked it at
                </span>
                <ScoreCircle score={Math.max(resultCount, 0.1)} size={280} />
                <span style={{ fontFamily: FONTS.sans, fontWeight: 700, fontSize: 27, color: COLORS.obSecondary }}>
                  out of 10
                </span>
                <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 22, color: COLORS.obLabel }}>
                  Based on 4 comparisons.
                </span>
                <div
                  style={{
                    marginTop: 8,
                    background: COLORS.obTerra,
                    color: '#fff',
                    borderRadius: 999,
                    padding: '22px 64px',
                    fontFamily: FONTS.sans,
                    fontWeight: 800,
                    fontSize: 26,
                  }}
                >
                  Use this score
                </div>
              </div>
            )}
          </DeviceFrame>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
