import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { useBottomSheet } from '../lib/useBottomSheet';
import { formatScore, scoreSolid, scoreTint } from '../lib/score';
import { tierOfScore } from '../lib/settleScores';
import { TIER_LABELS } from '../lib/headToHeadRating';
import { useSettings } from '../contexts/SettingsContext';
import { Avatar } from './Avatar';
import { avatarHue } from '../lib/avatar';
import {
  countsForCommunity,
  getProfilesByIds,
  type CommunityRating,
  type UserProfile,
} from '../lib/supabase-community';

/**
 * The breakdown behind a single averaged score — opened by tapping the
 * "Everyone" disc in a restaurant's Ratings section.
 *
 * An average is a summary, and a summary hides its own shape: 8.0 means
 * something different when everyone said 8 than when half said 10 and half
 * said 6. This sheet shows the shape — a bar per whole-number band, tinted
 * by the same tier palette the rest of the app scores with — and lets you
 * tap a band to see exactly who is in it.
 *
 * Bands are floor-based (a 9.8 is a "9", a perfect 10 gets its own bar)
 * because that's how people say scores out loud, and because rounding
 * would file most of the 9.x ratings under a "10" nobody gave.
 *
 * It portals to <body>: the pop-up variant of the restaurant panel is
 * ITSELF a bottom sheet, so rendering in place would trap this one inside
 * that sheet's stacking context (and its overflow).
 */

/** Whole-number band for a score — 1…10, where 10 is only an exact 10. */
const bandOf = (score: number): number => Math.min(10, Math.max(1, Math.floor(score)));
const BANDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const bandLabel = (b: number): string => (b === 10 ? '10' : `${b}–${b}.9`);

const CHART_H = 92; // px of headroom for the tallest bar

