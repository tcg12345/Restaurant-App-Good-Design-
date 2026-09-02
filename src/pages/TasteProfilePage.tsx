/**
 * Your taste profile, in full: /profile/taste
 *
 * The profile page shows the teaser card; this is the reading. It turns
 * the engine's TasteProfile into sentences and a handful of charts, and
 * it is built to CHANGE — every number re-derives from the ratings, the
 * tier ring fills as you rate, and the trend section reads the calendar
 * so the page has a past without storing one.
 *
 * Order: masthead (tier, points, rank) → the three sentences that best
 * describe the palate → how you grade → where the money goes → cuisines
 * you love vs cuisines you eat → over time → habits → what you look for
 * → the ladder (how points are earned) → the leaderboard → what you told
 * us in the quiz.
 *
 * Every platform comparison comes from get_taste_benchmarks (migration
 * 083) and has a self-referential fallback; every section has a minimum
 * rating count and says what unlocks it rather than rendering thin data.
 *
 * Same chrome as TopListPage: no header bar — a masthead that scrolls
 * away into a condensed glass strip, with the back button floating above
 * both.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion, animate, useMotionValue } from 'motion/react';
import { ChevronRight, Globe2, Info, Lock, MapPin, Sparkles, Trophy, Users, UtensilsCrossed } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { FloatingBack } from '../components/FloatingBack';
import { useHeaderFade, type HeaderFade } from '../lib/useHeaderFade';
import { useToast } from '../contexts/ToastContext';
import { ShareIcon } from '../components/icons/ShareIcon';
import { shareExternally, canonicalShareUrl } from '../lib/native-share';
import { cn } from '../lib/utils';
import { formatScore, scoreColor, scoreSolid, scoreTier } from '../lib/score';
import { useTasteProfile } from '../lib/useTasteProfile';
import { PRICE_SYMBOLS, pct as pctText, fmt1 as f1, type CuisineRow, type Petal, type TasteBenchmarks, type TasteInsights } from '../lib/taste-insights';
import { TIERS, tierFor, type PointsComponent, type TastePoints, type TierStanding } from '../lib/taste-tier';
import { getTasteLeaderboard, getTasteMyRanks, getTasteTwins, type LeaderboardRow, type LeaderboardSort, type MyRanks } from '../lib/supabase-taste';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { Avatar } from '../components/Avatar';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { TierEmblem, TIER_ICONS } from '../components/profile/TierEmblem';

const CHROME_TOP = 'calc(env(safe-area-inset-top, 0px) + 12px)';
const PAGE_BOTTOM = 'calc(env(safe-area-inset-bottom, 0px) + 104px)';
const EASE = [0.22, 1, 0.36, 1] as const;


/* ── Page ─────────────────────────────────────────────────────────────── */

/* ── Voice ────────────────────────────────────────────────────────────── */

/** Who the page is about. Your own page speaks to you; someone else's
 *  speaks about them by name, and every label below picks accordingly. */
export interface Voice {
  self: boolean;
  /** "you" / the person's first name. */
  name: string;
  /** "your" / "Jamie's". */
  your: string;
  /** "Your" / "Jamie's". */
  Your: string;
}
export const SELF_VOICE: Voice = { self: true, name: 'you', your: 'your', Your: 'Your' };
export const voiceFor = (name: string): Voice => ({ self: false, name, your: `${name}'s`, Your: `${name}'s` });

/* ── Page (own profile) ───────────────────────────────────────────────── */

export const TasteProfilePage: React.FC = () => {
  const navigate = useNavigate();
  const { user, profile: myProfile } = useAuth();
  const { showToast } = useToast();
  const { phoneMode, twoDecimalScores } = useSettings();
  const fade = useHeaderFade({ enabled: phoneMode, windowScroll: true });
  const { insights, points, standing, benchmarks, benchmarksLoading, ratingCount } = useTasteProfile({ refresh: true });
  const bench = benchmarks?.benchmarks ?? null;
  const n = ratingCount;
  // Two tabs under the masthead: the reading, and the board. `?tab=leaderboard`
  // deep-links straight to the board (the card can send people there later).
  const location = useLocation();
  const [tab, setTab] = useState<PageTab>(() =>
    new URLSearchParams(location.search).get('tab') === 'leaderboard' ? 'board' : 'taste');
  const [boardSort, setBoardSort] = useState<BoardKey>('points');
  const goToTwins = () => { setBoardSort('twins'); setTab('board'); window.scrollTo({ top: 0 }); };

  const rankLine = bench && bench.myRank != null && bench.rankedUsers > 0
    ? `#${bench.myRank} of ${bench.rankedUsers} on GoodEats`
    : bench && bench.rankedUsers > 0
      ? `Ranked at 10 ratings · ${bench.rankedUsers} on the board`
      : null;

  // Share: the public taste page, plus a line that stands on its own in a
  // message. The link only opens for people who can see the profile.
  const share = async () => {
    const username = myProfile?.username;
    const url = username ? canonicalShareUrl(`/user/${encodeURIComponent(username)}/taste`) : undefined;
    const who = myProfile?.display_name;
    const text = [
      insights.palate.archetype ?? `${standing.tier.name} on GoodEats`,
      insights.palate.tagline,
      `${points.total} pts · ${standing.tier.name}`,
    ].filter(Boolean).join(' — ');
    const result = await shareExternally({ title: who ? `${who}'s taste profile on GoodEats` : 'My taste profile on GoodEats', text, url });
    if (result === 'unsupported') showToast("Sharing isn't available here");
    else if ((result === 'shared' || result === 'copied') && myProfile && !myProfile.is_public) showToast('Shared — only people who can see your profile can open it');
    else if (result === 'copied') showToast('Link copied');
  };

  return (
    <div className="min-h-screen bg-surface">
      <TasteChrome fade={fade} title="Taste profile" right={`${points.total} pts`} onBack={() => navigate('/profile')} backId="taste-profile-back" />

      <div className="mx-auto w-full max-w-[860px] px-5" style={{ paddingBottom: PAGE_BOTTOM }}>
        <TasteMasthead
          fade={fade}
          phoneMode={phoneMode}
          eyebrow="Taste profile"
          standing={standing}
          points={points}
          showInfo
          rankLine={rankLine}
          loadingLine={benchmarksLoading && !bench ? 'Checking the board…' : null}
          trailing={
            <button
              type="button"
              onClick={() => { void share(); }}
              aria-label="Share your taste profile"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-on-surface/[0.06] text-on-surface/80 active:bg-on-surface/[0.1] transition-colors"
            >
              <ShareIcon size={17} />
            </button>
          }
        />

        <TabBar tab={tab} onChange={setTab} />

        {tab === 'board' ? (
          <BoardTab
            key="board"
            sort={boardSort}
            onSort={setBoardSort}
            myId={user?.id ?? null}
            bench={bench}
            loading={benchmarksLoading}
            ratingCount={n}
            points={points.total}
            tierName={standing.tier.name}
          />
        ) : (
          <TasteBody
            v={SELF_VOICE}
            insights={insights}
            points={points}
            bench={bench}
            ratingCount={n}
            twoDecimals={twoDecimalScores}
            onFindTwins={goToTwins}
            showQuiz
          />
        )}
      </div>
    </div>
  );
};

/* ── Shared chrome ────────────────────────────────────────────────────── */

/** The condensed strip that arrives as the masthead leaves, plus the
 *  floating back button above both. */
export const TasteChrome: React.FC<{
  fade: HeaderFade; title: string; right?: string; onBack: () => void; backId: string;
}> = ({ fade, title, right, onBack, backId }) => (
  <div className="sticky top-0 z-40 h-0">
    <motion.div
      style={fade.condensedStyle}
      className="absolute inset-x-0 top-0 border-b border-on-surface/[0.06] bg-surface/85 backdrop-blur-xl"
    >
      <div className="mx-auto w-full max-w-[860px] px-4 pt-safe-3">
        <div className="flex h-11 items-center gap-3 pb-1.5">
          <span className="w-11 flex-none" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-serif text-[16px] font-bold tracking-[-0.02em] text-on-surface">
            {title}
          </span>
          {right && <span className="flex-none text-[13px] font-bold tabular-nums text-primary">{right}</span>}
        </div>
      </div>
    </motion.div>
    <FloatingBack id={backId} onBack={onBack} />
  </div>
);

/** Tier emblem, tier name, points and rank — the head of both the own
 *  page and another person's. */
