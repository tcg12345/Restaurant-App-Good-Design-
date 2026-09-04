/**
 * The Pro stories — one glass object each, animating in.
 *
 * Shared by the onboarding intro (one story per page) and the Pro page
 * (one story per card in the carousel). Each object is a faithful piece
 * of the real screen it stands for — a generated recipe as the recipe
 * page opens it, the profile's taste card, the restaurant page's score history, the
 * Find-a-place sheet — with real copy and the real anatomy, so nothing
 * here promises a screen the app doesn't have. The assistant is a Pro
 * benefit too, but it isn't headlined: it lives as a line on the plan.
 */
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronRight, Sparkles, Users, MapPin } from 'lucide-react';
import type { BenefitKey } from '../../lib/entitlements';
import { EASE, NIGHT_INK, NIGHT_INK_SOFT, NIGHT_INK_FAINT, PALE, GOLD } from './night';
import { ProCompare } from './ProCompare';

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

/* ── Recipes: a generated recipe, as the recipe page opens it ─────── */
const RecipesVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Piece i={0} delay={delay}>
      <div style={{ position: 'relative', height: 118, borderRadius: 16, overflow: 'hidden', background: 'radial-gradient(120% 90% at 20% 15%, #b08a63 0%, #6e4f3a 40%, #2c221c 100%)' }}>
        <span aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.45) 100%)' }} />
        <span style={{ position: 'absolute', left: 12, bottom: 10, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px', borderRadius: 999, background: 'rgba(0,0,0,0.42)', color: '#f5f4f0', fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.04em' }}><Sparkles size={11} /> Pictured by AI</span>
      </div>
    </Piece>
    <Piece i={1} delay={delay}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <Serif size={18}>Miso-butter salmon</Serif>
        <span style={{ fontSize: '11.5px', fontWeight: 600, color: NIGHT_INK_FAINT, whiteSpace: 'nowrap' }}>Serves 4 · 35 min</span>
      </div>
    </Piece>
    <Piece i={2} delay={delay}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <Chip>Generated</Chip>
        <Chip>Combined from two</Chip>
        <Chip>From a photo</Chip>
        <Chip>No weekly cap</Chip>
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

const Row: React.FC<{ icon: React.ReactNode; title: string; sub: React.ReactNode }> = ({ icon, title, sub }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
    <span style={{ width: 36, height: 36, borderRadius: 12, flex: 'none', background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center', color: NIGHT_INK_SOFT }}>{icon}</span>
    <span style={{ minWidth: 0, flex: 1 }}>
      <span style={{ display: 'block', fontSize: '13.5px', fontWeight: 700, color: NIGHT_INK }}>{title}</span>
      <span style={{ display: 'block', fontSize: '12px', color: NIGHT_INK_FAINT, marginTop: 2 }}>{sub}</span>
    </span>
    <ChevronRight size={15} style={{ color: NIGHT_INK_FAINT, flex: 'none' }} />
  </div>
);

const TogetherVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column' }}>
    <Piece i={0} delay={delay}>
      <Row icon={<Users size={16} />} title="Who's eating" sub={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>You + 4 <Avatars colors={['#7f93b8', GOLD, '#6fa08a', '#b07a6a']} size={18} /></span>} />
      <Row icon={<MapPin size={16} />} title="Where" sub="West Village · walking distance" />
    </Piece>
    <Piece i={1} delay={delay}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0 2px' }}>
        <span style={{ width: 42, height: 42, borderRadius: 999, flex: 'none', display: 'grid', placeItems: 'center', background: 'rgba(111,196,155,0.16)', color: '#6fc49b', fontWeight: 800, fontSize: 13.5, fontVariantNumeric: 'tabular-nums' }}>8.1</span>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ display: 'block', fontSize: '10.5px', letterSpacing: '0.14em', textTransform: 'uppercase', color: PALE, fontWeight: 700 }}>For all five of you</span>
          <Serif size={16}>Kawa Ni</Serif>
          <span style={{ display: 'block', fontSize: '11.5px', color: NIGHT_INK_FAINT, marginTop: 1 }}>Japanese · $$$ · everyone's above their bar</span>
        </span>
      </div>
    </Piece>
    <Piece i={2} delay={delay}>
      <div style={{ fontSize: '11.5px', color: NIGHT_INK_FAINT, marginTop: 8 }}>Shared list · Friday dinner club · rated as a group</div>
    </Piece>
  </div>
);

export const PRO_STORIES: ProStory[] = [
  { id: 'recipes', benefit: 'recipes', eyebrow: 'Recipes', line1: 'Cook without', line2: 'a cap.', sub: 'Unlimited AI recipes — generated, combined from two, or pulled from a photo — each with a picture of the dish.', Visual: RecipesVisual },
  { id: 'taste', benefit: 'taste', eyebrow: 'Taste profile', line1: 'Your taste,', line2: 'in full.', sub: 'Trends, comparisons against everyone else, and the people whose palate overlaps yours.', Visual: TasteVisual },
  { id: 'history', benefit: 'taste', eyebrow: 'Score history', line1: 'Every visit,', line2: 'charted.', sub: 'How your score for a place moved over time, with every visit beneath it.', Visual: HistoryVisual },
  { id: 'together', benefit: 'together', eyebrow: 'Plan together', line1: 'Five palates,', line2: 'one table.', sub: 'Group picks for up to five, shared lists, and search by mood.', Visual: TogetherVisual },
  // The table, last: everything above, side by side with what free keeps.
  { id: 'compare', benefit: 'account', eyebrow: 'Side by side', line1: 'Free, or', line2: 'Pro.', sub: 'Everything you use today stays free. Pro lifts the limits and adds the rest.', Visual: ProCompare },
];
