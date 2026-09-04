/**
 * The Pro stories — one glass object each, animating in.
 *
 * Shared by the onboarding intro (one story per page) and the Pro page
 * (one story per card in the carousel). Each object is a faithful piece
 * of the real screen it stands for — the recipe page's nutrition panel,
 * the profile's taste card, the restaurant page's score history, the
 * Find-a-place sheet — with real copy and the real anatomy, so nothing
 * here promises a screen the app doesn't have. The assistant is a Pro
 * benefit too, but it isn't headlined: it lives as a line on the plan.
 */
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronRight, Sparkles, Users, MapPin } from 'lucide-react';
import type { BenefitKey } from '../../lib/entitlements';
import { EASE, NIGHT_INK, NIGHT_INK_SOFT, NIGHT_INK_FAINT, PALE, ON_PALE, GOLD } from './night';

export interface ProStory {
  id: string;
  benefit: BenefitKey;
  eyebrow: string;
  /** The first line, upright. */
  line1: string;
  /** The second line, italic. */
  line2: string;
  sub: string;
  Visual: React.FC<{ delay?: number }>;
}

/** Staggered arrival for the pieces inside an object. */
const Piece: React.FC<{ i: number; delay?: number; className?: string; style?: React.CSSProperties; children: React.ReactNode }> = ({ i, delay = 0, className, style, children }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      style={style}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: delay + 0.12 + i * 0.14, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

/** The app's section eyebrow, as the real pages set it. */
const Eyebrow: React.FC<{ children: React.ReactNode; right?: React.ReactNode }> = ({ children, right }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: '10.5px', letterSpacing: '0.16em', textTransform: 'uppercase', color: PALE, fontWeight: 700 }}>{children}</span>
    {right && <span style={{ fontSize: '11.5px', fontWeight: 600, color: NIGHT_INK_FAINT, fontVariantNumeric: 'tabular-nums' }}>{right}</span>}
  </div>
);

const Serif: React.FC<{ size?: number; children: React.ReactNode }> = ({ size = 17, children }) => (
  <span style={{ display: 'block', fontFamily: 'var(--font-serif)', fontSize: size, fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.02em', color: NIGHT_INK }}>{children}</span>
);

const Chip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ display: 'inline-block', padding: '5px 10px', borderRadius: 999, background: 'rgba(174,187,211,0.12)', color: PALE, fontSize: '11.5px', fontWeight: 600 }}>{children}</span>
);