export const TasteMasthead: React.FC<{
  fade: HeaderFade;
  phoneMode: boolean;
  eyebrow: string;
  standing: TierStanding;
  points: TastePoints;
  rankLine: string | null;
  /** A second fact under the rank, e.g. "84% match with your palate". */
  extraLine?: string | null;
  loadingLine?: string | null;
  showInfo?: boolean;
  trailing?: React.ReactNode;
}> = ({ fade, phoneMode, eyebrow, standing, points, rankLine, extraLine, loadingLine, showInfo, trailing }) => {
  const reduce = useReducedMotion();
  return (
    <motion.header ref={fade.headerRef} style={fade.headerStyle}>
      <div style={{ paddingTop: CHROME_TOP }}>
        <div className="flex h-11 items-center justify-between pl-[52px]">
          <p className="min-w-0 truncate text-[10.5px] font-bold uppercase tracking-[0.18em] text-on-surface/40">{eyebrow}</p>
          {trailing}
        </div>
        <div className="mt-2 flex items-center gap-5">
          <TierEmblem tier={standing.tier} progress={standing.progress} size={phoneMode ? 84 : 104} />
          <div className="min-w-0 flex-1">
            <h1 className={cn(
              'font-serif font-bold leading-[1.02] tracking-[-0.03em] text-on-surface',
              phoneMode ? 'text-[36px]' : 'text-[50px]',
            )}>
              {standing.tier.name}
            </h1>
            <p className="mt-2 text-[13.5px] leading-[1.45] text-on-surface/55" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              {standing.tier.blurb}
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[13px] font-semibold tabular-nums">
          <span className="inline-flex items-center gap-1.5 text-primary text-[15px]">
            <CountUp to={points.total} /> pts
            {showInfo && <PointsInfo components={points.components} />}
          </span>
          {rankLine && (
            <>
              <span className="h-3.5 w-px self-center bg-on-surface/15" aria-hidden />
              <span className="text-on-surface/55">{rankLine}</span>
            </>
          )}
          {loadingLine && <span className="text-on-surface/35">{loadingLine}</span>}
        </div>
        {extraLine && (
          <p className="mt-1.5 text-[13px] font-semibold text-on-surface/70">{extraLine}</p>
        )}
        {/* Progress to the next rung — the sentence that makes the
            emblem's ring legible as a number. */}
        <div className="mt-3.5">
          <div className="h-[6px] overflow-hidden rounded-full bg-on-surface/[0.07]">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={reduce ? false : { width: 0 }}
              animate={{ width: `${Math.round(standing.progress * 100)}%` }}
              transition={{ duration: 1, ease: EASE, delay: 0.2 }}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-on-surface/50">
            {standing.next
              ? <>{standing.toNext} pts to <span className="font-semibold text-on-surface/75">{standing.next.name}</span> · {standing.next.min} pts</>
              : 'Top of the ladder.'}
          </p>
        </div>
      </div>
    </motion.header>
  );
};

/* ── The reading ──────────────────────────────────────────────────────── */

/** Every section from the sentences to the ladder. `v` decides whether
 *  it speaks to you or about someone; `onFindTwins` is only offered on
 *  your own page, where the leaderboard tab exists to jump to. */
