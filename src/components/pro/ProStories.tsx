/**
 * The four Pro stories — one glass object each, animating in.
 *
 * Shared by the onboarding intro (one story per page) and the Pro page
 * (one story per card in the carousel). Each object is a small piece of
 * the real feature: the assistant's reply, a recipe with its numbers, a
 * taste match, a group pick. Real copy, real shapes, no lorem.
 */
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Sparkles } from 'lucide-react';
import type { BenefitKey } from '../../lib/entitlements';
import { EASE, NIGHT_INK, NIGHT_INK_SOFT, PALE, ON_PALE, GOLD } from './night';

export interface ProStory {
  key: BenefitKey;
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
      transition={{ duration: 0.5, delay: delay + 0.12 + i * 0.16, ease: EASE }}
    >
      {children}
    </motion.div>
  );
};

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: '10px', letterSpacing: '0.14em', textTransform: 'uppercase', color: PALE, fontWeight: 700 }}>{children}</div>
);

const Bubble: React.FC<{ me?: boolean; children: React.ReactNode }> = ({ me, children }) => (
  <div
    style={{
      borderRadius: 16, padding: '9px 12px', fontSize: '12.5px', lineHeight: 1.35, maxWidth: '86%',
      background: me ? PALE : 'rgba(255,255,255,0.1)', color: me ? ON_PALE : NIGHT_INK,
      marginLeft: me ? 'auto' : 0, fontWeight: me ? 600 : 500,
    }}
  >
    {children}
  </div>
);

const Typing: React.FC = () => {
  const reduce = useReducedMotion();
  return (
    <div style={{ display: 'inline-flex', gap: 4, padding: '9px 12px', borderRadius: 16, background: 'rgba(255,255,255,0.1)' }} aria-hidden>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          style={{ width: 5, height: 5, borderRadius: 999, background: NIGHT_INK, display: 'block' }}
          animate={reduce ? { opacity: 0.6 } : { opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
};

const AssistantVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
    <Piece i={0} delay={delay}><Label>Ask a local</Label></Piece>
    <Piece i={1} delay={delay}><Bubble me>Quiet, walkable, four of us, tonight?</Bubble></Piece>
    <Piece i={2} delay={delay}><Bubble>Kawa Ni at 8:15. You gave it a 7.8, and Jen was there last month. Want me to hold it?</Bubble></Piece>
    <Piece i={3} delay={delay}><Typing /></Piece>
  </div>
);

const Shimmer: React.FC = () => {
  const reduce = useReducedMotion();
  return (
    <div style={{ position: 'relative', height: 96, borderRadius: 14, overflow: 'hidden', background: 'linear-gradient(135deg, #8a6f57 0%, #4b3a30 55%, #2a211d 100%)' }}>
      {!reduce && (
        <motion.div
          style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)' }}
          initial={{ x: '-100%' }} animate={{ x: '100%' }} transition={{ duration: 1.4, delay: 0.6, ease: 'easeInOut' }}
        />
      )}
      <span style={{ position: 'absolute', left: 10, bottom: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '10px', fontWeight: 700, color: '#f5f4f0', background: 'rgba(0,0,0,0.35)', padding: '4px 8px', borderRadius: 999 }}>
        <Sparkles size={10} /> Pictured by AI
      </span>
    </div>
  );
};

const RecipeVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Piece i={0} delay={delay}><Shimmer /></Piece>
    <Piece i={1} delay={delay}>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '16px', fontWeight: 700, color: NIGHT_INK, letterSpacing: '-0.01em' }}>Miso-butter salmon</div>
      <div style={{ fontSize: '11.5px', color: NIGHT_INK_SOFT, marginTop: 2 }}>Serves 4 · 35 min · no weekly cap</div>
    </Piece>
    <Piece i={2} delay={delay}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[['420', 'kcal'], ['18g', 'protein'], ['52g', 'carbs'], ['14g', 'fat']].map(([n, l]) => (
          <span key={l} style={{ fontSize: '11.5px', fontWeight: 700, color: NIGHT_INK, background: 'rgba(255,255,255,0.08)', padding: '5px 9px', borderRadius: 999, fontVariantNumeric: 'tabular-nums' }}>
            {n} <span style={{ fontWeight: 500, color: NIGHT_INK_SOFT }}>{l}</span>
          </span>
        ))}
      </div>
    </Piece>
  </div>
);