/* ── Recipes: the nutrition panel, as the recipe page draws it ─────── */
const RecipesVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Piece i={0} delay={delay}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, flex: 'none', background: 'linear-gradient(135deg, #8a6f57 0%, #4b3a30 60%, #2a211d 100%)', display: 'grid', placeItems: 'center', color: '#f5f4f0' }}><Sparkles size={14} /></span>
        <span style={{ minWidth: 0 }}>
          <Serif size={16}>Miso-butter salmon</Serif>
          <span style={{ display: 'block', fontSize: '11.5px', color: NIGHT_INK_SOFT, marginTop: 2 }}>Serves 4 · 35 min · pictured by AI</span>
        </span>
      </div>
    </Piece>
    <Piece i={1} delay={delay}>
      <div style={{ borderRadius: 14, padding: '12px 14px', background: 'rgba(0,0,0,0.22)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Eyebrow>Nutrition</Eyebrow>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 10 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, flex: 'none' }}>
            <span style={{ fontFamily: 'var(--font-serif)', fontSize: 34, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1, color: NIGHT_INK, fontVariantNumeric: 'tabular-nums' }}>420</span>
            <span style={{ fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NIGHT_INK_FAINT }}>kcal</span>
          </span>
          <span style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, flex: 1 }}>
            {[['18', 'Protein'], ['52', 'Carbs'], ['14', 'Fat']].map(([n, l]) => (
              <span key={l} style={{ paddingLeft: 10, borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                <span style={{ display: 'block', fontSize: '16px', fontWeight: 700, letterSpacing: '-0.02em', color: NIGHT_INK }}>{n}<em style={{ fontStyle: 'normal', fontSize: '10px', fontWeight: 600, color: NIGHT_INK_FAINT, marginLeft: 1 }}>g</em></span>
                <span style={{ display: 'block', fontSize: '9.5px', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: NIGHT_INK_FAINT, marginTop: 2 }}>{l}</span>
              </span>
            ))}
          </span>
        </div>
        <div style={{ marginTop: 10, fontSize: '11px', color: NIGHT_INK_FAINT }}>Estimated by AI, per serving</div>
      </div>
    </Piece>
  </div>
);

/* ── Taste: the profile's taste card, as the profile draws it ──────── */
const TasteVisual: React.FC<{ delay?: number }> = ({ delay }) => {
  const reduce = useReducedMotion();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Piece i={0} delay={delay}><Eyebrow right="#14 of 326">Taste profile</Eyebrow></Piece>
      <Piece i={1} delay={delay}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 44, height: 44, borderRadius: 999, flex: 'none', background: 'rgba(174,187,211,0.14)', border: '1px solid rgba(174,187,211,0.35)', display: 'grid', placeItems: 'center', color: PALE, fontFamily: 'var(--font-serif)', fontWeight: 700, fontSize: 18 }}>ψ</span>
          <span style={{ minWidth: 0, flex: 1 }}>
            <Serif size={18}>The Fine-Dining Explorer</Serif>
            <span style={{ display: 'block', fontSize: '12px', color: NIGHT_INK_FAINT, marginTop: 3, fontWeight: 600 }}>Critic · 431 pts</span>
          </span>
          <ChevronRight size={16} style={{ color: NIGHT_INK_FAINT, flex: 'none' }} />
        </div>
      </Piece>
      <Piece i={2} delay={delay}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.1)', overflow: 'hidden', display: 'block' }}>
            <motion.span style={{ display: 'block', height: '100%', borderRadius: 999, background: PALE }} initial={reduce ? false : { width: '4%' }} animate={{ width: '66%' }} transition={{ duration: 1.1, delay: (delay ?? 0) + 0.5, ease: EASE }} />
          </span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: NIGHT_INK_FAINT, whiteSpace: 'nowrap' }}>219 pts to Legend</span>
        </div>
      </Piece>
      <Piece i={3} delay={delay}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <Chip>Stricter than 72% of raters</Chip>
          <Chip>Taste twin · Jen, 92%</Chip>
          <Chip>Broader than 61%</Chip>
        </div>
      </Piece>
    </div>
  );
};

/* ── Score history: the restaurant page's section ──────────────────── */
const HistoryVisual: React.FC<{ delay?: number }> = ({ delay }) => {
  const reduce = useReducedMotion();
  // Four visits, scores 7.6 → 8.2, on a 0..1 y in a 100×40 box.
  const pts: Array<[number, number, string, string, boolean]> = [[6, 32, 'Jun 21', '7.6', false], [36, 24, 'Nov 2', '7.9', false], [66, 27, 'Jan 9', '7.8', false], [94, 8, 'Mar 14', '8.2', true]];
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Piece i={0} delay={delay}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Serif size={17}>Score history</Serif>
          <span style={{ fontSize: '12px', fontWeight: 600, color: NIGHT_INK_FAINT }}>4 visits</span>
        </div>
        <div style={{ fontSize: '12.5px', color: NIGHT_INK_SOFT, marginTop: 2 }}>Up 0.6 since your first visit</div>
      </Piece>
      <Piece i={1} delay={delay}>
        <svg viewBox="0 0 100 40" width="100%" height="64" preserveAspectRatio="none" aria-hidden style={{ display: 'block', overflow: 'visible' }}>
          <motion.path d={path} fill="none" stroke={PALE} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, delay: (delay ?? 0) + 0.5, ease: EASE }} />
          {pts.map((p, i) => (
            <motion.circle key={i} cx={p[0]} cy={p[1]} r={p[4] ? 2.6 : 2} fill={p[4] ? PALE : '#1b1c20'} stroke={PALE} strokeWidth={1.4} vectorEffect="non-scaling-stroke" initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3, delay: (delay ?? 0) + 0.5 + i * 0.28 }} />
          ))}
        </svg>
      </Piece>
      <Piece i={2} delay={delay}>
        <div>
          {[...pts].reverse().slice(0, 3).map((p, i) => (
            <div key={p[2]} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.08)' }}>
              <span style={{ width: 34, fontSize: '10px', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: NIGHT_INK_FAINT }}>{p[2].split(' ')[0]}<br /><span style={{ fontSize: '13px', color: NIGHT_INK, letterSpacing: 0 }}>{p[2].split(' ')[1]}</span></span>
              <span style={{ flex: 1, fontSize: '12.5px', color: NIGHT_INK_SOFT }}>{p[4] ? 'Sat at the counter this time' : i === 1 ? 'Tasting menu, quieter room' : 'First visit, with Jen'}</span>
              <span style={{ fontSize: '12.5px', fontWeight: 800, padding: '4px 9px', borderRadius: 999, background: 'rgba(111,196,155,0.16)', color: '#6fc49b', fontVariantNumeric: 'tabular-nums' }}>{p[3]}</span>
            </div>
          ))}
        </div>
      </Piece>
    </div>
  );
};