export const TasteBody: React.FC<{
  v: Voice;
  insights: TasteInsights;
  points: TastePoints;
  bench: TasteBenchmarks | null;
  ratingCount: number;
  twoDecimals: boolean;
  onFindTwins?: () => void;
  showQuiz?: boolean;
}> = ({ v, insights, points, bench, ratingCount: n, twoDecimals, onFindTwins, showQuiz }) => {
  if (n === 0) {
    return (
      <Reveal className="mt-8">
        <div className="rounded-[22px] bg-on-surface/[0.04] px-5 py-6">
          <p className="font-serif text-[20px] font-bold tracking-[-0.02em] text-on-surface">Nothing on the record yet</p>
          <p className="mt-2 text-[14px] leading-[1.55] text-on-surface/60" style={{ textWrap: 'pretty' } as React.CSSProperties}>
            {v.self
              ? 'Your taste profile is built from what you rate — how you grade, where you spend, what you keep going back to. It starts moving with the first one, and the sentences start at five.'
              : `${v.name} hasn't rated anything yet. A taste profile starts with the first rating and starts talking at five.`}
          </p>
          {v.self && (
            <Link to="/" className="mt-5 inline-flex h-11 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-on-primary">
              Rate a place
            </Link>
          )}
        </div>
        {showQuiz && <QuizBlock insights={insights} />}
      </Reveal>
    );
  }
  const scoredTwice = insights.cuisines.filter((c) => c.n >= 2).length;
  const pricedN = insights.price.counts.reduce((a, b) => a + b, 0);
  return (
    <>
      {/* ── Read-out ── */}
      <Section title="In a sentence" sub={n < 5 ? `Unlocks at 5 ratings — ${5 - n} to go.` : `The three truest things the numbers say about ${v.name}.`}>
        {insights.sentences.length === 0 ? (
          <Locked need={5} have={n} what="the read-out" />
        ) : (
          <ol className="flex flex-col">
            {insights.sentences.slice(0, 3).map((s, i) => (
              <li key={s.id} className={cn('flex items-start gap-3.5 py-4', i > 0 && 'border-t border-on-surface/[0.08]')}>
                <span className="mt-[3px] flex h-6 w-6 flex-none items-center justify-center rounded-full bg-on-surface/[0.06] text-primary">
                  <Sparkles size={13} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-on-surface" style={{ fontSize: '17px', fontWeight: 700, lineHeight: 1.25, letterSpacing: '-0.022em', textWrap: 'pretty' } as React.CSSProperties}>{s.headline}</span>
                  <span className="mt-1 block text-on-surface/55" style={{ fontSize: '13.5px', lineHeight: 1.45, textWrap: 'pretty' } as React.CSSProperties}>{s.detail}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {/* ── Palate ── */}
      <Section title={`${v.Your} palate`} sub={v.self ? 'What you actually like, apart from any points.' : `What ${v.name} actually likes, apart from any points.`}>
        {insights.palate.petals.length < 3 || insights.scored < 5
          ? <Locked need={5} have={insights.scored} what={`${v.your} palate`} note="Needs five ratings across a few cuisines." />
          : <PalateCard v={v} insights={insights} twoDecimals={twoDecimals} onFindTwins={onFindTwins} />}
      </Section>

      {/* ── Grading ── */}
      <Section title={v.self ? 'How you grade' : `How ${v.name} grades`} sub={`${v.Your} scale, and where the platform's sits on it.`}>
        {insights.scored < 5 ? <Locked need={5} have={insights.scored} what={`${v.your} grading style`} /> : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat value={formatScore(insights.avg, twoDecimals)} label={`${v.Your} average`} tone={scoreColor(insights.avg)} />
              <Stat value={formatScore(insights.median, twoDecimals)} label={`${v.Your} median`} />
            </div>
            <Histogram v={v} histogram={insights.histogram} avg={insights.avg} platformAvg={bench?.platformAvgScore ?? null} twoDecimals={twoDecimals} />
            <p className="mt-4 text-[13.5px] leading-[1.5] text-on-surface/60" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              {gradingProse(insights, bench?.rankedUsers ?? 0, v)}
            </p>
          </>
        )}
      </Section>

      {/* ── Price ── */}
      <Section title="Where the money goes" sub={`Share of ${v.your} ratings in each price tier.`}>
        {pricedN < 5
          ? <Locked need={5} have={pricedN} what={`${v.your} spending pattern`} note="Only ratings with a price count." />
          : <PriceTiers v={v} insights={insights} rankedUsers={bench?.rankedUsers ?? 0} />}
      </Section>

      {/* ── Cuisines ── */}
      <Section title="Love vs eat" sub={v.self ? 'How often you eat a cuisine against how you score it. The gap is the story.' : `How often ${v.name} eats a cuisine against how they score it. The gap is the story.`}>
        {scoredTwice < 3
          ? <Locked need={3} have={scoredTwice} what="the cuisine map" note="Needs three cuisines rated at least twice." unit="cuisines" />
          : <CuisineMap v={v} insights={insights} twoDecimals={twoDecimals} />}
      </Section>

      {/* ── Over time ── */}
      <Section title="Over time" sub={`${v.Your} palate has a past. This is it.`}>
        {insights.trend.periods.length < 2 || insights.scored < 6
          ? <Locked need={6} have={insights.scored} what="the timeline" note="Needs ratings across at least two quarters." />
          : <Trend insights={insights} twoDecimals={twoDecimals} />}
      </Section>

      {/* ── Habits ── */}
      <Section title="Habits" sub={v.self ? "The fields nobody charts: whether you'd go back, who was at the table, what day it was." : `The fields nobody charts: whether ${v.name} would go back, who was at the table, what day it was.`}>
        {n < 5 ? <Locked need={5} have={n} what={`${v.your} habits`} /> : <Habits v={v} insights={insights} />}
      </Section>

      {/* ── Tags ── */}
      {insights.tags.length > 0 && (
        <Section title={v.self ? 'What you look for' : `What ${v.name} looks for`} sub={`The tags ${v.your} best ratings carry most.`}>
          <TagCloud tags={insights.tags} />
        </Section>
      )}

      {/* ── Ladder ── */}
      <Section title="The ladder" sub={`Where ${v.your} points come from. No component has a ceiling, and nothing here rewards agreeing with anyone.`}>
        <Ladder components={points.components} total={points.total} />
      </Section>

      {showQuiz && <QuizBlock insights={insights} />}
    </>
  );
};

/* ── Points info ──────────────────────────────────────────────────────── */

/**
 * The "i" beside the points total. Hover (a real mouse) or tap opens a
 * short card on how points are earned — the same labels and hints the
 * ladder section renders, so the two can never disagree. Pointer type
 * is checked because iOS synthesises mouse events on tap: hover-opening
 * there would leave the card stuck open after the toggling tap closed it.
 */
const PointsInfo: React.FC<{ components: PointsComponent[] }> = ({ components }) => {
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPinned(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pinned]);
  return (
    <span
      ref={wrapRef}
      className="relative inline-flex"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHovered(false); }}
    >
      <button
        type="button"
        onClick={() => setPinned((v) => !v)}
        aria-expanded={open}
        aria-label="How points work"
        className={cn(
          'flex h-[18px] w-[18px] items-center justify-center rounded-full transition-colors',
          open ? 'bg-primary text-on-primary' : 'bg-primary/15 text-primary active:bg-primary/30',
        )}
        // A 44pt target around an 18px glyph, without changing the layout.
        style={{ boxShadow: 'none', outline: 'none' }}
      >
        <Info size={11} strokeWidth={2.6} />
        <span className="absolute -inset-3" aria-hidden />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="How points are earned"
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            className="absolute left-0 top-[calc(100%+10px)] z-30 w-[280px] origin-top-left rounded-2xl border border-on-surface/[0.08] bg-surface px-4 py-3.5 text-left shadow-xl"
          >
            <p className="text-on-surface" style={{ fontSize: '13.5px', fontWeight: 700, letterSpacing: '-0.01em' }}>How points work</p>
            <p className="mt-1 text-on-surface/60" style={{ fontSize: '12px', lineHeight: 1.45, textWrap: 'pretty' } as React.CSSProperties}>
              Points measure how much of your taste is on the record — never whether it agrees with anyone. There is no ceiling: every rating, cuisine, city, note and photo keeps adding.
            </p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {components.map((c) => (
                <li key={c.key} className="flex items-baseline gap-2" style={{ fontSize: '12px', lineHeight: 1.35 }}>
                  <span className="w-[76px] flex-none font-semibold text-on-surface">{c.label}</span>
                  <span className="min-w-0 flex-1 text-on-surface/60">{c.hint}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-on-surface/45" style={{ fontSize: '11.5px', lineHeight: 1.4 }}>
              {TIERS.map((t) => `${t.name} ${t.min}`).join(' · ')}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
};

/* ── Palate ───────────────────────────────────────────────────────────── */

/**
 * The palate as an identity: its name, one line on it, and a fingerprint
 * — one petal per cuisine, its length the affinity (how much you eat it,
 * blended with how far above your bar you score it), its colour your
 * average score. Two people with the same points can have fingerprints
 * that look nothing alike, which is the point.
 */
/** The neutral card every boxed thing on this page sits in. Primary is an
 *  accent here (eyebrows, rings, bars), never a wash — a low-alpha orange
 *  over a dark surface reads as a muddy brown. */
const CARD = 'rounded-[22px] bg-on-surface/[0.04] ring-1 ring-on-surface/[0.06]';

/** Legend swatch: which score tier a petal's colour means. */
const TIER_LEGEND: Array<{ tier: 'high' | 'mid' | 'low'; label: string; sample: number }> = [
  { tier: 'high', label: 'Loved', sample: 9 },
  { tier: 'mid', label: 'Liked', sample: 7 },
  { tier: 'low', label: 'Missed', sample: 3 },
];

const PalateCard: React.FC<{ v: Voice; insights: TasteInsights; twoDecimals: boolean; onFindTwins?: () => void }> = ({ v, insights, twoDecimals, onFindTwins }) => {
  const { archetype, tagline, petals } = insights.palate;
  const [picked, setPicked] = useState<string | null>(null);
  const sel = petals.find((p) => p.name === picked) ?? null;
  const tiersPresent = new Set(petals.map((p) => scoreTier(p.avg)));
  return (
    <div>
      <div className={cn(CARD, 'px-4 pb-4 pt-4')}>
        {archetype && (
          <>
            <p className="text-primary" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>{v.Your} palate is</p>
            <p className="mt-1 text-on-surface" style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.035em' }}>{archetype}</p>
            {tagline && <p className="mt-2 text-on-surface/60" style={{ fontSize: '13.5px', lineHeight: 1.5, textWrap: 'pretty' } as React.CSSProperties}>{tagline}</p>}
          </>
        )}
        <div className="mt-2">
          <PetalChart petals={petals} picked={picked} onPick={(name) => setPicked((p) => (p === name ? null : name))} />
        </div>
        {/* One line under the chart: the legend, or the tapped petal. */}
        <div className="mt-1 flex min-h-[20px] flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-[12px] text-on-surface/55">
          {sel ? (
            <span>
              <span className="font-bold text-on-surface">{sel.name}</span> · {sel.n} rating{sel.n === 1 ? '' : 's'} · avg <span className={cn('font-bold', scoreColor(sel.avg))}>{formatScore(sel.avg, twoDecimals)}</span> · {Math.round(sel.eat * 100)}% as often as {v.your} most-eaten
            </span>
          ) : (
            <>
              {TIER_LEGEND.filter((l) => tiersPresent.has(l.tier)).map((l) => (
                <span key={l.tier} className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: scoreSolid(l.sample) }} />
                  {l.label}
                </span>
              ))}
              <span className="text-on-surface/40">· Length = how often</span>
            </>
          )}
        </div>
      </div>
      {onFindTwins && (
        <button
          type="button"
          onClick={onFindTwins}
          className="mt-4 inline-flex h-11 items-center gap-2 rounded-full bg-on-surface px-5 text-surface active:opacity-80 transition-opacity"
          style={{ fontSize: '13px', fontWeight: 700 }}
        >
          <Users size={15} strokeWidth={2.2} />
          Find people who eat like you
          <ChevronRight size={14} />
        </button>
      )}
    </div>
  );
};

/**
 * The fingerprint: one petal per cuisine. Length is how OFTEN you eat it
 * (against your most-eaten), colour is how you SCORE it — two facts, two
 * channels, so a long amber petal and a short green one both read at a
 * glance. One dashed ring marks "as often as your most-eaten".
 */
/** Rough advance width of one character at the label's font-size/weight
 *  (Manrope bold 11px) — good enough to size a truncation budget without
 *  a canvas measurement pass. */
const LABEL_CHAR_PX = 6.5;
const LABEL_EDGE_PAD = 6;

/** Truncate a petal's name so it never runs past the chart's own edge,
 *  given how much room its anchor direction actually has. A word longer
 *  than its budget ends in an ellipsis rather than being clipped by the
 *  SVG viewport — which used to chop from the wrong end ("Mediterranean"
 *  rendered as "nean", the tail surviving because the anchor was 'end'). */
function fitLabel(name: string, maxWidth: number): string {
  const maxChars = Math.max(3, Math.floor(maxWidth / LABEL_CHAR_PX));
  if (name.length <= maxChars) return name;
  return `${name.slice(0, maxChars - 1)}…`;
}

const PetalChart: React.FC<{ petals: Petal[]; picked: string | null; onPick: (name: string) => void }> = ({ petals, picked, onPick }) => {
  const reduce = useReducedMotion();
  // Square and wider than the flower itself needs: the extra width is
  // what keeps a label on the left or right spoke — the two directions
  // with the least room, since the whole word sits to one side of its
  // anchor point rather than straddling it — off the card's edge.
  const W = 380; const H = 380; const cx = W / 2; const cy = H / 2;
  const maxLen = 102; const minLen = 34;
  const k = petals.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Your palate as a fingerprint of cuisines">
      <circle cx={cx} cy={cy} r={maxLen + 14} fill="none" stroke="currentColor" className="text-on-surface/12" strokeDasharray="2 5" />
      {petals.map((p, i) => {
        const angle = -Math.PI / 2 + (i / k) * Math.PI * 2;
        const len = minLen + (maxLen - minLen) * p.eat;
        const w = Math.max(10, Math.min(20, (Math.PI * 2 * len) / (k * 2.4)));
        const on = picked === p.name;
        const dim = picked != null && !on;
        const deg = (angle * 180) / Math.PI + 90;
        const lx = cx + Math.cos(angle) * (maxLen + 30);
        const ly = cy + Math.sin(angle) * (maxLen + 30);
        const anchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle';
        const maxWidth = anchor === 'start' ? (W - LABEL_EDGE_PAD) - lx
          : anchor === 'end' ? lx - LABEL_EDGE_PAD
          : 2 * Math.min(lx - LABEL_EDGE_PAD, (W - LABEL_EDGE_PAD) - lx);
        const label = fitLabel(p.name, maxWidth);
        return (
          <g key={p.name} onClick={() => onPick(p.name)} style={{ cursor: 'pointer', opacity: dim ? 0.3 : 1, transition: 'opacity 200ms var(--ease-out)' }}>
            <motion.path
              d={`M 0 0 C ${w} ${len * 0.3}, ${w} ${len * 0.75}, 0 ${len} C ${-w} ${len * 0.75}, ${-w} ${len * 0.3}, 0 0 Z`}
              transform={`translate(${cx} ${cy}) rotate(${deg})`}
              style={{ fill: scoreSolid(p.avg), opacity: 0.9, stroke: on ? 'var(--color-on-surface)' : 'transparent' }}
              strokeWidth={2}
              initial={reduce ? false : { opacity: 0 }}
              whileInView={{ opacity: 0.9 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, ease: EASE, delay: 0.06 * i }}
            />
            <text x={lx} y={ly + 3.5} textAnchor={anchor} className="fill-current text-on-surface" style={{ fontSize: 11, fontWeight: 700 }}>
              {label !== p.name && <title>{p.name}</title>}
              {label}
            </text>
          </g>
        );
      })}
      <circle cx={cx} cy={cy} r={7} style={{ fill: 'var(--color-surface)', stroke: 'var(--color-on-surface)' }} strokeWidth={2.5} />
    </svg>
  );
};

/* ── Tabs ─────────────────────────────────────────────────────────────── */

type PageTab = 'taste' | 'board';

/** The same connected segmented track the profile's Rated/Posts/Reels/
 *  Guides control uses, so the two pages read as one app. */
const TabBar: React.FC<{ tab: PageTab; onChange: (t: PageTab) => void }> = ({ tab, onChange }) => (
  <div className="mt-6 flex rounded-full bg-on-surface/[0.05] p-1" role="tablist">
    {([
      ['taste', Sparkles, 'Your taste'],
      ['board', Trophy, 'Leaderboard'],
    ] as const).map(([key, Icon, label]) => {
      const on = tab === key;
      return (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => onChange(key)}
          className={cn(
            'flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full py-2.5 transition-colors',
            on
              ? 'bg-surface dark:bg-on-surface/[0.14] text-on-surface shadow-[0_1px_4px_rgba(0,0,0,0.08)]'
              : 'text-on-surface/55 active:text-on-surface',
          )}
          style={{ fontSize: '12.5px', fontWeight: 700 }}
        >
          <Icon size={14} className="flex-none" />
          <span className="truncate">{label}</span>
        </button>
      );
    })}
  </div>
);

/**
 * The leaderboard tab: where you stand, then everyone you can see. Your
 * own standing leads because a board you aren't on yet has to say why.
 */
type BoardKey = LeaderboardSort | 'twins';

/** The boards, in tab order. `value` reads the headline number for a row. */
const BOARDS: Array<{
  key: BoardKey;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  unit: (n: number) => string;
  value: (r: LeaderboardRow) => number;
  rule: string;
}> = [
  { key: 'points', label: 'Points', icon: Trophy, unit: (n) => `${n} pts`, value: (r) => r.points, rule: 'Ranked by points, ties broken by places rated.' },
  { key: 'places', label: 'Places rated', icon: MapPin, unit: (n) => `${n} rated`, value: (r) => r.ratingCount, rule: 'Ranked by places rated, ties broken by points.' },
  { key: 'cuisines', label: 'Cuisines', icon: UtensilsCrossed, unit: (n) => `${n} cuisine${n === 1 ? '' : 's'}`, value: (r) => r.cuisineCount, rule: 'Ranked by distinct cuisines, ties broken by places rated.' },
  { key: 'cities', label: 'Cities', icon: Globe2, unit: (n) => `${n} cit${n === 1 ? 'y' : 'ies'}`, value: (r) => r.cityCount, rule: 'Ranked by distinct cities, ties broken by places rated.' },
  { key: 'twins', label: 'Like you', icon: Users, unit: (n) => `${n}% match`, value: (r) => Math.round((r.similarity ?? 0) * 100), rule: 'Matched on the cuisines you eat and love — closest first.' },
];

const BoardTab: React.FC<{
  sort: BoardKey;
  onSort: (k: BoardKey) => void;
  myId: string | null;
  bench: TasteBenchmarks | null;
  loading: boolean;
  ratingCount: number;
  points: number;
  tierName: string;
}> = ({ sort, onSort: setSort, myId, bench, loading, ratingCount, points, tierName }) => {
  const board = BOARDS.find((b) => b.key === sort) ?? BOARDS[0];
  // Rank per board. Falls back to the benchmarks' points rank when 084
  // isn't applied, so the points board still says where you stand.
  const [myRanks, setMyRanks] = useState<MyRanks | null>(null);
  useEffect(() => {
    let cancelled = false;
    getTasteMyRanks().then((r) => { if (!cancelled) setMyRanks(r); });
    return () => { cancelled = true; };
  }, [ratingCount]);
  // The chip row scrolls; a board picked from elsewhere (the palate
  // section's "find people" button) must be visible as chosen. Once per
  // selection — not on every render, which would yank the row back under
  // the user's finger whenever a fetch resolved.
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = chipsRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [sort]);
  const ranked = myRanks?.rankedUsers ?? bench?.rankedUsers ?? 0;
  const myRank = sort === 'twins' ? null : myRanks ? myRanks.ranks[sort] : sort === 'points' ? (bench?.myRank ?? null) : null;
  const toRank = Math.max(0, 10 - ratingCount);
  const twins = sort === 'twins';
  return (
    <Reveal className="mt-6">
      {/* Board picker — a chip per ladder, scrolling if the row is tight. */}
      <div ref={chipsRef} className="-mx-5 flex gap-2 overflow-x-auto px-5 no-scrollbar" role="tablist" aria-label="Leaderboards">
        {BOARDS.map((b) => {
          const on = b.key === sort;
          const Icon = b.icon;
          return (
            <button
              key={b.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setSort(b.key)}
              className={cn(
                'flex-none inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 transition-colors',
                on ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface/70 active:bg-on-surface/[0.1]',
              )}
              style={{ fontSize: '12.5px', fontWeight: 700 }}
            >
              <Icon size={13} strokeWidth={2.3} />
              {b.label}
            </button>
          );
        })}
      </div>
      <div className={cn(CARD, 'mt-4 px-4 py-4')}>
        <p className="text-primary" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
          {twins ? 'Your taste twins' : `Where you stand · ${board.label}`}
        </p>
        <p className="mt-1.5 text-on-surface" style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.03em' }}>
          {twins
            ? (toRank > 0 ? `${toRank} more rating${toRank === 1 ? '' : 's'} and we can match you` : 'People who eat like you')
            : myRank != null && ranked > 0
            ? `#${myRank} of ${ranked} on GoodEats`
            : loading && !bench
              ? 'Checking the board…'
              : toRank > 0
                ? `${toRank} more rating${toRank === 1 ? '' : 's'} and you're on the board`
                : 'Your rank lands once your ratings sync'}
        </p>
        <p className="mt-1.5 text-on-surface/55" style={{ fontSize: '13px', lineHeight: 1.45 }}>
          {twins
            ? `${board.rule} A match is the overlap between what you both eat and score above your own bars, so a tough grader and a generous one can still be twins. Private accounts aren't listed.`
            : `${points} pts · ${tierName}. ${board.rule} Private accounts count but aren't listed.`}
        </p>
      </div>
      <div className="mt-5">
        <Leaderboard
          sort={sort}
          headline={board}
          myId={myId}
          myRank={myRank}
          myPoints={bench?.myPoints ?? null}
          ranked={ranked}
        />
      </div>
    </Reveal>
  );
};