const Avatars: React.FC<{ colors: string[]; size?: number; extra?: string }> = ({ colors, size = 30, extra }) => (
  <div style={{ display: 'flex' }}>
    {colors.map((c, i) => (
      <span key={i} style={{ width: size, height: size, borderRadius: 999, background: c, border: '2px solid #1b1c20', marginLeft: i === 0 ? 0 : -Math.round(size / 3) }} />
    ))}
    {extra && (
      <span style={{ width: size, height: size, borderRadius: 999, background: PALE, color: ON_PALE, border: '2px solid #1b1c20', marginLeft: -Math.round(size / 3), display: 'grid', placeItems: 'center', fontSize: Math.round(size * 0.36), fontWeight: 800 }}>{extra}</span>
    )}
  </div>
);

const Bars: React.FC<{ delay?: number; height?: number }> = ({ delay = 0, height = 64 }) => {
  const reduce = useReducedMotion();
  const bars = [[0.4, '#4b5670'], [0.7, '#6a7a9c'], [1, PALE], [0.55, '#6a7a9c'], [0.8, '#8ea0c2'], [0.35, '#4b5670']] as const;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height }} aria-hidden>
      {bars.map(([h, c], i) => (
        <motion.i
          key={i}
          style={{ flex: 1, height: `${h * 100}%`, borderRadius: '4px 4px 2px 2px', background: c, display: 'block', transformOrigin: 'bottom' }}
          initial={reduce ? false : { scaleY: 0.08 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.9, delay: delay + 0.5 + i * 0.06, ease: EASE }}
        />
      ))}
    </div>
  );
};

const TasteVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Piece i={0} delay={delay}><Label>Taste twins</Label></Piece>
    <Piece i={1} delay={delay}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Avatars colors={['#7f93b8', GOLD, '#6fa08a']} />
        <span style={{ fontSize: '12.5px', fontWeight: 700, color: NIGHT_INK }}>92% match · Jen</span>
      </div>
    </Piece>
    <Piece i={2} delay={delay}><Bars delay={delay} /></Piece>
    <Piece i={3} delay={delay}><div style={{ fontSize: '11.5px', color: NIGHT_INK_SOFT }}>Stricter than 72% of raters. Broader than 61%.</div></Piece>
  </div>
);

const TogetherVisual: React.FC<{ delay?: number }> = ({ delay }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
    <Piece i={0} delay={delay}><Avatars colors={['#7f93b8', GOLD, '#6fa08a', '#b07a6a']} size={34} extra="+1" /></Piece>
    <Piece i={1} delay={delay}><Bubble>"quiet, date-night, great cocktails, walkable"</Bubble></Piece>
    <Piece i={2} delay={delay}><Bubble me>For all five of you: Kawa Ni · 8.1</Bubble></Piece>
    <Piece i={3} delay={delay}><div style={{ fontSize: '11.5px', color: NIGHT_INK_SOFT }}>Shared list · Friday dinner club · rated as a group</div></Piece>
  </div>
);

export const PRO_STORIES: ProStory[] = [
  { key: 'assistant', eyebrow: 'Assistant', line1: 'The assistant,', line2: 'unhurried.', sub: 'On Opus, with your ratings in mind. 120 messages an hour instead of 10.', Visual: AssistantVisual },
  { key: 'recipes', eyebrow: 'Recipes', line1: 'Every recipe,', line2: 'pictured.', sub: 'No weekly cap on AI recipes, a photo for every dish, calories and macros on all of them.', Visual: RecipeVisual },
  { key: 'taste', eyebrow: 'Taste', line1: 'People who eat', line2: 'like you.', sub: 'Your full taste profile: trends, comparisons, and the people whose palate overlaps yours.', Visual: TasteVisual },
  { key: 'together', eyebrow: 'Together', line1: 'Five palates,', line2: 'one table.', sub: 'Group picks for up to five, shared lists, and search by mood.', Visual: TogetherVisual },
];