/* ── Together: the Find-a-place sheet's rows and its answer ────────── */
const Avatars: React.FC<{ colors: string[]; size?: number }> = ({ colors, size = 26 }) => (
  <span style={{ display: 'flex' }}>
    {colors.map((c, i) => (
      <span key={i} style={{ width: size, height: size, borderRadius: 999, background: c, border: '2px solid #1b1c20', marginLeft: i === 0 ? 0 : -Math.round(size / 3) }} />
    ))}
  </span>
);

const Row: React.FC<{ icon: React.ReactNode; title: string; sub: React.ReactNode; last?: boolean }> = ({ icon, title, sub, last }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.08)' }}>
    <span style={{ width: 36, height: 36, borderRadius: 12, flex: 'none', background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', color: NIGHT_INK_SOFT }}>{icon}</span>
    <span style={{ minWidth: 0, flex: 1 }}>
      <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: NIGHT_INK }}>{title}</span>
      <span style={{ display: 'block', fontSize: '12px', color: NIGHT_INK_FAINT, marginTop: 2 }}>{sub}</span>
    </span>
    <ChevronRight size={15} style={{ color: NIGHT_INK_FAINT, flex: 'none' }} />
  </div>
);

const TogetherVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Piece i={0} delay={delay}>
      <div style={{ borderRadius: 16, overflow: 'hidden', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <Row icon={<Users size={16} />} title="Who's eating" sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>You + 4 <Avatars colors={['#7f93b8', GOLD, '#6fa08a', '#b07a6a']} size={18} /></span>} />
        <Row icon={<MapPin size={16} />} title="Where" sub="West Village · walking distance" last />
      </div>
    </Piece>
    <Piece i={1} delay={delay}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 14, background: 'rgba(174,187,211,0.1)', border: '1px solid rgba(174,187,211,0.3)' }}>
        <span style={{ width: 40, height: 40, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', background: 'rgba(111,196,155,0.16)', color: '#6fc49b', fontWeight: 800, fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>8.1</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: '10.5px', letterSpacing: '0.14em', textTransform: 'uppercase', color: PALE, fontWeight: 700 }}>For all five of you</span>
          <Serif size={15}>Kawa Ni</Serif>
          <span style={{ display: 'block', fontSize: '11.5px', color: NIGHT_INK_FAINT, marginTop: 1 }}>Japanese · $$$ · everyone's above their bar</span>
        </span>
      </div>
    </Piece>
    <Piece i={2} delay={delay}>
      <div style={{ fontSize: '11.5px', color: NIGHT_INK_FAINT }}>Shared list · Friday dinner club · rated as a group</div>
    </Piece>
  </div>
);

export const PRO_STORIES: ProStory[] = [
  { id: 'recipes', benefit: 'recipes', eyebrow: 'Recipes', line1: 'Every recipe,', line2: 'with its numbers.', sub: 'No weekly cap on AI recipes, a photo for every dish, and calories and macros on all of them.', Visual: RecipesVisual },
  { id: 'taste', benefit: 'taste', eyebrow: 'Taste profile', line1: 'Your taste,', line2: 'in full.', sub: 'Trends, comparisons against everyone else, and the people whose palate overlaps yours.', Visual: TasteVisual },
  { id: 'history', benefit: 'taste', eyebrow: 'Score history', line1: 'Every visit,', line2: 'charted.', sub: 'How your score for a place moved over time, with every visit beneath it.', Visual: HistoryVisual },
  { id: 'together', benefit: 'together', eyebrow: 'Plan together', line1: 'Five palates,', line2: 'one table.', sub: 'Group picks for up to five, shared lists, and search by mood.', Visual: TogetherVisual },
];