/* ── Chrome ───────────────────────────────────────────────────────────── */

/** Sections arrive as they scroll into view — once, softly, and not at
 *  all when the system asks for reduced motion. */
const Reveal: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const reduce = useReducedMotion();
  return (
    <motion.section
      className={className}
      initial={reduce ? false : { opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px 0px' }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      {children}
    </motion.section>
  );
};

const Section: React.FC<{ title: string; sub?: string; children: React.ReactNode }> = ({ title, sub, children }) => (
  <Reveal className="mt-9">
    <div className="border-t border-on-surface/[0.14]" aria-hidden />
    <div className="pt-3">
      <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>{title}</h2>
      {sub && <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '13px', lineHeight: 1.4, textWrap: 'pretty' } as React.CSSProperties}>{sub}</p>}
    </div>
    <div className="mt-4">{children}</div>
  </Reveal>
);

const Locked: React.FC<{ need: number; have: number; what: string; note?: string; unit?: string }> = ({ need, have, what, note, unit = 'ratings' }) => {
  const left = Math.max(0, need - have);
  const noun = left === 1 ? unit.replace(/s$/, '') : unit;
  return (
  <div className="flex items-center gap-3.5 rounded-[18px] bg-on-surface/[0.04] px-4 py-3.5">
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-on-surface/[0.06] text-on-surface/40">
      <Lock size={15} />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block text-on-surface" style={{ fontSize: '13.5px', fontWeight: 600 }}>
        {left} more {noun} unlock{left === 1 ? 's' : ''} {what}
      </span>
      <span className="mt-0.5 block text-on-surface/45" style={{ fontSize: '12px' }}>{note ?? `${have} of ${need} so far.`}</span>
    </span>
  </div>
  );
};

