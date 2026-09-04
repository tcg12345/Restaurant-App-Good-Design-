/**
 * Free against Pro, in one table — the page people scan before they
 * decide. Rows are the real limits from the plan (spec §12), not
 * marketing lines: where the free plan has a number, the number is
 * shown; where Pro simply has it, a check. The Pro column wears a pale
 * slate platter so the eye lands there first.
 *
 * Rendered as a story object (the intro page and the Pro page's
 * carousel) — compact enough to sit inside a glass card.
 */
import React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Check, Minus } from 'lucide-react';
import { EASE, NIGHT_INK, NIGHT_INK_SOFT, NIGHT_INK_FAINT, PALE, ON_PALE } from './night';

type Cell = true | false | string;

const ROWS: Array<{ label: string; free: Cell; pro: Cell }> = [
  { label: 'Rating, lists, guides, posts', free: true, pro: true },
  { label: 'AI recipes', free: '5 / wk', pro: 'Unlimited' },
  { label: 'Recipe photos & nutrition', free: false, pro: true },
  { label: 'Full taste profile & twins', free: false, pro: true },
  { label: 'Score history', free: 'Last visit', pro: 'Every visit' },
  { label: 'Group picks', free: 'You + 1', pro: 'Up to 5' },
  { label: 'Shared lists', free: 'Join', pro: 'Create' },
  { label: 'Assistant messages', free: '10 / hr', pro: '120 / hr' },
  { label: 'Export your data', free: false, pro: true },
];

const CellView: React.FC<{ v: Cell; pro?: boolean }> = ({ v, pro }) => {
  if (v === true) return <Check size={15} strokeWidth={2.8} style={{ color: pro ? PALE : NIGHT_INK_SOFT }} aria-label="Included" />;
  if (v === false) return <Minus size={14} strokeWidth={2.4} style={{ color: NIGHT_INK_FAINT }} aria-label="Not included" />;
  return <span style={{ fontSize: '11px', fontWeight: 700, color: pro ? PALE : NIGHT_INK_SOFT, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{v}</span>;
};

export const ProCompare: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const reduce = useReducedMotion();
  const cols = '1fr 62px 72px';
  return (
    <div style={{ position: 'relative' }}>
      {/* The Pro column's platter, behind the rows. */}
      <motion.div
        aria-hidden
        style={{ position: 'absolute', top: -6, bottom: -6, right: -4, width: 80, borderRadius: 16, background: 'rgba(174,187,211,0.12)', border: '1px solid rgba(174,187,211,0.28)' }}
        initial={reduce ? false : { opacity: 0, scaleY: 0.92 }}
        animate={{ opacity: 1, scaleY: 1 }}
        transition={{ duration: 0.6, delay: delay + 0.1, ease: EASE }}
      />
      <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: cols, alignItems: 'center', padding: '2px 0 8px' }}>
        <span />
        <span style={{ textAlign: 'center', fontSize: '10px', fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: NIGHT_INK_FAINT }}>Free</span>
        <span style={{ textAlign: 'center' }}>
          <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 999, background: PALE, color: ON_PALE, fontFamily: 'var(--font-mono)', fontSize: '9px', letterSpacing: '0.16em', fontWeight: 700 }}>PRO</span>
        </span>
      </div>
      {ROWS.map((r, i) => (
        <motion.div
          key={r.label}
          style={{ position: 'relative', display: 'grid', gridTemplateColumns: cols, alignItems: 'center', minHeight: 30, borderTop: '1px solid rgba(255,255,255,0.08)' }}
          initial={reduce ? false : { opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.4, delay: delay + 0.18 + i * 0.05, ease: EASE }}
        >
          <span style={{ fontSize: '12px', fontWeight: 600, color: NIGHT_INK, paddingRight: 8, lineHeight: 1.25 }}>{r.label}</span>
          <span style={{ display: 'flex', justifyContent: 'center' }}><CellView v={r.free} /></span>
          <span style={{ display: 'flex', justifyContent: 'center' }}><CellView v={r.pro} pro /></span>
        </motion.div>
      ))}
    </div>
  );
};
