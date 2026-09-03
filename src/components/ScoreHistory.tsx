/**
 * Score history — how your score for one restaurant moved across visits.
 *
 * Rendered only when there IS history (the current rating plus at least
 * one earlier visit); a single rating has no history to show, and the
 * "Your rating" section already carries it. One section, no nested
 * collapses: a small line of the scores in visit order, then the visits
 * as a list (newest first). Tapping a visit reveals its tags, photos and
 * the delete affordance; the current rating is edited from "Your rating"
 * instead, so it never offers delete here.
 *
 * Shared by the phone and desktop restaurant pages: same data, same
 * order, same chart — only the type sizes differ.
 */
import React, { useState } from 'react';
import { ChevronDown, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { formatScore, scoreHex, scoreTier } from '../lib/score';
import { useSettings } from '../contexts/SettingsContext';
import { Collapse } from './Collapse';

export interface ScoreHistoryEntry {
  id: string;
  score: number;
  date: Date | null;
  notes?: string;
  tags?: string[];
  photos?: { url: string }[];
  /** The rating that stands today. Listed first, never deletable here. */
  isCurrent?: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const chipTint = (s: number) => {
  const t = scoreTier(s);
  return t === 'high' ? 'bg-score-high-tint text-score-high-ink'
    : t === 'mid' ? 'bg-score-mid-tint text-score-mid-ink'
    : 'bg-score-low-tint text-score-low-ink';
};

/** "Jul 24", or "Jul 24, 2025" when the chart spans more than one year —
 *  the same month-day shape the list rows use, so the axis never reads as
 *  a different date system. */
const axisDate = (d: Date | null, withYear: boolean) =>
  d ? `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ''}` : '';

/** Oldest → newest, evenly spaced; the y range hugs the scores so a drift
 *  of half a point still reads as a slope, clamped to the 0–10 scale. */
const Chart: React.FC<{ points: ScoreHistoryEntry[]; height: number; twoDecimals: boolean }> = ({ points, height, twoDecimals }) => {
  const W = 320;
  const H = height;
  const padX = 18;
  const padTop = 18;
  const padBottom = 22;
  const scores = points.map((p) => p.score);
  const lo = Math.max(0, Math.min(...scores) - 0.75);
  const hi = Math.min(10, Math.max(...scores) + 0.75);
  const span = Math.max(0.5, hi - lo);
  const x = (i: number) => (points.length === 1 ? W / 2 : padX + (i * (W - padX * 2)) / (points.length - 1));
  const y = (s: number) => padTop + ((hi - s) / span) * (H - padTop - padBottom);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const spansYears = !!first.date && !!last.date && first.date.getFullYear() !== last.date.getFullYear();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height }} role="img" aria-label={`Score history, ${points.length} visits`}>
      {/* baseline the dates sit on */}
      <line x1={padX} x2={W - padX} y1={H - padBottom + 6} y2={H - padBottom + 6} className="stroke-on-surface/[0.12]" strokeWidth="1" />
      <path d={path} fill="none" className="stroke-on-surface/30" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => {
        const cx = x(i);
        const cy = y(p.score);
        const current = i === points.length - 1;
        return (
          <g key={p.id}>
            {current && <circle cx={cx} cy={cy} r={8} fill={scoreHex(p.score)} opacity={0.18} />}
            <circle cx={cx} cy={cy} r={current ? 4.5 : 3.5} fill={scoreHex(p.score)} />
            <text
              x={cx}
              y={cy - 9}
              textAnchor="middle"
              className="fill-on-surface/70"
              style={{ fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
            >
              {formatScore(p.score, twoDecimals)}
            </text>
          </g>
        );
      })}
      <text x={padX} y={H - 4} textAnchor="start" className="fill-on-surface/45" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em' }}>
        {axisDate(first.date, spansYears)}
      </text>
      {points.length > 1 && (
        <text x={W - padX} y={H - 4} textAnchor="end" className="fill-on-surface/45" style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.04em' }}>
          {axisDate(last.date, spansYears)}
        </text>
      )}
    </svg>
  );
};