const Stat: React.FC<{ value: string; label: string; tone?: string; accent?: boolean }> = ({ value, label, tone, accent }) => (
  <div className={cn('flex flex-col items-start gap-2 rounded-[20px] px-3.5 py-4 bg-on-surface/[0.05]', accent && 'ring-1 ring-primary/30')}>
    <span className={cn('tabular-nums', tone ?? (accent ? 'text-primary' : 'text-on-surface'))} style={{ fontSize: '22px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.04em' }}>{value}</span>
    <span className="text-on-surface/45" style={{ fontSize: '11px', fontWeight: 600, lineHeight: 1.15 }}>{label}</span>
  </div>
);

/** A number that counts up on mount — the points total earns it. */
const CountUp: React.FC<{ to: number }> = ({ to }) => {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? to : 0);
  const [shown, setShown] = useState(reduce ? to : 0);
  useEffect(() => {
    const controls = animate(mv, to, { duration: reduce ? 0 : 1.1, ease: EASE, onUpdate: (v) => setShown(Math.round(v)) });
    return () => controls.stop();
  }, [to, mv, reduce]);
  return <span className="tabular-nums">{shown}</span>;
};

/* ── Grading ──────────────────────────────────────────────────────────── */

function gradingProse(ins: TasteInsights, rankedUsers: number, v: Voice): string {
  // Plain words only: no "spread", no "p90". The one number worth naming
  // is the bar — the score above which a rating from you reads as praise.
  const bar = `Anything above ${f1(ins.anchor)} counts as praise from ${v.name}.`;
  if (ins.grading.vsPlatform != null && ins.grading.tougherThan != null && rankedUsers >= 5) {
    const d = ins.grading.vsPlatform;
    const who = d < -0.15 ? 'A tougher grader than most' : d > 0.15 ? 'A kinder grader than most' : 'Right on the GoodEats average';
    return `${who} — ${d < 0 ? 'stricter' : 'kinder'} than ${pctText(d < 0 ? ins.grading.tougherThan : 1 - ins.grading.tougherThan)} of raters. ${bar}`;
  }
  const self = ins.grading.label === 'tough'
    ? `A tough grader: an 8 from ${v.name} is real praise.`
    : ins.grading.label === 'generous'
      ? `A generous grader: a 7 from ${v.name} is a complaint.`
      : 'A balanced grader.';
  return `${self} ${bar}`;
}

const Histogram: React.FC<{ v: Voice; histogram: number[]; avg: number; platformAvg: number | null; twoDecimals: boolean }> = ({ v, histogram, avg, platformAvg, twoDecimals }) => {
  const reduce = useReducedMotion();
  const bands = histogram.map((c, i) => ({ band: i, c })).filter((b) => b.band >= 1 || b.c > 0);
  const max = Math.max(1, ...bands.map((b) => b.c));
  const first = bands[0].band;
  const span = 10 - first;
  const markerX = (v: number) => `${Math.max(0, Math.min(1, (v - first) / (span + 1))) * 100}%`;
  return (
    <div className="mt-5">
      <div className="relative">
        <div className="flex h-[92px] items-end gap-[3px]">
          {bands.map((b, i) => (
            <div key={b.band} className="flex h-full flex-1 flex-col justify-end">
              <motion.div
                className="w-full rounded-t-[5px]"
                style={{ background: scoreSolid(b.band + 0.5), opacity: b.c === 0 ? 0.18 : 1 }}
                initial={reduce ? false : { height: 0 }}
                whileInView={{ height: `${Math.max(4, (b.c / max) * 100)}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, ease: EASE, delay: 0.04 * i }}
              />
            </div>
          ))}
        </div>
        {/* Your mean, and the platform's, as two hairlines over the bars. */}
        <span className="pointer-events-none absolute bottom-0 top-0 w-px bg-on-surface" style={{ left: markerX(avg) }} aria-hidden />
        {platformAvg != null && (
          <span className="pointer-events-none absolute bottom-0 top-0 w-px border-l border-dashed border-on-surface/40" style={{ left: markerX(platformAvg) }} aria-hidden />
        )}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {bands.map((b) => (
          <span key={b.band} className="flex-1 text-center text-[10.5px] font-semibold tabular-nums text-on-surface/40">{b.band}</span>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-on-surface/50">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px bg-on-surface" />{v.Your} mean {formatScore(avg, twoDecimals)}</span>
        {platformAvg != null && <span className="inline-flex items-center gap-1.5"><span className="h-3 w-px border-l border-dashed border-on-surface/50" />GoodEats mean {formatScore(platformAvg, twoDecimals)}</span>}
      </div>
    </div>
  );
};

/* ── Price ────────────────────────────────────────────────────────────── */

const PriceTiers: React.FC<{ v: Voice; insights: TasteInsights; rankedUsers: number }> = ({ v, insights, rankedUsers }) => {
  const reduce = useReducedMotion();
  const { share, counts, dominantTier, dominantShare, tiersUsed, platformShare } = insights.price;
  const max = Math.max(0.01, ...share);
  const showPlatform = platformShare != null && rankedUsers >= 3;
  return (
    <div>
      <div className="grid grid-cols-4 gap-2.5">
        {share.map((s, i) => {
          const tier = i + 1;
          const dominant = tier === dominantTier;
          return (
            <div key={tier} className="flex flex-col items-stretch">
              <div className="relative h-[110px] overflow-hidden rounded-[14px] bg-on-surface/[0.05]">
                <motion.div
                  className={cn('absolute inset-x-0 bottom-0', dominant ? 'bg-primary' : 'bg-on-surface/[0.22]')}
                  initial={reduce ? false : { height: 0 }}
                  whileInView={{ height: `${(s / max) * 100}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.7, ease: EASE, delay: 0.06 * i }}
                />
                {showPlatform && platformShare && (
                  <span
                    className="absolute inset-x-2 h-0 border-t-2 border-dashed border-on-surface/55"
                    style={{ bottom: `${(platformShare[i] / max) * 100}%` }}
                    aria-hidden
                  />
                )}
              </div>
              <span className={cn('mt-2 text-center text-[13px] font-bold', dominant ? 'text-on-surface' : 'text-on-surface/55')}>{PRICE_SYMBOLS[i]}</span>
              <span className="text-center text-[11.5px] font-semibold tabular-nums text-on-surface/45">{pctText(s)} · {counts[i]}</span>
            </div>
          );
        })}
      </div>
      {showPlatform && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] text-on-surface/50">
          <span className="w-4 border-t-2 border-dashed border-on-surface/55" />
          GoodEats, all ratings
        </p>
      )}
      <p className="mt-3 text-[13.5px] leading-[1.5] text-on-surface/60" style={{ textWrap: 'pretty' } as React.CSSProperties}>
        {dominantTier != null && dominantShare >= 0.6
          ? `${pctText(dominantShare)} of ${v.your} ratings sit in ${PRICE_SYMBOLS[dominantTier - 1]}${insights.grading.vsPlatform != null && rankedUsers >= 5 && insights.price.platformShare ? ` — the platform puts ${pctText(insights.price.platformShare[dominantTier - 1])} there` : ''}. ${v.self ? 'You know what you like to spend.' : `${v.name} knows what they like to spend.`}`
          : tiersUsed >= 3 && dominantShare < 0.45
            ? `Spread across ${tiersUsed} tiers with no tier above ${pctText(dominantShare)}: the food decides the budget, not the other way round.`
            : dominantTier != null
              ? `Mostly ${PRICE_SYMBOLS[dominantTier - 1]} (${pctText(dominantShare)}), with the occasional step ${dominantTier >= 3 ? 'down' : 'up'}.`
              : ''}
      </p>
    </div>
  );
};

