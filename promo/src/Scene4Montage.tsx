import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Sparkles, Star, Users, BadgeCheck, Plus } from 'lucide-react';
import { COLORS, FONTS } from './brand';
import { DeviceFrame } from './DeviceFrame';
import { ScoreCircle, Kicker } from './shared';

/**
 * Scene 4 — breadth montage: Discover map, Friends, Lists & Trips.
 * Reconstructions grounded in the real screens:
 *  - Map markers = Discover.tsx createMarkerElement (score-colored
 *    circles #10b981/#f59e0b/#ef4444, white border + score) plus the
 *    real wishlist-heart and rated-check SVG paths.
 *  - Tabs = the real PANEL_MODE_TABS (Discover / My Ratings / Friends /
 *    Verified with the same lucide icons).
 *  - Lists = the app's DEFAULT_LISTS names/emoji and the Pantry card
 *    gradients; Trips = the real Trips tab concept ("Plan a Trip",
 *    "Night 1").
 */

const BEAT_LEN = 40;

/* ── Real marker SVG paths from Discover.tsx ── */
const HeartPin: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      background: COLORS.primary,
      border: '3px solid #fff',
      boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24" fill="#fff" stroke="none">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  </div>
);

const CheckPin: React.FC<{ size: number }> = ({ size }) => (
  <div
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      background: '#10b981',
      border: '3px solid #fff',
      boxShadow: '0 2px 8px rgba(0,0,0,0.28)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}
  >
    <svg width={size * 0.55} height={size * 0.55} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  </div>
);

const ScorePin: React.FC<{ score: number; size?: number; delay: number }> = ({ score, size = 84, delay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 11, mass: 0.6 } });
  const color = score >= 8 ? '#10b981' : score >= 5 ? '#f59e0b' : '#ef4444';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: color,
        border: '4px solid #fff',
        boxShadow: '0 3px 10px rgba(0,0,0,0.3)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${s})`,
      }}
    >
      <span style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: size * 0.34, color: '#fff', fontVariantNumeric: 'tabular-nums' }}>
        {score.toFixed(1)}
      </span>
    </div>
  );
};