export const ScoreHistory: React.FC<{
  entries: ScoreHistoryEntry[];
  variant: 'mobile' | 'desktop';
  onDeleteVisit: (visitId: string) => void;
  /** Section heading, styled by the page so it matches its neighbours. */
  heading: React.ReactNode;
  className?: string;
}> = ({ entries, variant, onDeleteVisit, heading, className }) => {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const { twoDecimalScores } = useSettings();
  if (entries.length < 2) return null;

  const byDateAsc = [...entries].sort((a, b) => (a.date?.getTime() ?? 0) - (b.date?.getTime() ?? 0));
  const newestFirst = [...byDateAsc].reverse();
  const firstScore = byDateAsc[0].score;
  const lastScore = byDateAsc[byDateAsc.length - 1].score;
  const delta = lastScore - firstScore;
  const deltaLabel = Math.abs(delta) < 0.05 ? 'Steady since your first visit'
    : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta).toFixed(1)} since your first visit`;
  const desktop = variant === 'desktop';

  return (
    <section className={className}>
      <div className="flex items-baseline justify-between gap-4">
        {heading}
        <span className="text-on-surface/50 tabular-nums" style={{ fontSize: desktop ? '12.5px' : '12px', fontWeight: 600 }}>
          {entries.length} visits
        </span>
      </div>
      <p className="mt-1 text-on-surface/55" style={{ fontSize: desktop ? '13.5px' : '13px' }}>{deltaLabel}</p>

      <div className={cn('mt-3', desktop && 'rounded-2xl border border-on-surface/[0.07] bg-white px-2 pt-1')}>
        <Chart points={byDateAsc} height={desktop ? 132 : 108} twoDecimals={twoDecimalScores} />
      </div>

      <ul className={cn('mt-2', desktop && 'rounded-2xl border border-on-surface/[0.07] bg-white px-[22px] overflow-hidden')}>
        {newestFirst.map((e, idx) => {
          const open = expanded === e.id;
          const month = e.date ? MONTHS[e.date.getMonth()].toUpperCase() : '—';
          const day = e.date ? e.date.getDate() : '';
          const hasMore = (e.tags && e.tags.length > 0) || (e.photos && e.photos.length > 0) || !e.isCurrent;
          return (
            <li key={e.id} className={cn(idx > 0 && 'border-t border-on-surface/[0.08]')}>
              <button
                type="button"
                onClick={() => hasMore && setExpanded(open ? null : e.id)}
                className={cn('w-full flex items-center gap-3 text-left transition-opacity', hasMore && 'active:opacity-70', desktop ? 'py-4' : 'py-3')}
                aria-expanded={hasMore ? open : undefined}
              >
                <div className="flex-shrink-0 w-10 flex flex-col items-center">
                  <span className="text-on-surface/40 leading-none" style={{ fontSize: '9px', letterSpacing: '0.12em', fontWeight: 700 }}>{month}</span>
                  <span className="text-on-surface/75 leading-none mt-1 tabular-nums" style={{ fontSize: desktop ? '17px' : '15px', fontWeight: 700 }}>{day || '—'}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn('truncate', e.notes ? 'text-on-surface/75' : 'text-on-surface/35')} style={{ fontSize: desktop ? '14px' : '13px' }}>
                    {e.notes || 'No notes'}
                  </p>
                  {e.isCurrent && (
                    <p className="text-on-surface/40 mt-0.5" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.12em' }}>CURRENT</p>
                  )}
                </div>
                <span className={cn('flex-shrink-0 inline-flex items-center h-7 px-2.5 rounded-full tabular-nums', chipTint(e.score))} style={{ fontSize: '13px', fontWeight: 700 }}>
                  {formatScore(e.score, twoDecimalScores)}
                </span>
                {hasMore && <ChevronDown size={14} className={cn('flex-shrink-0 text-on-surface/35 transition-transform duration-200', open && 'rotate-180')} />}
              </button>
              {hasMore && (
                <Collapse open={open}>
                  <div className={cn('pb-3 pl-[52px] space-y-2.5')}>
                    {e.tags && e.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {e.tags.map((t) => (
                          <span key={t} className="rounded-full bg-on-surface/[0.06] text-on-surface/60 px-2.5 py-1" style={{ fontSize: '11px', fontWeight: 600 }}>{t}</span>
                        ))}
                      </div>
                    )}
                    {e.photos && e.photos.length > 0 && (
                      <div className="flex gap-1.5 overflow-x-auto no-scrollbar snap-x snap-mandatory">
                        {e.photos.slice(0, 8).map((ph, i) => (
                          <img key={i} src={ph.url} alt="" className={cn('rounded-xl object-cover flex-shrink-0 snap-start', desktop ? 'w-24 h-24' : 'w-16 h-16')} referrerPolicy="no-referrer" />
                        ))}
                      </div>
                    )}
                    {!e.isCurrent && (
                      confirmDelete === e.id ? (
                        <div className="flex items-center justify-between gap-2 bg-score-low-tint rounded-xl px-3 py-2">
                          <p className="text-xs font-medium text-score-low-ink">Delete this visit?</p>
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => setConfirmDelete(null)} className="px-2.5 py-1 text-[11px] font-semibold text-on-surface/70 rounded-full bg-on-surface/[0.06]">Cancel</button>
                            <button
                              type="button"
                              onClick={() => { onDeleteVisit(e.id); setConfirmDelete(null); setExpanded(null); }}
                              className="px-2.5 py-1 text-[11px] font-semibold text-white bg-score-low rounded-full"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={() => setConfirmDelete(e.id)} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-score-low-ink active:opacity-70 transition-opacity">
                          <Trash2 size={13} /> Delete visit
                        </button>
                      )
                    )}
                  </div>
                </Collapse>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