/* ── Cuisines ─────────────────────────────────────────────────────────── */

const CuisineMap: React.FC<{ v: Voice; insights: TasteInsights; twoDecimals: boolean }> = ({ v, insights, twoDecimals }) => {
  const reduce = useReducedMotion();
  const rows = insights.cuisines.filter((c) => c.n >= 2);
  const [selected, setSelected] = useState<string | null>(null);
  const W = 320; const H = 210; const PAD = { l: 12, r: 14, t: 14, b: 26 };
  const maxShare = Math.max(0.05, ...rows.map((r) => r.share));
  const yLim = Math.max(1.5, ...rows.map((r) => Math.abs(r.rel)));
  const x = (share: number) => PAD.l + (share / maxShare) * (W - PAD.l - PAD.r);
  const y = (rel: number) => PAD.t + (1 - (rel + yLim) / (2 * yLim)) * (H - PAD.t - PAD.b);
  const radius = (cn: number) => 4 + Math.sqrt(cn) * 2.2;
  const labelled = new Set<string>();
  if (insights.loveMoreThanEat) labelled.add(insights.loveMoreThanEat.name);
  if (insights.eatMoreThanLove) labelled.add(insights.eatMoreThanLove.name);
  if (rows[0]) labelled.add(rows[0].name);
  const best = [...rows].sort((a, b) => b.rel - a.rel)[0];
  if (best) labelled.add(best.name);
  const sel: CuisineRow | null = rows.find((r) => r.name === selected) ?? null;
  return (
    <div className={cn(CARD, 'overflow-hidden')}>
      <div className="relative px-1 pt-1">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Cuisines plotted by how often you eat them against how you rate them">
          {/* Your bar */}
          <line x1={PAD.l} x2={W - PAD.r} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-on-surface/30" strokeDasharray="3 4" />
          <text x={W - PAD.r} y={y(0) - 5} textAnchor="end" className="fill-current text-on-surface/45" style={{ fontSize: 9, fontWeight: 600 }}>{v.your} bar {formatScore(insights.anchor, twoDecimals)}</text>
          <text x={PAD.l} y={H - 8} className="fill-current text-on-surface/40" style={{ fontSize: 9, fontWeight: 600 }}>rarely eaten →</text>
          <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-current text-on-surface/40" style={{ fontSize: 9, fontWeight: 600 }}>eaten most</text>
          <text x={PAD.l} y={PAD.t + 4} className="fill-current text-on-surface/40" style={{ fontSize: 9, fontWeight: 600 }}>↑ loved</text>
          {rows.map((r, i) => {
            const cx = x(r.share); const cy = y(Math.max(-yLim, Math.min(yLim, r.rel)));
            const on = selected === r.name;
            const dim = selected != null && !on;
            return (
              <g key={r.name} onClick={() => setSelected(on ? null : r.name)} style={{ cursor: 'pointer', opacity: dim ? 0.25 : 1, transition: 'opacity 200ms var(--ease-out)' }}>
                {/* The dot grows in by radius, not transform: an SVG
                    transform needs a measured origin per circle, and
                    the attribute tween needs nothing. */}
                <motion.circle
                  cx={cx} cy={cy}
                  style={{ fill: scoreSolid(r.avg), opacity: 0.9, stroke: on ? 'var(--color-on-surface)' : 'transparent' }}
                  strokeWidth={2}
                  initial={reduce ? false : { r: 0 }}
                  whileInView={{ r: radius(r.n) }}
                  viewport={{ once: true }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.03 * i }}
                />
                {/* A generous invisible target for fingers. */}
                <circle cx={cx} cy={cy} r={16} fill="transparent" />
                {(labelled.has(r.name) || on) && !dim && (
                  <text
                    x={cx + radius(r.n) + 4} y={cy + 3}
                    textAnchor={cx > W * 0.72 ? 'end' : 'start'}
                    dx={cx > W * 0.72 ? -(radius(r.n) * 2 + 8) : 0}
                    className="fill-current text-on-surface"
                    style={{ fontSize: 10, fontWeight: 700 }}
                  >
                    {r.name}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      {/* A tapped dot reads out here; otherwise the two callouts speak. */}
      {sel && (
        <p className="px-4 pb-1 text-[12.5px] text-on-surface/70">
          <span className="font-bold text-on-surface">{sel.name}</span> · {sel.n} rating{sel.n === 1 ? '' : 's'} · avg <span className={cn('font-bold', scoreColor(sel.avg))}>{formatScore(sel.avg, twoDecimals)}</span> · {sel.rel >= 0 ? '+' : '−'}{f1(Math.abs(sel.rel))} vs {v.your} bar
        </p>
      )}
      {(insights.loveMoreThanEat || insights.eatMoreThanLove) && (
        <div className="grid grid-cols-2 gap-2.5 px-3 pb-3 pt-2">
          {insights.loveMoreThanEat && (
            <Callout tone="high" eyebrow={v.self ? 'Love more than you eat' : 'Loves more than they eat'} name={insights.loveMoreThanEat.name}
              text={`${insights.loveMoreThanEat.n} ratings, averaging ${formatScore(insights.loveMoreThanEat.avg, twoDecimals)}. Worth ordering more of.`} />
          )}
          {insights.eatMoreThanLove && (
            <Callout tone="mid" eyebrow={v.self ? 'Eat more than you love' : 'Eats more than they love'} name={insights.eatMoreThanLove.name}
              text={`${insights.eatMoreThanLove.n} ratings, averaging ${formatScore(insights.eatMoreThanLove.avg, twoDecimals)} — under ${v.your} bar.`} />
          )}
        </div>
      )}
    </div>
  );
};

/** A tinted note inside the chart card — the tint is the score tier the
 *  note is about (green for the loved cuisine, amber for the merely
 *  eaten), so it reads as part of the chart's own colour system. */
const Callout: React.FC<{ tone: 'high' | 'mid'; eyebrow: string; name: string; text: string }> = ({ tone, eyebrow, name, text }) => (
  <div className="rounded-[18px] px-3.5 py-3.5" style={{ background: `var(--color-score-${tone}-tint)` }}>
    <p style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: `var(--color-score-${tone}-ink)`, textWrap: 'balance' } as React.CSSProperties}>{eyebrow}</p>
    <p className="mt-1.5 text-on-surface" style={{ fontSize: '17px', fontWeight: 700, letterSpacing: '-0.02em' }}>{name}</p>
    <p className="mt-1 text-on-surface/60" style={{ fontSize: '12.5px', lineHeight: 1.45, textWrap: 'pretty' } as React.CSSProperties}>{text}</p>
  </div>
);

/* ── Trend ────────────────────────────────────────────────────────────── */

const Trend: React.FC<{ insights: TasteInsights; twoDecimals: boolean }> = ({ insights, twoDecimals }) => {
  const reduce = useReducedMotion();
  const periods = insights.trend.periods.slice(-8);
  const W = 320; const H = 120; const PAD = { l: 14, r: 14, t: 18, b: 22 };
  const lo = Math.min(...periods.map((p) => p.avg)) - 0.4;
  const hi = Math.max(...periods.map((p) => p.avg)) + 0.4;
  const x = (i: number) => PAD.l + (periods.length === 1 ? 0.5 : i / (periods.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const d = periods.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.avg)}`).join(' ');
  const last = periods[periods.length - 1];
  const { drift, newCuisines, recentTopCuisine, priorTopCuisine, recentAvg, priorAvg, recentN } = insights.trend;
  return (
    <div>
      <div className="overflow-hidden rounded-[18px] bg-on-surface/[0.035]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label="Average score per quarter">
          <motion.path
            d={d} fill="none" style={{ stroke: 'var(--color-primary)' }} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"
            initial={reduce ? false : { pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }}
            transition={{ duration: 1.1, ease: EASE }}
          />
          {periods.map((p, i) => (
            <g key={p.key}>
              <circle cx={x(i)} cy={y(p.avg)} r={p === last ? 5 : 3.5} style={{ fill: p === last ? 'var(--color-primary)' : 'var(--color-surface)', stroke: 'var(--color-primary)' }} strokeWidth={2} />
              <text x={x(i)} y={y(p.avg) - 9} textAnchor="middle" className="fill-current text-on-surface" style={{ fontSize: 9.5, fontWeight: 700 }}>{formatScore(p.avg, twoDecimals)}</text>
              <text x={x(i)} y={H - 7} textAnchor="middle" className="fill-current text-on-surface/45" style={{ fontSize: 9, fontWeight: 600 }}>{p.label}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 flex gap-2.5 overflow-x-auto no-scrollbar">
        {periods.map((p) => (
          <span key={p.key} className="flex-none rounded-full bg-on-surface/[0.05] px-3 py-1.5 text-[11.5px] text-on-surface/60">
            <span className="font-bold text-on-surface/80">{p.label}</span> · {p.n} rated · {p.cuisinesToDate} cuisines{p.topCuisine ? ` · ${p.topCuisine}` : ''}
          </span>
        ))}
      </div>
      {(drift != null || newCuisines.length > 0 || recentTopCuisine) && (
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-[18px] bg-on-surface/[0.05] px-4 py-3.5">
            <p className="text-on-surface/45" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Before</p>
            <p className={cn('mt-1.5 tabular-nums', priorAvg != null ? scoreColor(priorAvg) : 'text-on-surface')} style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.04em' }}>{priorAvg != null ? formatScore(priorAvg, twoDecimals) : '—'}</p>
            <p className="mt-1 text-on-surface/55" style={{ fontSize: '12px' }}>{priorTopCuisine ? `${priorTopCuisine} first` : `${insights.trend.priorN} ratings`}</p>
          </div>
          <div className="rounded-[18px] bg-on-surface/[0.05] px-4 py-3.5 ring-1 ring-primary/30">
            <p className="text-primary" style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>Last 90 days</p>
            <p className={cn('mt-1.5 tabular-nums', recentAvg != null ? scoreColor(recentAvg) : 'text-on-surface')} style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.04em' }}>{recentAvg != null ? formatScore(recentAvg, twoDecimals) : '—'}</p>
            <p className="mt-1 text-on-surface/55" style={{ fontSize: '12px' }}>
              {recentN === 0 ? 'Nothing rated lately' : recentTopCuisine ? `${recentTopCuisine} first` : `${recentN} ratings`}
              {drift != null ? ` · ${drift >= 0 ? '+' : '−'}${f1(Math.abs(drift))}` : ''}
            </p>
          </div>
          {newCuisines.length > 0 && (
            <p className="col-span-2 text-[13px] leading-[1.5] text-on-surface/60" style={{ textWrap: 'pretty' } as React.CSSProperties}>
              New lately: <span className="font-semibold text-on-surface/80">{newCuisines.slice(0, 5).join(', ')}</span>{newCuisines.length > 5 ? ` and ${newCuisines.length - 5} more` : ''}.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Habits ───────────────────────────────────────────────────────────── */

const Habits: React.FC<{ v: Voice; insights: TasteInsights }> = ({ v, insights }) => {
  const h = insights.habits;
  const tiles: Array<{ value: string; label: string; accent?: boolean } | null> = [
    h.returnRate != null ? { value: pctText(h.returnRate), label: v.self ? "You'd go back" : 'Would go back', accent: h.returnRate >= 0.8 } : null,
    h.repeatShare != null ? { value: pctText(h.repeatShare), label: 'Places revisited' } : null,
    { value: pctText(h.socialShare), label: 'With friends' },
    h.weekendShare != null ? { value: pctText(h.weekendShare), label: 'On weekends' } : null,
    h.favoriteDay ? { value: h.favoriteDay.slice(0, 3), label: `${v.Your} night` } : null,
    h.michelin ? { value: String(h.michelin.count), label: 'In the Michelin Guide', accent: true } : null,
    h.michelin && h.michelin.starCount > 0
      ? { value: String(h.michelin.totalStars), label: `Michelin star${h.michelin.totalStars === 1 ? '' : 's'} · ${h.michelin.starCount} starred`, accent: true }
      : null,
    { value: String(h.cities.length), label: h.cities.length === 1 ? 'City' : 'Cities' },
    h.perMonth != null ? { value: h.perMonth >= 10 ? String(Math.round(h.perMonth)) : f1(h.perMonth), label: 'Ratings a month' } : null,
    { value: pctText(h.notesShare), label: 'With notes' },
    { value: pctText(h.photosShare), label: 'With photos' },
  ];
  const shown = tiles.filter((t): t is NonNullable<typeof t> => t != null);
  return (
    <div>
      <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {shown.map((t) => <Stat key={t.label} value={t.value} label={t.label} accent={t.accent} />)}
      </div>
      {h.cities.length > 1 && (
        <p className="mt-3.5 text-[13px] leading-[1.5] text-on-surface/60" style={{ textWrap: 'pretty' } as React.CSSProperties}>
          Mostly <span className="font-semibold text-on-surface/80">{h.cities[0].name}</span> ({h.cities[0].n})
          {h.cities.slice(1, 4).map((c) => ` · ${c.name} (${c.n})`).join('')}
          {h.cities.length > 4 ? ` · ${h.cities.length - 4} more` : ''}.
        </p>
      )}
    </div>
  );
};

/* ── Tags ─────────────────────────────────────────────────────────────── */

const TagCloud: React.FC<{ tags: Array<{ name: string; weight: number }> }> = ({ tags }) => (
  <div className="flex flex-wrap gap-2">
    {tags.map((t, i) => (
      <motion.span
        key={t.name}
        initial={{ opacity: 0, scale: 0.9 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.35, ease: EASE, delay: 0.04 * i }}
        className="rounded-full bg-on-surface/[0.05] text-on-surface ring-1 ring-on-surface/[0.07]"
        style={{
          fontSize: `${12 + Math.round(t.weight * 4)}px`,
          fontWeight: 600,
          padding: '8px 13px',
          opacity: 0.6 + t.weight * 0.4,
        }}
      >
        {t.name}
      </motion.span>
    ))}
  </div>
);

/* ── Ladder ───────────────────────────────────────────────────────────── */

const Ladder: React.FC<{ components: PointsComponent[]; total: number }> = ({ components, total }) => {
  const reduce = useReducedMotion();
  // No component has a ceiling, so a bar can't show "how far to full".
  // It shows the component's share of your total instead — where your
  // points actually come from — scaled so the biggest one fills the row.
  const biggest = Math.max(1, ...components.map((c) => c.points));
  return (
    <div>
      <div className="flex flex-col">
        {components.map((c, i) => (
          <div key={c.key} className={cn('py-3', i > 0 && 'border-t border-on-surface/[0.07]')}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-on-surface" style={{ fontSize: '14px', fontWeight: 700 }}>{c.label}</span>
              <span className="tabular-nums text-on-surface/55" style={{ fontSize: '12.5px', fontWeight: 600 }}>
                <span className="text-on-surface">{Math.round(c.points)}</span> pts · {total > 0 ? Math.round((c.points / total) * 100) : 0}%
              </span>
            </div>
            <div className="mt-2 h-[6px] overflow-hidden rounded-full bg-on-surface/[0.07]">
              <motion.div
                className="h-full rounded-full bg-primary/80"
                initial={reduce ? false : { width: 0 }}
                whileInView={{ width: `${Math.max(2, Math.round((c.points / biggest) * 100))}%` }}
                viewport={{ once: true }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.05 * i }}
              />
            </div>
            <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '12px' }}>
              {c.value} {c.value === 1 ? c.unitOne : c.unit} · {c.hint}
            </p>
          </div>
        ))}
      </div>
      {/* The rungs, so the number has somewhere to go. */}
      <div className="mt-4 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
        {TIERS.map((t) => {
          const Icon = TIER_ICONS[t.key];
          const reached = total >= t.min;
          const current = tierFor(total).tier.key === t.key;
          return (
            <span
              key={t.key}
              className={cn(
                'flex-none inline-flex items-center gap-1.5 rounded-full px-3 py-[7px] text-[11.5px] font-semibold',
                current ? 'bg-primary text-on-primary' : reached ? 'bg-on-surface/[0.06] text-primary' : 'bg-on-surface/[0.05] text-on-surface/45',
              )}
            >
              <Icon size={12} strokeWidth={2.2} />
              {t.name} · {t.min}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/* ── Leaderboard ──────────────────────────────────────────────────────── */

/** Rows and profiles per board, kept for the page's lifetime so tapping
 *  between chips doesn't refetch what was already on screen. */
const boardCache = new Map<BoardKey, { rows: LeaderboardRow[]; profiles: Record<string, UserProfile> }>();

const Leaderboard: React.FC<{
  sort: BoardKey;
  headline: (typeof BOARDS)[number];
  myId: string | null; myRank: number | null; myPoints: number | null; ranked: number;
}> = ({ sort, headline, myId, myRank, myPoints, ranked }) => {
  type Load = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; rows: LeaderboardRow[]; profiles: Record<string, UserProfile> };
  const [load, setLoad] = useState<Load>(() => {
    const cached = boardCache.get(sort);
    return cached ? { state: 'ready', ...cached } : { state: 'loading' };
  });
  useEffect(() => {
    const cached = boardCache.get(sort);
    if (cached) { setLoad({ state: 'ready', ...cached }); return; }
    let cancelled = false;
    setLoad({ state: 'loading' });
    (async () => {
      const rows = sort === 'twins' ? await getTasteTwins(25) : await getTasteLeaderboard(25, sort);
      if (cancelled) return;
      if (rows == null) { setLoad({ state: 'failed' }); return; }
      const profiles = rows.length > 0 ? await getProfilesByIds(rows.map((r) => r.userId)) : {};
      if (cancelled) return;
      boardCache.set(sort, { rows, profiles });
      setLoad({ state: 'ready', rows, profiles });
    })();
    return () => { cancelled = true; };
  }, [sort]);

  if (load.state === 'failed') {
    return <p className="text-[13.5px] text-on-surface/50">The board isn't available right now — try again in a moment.</p>;
  }
  if (load.state === 'loading') return <p className="text-[13.5px] text-on-surface/45">Loading the board…</p>;
  const { rows, profiles } = load;
  if (rows.length === 0 && myRank == null) {
    return (
      <div className="rounded-[18px] bg-on-surface/[0.04] px-4 py-4 text-[13.5px] leading-[1.5] text-on-surface/60">
        {sort === 'twins'
          ? (ranked <= 1
            ? 'Nobody to match yet — you\'re the only ranked eater. Twins appear as more people cross ten ratings.'
            : 'No overlap yet with anyone you can see. Follow people to compare palates, or keep rating.')
          : ranked === 0
          ? 'Nobody is ranked yet — the board opens for anyone with ten or more ratings.'
          : `${ranked} ${ranked === 1 ? 'person is' : 'people are'} ranked, none of them visible to you yet. Follow people to see where they sit.`}
      </div>
    );
  }
  const meListed = rows.some((r) => r.userId === myId);
  return (
    <ol>
      {rows.map((r) => (
        <LeaderRow key={r.userId} row={r} headline={headline} profile={profiles[r.userId]} me={r.userId === myId} />
      ))}
      {!meListed && myRank != null && myPoints != null && myId && (
        <>
          {myRank > rows.length + 1 && <li className="py-2 pl-[38px] text-[12px] text-on-surface/35">…</li>}
          <LeaderRow row={{ userId: myId, rank: myRank, points: myPoints, ratingCount: 0, cuisineCount: 0, cityCount: 0 }} headline={headline} profile={undefined} me synthetic />
        </>
      )}
    </ol>
  );
};

const LeaderRow: React.FC<{
  row: LeaderboardRow; headline: (typeof BOARDS)[number]; profile: UserProfile | undefined; me: boolean;
  /** The caller's own row, built from rank + points alone when they sit
   *  below the list's cut — its per-board counts are unknown. */
  synthetic?: boolean;
}> = ({ row, headline, profile, me, synthetic = false }) => {
  const { user, profile: myProfile } = useAuth();
  const p = me ? (myProfile ?? profile) : profile;
  const name = p?.display_name || p?.username || (me ? 'You' : 'GoodEats member');
  const standing = tierFor(row.points);
  const Icon = TIER_ICONS[standing.tier.key];
  // The board's own number leads on the right; the others fill the meta
  // line, so switching boards visibly re-headlines every row.
  const known = !synthetic;
  const meta = headline.key === 'twins'
    ? [
        row.sharedCuisines && row.sharedCuisines.length > 0 && `Shares ${row.sharedCuisines.join(', ')}`,
        (row.coRated ?? 0) > 0 && `${row.coRated} place${row.coRated === 1 ? '' : 's'} in common, agree on ${row.coAgree ?? 0}`,
        `${row.ratingCount} rated`,
      ].filter(Boolean).join(' · ')
    : known
    ? [
        headline.key !== 'places' && `${row.ratingCount} rated`,
        headline.key !== 'cuisines' && `${row.cuisineCount} cuisines`,
        headline.key !== 'cities' && `${row.cityCount} cit${row.cityCount === 1 ? 'y' : 'ies'}`,
        headline.key !== 'points' && `${row.points} pts`,
      ].filter(Boolean).join(' · ')
    : (p?.username ? `@${p.username}` : 'Ranked');
  const big = known || headline.key === 'points' ? headline.value(row) : null;
  const inner = (
    <>
      <span className={cn(
        'w-6 flex-none text-right font-serif text-[17px] font-bold leading-none tabular-nums',
        row.rank === 1 ? 'text-primary' : row.rank <= 3 ? 'text-on-surface/75' : 'text-on-surface/25',
      )}>
        {row.rank}
      </span>
      <Avatar src={p?.avatar_url} name={name} size={38} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, letterSpacing: '-0.015em' }}>{name}{me ? ' (you)' : ''}</span>
          {p?.is_verified && <VerifiedBadge size={13} />}
        </span>
        <span className="mt-[3px] block truncate text-on-surface/45" style={{ fontSize: '12px' }}>{meta}</span>
      </span>
      <span className="flex flex-none flex-col items-end gap-1">
        <span className="tabular-nums text-on-surface" style={{ fontSize: '15px', fontWeight: 700 }}>
          {big != null ? headline.unit(big) : '—'}
        </span>
        <span className="inline-flex items-center gap-1 text-primary" style={{ fontSize: '10.5px', fontWeight: 700 }}>
          <Icon size={11} strokeWidth={2.4} />{standing.tier.name}
        </span>
      </span>
    </>
  );
  const cls = cn(
    'flex items-center gap-3.5 py-3 -mx-2 px-2 rounded-[16px] transition-colors',
    me && 'bg-on-surface/[0.05] ring-1 ring-on-surface/[0.07]',
  );
  return (
    <li className="relative after:absolute after:bottom-0 after:left-[38px] after:right-0 after:h-px after:bg-on-surface/[0.06] last:after:hidden">
      {p?.username && !(me && user) ? (
        <Link to={`/user/${encodeURIComponent(p.username)}`} className={cn(cls, 'active:bg-on-surface/[0.03]')}>{inner}</Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
};

/* ── Quiz ─────────────────────────────────────────────────────────────── */

const QuizBlock: React.FC<{ insights: TasteInsights }> = ({ insights }) => {
  const q = insights.quiz;
  const has = q.cuisines.length > 0 || q.avoid.length > 0 || q.dietary.length > 0 || q.atmosphere;
  if (!has) return null;
  return (
    <Section title="What you told us" sub={q.influence > 0
      ? `From your onboarding answers. They still shape ${pctText(q.influence)} of the picture; real ratings take over from here.`
      : 'From your onboarding answers. Your ratings have taken over from them entirely.'}>
      <div className="flex flex-col gap-3 text-[13.5px] leading-[1.5] text-on-surface/70">
        {q.cuisines.length > 0 && <p><span className="font-semibold text-on-surface">Into:</span> {q.cuisines.join(', ')}</p>}
        {q.avoid.length > 0 && <p><span className="font-semibold text-on-surface">Skips:</span> {q.avoid.join(', ')}</p>}
        {q.dietary.length > 0 && <p><span className="font-semibold text-on-surface">Eats:</span> {q.dietary.join(', ')}</p>}
        {q.atmosphere && <p><span className="font-semibold text-on-surface">Room:</span> {q.atmosphere}</p>}
      </div>
      <Link to="/profile" className="mt-4 inline-flex items-center gap-1 text-[12.5px] font-bold text-primary">
        Back to profile <ChevronRight size={13} />
      </Link>
    </Section>
  );
};