export const RatingDistributionSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  /** Every community row for this restaurant. Slider-method rows are
   *  filtered out here so the totals match the disc that opened this
   *  sheet — see countsForCommunity. */
  ratings: CommunityRating[];
  /** The average the disc showed, passed in rather than recomputed so the
   *  two can never disagree. */
  avgScore: number;
  restaurantName?: string;
  /** Marks one row as "You" in the rater list. */
  currentUserId?: string | null;
}> = ({ open, onClose, ratings, avgScore, restaurantName, currentUserId }) => {
  const { twoDecimalScores } = useSettings();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [entered, setEntered] = useState(false);
  const { dragProps, sheetRef } = useBottomSheet(open, onClose, scrollRef, setDragging);
  const [selected, setSelected] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<Record<string, UserProfile>>({});

  // Reset per-open so a reopened sheet never starts mid-animation or with
  // a stale band still selected.
  useEffect(() => {
    if (!open) { setEntered(false); setSelected(null); }
  }, [open]);

  const counted = useMemo(
    () => ratings.filter(countsForCommunity).slice().sort((a, b) => Number(b.score) - Number(a.score)),
    [ratings],
  );

  // Names for the rater list. Fetched on open (and only for ids we don't
  // already hold) — the parent surfaces never needed profiles for the disc.
  useEffect(() => {
    if (!open || counted.length === 0) return;
    const missing = [...new Set<string>(counted.map((r) => r.user_id))].filter((id) => !profiles[id]);
    if (missing.length === 0) return;
    let cancelled = false;
    void getProfilesByIds(missing).then((map) => {
      if (!cancelled) setProfiles((prev) => ({ ...prev, ...map }));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, counted]);

  const counts = useMemo(() => {
    const c: Record<number, number> = {};
    for (const b of BANDS) c[b] = 0;
    for (const r of counted) c[bandOf(Number(r.score))]++;
    return c;
  }, [counted]);

  const total = counted.length;
  const maxCount = Math.max(1, ...BANDS.map((b) => counts[b]));

  const tierCounts = useMemo(() => {
    const t = { loved: 0, fine: 0, disliked: 0 };
    for (const r of counted) t[tierOfScore(Number(r.score))]++;
    return t;
  }, [counted]);

  const visible = selected == null ? counted : counted.filter((r) => bandOf(Number(r.score)) === selected);

  const glassSuspended = dragging || !entered;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          key="rating-dist-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22 }}
          className="fixed inset-0 z-[130] bg-black/55 backdrop-blur-sm flex items-end justify-center"
          onClick={onClose}
        >
          <motion.div
            ref={sheetRef as React.RefObject<HTMLDivElement>}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
            onAnimationComplete={() => setEntered(true)}
            {...dragProps}
            onClick={(e) => e.stopPropagation()}
            className="bg-surface w-full sm:max-w-[460px] rounded-t-[24px] sm:rounded-b-[24px] sm:mb-6 max-h-[82vh] flex flex-col overflow-visible relative"
            style={{ clipPath: 'inset(-80px 0 0 0 round 24px 24px 0 0)' }}
          >
            {/* The close floats above the sheet, in the strip over the page. */}
            <div className="absolute right-3 top-[-56px] z-30">
              <GlassButton
                id="rating-dist-close"
                symbol="xmark"
                label="Close"
                onClick={onClose}
                suspended={glassSuspended}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-black/55 text-white ring-1 ring-white/[0.16] transition-colors"
              >
                <X size={17} strokeWidth={2.2} />
              </GlassButton>
            </div>
            <div className="pt-2.5 pb-1 flex justify-center flex-shrink-0" aria-hidden>
              <span className="w-9 h-1 rounded-full bg-on-surface/15" />
            </div>

            {/* Header */}
            <div className="flex-shrink-0 flex items-start gap-3 px-5 pt-1.5 pb-3.5">
              <div className="min-w-0 flex-1">
                <h2 className="font-serif font-bold text-on-surface" style={{ fontSize: '19px', letterSpacing: '-0.022em' }}>
                  Rating breakdown
                </h2>
                {restaurantName && (
                  <p className="mt-1 truncate text-on-surface/45" style={{ fontSize: '12.5px' }}>{restaurantName}</p>
                )}
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-safe-5">
              {total === 0 ? (
                <p className="py-10 text-center text-on-surface/45" style={{ fontSize: '13.5px' }}>
                  No ratings yet.
                </p>
              ) : (
                <>
                  {/* Average + how many it came from */}
                  <div className="flex items-center gap-4">
                    <span
                      className={cn('flex-none w-[68px] h-[68px] rounded-full flex items-center justify-center tabular-nums', scoreTint(avgScore))}
                      style={{ fontSize: twoDecimalScores ? '20px' : '23px', fontWeight: 700, letterSpacing: '-0.01em' }}
                    >
                      {formatScore(avgScore, twoDecimalScores)}
                    </span>
                    <div className="min-w-0">
                      <p className="text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>
                        {total.toLocaleString()} {total === 1 ? 'rating' : 'ratings'}
                      </p>
                      <p className="mt-1 text-on-surface/50" style={{ fontSize: '12.5px', lineHeight: 1.35 }}>
                        {[
                          tierCounts.loved > 0 ? `${tierCounts.loved} loved` : null,
                          tierCounts.fine > 0 ? `${tierCounts.fine} fine` : null,
                          tierCounts.disliked > 0 ? `${tierCounts.disliked} didn't like` : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                  </div>

                  {/* The distribution. Tap a band to filter the list below. */}
                  <div className="mt-6 flex items-end gap-[3px]" style={{ height: CHART_H }}>
                    {BANDS.map((b) => {
                      const n = counts[b];
                      const on = selected === b;
                      const h = n === 0 ? 3 : Math.max(8, Math.round((n / maxCount) * CHART_H));
                      return (
                        <button
                          key={b}
                          type="button"
                          disabled={n === 0}
                          onClick={() => setSelected(on ? null : b)}
                          aria-pressed={on}
                          aria-label={`${n} ${n === 1 ? 'rating' : 'ratings'} in the ${bandLabel(b)} range`}
                          className="flex-1 min-w-0 h-full flex flex-col justify-end disabled:cursor-default group"
                        >
                          <span
                            className="block text-center tabular-nums text-on-surface/45 transition-opacity"
                            style={{ fontSize: '10px', fontWeight: 700, opacity: n === 0 ? 0 : 1 }}
                          >
                            {n}
                          </span>
                          <span
                            className={cn(
                              'mt-1 block w-full rounded-[5px] transition-all duration-200',
                              n > 0 && !on && 'group-active:opacity-80',
                            )}
                            style={{
                              height: h,
                              background: n === 0 ? 'color-mix(in srgb, var(--color-on-surface) 8%, transparent)' : scoreSolid(b),
                              opacity: n === 0 ? 1 : selected == null || on ? 1 : 0.28,
                            }}
                          />
                        </button>
                      );
                    })}
                  </div>
                  {/* Axis — a tick under every other bar keeps it readable
                      at this width without crowding. */}
                  <div className="mt-1.5 flex gap-[3px]">
                    {BANDS.map((b) => (
                      <span
                        key={b}
                        className={cn(
                          'flex-1 min-w-0 text-center tabular-nums transition-colors',
                          selected === b ? 'text-on-surface' : 'text-on-surface/35',
                        )}
                        style={{ fontSize: '10.5px', fontWeight: selected === b ? 700 : 500 }}
                      >
                        {b % 2 === 0 || selected === b ? b : ''}
                      </span>
                    ))}
                  </div>

                  {/* Who's in the selection */}
                  <div className="mt-6 flex items-baseline justify-between gap-3">
                    <p className="text-on-surface" style={{ fontSize: '13px', fontWeight: 700 }}>
                      {selected == null
                        ? 'Every rating'
                        : `${counts[selected]} in ${bandLabel(selected)}`}
                    </p>
                    {selected != null && (
                      <button
                        type="button"
                        onClick={() => setSelected(null)}
                        className="flex-none text-primary active:opacity-70 transition-opacity"
                        style={{ fontSize: '12.5px', fontWeight: 700 }}
                      >
                        Show all
                      </button>
                    )}
                  </div>

                  <ul className="mt-2 divide-y divide-on-surface/[0.07]">
                    {visible.map((r) => {
                      const p = profiles[r.user_id];
                      const isMe = !!currentUserId && r.user_id === currentUserId;
                      const name = isMe ? 'You' : (p?.display_name || p?.username || 'Someone');
                      const score = Number(r.score);
                      return (
                        <li key={r.id} className="flex items-center gap-3 py-2.5">
                          <Avatar
                            src={p?.avatar_url}
                            name={name}
                            size={32}
                            letterSize={12}
                            fallbackStyle={{ background: `hsl(${avatarHue(r.user_id)} 50% 45%)`, color: '#fff' }}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-on-surface" style={{ fontSize: '13.5px', fontWeight: 600 }}>{name}</p>
                            <p className="mt-0.5 truncate text-on-surface/45" style={{ fontSize: '11.5px' }}>
                              {TIER_LABELS[tierOfScore(score)]}
                              {r.notes ? ` · “${r.notes}”` : ''}
                            </p>
                          </div>
                          <span
                            className={cn('flex-none rounded-full px-2.5 py-1.5 tabular-nums', scoreTint(score))}
                            style={{ fontSize: '12.5px', fontWeight: 700 }}
                          >
                            {formatScore(score, twoDecimalScores)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
};