/* ── Beat 1: Discover map ── */
const MapScreen: React.FC<{ local: number }> = ({ local }) => {
  const tabs = [
    { label: 'Discover', Icon: Sparkles, active: true },
    { label: 'My Ratings', Icon: Star, active: false },
    { label: 'Friends', Icon: Users, active: false },
    { label: 'Verified', Icon: BadgeCheck, active: false },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: COLORS.surface2 }}>
      {/* street grid */}
      <svg width="100%" height="100%" viewBox="0 0 600 1230" style={{ position: 'absolute', inset: 0 }}>
        <g stroke={COLORS.line2} strokeWidth={7} opacity={0.75}>
          <line x1={-40} y1={300} x2={660} y2={210} />
          <line x1={-40} y1={560} x2={660} y2={470} />
          <line x1={-40} y1={840} x2={660} y2={750} />
          <line x1={-40} y1={1120} x2={660} y2={1030} />
          <line x1={140} y1={-40} x2={230} y2={1270} />
          <line x1={370} y1={-40} x2={460} y2={1270} />
        </g>
        <g stroke={COLORS.line} strokeWidth={4} opacity={0.8}>
          <line x1={-40} y1={430} x2={660} y2={340} />
          <line x1={-40} y1={700} x2={660} y2={610} />
          <line x1={-40} y1={980} x2={660} y2={890} />
          <line x1={40} y1={-40} x2={120} y2={1270} />
          <line x1={260} y1={-40} x2={345} y2={1270} />
          <line x1={490} y1={-40} x2={575} y2={1270} />
        </g>
        {/* park */}
        <ellipse cx={470} cy={950} rx={150} ry={120} fill={COLORS.edGreenSoft} opacity={0.9} />
      </svg>

      {/* markers (score-colored circles, like the real map) */}
      <div style={{ position: 'absolute', left: 86, top: 380 }}><ScorePin score={9.2} delay={6} /></div>
      <div style={{ position: 'absolute', left: 350, top: 300 }}><ScorePin score={8.7} delay={10} /></div>
      <div style={{ position: 'absolute', left: 210, top: 660 }}><ScorePin score={6.4} delay={14} /></div>
      <div style={{ position: 'absolute', left: 430, top: 560 }}><ScorePin score={4.8} size={72} delay={18} /></div>
      <div style={{ position: 'absolute', left: 120, top: 930 }}><HeartPin size={68} /></div>
      <div style={{ position: 'absolute', left: 420, top: 1020 }}><CheckPin size={68} /></div>

      {/* real panel-mode tabs */}
      <div
        style={{
          position: 'absolute',
          left: 20,
          right: 20,
          top: 108,
          display: 'flex',
          gap: 8,
          background: 'rgba(255,255,255,0.94)',
          borderRadius: 999,
          padding: 8,
          boxShadow: '0 8px 24px rgba(30,27,26,0.10)',
          opacity: interpolate(local, [2, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
        }}
      >
        {tabs.map(({ label, Icon, active }) => (
          <div
            key={label}
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: 999,
              padding: '13px 0',
              background: active ? COLORS.ink : 'transparent',
              color: active ? '#fff' : COLORS.ink3,
              fontFamily: FONTS.sans,
              fontWeight: 700,
              fontSize: 16.5,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon size={17} /> {label}
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Beat 2: Friends feed ── */
const FriendsScreen: React.FC = () => {
  const rows = [
    { initial: 'M', color: '#2E7D5C', name: 'Maya', place: 'Osteria Ponte', meta: 'Italian · $$$', score: 9.1, verified: true },
    { initial: 'D', color: '#3B5A8F', name: 'Diego', place: 'Café Marlow', meta: 'French · $$', score: 8.2, verified: false },
    { initial: 'S', color: '#B47419', name: 'Sam', place: 'Taqueria Norte', meta: 'Mexican · $', score: 7.6, verified: false },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: COLORS.surface, padding: '120px 26px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 26 }}>
        <Users size={26} color={COLORS.ink2} />
        <span style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 34, color: COLORS.ink }}>Friends</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {rows.map((r) => (
          <div
            key={r.name}
            style={{
              background: '#fff',
              border: `1.5px solid ${COLORS.line}`,
              borderRadius: 24,
              padding: '24px 24px',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              boxShadow: '0 2px 10px rgba(30,27,26,0.04)',
            }}
          >
            <div
              style={{
                width: 66,
                height: 66,
                borderRadius: 999,
                background: r.color,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONTS.serif,
                fontWeight: 700,
                fontSize: 28,
                flexShrink: 0,
              }}
            >
              {r.initial}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: FONTS.sans, fontWeight: 800, fontSize: 22, color: COLORS.ink }}>
                  {r.name}
                </span>
                {r.verified && <BadgeCheck size={22} fill={COLORS.primary} color="#fff" />}
                <span style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 20, color: COLORS.ink4 }}>
                  rated
                </span>
              </div>
              <div style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 27, color: COLORS.ink, marginTop: 6 }}>
                {r.place}
              </div>
              <div style={{ fontFamily: FONTS.sans, fontWeight: 600, fontSize: 19, color: COLORS.ink3, marginTop: 4 }}>
                {r.meta}
              </div>
            </div>
            <ScoreCircle score={r.score} size={84} />
          </div>
        ))}
      </div>
    </div>
  );
};

