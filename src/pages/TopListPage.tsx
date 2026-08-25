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
 */
import React, { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Star } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useSettings } from '../contexts/SettingsContext';
import { OwnScoreBadge } from '../components/ScoreBadge';
import { cn } from '../lib/utils';
import { scoreColor, scoreBadgeBg } from '../lib/score';
import {
  buildTopList, defaultMetaText, loadCustomization, parseTopListKey,
  topListKindLabel, topListMetaText,
} from '../lib/topLists';

const numericScore = (s: unknown): number => {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
};

export const TopListPage: React.FC = () => {
  const { listKey = '' } = useParams<{ listKey: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { ratings, scoresUnlocked } = useLists();
  const { phoneMode, twoDecimalScores } = useSettings();

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
      <div className="min-h-screen bg-surface pb-32">
        <Header onBack={() => navigate('/profile')} />
        <div className="mx-auto w-full max-w-[860px] px-5 pt-20 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-on-surface/[0.05]">
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

  return (
    <div className="min-h-screen bg-surface pb-32">
      <Header onBack={() => navigate('/profile')} />
      <div className="mx-auto w-full max-w-[860px] px-5">
        {/* Masthead — the list introduces itself once, at the top, instead
            of a heading repeating over every row. */}
        <header className="pt-5 pb-6">
          <p className="text-[10.5px] font-bold uppercase tracking-[0.18em] text-on-surface/40">
            {topListKindLabel(config)}
          </p>
          <h1 className={cn(
            'mt-2 font-serif font-bold leading-[1.05] tracking-[-0.02em] text-on-surface',
            phoneMode ? 'text-[34px]' : 'text-[46px]',
          )}>
            {list.label}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="text-[13.5px] font-semibold text-on-surface/55 tabular-nums">
              {list.total} place{list.total === 1 ? '' : 's'}
            </span>
            {scoresUnlocked && (
              <>
                <span className="text-on-surface/20">·</span>
                <span className={cn(
                  'rounded-md border px-1.5 py-0.5 text-[12.5px] font-bold tabular-nums',
                  scoreBadgeBg(list.avg), scoreColor(list.avg),
                )}>
                  {list.avg.toFixed(twoDecimalScores ? 2 : 1)} avg
                </span>
              </>
            )}
          </div>
        </header>

        {/* The ranking. One row per place, rank in the gutter, so the eye
            runs straight down the numbers. */}
        <ol className="divide-y divide-on-surface/[0.06] border-t border-on-surface/[0.06]">
          {list.all.map((r, i) => {
            const rank = i + 1;
            const meta = topListMetaText(config, r) ?? defaultMetaText(r);
            return (
              <li key={r.restaurantId}>
                <Link
                  to={`/restaurant/${r.restaurantId}`}
                  className="group flex items-center gap-4 py-3.5 transition-colors hover:bg-on-surface/[0.02]"
                >
                  <span className={cn(
                    'w-8 flex-shrink-0 text-right font-serif font-bold tabular-nums leading-none',
                    phoneMode ? 'text-[20px]' : 'text-[24px]',
                    rank === 1 ? 'text-primary' : rank <= 3 ? 'text-on-surface' : 'text-on-surface/30',
                  )}>
                    {rank}
                  </span>
                  <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-on-surface/[0.05]">
                    {r.image
                      ? <img src={r.image} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
                      : <MapPin size={16} className="text-on-surface/25" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-serif text-[16.5px] font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">
                      {r.name}
                    </span>
                    {meta && <span className="mt-1 block truncate text-[12.5px] text-on-surface/45">{meta}</span>}
                  </span>
                  <OwnScoreBadge rating={numericScore(r.score)} unlocked={scoresUnlocked} size="lg" />
                </Link>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
};

const Header: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <div className="sticky top-0 z-20 border-b border-on-surface/[0.06] bg-surface/85 backdrop-blur-xl">
    <div className="mx-auto flex w-full max-w-[860px] items-center gap-2 px-5 py-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-on-surface/70 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
      >
        <ArrowLeft size={19} />
      </button>
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Top list</span>
    </div>
  </div>
);
