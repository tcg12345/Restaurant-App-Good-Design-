/**
 * One top list, in full: /profile/top/:listKey
 *
 * The destination behind every cover card on the profile. The profile
 * shows the shelf; this shows the ranking — every place in the slice, in
 * order, not a top-10 truncation.
 *
 * It derives the list from the same ratings and the same stored
 * customization the card did (lib/topLists), so what opens can never
 * disagree with what was pressed.
 *
 * Layout: the page has no header BAR. A masthead introduces the list once,
 * scrolls away, and hands off to a condensed glass strip carrying the same
 * title (useHeaderFade's standard pair) — while the back button floats
 * above both, on native glass, from the safe area down. The old chrome was
 * a permanent "TOP LIST" caption in a band that started at pixel zero,
 * under the status bar.
 */
import React, { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { OwnScoreBadge } from '../components/ScoreBadge';
import { FloatingBack } from '../components/FloatingBack';
import { useHeaderFade } from '../lib/useHeaderFade';
import { cn } from '../lib/utils';
import { scoreColor } from '../lib/score';
import {
  buildTopList, defaultMetaText, loadCustomization, parseTopListKey,
  topListKindLabel, topListMetaText, type TopListRating,
} from '../lib/topLists';

const numericScore = (s: unknown): number => {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** The floating back button's own band: the safe area, plus its 44px, plus
 *  a hair. The eyebrow sits INSIDE that band beside the button rather than
 *  under it — a full-width strip of nothing to the right of a lone back
 *  arrow is the emptiest thing a page can open with. */
const CHROME_TOP = 'calc(env(safe-area-inset-top, 0px) + 12px)';
/** Clear of the home indicator and the floating assistant button. */
const PAGE_BOTTOM = 'calc(env(safe-area-inset-bottom, 0px) + 104px)';

export const TopListPage: React.FC = () => {
  const { listKey = '' } = useParams<{ listKey: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { ratings, scoresUnlocked } = useLists();
  const { phoneMode, twoDecimalScores } = useSettings();
  const fade = useHeaderFade({ enabled: phoneMode, windowScroll: true });

  const config = useMemo(() => parseTopListKey(decodeURIComponent(listKey)), [listKey]);
  const list = useMemo(
    () => (config ? buildTopList(config, ratings) : null),
    [config, ratings],
  );

  // A list only exists while its slice does: hide one in the editor, or
  // delete the last rating in it, and the URL is stale rather than wrong.
  // Say so plainly instead of rendering an empty ranking.
  const stillVisible = useMemo(() => {
    if (!config) return false;
    const hidden = new Set(loadCustomization(user?.id).hidden);
    return !hidden.has(decodeURIComponent(listKey));
  }, [config, listKey, user?.id]);

  if (!config || !list || !stillVisible) {
    return (
      <div className="min-h-screen bg-surface">
        <FloatingBack id="top-list-back" onBack={() => navigate('/profile')} />
        <div className="mx-auto w-full max-w-[860px] px-5 text-center" style={{ paddingTop: 'calc(env(safe-area-inset-top, 0px) + 76px)' }}>
          <span className="mx-auto mt-10 flex h-14 w-14 items-center justify-center rounded-2xl bg-on-surface/[0.05]">
            <Star size={26} className="text-on-surface/20" />
          </span>
          <h1 className="mt-4 font-serif text-[22px] font-bold text-on-surface">This list isn't here anymore</h1>
          <p className="mx-auto mt-1.5 max-w-[340px] text-[13.5px] text-on-surface/50">
            It was removed, or the ratings behind it were. Your other top lists are on your profile.
          </p>
          <Link
            to="/profile"
            className="mt-5 inline-flex h-11 items-center rounded-full bg-on-surface px-6 text-[13.5px] font-bold text-surface"
          >
            Back to profile
          </Link>
        </div>
      </div>
    );
  }

  const avgText = list.avg.toFixed(twoDecimalScores ? 2 : 1);

  return (
    <div className="min-h-screen bg-surface">
      {/* Condensed strip — arrives as the masthead leaves, so the list
          never loses its name, and the back button never loses a legible
          ground to sit on. Zero-height sticky: it floats, and the content
          below keeps its own rhythm instead of being pushed by a band. */}
      <div className="sticky top-0 z-40 h-0">
        <motion.div
          style={fade.condensedStyle}
          className="absolute inset-x-0 top-0 border-b border-on-surface/[0.06] bg-surface/85 backdrop-blur-xl"
        >
          <div className="mx-auto w-full max-w-[860px] px-4 pt-safe-3">
            <div className="flex h-11 items-center gap-3 pb-1.5">
              {/* The glass button lives in its own layer above; this just
                  reserves the space so the title starts beside it. */}
              <span className="w-11 flex-none" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-serif text-[16px] font-bold tracking-[-0.02em] text-on-surface">
                {list.label}
              </span>
              {scoresUnlocked && (
                <span className={cn('flex-none text-[13px] font-bold tabular-nums', scoreColor(list.avg))}>
                  {avgText}
                </span>
              )}
            </div>
          </div>
        </motion.div>
        <FloatingBack id="top-list-back" onBack={() => navigate('/profile')} />
      </div>

      <div className="mx-auto w-full max-w-[860px] px-5" style={{ paddingBottom: PAGE_BOTTOM }}>
        {/* Masthead — the list introduces itself once, at the top, instead
            of a heading repeating over every row. */}
        <motion.header
          ref={fade.headerRef}
          style={fade.headerStyle}
          className="pb-6"
          // Starts below the floating back button rather than under it.
        >
          <div style={{ paddingTop: CHROME_TOP }}>
            {/* Left-padded past the back button, and vertically centred on
                it, so the two read as one header row. */}
            <p className="flex h-11 items-center pl-[52px] text-[10.5px] font-bold uppercase tracking-[0.18em] text-on-surface/40">
              {topListKindLabel(config)}
            </p>
            <h1 className={cn(
              'mt-1.5 font-serif font-bold leading-[1.02] tracking-[-0.03em] text-on-surface',
              phoneMode ? 'text-[38px]' : 'text-[52px]',
            )}>
              {list.label}
            </h1>
            {/* One quiet line of facts. The average used to sit in a
                bordered amber box — the only boxed thing on the screen,
                which made a statistic look like a button. It keeps the
                score colour; it loses the frame. */}
            <div className="mt-3.5 flex items-center gap-3 text-[13px] font-semibold tabular-nums">
              <span className="text-on-surface/50">
                {list.total} place{list.total === 1 ? '' : 's'}
              </span>
              {scoresUnlocked && (
                <>
                  <span className="h-3.5 w-px bg-on-surface/15" aria-hidden />
                  <span className={scoreColor(list.avg)}>{avgText} average</span>
                </>
              )}
            </div>
          </div>
        </motion.header>

        {/* The ranking. One row per place, rank in the gutter, so the eye
            runs straight down the numbers — and the hairline starts after
            that gutter, which leaves the numerals a column of their own
            rather than a first cell in a table. */}
        <ol>
          {list.all.map((r, i) => (
            <TopListRow
              key={r.restaurantId}
              rank={i + 1}
              rating={r}
              meta={topListMetaText(config, r) ?? defaultMetaText(r)}
              scoresUnlocked={scoresUnlocked}
            />
          ))}
        </ol>
      </div>
    </div>
  );
};

const TopListRow: React.FC<{
  rank: number;
  rating: TopListRating;
  meta: string | null | undefined;
  scoresUnlocked: boolean;
}> = ({ rank, rating: r, meta, scoresUnlocked }) => (
  <li className="relative after:absolute after:bottom-0 after:left-[38px] after:right-0 after:h-px after:bg-on-surface/[0.06] last:after:hidden">
    <Link
      to={`/restaurant/${r.restaurantId}`}
      className="group flex items-center gap-3.5 py-3.5 transition-colors active:bg-on-surface/[0.03]"
    >
      <span className={cn(
        'w-6 flex-none text-right font-serif text-[17px] font-bold leading-none tabular-nums',
        rank === 1 ? 'text-primary' : rank <= 3 ? 'text-on-surface/75' : 'text-on-surface/25',
      )}>
        {rank}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-serif text-[16.5px] font-bold leading-[1.15] tracking-[-0.01em] text-on-surface transition-colors group-hover:text-primary">
          {r.name}
        </span>
        {meta && <span className="mt-[3px] block truncate text-[12px] text-on-surface/45">{meta}</span>}
      </span>
      <OwnScoreBadge rating={numericScore(r.score)} unlocked={scoresUnlocked} size="md" />
    </Link>
  </li>
);