/* ── Beat 3: Lists & Trips (real names, emoji, and card gradients) ── */
const ListsScreen: React.FC = () => {
  const lists = [
    { name: 'Date Nights', emoji: '🕯️', grad: 'linear-gradient(160deg, #2C2826, #161311)' },
    { name: 'Hidden Gems', emoji: '💎', grad: 'linear-gradient(160deg, #D26A4A, #A8482E)' },
    { name: 'Best Cocktails', emoji: '🍸', grad: 'linear-gradient(160deg, #2F4A39, #15281D)' },
    { name: 'Quick Bites', emoji: '⚡', grad: 'linear-gradient(160deg, #C68F3A, #8E5E1F)' },
  ];
  return (
    <div style={{ position: 'absolute', inset: 0, background: COLORS.surface, padding: '116px 26px 0' }}>
      <div
        style={{
          fontFamily: FONTS.sans,
          fontWeight: 800,
          textTransform: 'uppercase',
          letterSpacing: '0.16em',
          fontSize: 17,
          color: COLORS.ink4,
          marginBottom: 18,
        }}
      >
        Collections
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {lists.map((l) => (
          <div
            key={l.name}
            style={{
              background: l.grad,
              borderRadius: 22,
              padding: '22px 22px 20px',
              height: 168,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 40, lineHeight: 1 }}>{l.emoji}</span>
            <span style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 26, color: '#fff', marginTop: 8 }}>
              {l.name}
            </span>
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          margin: '38px 0 16px',
        }}
      >
        <span style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 34, color: COLORS.ink }}>Trips</span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontFamily: FONTS.sans,
            fontWeight: 700,
            fontSize: 19,
            color: COLORS.primary,
            background: 'rgba(159,48,18,0.08)',
            borderRadius: 999,
            padding: '10px 20px',
          }}
        >
          <Plus size={19} /> Plan a Trip
        </span>
      </div>
      <div
        style={{
          background: '#fff',
          border: `1.5px solid ${COLORS.line}`,
          borderRadius: 24,
          padding: '24px 24px',
        }}
      >
        <div style={{ fontFamily: FONTS.serif, fontWeight: 700, fontSize: 27, color: COLORS.ink }}>
          Rome, spring weekend
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          {['Night 1', 'Night 2', 'Night 3'].map((n, i) => (
            <span
              key={n}
              style={{
                fontFamily: FONTS.sans,
                fontWeight: 700,
                fontSize: 18,
                color: i === 0 ? '#fff' : COLORS.ink3,
                background: i === 0 ? COLORS.ink : COLORS.muted,
                borderRadius: 999,
                padding: '9px 20px',
              }}
            >
              {n}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

/* ── Scene ── */
const BEATS = [
  { kicker: 'Discover', line: 'Find your next table.', Screen: MapScreen },
  { kicker: 'Friends', line: 'Follow the people you trust.', Screen: FriendsScreen },
  { kicker: 'Lists & Trips', line: 'Every plan in one place.', Screen: ListsScreen },
];

export const Scene4Montage: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: COLORS.obBg }}>
      {BEATS.map((b, i) => {
        const start = i * BEAT_LEN;
        const local = frame - start;
        if (local < -8 || local > BEAT_LEN + 12) return null;
        const inS = spring({ frame: local, fps, config: { damping: 16, mass: 0.9 } });
        const isLast = i === BEATS.length - 1;
        const out = isLast
          ? 0
          : interpolate(local, [BEAT_LEN - 6, BEAT_LEN + 6], [0, 1], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
        const x = (1 - inS) * 900 - out * 900;
        const Screen = b.Screen;
        return (
          <AbsoluteFill key={b.kicker} style={{ alignItems: 'center', transform: `translateX(${x}px)` }}>
            <div style={{ marginTop: 128, textAlign: 'center' }}>
              <Kicker color={COLORS.obTerra}>{b.kicker}</Kicker>
              <h2
                style={{
                  fontFamily: FONTS.display,
                  fontWeight: 620,
                  fontSize: 84,
                  letterSpacing: '-0.015em',
                  color: COLORS.obInk,
                  margin: '24px 0 0',
                }}
              >
                {b.line}
              </h2>
            </div>
            <div style={{ marginTop: 58 }}>
              <DeviceFrame width={620} screenBg={COLORS.surface}>
                <Screen local={local} />
              </DeviceFrame>
            </div>
          </AbsoluteFill>
        );
      })}
    </AbsoluteFill>
  );
};
