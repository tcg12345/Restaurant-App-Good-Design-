import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings, LogOut, X, User, AtSign, Check, ChevronRight, Lock, Loader2, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText,
  Star, MapPin, Heart, Globe, EyeOff, Moon, Sun, Film, Plus, UserPlus, Image as ImageIcon, Sparkles,
  LayoutGrid, List as ListIcon, Upload, Pencil, GripVertical, BookOpen, ChefHat, SquarePen,
  Shield, LifeBuoy, BadgeCheck, UploadCloud,
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { ProfileReelsSection, ProfilePostsSection, ProfileGuidesSection } from '../components/ProfileReelsSection';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { TopBar } from '../components/TopBar';
import { saveProfile, getFollowCounts, getExpertRecommendationCount, getFriends, getFollowerIds, getProfilesByIds, removeFollower, type UserProfile } from '../lib/supabase-community';
import { getMyGuides, deleteGuide, setGuideVisibility, getGuidesForFeed, type Guide as MyGuide } from '../lib/supabase-guides';
import { deleteAccount, clearLocalAppData } from '../lib/supabase-account';
import { geocodePlace } from '../components/HomeLocationBar';
import { supabase } from '../lib/supabase';
import { cn, parseVisitDate } from '../lib/utils';
import { getMyLatestVerificationRequest, type VerificationRequest } from '../lib/supabase-verification';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { useUnifiedCreatePicker } from '../components/useUnifiedComposer';
import { VerifiedStatusPicker } from '../components/VerifiedStatusPicker';
import { ScoreBadge } from '../components/ScoreBadge';
import { scoreColor, scoreBadgeBg } from '../lib/score';
import { useBottomSheet } from '../lib/useBottomSheet';
import { openExternalUrl, SUPPORT_URL, PRIVACY_URL } from '../lib/external-links';

type SettingsPage = 'main' | 'edit' | 'account';

function formatScore(s: unknown): string {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

function numericScore(s: unknown): number {
  const n = typeof s === 'number' ? s : Number(s);
  return Number.isFinite(n) ? n : 0;
}

function cityFromAddress(address: string): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  // Heuristic: in "<street>, <city>, <state-or-country>" the city is the
  // middle part; in "<street>, <city>" it's the last. Pick accordingly so
  // we don't render "CT" or "USA" as the place label.
  if (parts.length >= 3) return parts[parts.length - 2];
  return parts[parts.length - 1];
}

/** Single neutral gradient behind cards with no photo. Kept identical
 *  across every card so the section reads as a calm row rather than a
 *  bag of colored tiles. */
const TOP_RATED_GRADIENT = 'from-stone-700 via-stone-800 to-stone-950';

/** ISO string for sorting by recency; never throws (missing/invalid → empty). */
function ratingRecencyIso(r: { visitDate?: string; createdAt?: number }): string {
  const d = parseVisitDate(r.visitDate);
  if (d) return d.toISOString();
  if (typeof r.createdAt === 'number' && Number.isFinite(r.createdAt)) {
    const d = new Date(r.createdAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return '';
}

/* ── TopRatedCard ──
   Text-only minimalist tile used in the Profile TOP tab. # + rank
   on the left, score-colored decimal on the right, serif name and
   meta sub-line below. Subtle border lifts on hover so the strip
   doesn't feel like detached chrome. */
const TopRatedCard: React.FC<{
  rank: number;
  rating: { restaurantId: string; name: string; score: number; cuisine?: string; price?: string; address?: string; image?: string };
  /** Bottom sub-line under the name. Defaults to cuisine · price · city. */
  metaText?: string;
}> = ({ rank, rating, metaText }) => {
  const city = cityFromAddress(rating.address || '');
  const resolvedMeta = metaText ?? [rating.cuisine, rating.price, city].filter(Boolean).join(' · ');

  return (
    <Link
      to={`/restaurant/${rating.restaurantId}`}
      className="block w-52 flex-shrink-0 snap-start rounded-2xl bg-white border border-on-surface/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-4 py-3.5 hover:border-on-surface/[0.16] hover:shadow-[0_4px_14px_-4px_rgba(0,0,0,0.08)] transition-all"
    >
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[13px] font-medium text-on-surface/30 leading-none">#</span>
          <span className="font-serif font-bold text-on-surface text-[26px] leading-none tabular-nums">
            {rank}
          </span>
        </div>
        <ScoreBadge rating={numericScore(rating.score)} size="lg" />
      </div>

      <p className="font-serif font-bold text-on-surface text-[16px] leading-tight line-clamp-1 mt-3">
        {rating.name}
      </p>
      <p className="text-[12px] text-on-surface/45 truncate mt-1">
        {resolvedMeta}
      </p>
    </Link>
  );
};

/* ── GuideCard ──
   Recommended-guide tile used in the Profile TOP tab. Cover with a
   GUIDE chip + bookmark, place count footer, then title + author row
   sit below the card. Author avatars are simple initial circles. */
type Guide = {
  id: string;
  title: string;
  authorName: string;
  authorHandle: string;
  authorInitials: string;
  placeCount: number;
  cuisineLabel: string;
  coverGradient: string;
  bgImage?: string;
};

const GuideCard: React.FC<{ guide: Guide }> = ({ guide }) => (
  <Link
    to={`/guides/${guide.id}`}
    className="flex-shrink-0 snap-start w-[260px] group"
  >
    <div className={cn(
      'relative w-full aspect-[4/3] rounded-2xl overflow-hidden ring-1 ring-on-surface/[0.06] shadow-sm bg-gradient-to-br',
      guide.coverGradient,
    )}>
      {guide.bgImage && (
        <img
          src={guide.bgImage}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          referrerPolicy="no-referrer"
        />
      )}
      {!guide.bgImage && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="font-mono uppercase tracking-[0.18em] text-white/25 text-[12px]">
            {guide.cuisineLabel}
          </span>
        </div>
      )}

      {/* GUIDE badge top-left */}
      <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 rounded-lg bg-white px-2 h-7 text-on-surface text-[11px] font-bold tracking-wider">
        <ListIcon size={12} />
        GUIDE
      </span>


      {/* Bottom wash + place count */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[50%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
      <div className="absolute bottom-2.5 left-3 inline-flex items-center gap-1 text-white text-[12.5px] font-semibold">
        <MapPin size={12} />
        {guide.placeCount} places
      </div>
    </div>

    <p className="mt-3 font-serif font-bold text-on-surface text-[16px] leading-tight line-clamp-2">
      {guide.title}
    </p>
    <div className="mt-2 flex items-center gap-2">
      <div className="w-7 h-7 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
        <span className="text-[11px] font-bold text-primary">{guide.authorInitials}</span>
      </div>
      <p className="text-[12px] text-on-surface/55 truncate">
        <span className="font-semibold text-on-surface/75">{guide.authorName}</span>
        {guide.authorHandle && <span className="text-on-surface/40"> · @{guide.authorHandle}</span>}
      </p>
    </div>
  </Link>
);

/* ── Top10Section ──
   Section header (title + subtitle + See all) followed by a
   horizontally scrolling strip of TopRatedCards. Kept inline so the
   Profile page can repeat it for each slice (overall, per cuisine,
   per city). */
const Top10Section: React.FC<{
  name: string;
  total: number;
  avg: number;
  onSeeAll?: () => void;
  children: React.ReactNode;
}> = ({ name, total, avg, onSeeAll, children }) => (
  <section>
    <div className="px-5 flex items-baseline justify-between gap-3 mb-1.5">
      <h3 className="font-serif font-bold text-on-surface text-[20px] leading-tight min-w-0 truncate">
        {name}
        <span className="text-on-surface/45 font-normal ml-1.5">
          · {total} place{total === 1 ? '' : 's'} · {avg.toFixed(1)} avg
        </span>
      </h3>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface/65 hover:text-on-surface flex-shrink-0"
        >
          See all <ChevronRight size={14} />
        </button>
      )}
    </div>
    <div className="flex gap-3 overflow-x-auto px-5 pb-1.5 scrollbar-hide snap-x snap-mandatory">
      {children}
    </div>
  </section>
);

/* ── Desktop TOP-tab pieces ──────────────────────────────────────────
   The desktop "Top lists" view (left category rail + featured hero +
   horizontally-scrolling per-category rows). Mobile keeps the simpler
   stacked strips above. ── */

/* Featured hero card — the #1 of the currently-selected scope. */
const FeaturedTopCard: React.FC<{
  rating: { restaurantId: string; name: string; score: number; cuisine?: string; price?: string; address?: string };
  scopeLabel: string;
}> = ({ rating, scopeLabel }) => {
  const score = numericScore(rating.score);
  const meta = [rating.cuisine, rating.price, rating.address].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/restaurant/${rating.restaurantId}`}
      className="block relative overflow-hidden rounded-3xl border border-on-surface/[0.06] bg-gradient-to-br from-primary/[0.06] via-on-surface/[0.015] to-transparent px-8 py-7 hover:border-on-surface/[0.12] transition-colors"
    >
      <div className="flex items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-3">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-[11px] font-bold uppercase tracking-wider">
              <Star size={12} className="fill-primary" /> Top rated
            </span>
            <span className="text-[13px] font-semibold text-on-surface/45">#1 in {scopeLabel}</span>
          </div>
          <h2 className="font-serif font-bold text-on-surface text-[40px] leading-none truncate">{rating.name}</h2>
          {meta && <p className="text-[15px] text-on-surface/55 mt-3 truncate">{meta}</p>}
        </div>
        <div className="flex flex-col items-center flex-shrink-0">
          <div className={cn(
            'w-[128px] h-[128px] rounded-full border-[3px] flex items-center justify-center',
            score >= 8 ? 'border-green-400/70 bg-green-50' : score >= 5 ? 'border-yellow-400/70 bg-yellow-50' : 'border-red-400/70 bg-red-50',
          )}>
            <span className={cn('font-serif font-bold text-[42px] leading-none tabular-nums', scoreColor(score))}>
              {score.toFixed(1)}
            </span>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/35 mt-2.5">Out of 10</span>
        </div>
      </div>
    </Link>
  );
};

/* Horizontal rank card — # + rank, name + meta, score circle on the right. */
const DesktopRankCard: React.FC<{
  rank: number;
  rating: { restaurantId: string; name: string; score: number; cuisine?: string; price?: string; address?: string };
  metaText?: string;
}> = ({ rank, rating, metaText }) => {
  const city = cityFromAddress(rating.address || '');
  const resolvedMeta = metaText ?? [rating.cuisine, rating.price, city].filter(Boolean).join(' · ');
  return (
    <Link
      to={`/restaurant/${rating.restaurantId}`}
      className="flex-shrink-0 snap-start w-[340px] rounded-2xl bg-white border border-on-surface/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.03)] px-5 py-4 flex items-center gap-4 hover:border-on-surface/[0.16] hover:shadow-[0_6px_18px_-6px_rgba(0,0,0,0.12)] transition-all"
    >
      <div className="flex items-baseline gap-0.5 flex-shrink-0 w-8">
        <span className="text-[12px] font-medium text-on-surface/30 leading-none">#</span>
        <span className={cn('font-serif font-bold text-[24px] leading-none tabular-nums', rank === 1 ? 'text-primary' : 'text-on-surface')}>
          {rank}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-serif font-bold text-on-surface text-[17px] leading-tight truncate">{rating.name}</p>
        <p className="text-[12.5px] text-on-surface/45 truncate mt-1">{resolvedMeta}</p>
      </div>
      <ScoreBadge rating={numericScore(rating.score)} size="lg" />
    </Link>
  );
};

/* Section header + horizontally-scrolling row of rank cards (desktop). */
const DesktopTopSection: React.FC<{
  name: string;
  total: number;
  avg: number;
  onSeeAll?: () => void;
  children: React.ReactNode;
}> = ({ name, total, avg, onSeeAll, children }) => (
  <section>
    <div className="flex items-center justify-between gap-3 mb-3.5">
      <div className="flex items-center gap-3 min-w-0">
        <h3 className="font-serif font-bold text-on-surface text-[26px] leading-none truncate">{name}</h3>
        <span className={cn('flex-shrink-0 px-2 py-0.5 rounded-md border text-[12.5px] font-bold tabular-nums', scoreBadgeBg(avg), scoreColor(avg))}>
          {avg.toFixed(1)} avg
        </span>
        <span className="flex-shrink-0 text-[13.5px] text-on-surface/40">{total} place{total === 1 ? '' : 's'}</span>
      </div>
      {onSeeAll && (
        <button
          type="button"
          onClick={onSeeAll}
          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-primary hover:text-primary/80 flex-shrink-0"
        >
          See all <ChevronRight size={14} />
        </button>
      )}
    </div>
    <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x">
      {children}
    </div>
  </section>
);

/* ── Recommended guides ──
   Real published + public guides from the community, mapped into the
   GuideCard shape. Covers use the guide's own photo (or its first
   entry's) with a rotating gradient fallback. */
const GUIDE_GRADIENTS = [
  'from-stone-700 via-stone-800 to-stone-950',
  'from-zinc-700 via-zinc-800 to-stone-950',
  'from-neutral-700 via-neutral-800 to-stone-950',
  'from-stone-800 via-stone-900 to-zinc-950',
];

function guideToCard(g: MyGuide, author: UserProfile | undefined, i: number): Guide {
  const name = author?.display_name || author?.username || 'Gourmet Canvas cook';
  const initials = name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'GC';
  return {
    id: g.id,
    title: g.title,
    authorName: name,
    authorHandle: author?.username || '',
    authorInitials: initials,
    placeCount: g.entries.length,
    cuisineLabel: g.type === 'recipes' ? 'RECIPE GUIDE' : 'GUIDE',
    coverGradient: GUIDE_GRADIENTS[i % GUIDE_GRADIENTS.length],
    bgImage: g.coverPhoto || g.entries.find((e) => e.image)?.image || undefined,
  };
}

/* ── EmptyTabState ──
   Friendly empty placeholder for any tab with no items. Matches the
   surface tone so it never feels like an error state. */
const EmptyTabState: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ctaLabel: string;
  onCta: () => void;
}> = ({ icon, title, subtitle, ctaLabel, onCta }) => (
  <div className="text-center py-12 rounded-2xl border border-dashed border-on-surface/10">
    <div className="mb-3 flex justify-center">{icon}</div>
    <p className="text-sm font-semibold text-on-surface/55">{title}</p>
    <p className="text-xs text-on-surface/35 mt-1 max-w-xs mx-auto">{subtitle}</p>
    <button
      type="button"
      onClick={onCta}
      className="mt-4 px-5 py-2.5 rounded-full bg-primary text-white text-xs font-semibold"
    >
      {ctaLabel}
    </button>
  </div>
);

/* ── Top-list customization ────────────────────────────────────────────
   The TOP tab seeds itself with auto-generated strips (Top 10 overall +
   one per cuisine and city with 4+ ratings). Users can hide any of those
   and add their own slices (e.g. by price tier, tag, or "would return").
   We persist two deltas in localStorage rather than the full set of
   configs so the page keeps reacting to new ratings — a freshly-eligible
   cuisine still shows up automatically. */

type TopListConfig =
  | { type: 'overall' }
  | { type: 'cuisine'; value: string }
  | { type: 'city'; value: string }
  | { type: 'price'; value: string }
  | { type: 'tag'; value: string }
  | { type: 'wouldReturn' };

type TopListCustomization = {
  hidden: string[];
  custom: TopListConfig[];
  /** User-preferred display order, list keys in the desired sequence.
   *  Any visible keys not present fall to the end in their natural
   *  (auto + custom) order — so freshly-eligible auto lists slot in
   *  predictably without erasing the user's choices. */
  order: string[];
};

const TOP_LIST_KEY = (userId: string | null | undefined) => `gourmad-top-lists-${userId || 'anon'}`;
const MIN_LIST_SIZE = 4;

const topListKey = (c: TopListConfig): string => {
  if (c.type === 'overall' || c.type === 'wouldReturn') return c.type;
  return `${c.type}:${c.value}`;
};

const topListLabel = (c: TopListConfig): string => {
  if (c.type === 'overall') return 'Overall';
  if (c.type === 'wouldReturn') return 'Would return';
  return c.value;
};

const topListPlainLabel = (c: TopListConfig): string => {
  if (c.type === 'overall') return 'Top 10 overall';
  if (c.type === 'wouldReturn') return 'Top 10 · Would return';
  if (c.type === 'city') return `Top 10 in ${c.value}`;
  return `Top 10 · ${c.value}`;
};

const topListPredicate = (c: TopListConfig) => (r: { cuisine?: string; price?: string; address?: string; tags?: string[]; wouldReturn?: boolean }): boolean => {
  switch (c.type) {
    case 'overall': return true;
    case 'cuisine': return r.cuisine === c.value;
    case 'city': return cityFromAddress(r.address || '') === c.value;
    case 'price': return r.price === c.value;
    case 'tag': return Array.isArray(r.tags) && r.tags.includes(c.value);
    case 'wouldReturn': return r.wouldReturn === true;
  }
};

const topListMetaText = (
  c: TopListConfig,
  r: { cuisine?: string; price?: string; address?: string },
): string | undefined => {
  const city = cityFromAddress(r.address || '');
  switch (c.type) {
    case 'overall':
    case 'wouldReturn':
    case 'tag':
      return undefined; // default cuisine · price · city
    case 'cuisine':
      return [city, r.price].filter(Boolean).join(' · ');
    case 'city':
      return [r.cuisine, r.price].filter(Boolean).join(' · ');
    case 'price':
      return [r.cuisine, city].filter(Boolean).join(' · ');
  }
};

function loadCustomization(userId: string | null | undefined): TopListCustomization {
  try {
    const raw = localStorage.getItem(TOP_LIST_KEY(userId));
    if (!raw) return { hidden: [], custom: [], order: [] };
    const parsed = JSON.parse(raw);
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      custom: Array.isArray(parsed.custom) ? parsed.custom : [],
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch {
    return { hidden: [], custom: [], order: [] };
  }
}

function saveCustomization(userId: string | null | undefined, c: TopListCustomization) {
  try {
    localStorage.setItem(TOP_LIST_KEY(userId), JSON.stringify(c));
  } catch {
    /* ignore quota errors */
  }
}

/* ── EditTopListsSheet ──
   Two-section editor: current visible lists with delete buttons, then
   a category picker (cuisine/city/price/tag/status) that surfaces every
   value with MIN_LIST_SIZE+ matching ratings the user hasn't already
   added. Adding a hidden auto-list un-hides it; adding a fresh slice
   pushes onto the custom list. */

/* ── Settings primitives ─────────────────────────────────────────
   Used by the redesigned Settings sheet (Profile / Preferences /
   Account groups). Section gives a labeled card-style group with
   subtle dividers between rows; Row renders either a navigable
   chevron item or a toggle item. Hover, focus and tap-feedback are
   built in so the whole row feels intentional, not just a button
   styled to look like one. */
const SettingsSection: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <section className="pt-4 first:pt-2">
    <h4 className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-on-surface/40 px-1 mb-2">{label}</h4>
    <div className="rounded-2xl border border-on-surface/[0.06] bg-on-surface/[0.02] overflow-hidden divide-y divide-on-surface/[0.05]">
      {children}
    </div>
  </section>
);

const SettingsRow: React.FC<{
  icon: React.ReactNode;
  label: string;
  hint?: string;
  onClick: () => void;
  /** When set, the row renders a switch on the right instead of a
   *  chevron. The click handler still fires when anywhere on the
   *  row is tapped, so it doubles as the switch's hit target. */
  toggle?: boolean;
  toggleValue?: boolean;
  /** Suppress the bottom divider when this is the last row in a
   *  Section (the parent's `divide-y` handles internal dividers, but
   *  this lets callers explicitly mark the tail). Cosmetic only. */
  isLast?: boolean;
}> = ({ icon, label, hint, onClick, toggle, toggleValue, isLast: _isLast }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full flex items-center gap-3.5 px-4 py-3.5 hover:bg-on-surface/[0.03] active:bg-on-surface/[0.05] focus:outline-none focus-visible:bg-on-surface/[0.05] transition-colors text-left"
  >
    <span className="w-9 h-9 rounded-xl bg-on-surface/[0.05] flex items-center justify-center text-on-surface/65 flex-shrink-0">
      {icon}
    </span>
    <span className="flex-1 min-w-0">
      <span className="block text-[14px] font-semibold text-on-surface leading-tight">{label}</span>
      {hint && <span className="block text-[11.5px] text-on-surface/45 mt-0.5 leading-snug truncate">{hint}</span>}
    </span>
    {toggle ? (
      <span
        className={cn(
          'relative inline-block w-[42px] h-[24px] rounded-full transition-colors flex-shrink-0',
          toggleValue ? 'bg-primary' : 'bg-on-surface/15',
        )}
        aria-hidden
      >
        <motion.span
          className="absolute top-[2px] w-5 h-5 bg-white rounded-full shadow-[0_1px_2px_rgba(0,0,0,0.18)]"
          animate={{ left: toggleValue ? 19 : 2 }}
          transition={{ type: 'spring', damping: 22, stiffness: 380 }}
        />
      </span>
    ) : (
      <ChevronRight size={16} className="text-on-surface/25 flex-shrink-0" />
    )}
  </button>
);
const EditTopListsSheet: React.FC<{
  open: boolean;
  onClose: () => void;
  visibleLists: TopListConfig[];
  addableByCategory: Record<'cuisine' | 'city' | 'price' | 'tag' | 'status', Array<{ config: TopListConfig; label: string; count: number }>>;
  onDelete: (c: TopListConfig) => void;
  onAdd: (c: TopListConfig) => void;
  onReorder: (configs: TopListConfig[]) => void;
}> = ({ open, onClose, visibleLists, addableByCategory, onDelete, onAdd, onReorder }) => {
  const { phoneMode } = useSettings();
  const [category, setCategory] = useState<'cuisine' | 'city' | 'price' | 'tag' | 'status'>('cuisine');
  const { dragProps } = useBottomSheet(open, onClose);

  useEffect(() => { if (open) setCategory('cuisine'); }, [open]);

  const tabs: Array<{ key: typeof category; label: string }> = [
    { key: 'cuisine', label: 'Cuisine' },
    { key: 'city', label: 'City' },
    { key: 'price', label: 'Price' },
    { key: 'tag', label: 'Tag' },
    { key: 'status', label: 'Status' },
  ];

  const addable = addableByCategory[category] || [];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: phoneMode ? 0.18 : 0.16 }}
          className={cn(
            'fixed inset-0 z-[70]',
            phoneMode ? 'bg-black/40 backdrop-blur-sm' : 'bg-black/50 backdrop-blur-md flex items-start justify-center pt-[12vh] px-4',
          )}
          onClick={onClose}
        >
          <motion.div
            {...(phoneMode
              ? { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' }, transition: { type: 'spring' as const, damping: 28, stiffness: 300 }, ...dragProps }
              : {
                  initial: { opacity: 0, scale: 0.94, y: -12 },
                  animate: { opacity: 1, scale: 1, y: 0 },
                  exit: { opacity: 0, scale: 0.96, y: -8 },
                  transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                })}
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            className={cn(
              'bg-surface flex flex-col overflow-hidden',
              phoneMode
                ? 'fixed bottom-0 left-0 right-0 rounded-t-3xl max-h-[85vh]'
                : 'w-full max-w-2xl rounded-[28px] max-h-[80vh] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.42)] ring-1 ring-on-surface/[0.06]',
            )}
          >
            {phoneMode && <div className="flex justify-center pt-3 pb-1"><div className="w-10 h-1 rounded-full bg-on-surface/15" /></div>}
            <div className={cn(
              'flex items-center justify-between flex-shrink-0',
              phoneMode ? 'px-5 pt-3 pb-3 border-b border-on-surface/[0.06]' : 'px-6 pt-5 pb-4 border-b border-on-surface/[0.06]',
            )}>
              <div>
                <h3 className={cn('font-serif font-bold', phoneMode ? 'text-lg' : 'text-[20px]')}>Edit top lists</h3>
                <p className="text-[11.5px] text-on-surface/45 mt-0.5">Remove auto-picked lists or add your own slices.</p>
              </div>
              <button onClick={onClose} className="w-8 h-8 rounded-full bg-on-surface/[0.05] flex items-center justify-center hover:bg-on-surface/10 transition-colors">
                <X size={16} className="text-on-surface/60" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">
              {/* Current lists — Reorder.Group so the user can drag any
                  row to a new spot. Drag handle on the left, X on the
                  right. The whole row is the drag affordance so touch
                  reorder feels natural on phones. */}
              <section>
                <div className="flex items-baseline justify-between mb-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/40">Your lists</p>
                  {visibleLists.length > 1 && (
                    <p className="text-[10.5px] text-on-surface/35">Drag to reorder</p>
                  )}
                </div>
                {visibleLists.length === 0 ? (
                  <p className="text-[13px] text-on-surface/45">No lists yet. Add one below.</p>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={visibleLists}
                    onReorder={onReorder}
                    className="space-y-1.5"
                  >
                    {visibleLists.map((c) => (
                      <Reorder.Item
                        key={topListKey(c)}
                        value={c}
                        className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-on-surface/[0.04] border border-on-surface/[0.06] cursor-grab active:cursor-grabbing select-none"
                        whileDrag={{
                          scale: 1.02,
                          boxShadow: '0 6px 20px -8px rgba(0,0,0,0.18)',
                          zIndex: 10,
                        }}
                      >
                        <GripVertical size={15} className="text-on-surface/30 flex-shrink-0" />
                        <span className="flex-1 min-w-0 text-[13.5px] font-medium text-on-surface/80 truncate">
                          {topListPlainLabel(c)}
                        </span>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onDelete(c)}
                          aria-label={`Remove ${topListPlainLabel(c)}`}
                          className="w-7 h-7 rounded-full bg-on-surface/[0.06] hover:bg-rose-100 text-on-surface/45 hover:text-rose-600 flex items-center justify-center transition-colors flex-shrink-0"
                        >
                          <X size={13} />
                        </button>
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                )}
              </section>

              {/* Add a list */}
              <section>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/40 mb-2.5">Add a list</p>

                <div className="flex flex-wrap gap-2 mb-3">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setCategory(t.key)}
                      className={cn(
                        'px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors border',
                        category === t.key
                          ? 'bg-primary text-white border-primary'
                          : 'bg-on-surface/[0.04] border-on-surface/[0.08] text-on-surface/55 hover:bg-on-surface/[0.08]',
                      )}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {addable.length === 0 ? (
                  <p className="text-[12.5px] text-on-surface/45 px-1">
                    Nothing eligible here yet — categories need at least {MIN_LIST_SIZE} rated restaurants to qualify.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {addable.map(({ config, label, count }) => (
                      <button
                        key={topListKey(config)}
                        type="button"
                        onClick={() => onAdd(config)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-on-surface/[0.04] border border-on-surface/[0.08] hover:bg-primary/[0.08] hover:border-primary/30 hover:text-primary text-[12px] font-semibold text-on-surface/75 transition-colors"
                      >
                        <Plus size={12} strokeWidth={2.6} />
                        {label}
                        <span className="text-on-surface/35 font-medium">· {count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export const Profile: React.FC = () => {
  const navigate = useNavigate();
  const { profile, user, signOut, refreshProfile, pendingRequestCount, isAdmin } = useAuth();
  const { showToast } = useToast();
  const listsCtx = useLists();
  const { openAddReelModal, openEditReelModal, reels, deleteReel, setReelVisibility } = useReels();
  const { openAddPostModal, openEditPostModal, posts, deletePost, setPostVisibility } = usePosts();
  const { openGuideCreator, isOpen: guideCreatorOpen } = useGuideCreator();
  // Unified Post entry in the create menu — media picked first, then a
  // single video routes to the reel editor, anything else to the post
  // composer (Instagram-style).
  const { openPicker: openUnifiedPicker, pickerInput } = useUnifiedCreatePicker();
  const ratings = Array.isArray(listsCtx.ratings) ? listsCtx.ratings : [];

  // Dismiss the friend-request banner for this session (reappears on reload
  // while requests are still pending, so a real request isn't lost).
  const [friendReqDismissed, setFriendReqDismissed] = useState(false);

  // Recommended guides — real public guides from the community (other
  // authors first). The strip hides entirely while empty.
  const [recommendedGuides, setRecommendedGuides] = useState<Guide[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const guides = await getGuidesForFeed({ limit: 8, excludeUserId: user?.id });
      if (cancelled) return;
      if (guides.length === 0) { setRecommendedGuides([]); return; }
      const authorIds = Array.from(new Set(guides.map((g) => g.userId)));
      const profiles = await getProfilesByIds(authorIds);
      if (cancelled) return;
      setRecommendedGuides(guides.map((g, i) => guideToCard(g, profiles[g.userId], i)));
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Reels and posts authored by the signed-in user. Both come from their
  // respective contexts (loaded once at mount), filtered locally.
  const myReels = useMemo(
    () => reels.filter((r) => r.authorId === user?.id),
    [reels, user?.id],
  );
  const myPosts = useMemo(
    () => posts.filter((p) => p.userId === user?.id),
    [posts, user?.id],
  );
  const [confirmDeleteReelId, setConfirmDeleteReelId] = useState<string | null>(null);
  const [confirmDeletePostId, setConfirmDeletePostId] = useState<string | null>(null);
  const [confirmDeleteGuideId, setConfirmDeleteGuideId] = useState<string | null>(null);
  const [deletingReel, setDeletingReel] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [deletingGuide, setDeletingGuide] = useState(false);

  // Guides owned by the signed-in user. Unlike reels/posts there's no
  // global context loading these, so we fetch in-page on mount and after
  // mutations. Includes drafts so the owner can see + finish them.
  const [myGuides, setMyGuides] = useState<MyGuide[]>([]);
  const refreshMyGuides = React.useCallback(async () => {
    if (!user?.id) { setMyGuides([]); return; }
    const list = await getMyGuides(user.id);
    setMyGuides(list);
  }, [user?.id]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id) { setMyGuides([]); return; }
      const list = await getMyGuides(user.id);
      if (!cancelled) setMyGuides(list);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);
  // Re-fetch the moment the guide creator closes — covers create / edit / save.
  const prevGuideCreatorOpen = useRef(false);
  useEffect(() => {
    if (prevGuideCreatorOpen.current && !guideCreatorOpen) void refreshMyGuides();
    prevGuideCreatorOpen.current = guideCreatorOpen;
  }, [guideCreatorOpen, refreshMyGuides]);
  // Guides actually worth rendering in the grid. Two cleanups:
  //   1. De-dupe by id (defensive — keeps the grid stable if a refresh
  //      ever races and a row slips in twice).
  //   2. Drop empty, untitled drafts — the accidental "Untitled guide"
  //      tiles a user racks up by opening the creator and bailing. A
  //      draft with a title OR any entries is real work-in-progress and
  //      stays so the owner can finish it.
  const visibleGuides = useMemo(() => {
    const seen = new Set<string>();
    return myGuides.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return g.entries.length > 0 || g.title.trim().length > 0;
    });
  }, [myGuides]);

  const onConfirmDeleteReel = async () => {
    if (!confirmDeleteReelId) return;
    setDeletingReel(true);
    const ok = await deleteReel(confirmDeleteReelId);
    setDeletingReel(false);
    setConfirmDeleteReelId(null);
    if (!ok) showToast("Couldn't delete that reel. Try again.");
  };
  const onConfirmDeletePost = async () => {
    if (!confirmDeletePostId) return;
    setDeletingPost(true);
    const ok = await deletePost(confirmDeletePostId);
    setDeletingPost(false);
    setConfirmDeletePostId(null);
    if (!ok) showToast("Couldn't delete that post. Try again.");
  };
  const onConfirmDeleteGuide = async () => {
    if (!confirmDeleteGuideId) return;
    setDeletingGuide(true);
    const ok = await deleteGuide(confirmDeleteGuideId);
    setDeletingGuide(false);
    setConfirmDeleteGuideId(null);
    if (!ok) { showToast("Couldn't delete that guide. Try again."); return; }
    setMyGuides((prev) => prev.filter((g) => g.id !== confirmDeleteGuideId));
  };
  const onToggleGuideVisibility = async (guideId: string, nextIsPublic: boolean) => {
    const next = nextIsPublic ? 'public' : 'private';
    // Optimistic flip — revert if the write fails. Making a guide public also
    // publishes it (mirrors setGuideVisibility) so the Draft badge clears and
    // the public profile picks it up immediately.
    setMyGuides((prev) => prev.map((g) =>
      g.id === guideId
        ? { ...g, visibility: next, isPublished: nextIsPublic ? true : g.isPublished }
        : g,
    ));
    const ok = await setGuideVisibility(guideId, next);
    if (!ok) {
      showToast("Couldn't update that guide's visibility. Try again.");
      void refreshMyGuides();
    }
  };
  const { phoneMode, darkMode, toggleDarkMode } = useSettings();
  const [activeTab, setActiveTab] = useState<'top' | 'posts' | 'reels' | 'guides' | 'rated'>('top');
  const [editListsOpen, setEditListsOpen] = useState(false);
  // Desktop "Top lists" category rail selection — 'all' shows every list,
  // otherwise a topListKey to focus a single category.
  const [topListFilter, setTopListFilter] = useState<string>('all');
  const [customization, setCustomization] = useState<TopListCustomization>({ hidden: [], custom: [], order: [] });
  // Load the persisted customization once we know who the user is.
  useEffect(() => { setCustomization(loadCustomization(user?.id)); }, [user?.id]);
  // Persist on every change.
  useEffect(() => { saveCustomization(user?.id, customization); }, [user?.id, customization]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('main');
  const settingsDrag = useBottomSheet(settingsOpen && phoneMode, () => setSettingsOpen(false));
  // Create menu — single button under the action row that opens a small
  // popover offering Post or Reel. Mirrors the desktop sidebar's pattern.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!createMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (createWrapRef.current && !createWrapRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [createMenuOpen]);

  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editBio, setEditBio] = useState('');
  // Home city the user is based in. Surfaced on Circle expert cards and
  // used by /location to suggest experts in the area being explored.
  // Free-text input here; on save it's forward-geocoded to lat/lng so
  // location-based queries don't have to re-geocode every profile.
  const [editHomeCity, setEditHomeCity] = useState('');
  const [editError, setEditError] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [editSuccess, setEditSuccess] = useState(false);

  const [followers, setFollowers] = useState(0);
  const [following, setFollowing] = useState(0);
  const [expertPickCount, setExpertPickCount] = useState(0);

  // Stat popups — clicking a stat number opens a list of the matching
  // entries (people for followers/following, restaurants for rated).
  const [statPopup, setStatPopup] = useState<null | 'followers' | 'following' | 'rated'>(null);
  const [popupPeople, setPopupPeople] = useState<UserProfile[] | null>(null);
  const [popupLoading, setPopupLoading] = useState(false);
  // Desktop vs phone — popup opens as a centered modal on wide
  // viewports and a bottom sheet on narrow ones.
  const [isWideViewport, setIsWideViewport] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsWideViewport(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const isDesktop = isWideViewport && !phoneMode;

  // Loads the right user list for the active stat popup (followers or
  // following). Skips when the popup isn't a people one. Reuses the
  // last-loaded list while a new fetch is in flight so the popup never
  // flashes empty between opens — but only when the cached list is for the
  // SAME popup type (a followers list must never masquerade as following).
  const popupPeopleForRef = useRef<null | 'followers' | 'following'>(null);
  useEffect(() => {
    if (statPopup !== 'followers' && statPopup !== 'following') return;
    if (!user?.id) return;
    let cancelled = false;
    setPopupLoading(true);
    if (popupPeopleForRef.current !== statPopup) setPopupPeople(null);
    (async () => {
      const ids = statPopup === 'followers'
        ? await getFollowerIds(user.id)
        : (await getFriends(user.id)).map((f) => f.friend_id);
      if (cancelled) return;
      if (ids.length === 0) {
        setPopupPeople([]);
        popupPeopleForRef.current = statPopup;
        setPopupLoading(false);
        return;
      }
      const profMap = await getProfilesByIds(ids);
      if (cancelled) return;
      // Preserve the order of `ids` so newest follows surface first
      // when the underlying query is ordered.
      const list = ids.map((id) => profMap[id]).filter(Boolean) as UserProfile[];
      setPopupPeople(list);
      popupPeopleForRef.current = statPopup;
      setPopupLoading(false);
    })();
    return () => { cancelled = true; };
  }, [statPopup, user?.id]);

  // Followers I'm currently removing (revoking their follow). Directional
  // (see removeFollower): deletes their follower→me edge so a private account
  // can cut off someone it previously approved.
  const [removingFollower, setRemovingFollower] = useState<Set<string>>(new Set());
  const handleRemoveFollower = React.useCallback(async (followerId: string) => {
    if (!user?.id || removingFollower.has(followerId)) return;
    setRemovingFollower((prev) => new Set(prev).add(followerId));
    const ok = await removeFollower(user.id, followerId);
    setRemovingFollower((prev) => { const n = new Set(prev); n.delete(followerId); return n; });
    if (ok) {
      setPopupPeople((prev) => (prev ? prev.filter((p) => p.user_id !== followerId) : prev));
      setFollowers((f) => Math.max(0, f - 1));
    } else {
      showToast("Couldn't remove that follower. Try again.");
    }
  }, [user?.id, removingFollower, showToast]);

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountError, setAccountError] = useState('');
  const [deleteStep, setDeleteStep] = useState(0);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (user?.id) {
      getFollowCounts(user.id).then(({ followers: f, following: fg }) => {
        setFollowers(f);
        setFollowing(fg);
      });
    }
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !profile?.is_verified) {
      setExpertPickCount(0);
      return;
    }
    let cancelled = false;
    getExpertRecommendationCount(user.id).then((c) => {
      if (!cancelled) setExpertPickCount(c);
    });
    return () => { cancelled = true; };
  }, [user?.id, profile?.is_verified]);

  const resetEditFields = () => {
    setEditName(profile?.display_name || '');
    setEditUsername(profile?.username || '');
    setEditBio(profile?.bio || '');
    setEditHomeCity(profile?.home_city || '');
    setEditError('');
    setEditSuccess(false);
  };

  const openEditProfile = () => {
    resetEditFields();
    setSettingsPage('edit');
    setSettingsOpen(true);
  };

  // Latest verification request — drives the settings "Verification" row
  // (none/denied → apply · pending → under review · verified → edit status).
  const [verifReq, setVerifReq] = useState<VerificationRequest | null>(null);
  const openSettings = () => {
    setSettingsPage('main');
    if (user?.id && !profile?.is_verified) {
      void getMyLatestVerificationRequest(user.id).then(setVerifReq);
    }
    setAccountMsg('');
    setAccountError('');
    setNewEmail('');
    setNewPassword('');
    setDeleteStep(0);
    setSettingsOpen(true);
  };

  const goToMyRatings = () => {
    sessionStorage.setItem('map-mode', 'myratings');
    navigate('/map');
  };

  const handleSaveProfile = async () => {
    if (!user?.id) return;
    if (!editName.trim() || !editUsername.trim()) {
      setEditError('Name and username are required');
      return;
    }
    if (editUsername.length < 3) {
      setEditError('Username must be at least 3 characters');
      return;
    }
    setEditSaving(true);
    setEditError('');
    // Resolve the typed home-city to coords on save so location-based
    // queries (e.g. "experts in Westport") don't have to forward-geocode
    // every profile at read time. Only changed-or-new entries hit Mapbox;
    // a cleared field resets coords too.
    const homeCityTrim = editHomeCity.trim();
    const previousCity = profile?.home_city || '';
    let homeBase: { homeCity?: string | null; homeLat?: number | null; homeLng?: number | null } | undefined;
    if (homeCityTrim !== previousCity) {
      if (!homeCityTrim) {
        homeBase = { homeCity: null, homeLat: null, homeLng: null };
      } else {
        const geo = await geocodePlace(homeCityTrim);
        homeBase = {
          homeCity: geo?.label || homeCityTrim,
          homeLat: geo?.lat ?? null,
          homeLng: geo?.lng ?? null,
        };
      }
    }
    const result = await saveProfile(
      user.id,
      editName.trim(),
      editUsername.trim(),
      editBio.trim(),
      undefined,
      homeBase,
    );
    if (result.success) {
      setEditSuccess(true);
      await refreshProfile();
      setTimeout(() => setSettingsPage('main'), 800);
    } else {
      setEditError(result.error || 'Failed to save');
    }
    setEditSaving(false);
  };

  const handleUpdateEmail = async () => {
    if (!newEmail.trim()) return;
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
    if (error) setAccountError(error.message);
    else setAccountMsg('Check your new email for a confirmation link');
  };

  const handleUpdatePassword = async () => {
    if (newPassword.length < 6) {
      setAccountError('Password must be at least 6 characters');
      return;
    }
    setAccountMsg('');
    setAccountError('');
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setAccountError(error.message);
    else {
      setAccountMsg('Password updated successfully');
      setNewPassword('');
    }
  };

  // Permanently delete the account + every piece of server-side data
  // (delete-account Edge Function), then wipe the device's local app
  // data. The local sign-out inside deleteAccount fires onAuthStateChange,
  // which lands the user on the signed-out screen. In-app deletion is an
  // App Store requirement (Review Guideline 5.1.1(v)).
  const handleDeleteAccount = async () => {
    if (deletingAccount) return;
    setDeletingAccount(true);
    setAccountMsg('');
    setAccountError('');
    const result = await deleteAccount();
    if (!result.ok) {
      setDeletingAccount(false);
      setDeleteStep(0);
      setAccountError(result.error || 'Could not delete the account. Please try again.');
      return;
    }
    clearLocalAppData();
    // Hard reload so provider state (still holding the deleted account's data
    // in memory) is torn down too — same clean-slate pattern as sign-out.
    window.location.reload();
  };

  const displayName = profile?.display_name || 'Your Name';
  const username = profile?.username || 'username';
  const bio = profile?.bio || '';
  const publicProfilePath = `/user/${encodeURIComponent(username)}`;

  const cuisineStats = useMemo(() => {
    const map = new Map<string, number>();
    ratings.forEach((r) => {
      if (!r.cuisine) return;
      map.set(r.cuisine, (map.get(r.cuisine) || 0) + 1);
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [ratings]);

  /** Counts per (cuisine / city / price / tag / wouldReturn) — used both
   *  to seed auto-generated lists and to gate which slices the user can
   *  add from the editor (must have MIN_LIST_SIZE+ matches). */
  const categoryCounts = useMemo(() => {
    const cuisine = new Map<string, number>();
    const city = new Map<string, number>();
    const price = new Map<string, number>();
    const tag = new Map<string, number>();
    let wouldReturn = 0;
    ratings.forEach((r) => {
      if (r.cuisine) cuisine.set(r.cuisine, (cuisine.get(r.cuisine) || 0) + 1);
      const c = cityFromAddress(r.address || '');
      if (c) city.set(c, (city.get(c) || 0) + 1);
      if (r.price) price.set(r.price, (price.get(r.price) || 0) + 1);
      if (Array.isArray(r.tags)) r.tags.forEach((t) => { if (t) tag.set(t, (tag.get(t) || 0) + 1); });
      if (r.wouldReturn) wouldReturn += 1;
    });
    return { cuisine, city, price, tag, wouldReturn };
  }, [ratings]);

  /** Auto-seeded configs: overall + any cuisine / city above the
   *  threshold, sorted by count desc so the heaviest categories lead. */
  const autoConfigs = useMemo<TopListConfig[]>(() => {
    const out: TopListConfig[] = [{ type: 'overall' }];
    Array.from(categoryCounts.cuisine.entries())
      .filter(([, n]) => n >= MIN_LIST_SIZE)
      .sort((a, b) => b[1] - a[1])
      .forEach(([value]) => out.push({ type: 'cuisine', value }));
    Array.from(categoryCounts.city.entries())
      .filter(([, n]) => n >= MIN_LIST_SIZE)
      .sort((a, b) => b[1] - a[1])
      .forEach(([value]) => out.push({ type: 'city', value }));
    return out;
  }, [categoryCounts]);

  /** Final ordered configs after applying user deltas: auto minus
   *  hidden, then any custom additions that aren't already covered.
   *  Sorted by the user's preferred order; anything missing from
   *  `order` (e.g. a freshly eligible auto cuisine) falls to the end
   *  in its natural position. */
  const visibleConfigs = useMemo<TopListConfig[]>(() => {
    const hidden = new Set(customization.hidden);
    const auto = autoConfigs.filter((c) => !hidden.has(topListKey(c)));
    const autoKeys = new Set(auto.map(topListKey));
    const custom = customization.custom.filter((c) => !autoKeys.has(topListKey(c)));
    const all = [...auto, ...custom];

    if (customization.order.length === 0) return all;
    const orderIdx = new Map<string, number>(customization.order.map((k, i) => [k, i]));
    return [...all].sort((a, b) => {
      const ai = orderIdx.get(topListKey(a));
      const bi = orderIdx.get(topListKey(b));
      if (ai != null && bi != null) return ai - bi;
      if (ai != null) return -1;
      if (bi != null) return 1;
      return 0; // both unknown — preserve natural auto/custom order
    });
  }, [autoConfigs, customization]);

  /** For each visible config: resolved title, subtitle, and the top-10
   *  ratings that match its predicate. Filters out empty slices. */
  const visibleLists = useMemo(() => {
    return visibleConfigs
      .map((config) => {
        const matching = ratings.filter(topListPredicate(config));
        const items = [...matching]
          .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
          .slice(0, 10);
        const total = matching.length;
        const avg = total > 0 ? matching.reduce((s, r) => s + (Number(r.score) || 0), 0) / total : 0;
        return { config, items, total, avg };
      })
      .filter(({ items }) => items.length > 0);
  }, [ratings, visibleConfigs]);

  /** Categories the user can still add to the strip set — every value
   *  with MIN_LIST_SIZE+ ratings that isn't already on screen. */
  const addableByCategory = useMemo(() => {
    const visibleKeys = new Set(visibleConfigs.map(topListKey));
    const buildFromMap = (
      m: Map<string, number>,
      type: 'cuisine' | 'city' | 'price' | 'tag',
    ) => Array.from(m.entries())
      .filter(([, n]) => n >= MIN_LIST_SIZE)
      .map(([value, count]) => ({ config: { type, value } as TopListConfig, label: value, count }))
      .filter(({ config }) => !visibleKeys.has(topListKey(config)))
      .sort((a, b) => b.count - a.count);

    const status: Array<{ config: TopListConfig; label: string; count: number }> = [];
    if (categoryCounts.wouldReturn >= MIN_LIST_SIZE && !visibleKeys.has('wouldReturn')) {
      status.push({ config: { type: 'wouldReturn' }, label: 'Would return', count: categoryCounts.wouldReturn });
    }
    // Overall is always present in autoConfigs unless explicitly hidden;
    // expose it from the editor too so a hidden overall can be restored.
    if (!visibleKeys.has('overall') && ratings.length >= MIN_LIST_SIZE) {
      status.unshift({ config: { type: 'overall' }, label: 'All-time overall', count: ratings.length });
    }

    return {
      cuisine: buildFromMap(categoryCounts.cuisine, 'cuisine'),
      city: buildFromMap(categoryCounts.city, 'city'),
      price: buildFromMap(categoryCounts.price, 'price'),
      tag: buildFromMap(categoryCounts.tag, 'tag'),
      status,
    };
  }, [categoryCounts, visibleConfigs, ratings.length]);

  const deleteList = (c: TopListConfig) => {
    const key = topListKey(c);
    const isAuto = autoConfigs.some((a) => topListKey(a) === key);
    setCustomization((prev) => ({
      hidden: isAuto && !prev.hidden.includes(key) ? [...prev.hidden, key] : prev.hidden,
      custom: prev.custom.filter((cc) => topListKey(cc) !== key),
      order: prev.order.filter((k) => k !== key),
    }));
  };

  const addList = (c: TopListConfig) => {
    const key = topListKey(c);
    const isAuto = autoConfigs.some((a) => topListKey(a) === key);
    setCustomization((prev) => ({
      hidden: prev.hidden.filter((h) => h !== key), // un-hide if it was hidden
      custom: isAuto || prev.custom.some((cc) => topListKey(cc) === key)
        ? prev.custom
        : [...prev.custom, c],
      order: prev.order,
    }));
  };

  /** Persist a drag-induced reorder. We store every visible key so
   *  future renders don't fall back to the natural order for some
   *  lists and the user's order for others. */
  const reorderLists = (configs: TopListConfig[]) => {
    const nextOrder = configs.map(topListKey);
    setCustomization((prev) => ({ ...prev, order: nextOrder }));
  };

  const recentRatings = useMemo(() => {
    return [...ratings].sort((a, b) => ratingRecencyIso(b).localeCompare(ratingRecencyIso(a))).slice(0, 6);
  }, [ratings]);

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const maxCuisine = cuisineStats[0]?.[1] || 1;

  return (
    <div className="pb-32 min-h-screen bg-surface">
      {/* Mirror the mobile Discover header — Create shortcut on the
          left, centered logo, messages/Circle cluster on the right.
          Hidden on desktop where the sidebar layout owns the chrome. */}
      {!isDesktop && (
        <TopBar
          centerLogo={phoneMode}
          leftAction={phoneMode ? (
            <button
              type="button"
              onClick={() => navigate('/create')}
              aria-label="Create"
              className="w-10 h-10 rounded-full bg-on-surface/5 hover:bg-on-surface/10 flex items-center justify-center text-on-surface/80 transition-colors"
            >
              <Plus size={20} />
            </button>
          ) : undefined}
        />
      )}

      {/* Center + cap the content column on desktop so the page mirrors the
          public profile (UserProfile) instead of stretching edge-to-edge in
          the sidebar layout. A no-op on narrow / phone viewports, where the
          content is already slimmer than the cap. */}
      <div className="mx-auto w-full max-w-[1280px]">

      {pendingRequestCount > 0 && !friendReqDismissed && (
        <div className="mx-5 mt-4">
          {/* Tap anywhere to view & respond in the Circle requests section. */}
          <div
            role="button"
            tabIndex={0}
            onClick={() => navigate('/circle')}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/circle'); } }}
            className="group flex items-center gap-3 pl-3 pr-2.5 py-2.5 rounded-2xl bg-on-surface/[0.04] hover:bg-on-surface/[0.07] border border-on-surface/[0.06] cursor-pointer transition-colors"
          >
            <span className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/12 grid place-items-center text-primary">
              <UserPlus size={16} strokeWidth={2.2} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-semibold text-on-surface leading-tight">
                {pendingRequestCount} friend request{pendingRequestCount !== 1 ? 's' : ''}
              </p>
              <p className="text-[12px] text-on-surface/50 leading-tight mt-0.5">
                Tap to view and respond
              </p>
            </div>
            <ChevronRight size={17} className="flex-shrink-0 text-on-surface/30 group-hover:text-on-surface/55 transition-colors" />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setFriendReqDismissed(true); }}
              aria-label="Dismiss"
              className="flex-shrink-0 w-7 h-7 rounded-full grid place-items-center text-on-surface/35 hover:text-on-surface/70 hover:bg-on-surface/[0.06] transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── Profile header ────────────────────────────────────────────── */}
      <div className="px-5 pt-4 pb-3">
        {/* Avatar + horizontal stats row */}
        <div className="flex items-center gap-5">
          <div className="relative flex-shrink-0">
            <div className="w-[92px] h-[92px] rounded-full bg-gradient-to-br from-primary/30 to-primary/15 flex items-center justify-center">
              <span className="text-[42px] font-serif font-bold text-primary leading-none">{displayName.charAt(0).toUpperCase()}</span>
            </div>
            {profile?.is_verified && (
              <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-surface ring-[3px] ring-surface flex items-center justify-center">
                <VerifiedBadge size={24} />
              </div>
            )}
          </div>

          <div className="flex-1 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => setStatPopup('rated')} className="flex flex-col items-center text-center group">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums group-hover:text-primary transition-colors">{ratings.length}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">rated</span>
            </button>
            <button type="button" onClick={() => setStatPopup('followers')} className="flex flex-col items-center text-center group">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums group-hover:text-primary transition-colors">{followers}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">followers</span>
            </button>
            <button type="button" onClick={() => setStatPopup('following')} className="flex flex-col items-center text-center group">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums group-hover:text-primary transition-colors">{following}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">following</span>
            </button>
          </div>
        </div>

        {/* Name + handle */}
        <div className="mt-5 flex items-baseline gap-2 flex-wrap">
          <h1 className="text-[26px] font-serif font-bold text-on-surface leading-none tracking-tight">{displayName}</h1>
          <span className="text-[15px] text-on-surface/40">@{username}</span>
        </div>

        {/* Public + joined */}
        <div className="flex items-center gap-2 mt-2.5">
          <span className={cn(
            'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border',
            profile?.is_public
              ? 'bg-emerald-50/70 border-emerald-200/60 text-emerald-700'
              : 'bg-on-surface/[0.04] border-on-surface/8 text-on-surface/45',
          )}>
            {profile?.is_public ? <Globe size={11} /> : <EyeOff size={11} />}
            {profile?.is_public ? 'Public' : 'Private'}
          </span>
          {profile?.is_verified && (
            <>
              <span className="text-on-surface/25 text-xs">·</span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/[0.07] border border-primary/20 text-[11px] font-semibold text-primary">
                <VerifiedBadge size={12} />
                Verified{expertPickCount > 0 && ` · ${expertPickCount}`}
              </span>
            </>
          )}
          {memberSince && (
            <>
              <span className="text-on-surface/25 text-xs">·</span>
              <span className="text-[12px] text-on-surface/45">Joined {memberSince}</span>
            </>
          )}
        </div>

        {profile?.is_verified && profile?.verified_status && (
          <p className="text-[13px] font-semibold text-primary/90 mt-2">{profile.verified_status}</p>
        )}

        {bio && <p className="text-[13.5px] text-on-surface/65 mt-3 leading-relaxed">{bio}</p>}

        {/* Action row */}
        <div ref={createWrapRef} className="relative flex items-center gap-2 mt-4">
          {/* Hidden media input for the unified Post entry — outside the
              AnimatePresence menu so it survives the menu closing. */}
          {pickerInput}
          <button
            type="button"
            onClick={() => setCreateMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-10 bg-primary text-white text-[13px] font-bold hover:bg-primary/90 transition-colors",
              phoneMode ? "flex-1 rounded-xl" : "rounded-full px-5",
            )}
          >
            <Plus
              size={15}
              strokeWidth={2.5}
              className={cn('transition-transform duration-200', createMenuOpen && 'rotate-45')}
            />
            Create
          </button>
          <button
            type="button"
            onClick={openEditProfile}
            className={cn(
              "inline-flex items-center justify-center gap-1.5 h-10 text-[13px] font-bold transition-colors",
              phoneMode
                ? "flex-1 rounded-xl bg-on-surface/[0.06] text-on-surface/80 border border-on-surface/8 hover:bg-on-surface/10"
                : "rounded-full px-5 bg-white text-on-surface/80 border border-on-surface/[0.08] shadow-sm hover:bg-on-surface/[0.03]",
            )}
          >
            <SquarePen size={14} />
            {phoneMode ? 'Edit' : 'Edit profile'}
          </button>
          <Link
            to={publicProfilePath}
            className={cn(
              "w-10 h-10 inline-flex items-center justify-center text-on-surface/55 transition-colors",
              phoneMode
                ? "rounded-xl bg-on-surface/[0.06] border border-on-surface/8 hover:bg-on-surface/10"
                : "rounded-full bg-white border border-on-surface/[0.08] shadow-sm hover:bg-on-surface/[0.03]",
            )}
            aria-label="View public profile"
          >
            <Upload size={15} />
          </Link>
          <button
            type="button"
            onClick={openSettings}
            className={cn(
              "w-10 h-10 inline-flex items-center justify-center text-on-surface/55 transition-colors",
              phoneMode
                ? "rounded-xl bg-on-surface/[0.06] border border-on-surface/8 hover:bg-on-surface/10"
                : "rounded-full bg-white border border-on-surface/[0.08] shadow-sm hover:bg-on-surface/[0.03]",
            )}
            aria-label="Settings"
          >
            <Settings size={15} />
          </button>

          <AnimatePresence>
            {createMenuOpen && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="absolute left-0 top-[calc(100%+0.25rem)] w-52 z-30 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-xl overflow-hidden"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setCreateMenuOpen(false); openUnifiedPicker(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <ImageIcon size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold leading-tight">Post</span>
                    <span className="block text-[11px] text-on-surface/50 leading-tight">Photos or a video — one video posts as a reel</span>
                  </span>
                </button>
                <div className="border-t border-on-surface/[0.06]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setCreateMenuOpen(false); openGuideCreator(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <BookOpen size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold leading-tight">Guide</span>
                    <span className="block text-[11px] text-on-surface/50 leading-tight">Curated restaurants or recipes</span>
                  </span>
                </button>
                <div className="border-t border-on-surface/[0.06]" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setCreateMenuOpen(false); listsCtx.openHomeMealModal(); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                >
                  <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <ChefHat size={16} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-bold leading-tight">Recipe</span>
                    <span className="block text-[11px] text-on-surface/50 leading-tight">Cook from home — ingredients &amp; steps</span>
                  </span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Tab bar ───────────────────────────────────────────────────── */}
      <div className="border-t border-on-surface/[0.08]">
        <div className="grid grid-cols-5">
          {([
            ['top', Star, 'TOP'],
            ['posts', LayoutGrid, 'POSTS'],
            ['reels', Film, 'REELS'],
            ['guides', BookOpen, 'GUIDES'],
            ['rated', ListIcon, 'RATED'],
          ] as const).map(([key, Icon, label]) => {
            const isActive = activeTab === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'relative py-3.5 flex flex-col items-center justify-center gap-1.5 transition-colors',
                  isActive ? 'text-on-surface' : 'text-on-surface/30',
                )}
              >
                <Icon size={18} className={cn(isActive && key === 'top' && 'fill-on-surface')} />
                <span className={cn(
                  'text-[10px] font-bold tracking-[0.18em]',
                  isActive ? 'text-on-surface' : 'text-on-surface/40',
                )}>
                  {label}
                </span>
                {isActive && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-[2px] rounded-full bg-on-surface" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <main className="px-5 pt-3">
        {activeTab === 'top' && (
          ratings.length === 0 ? (
            <EmptyTabState
              icon={<Star size={32} className="text-on-surface/15" />}
              title="No rated restaurants yet"
              subtitle="Rate restaurants to see your top picks here."
              ctaLabel="Open map"
              onCta={() => navigate('/')}
            />
          ) : !isDesktop ? (
            // Full-bleed strips: negative margin cancels the `main` pad
            // so cards run edge-to-edge during horizontal scroll.
            <div className="-mx-5 space-y-3">
              {visibleLists.map(({ config, items, total, avg }) => (
                <Top10Section
                  key={topListKey(config)}
                  name={topListLabel(config)}
                  total={total}
                  avg={avg}
                  onSeeAll={goToMyRatings}
                >
                  {items.map((r, i) => (
                    <TopRatedCard
                      key={r.restaurantId}
                      rank={i + 1}
                      rating={r}
                      metaText={topListMetaText(config, r)}
                    />
                  ))}
                </Top10Section>
              ))}

              {/* Edit top lists — opens the customization sheet. */}
              <div className="px-5">
                <button
                  type="button"
                  onClick={() => setEditListsOpen(true)}
                  className="w-full inline-flex items-center justify-center gap-2 h-11 rounded-2xl bg-on-surface/[0.04] border border-on-surface/[0.08] text-on-surface/70 text-[13px] font-semibold hover:bg-on-surface/[0.07] hover:border-on-surface/[0.15] transition-colors"
                >
                  <Pencil size={14} />
                  Edit top lists
                </button>
              </div>

              {/* Recommended guides — real public guides from the community. */}
              {recommendedGuides.length > 0 && (
                <section>
                  <div className="px-5 flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0">
                      <h3 className="font-serif font-bold text-on-surface text-[20px] leading-tight">Recommended guides</h3>
                      <p className="text-[12.5px] text-on-surface/45 mt-0.5">Fresh from the community</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/discover')}
                      className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-on-surface/65 hover:text-on-surface mt-1 flex-shrink-0"
                    >
                      Explore <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className="flex gap-4 overflow-x-auto px-5 pb-2 scrollbar-hide snap-x snap-mandatory">
                    {recommendedGuides.map((g) => (
                      <GuideCard key={g.id} guide={g} />
                    ))}
                  </div>
                </section>
              )}
            </div>
          ) : (() => {
            // ── Desktop "Top lists" — category rail + featured hero + rows ──
            const overallList = visibleLists.find((l) => l.config.type === 'overall') ?? visibleLists[0];
            const activeFilter = topListFilter !== 'all' && visibleLists.some((l) => topListKey(l.config) === topListFilter)
              ? topListFilter
              : 'all';
            const scopeList = activeFilter === 'all'
              ? overallList
              : (visibleLists.find((l) => topListKey(l.config) === activeFilter) ?? overallList);
            const featured = scopeList?.items[0];
            const sections = activeFilter === 'all'
              ? visibleLists
              : visibleLists.filter((l) => topListKey(l.config) === activeFilter);
            return (
              <div className="flex gap-7 items-start pb-12">
                {/* Category rail */}
                <aside className="w-[240px] flex-shrink-0 self-start sticky top-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/40 px-3 mb-3">Top lists</p>
                  <button
                    type="button"
                    onClick={() => setTopListFilter('all')}
                    className={cn(
                      'w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-left transition-colors',
                      activeFilter === 'all' ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]' : 'hover:bg-on-surface/[0.04]',
                    )}
                  >
                    <span className="font-bold text-[14px] text-on-surface">All categories</span>
                    <span className="ml-auto text-[12px] font-semibold text-on-surface/35 tabular-nums">{visibleLists.length}</span>
                  </button>
                  <div className="mt-1.5 space-y-0.5">
                    {visibleLists.map(({ config, total, avg }) => {
                      const key = topListKey(config);
                      const active = activeFilter === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setTopListFilter(key)}
                          className={cn(
                            'w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-left transition-colors',
                            active ? 'bg-white shadow-[0_1px_3px_rgba(0,0,0,0.06)]' : 'hover:bg-on-surface/[0.04]',
                          )}
                        >
                          <span className={cn('text-[14px] truncate', active ? 'font-bold text-on-surface' : 'font-semibold text-on-surface/75')}>
                            {topListLabel(config)}
                          </span>
                          <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                            <span className="text-[12px] font-semibold text-on-surface/30 tabular-nums">{total}</span>
                            <span className={cn('px-1.5 py-0.5 rounded-md border text-[12px] font-bold tabular-nums', scoreBadgeBg(avg), scoreColor(avg))}>
                              {avg.toFixed(1)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditListsOpen(true)}
                    className="mt-3 w-full inline-flex items-center justify-center gap-2 h-10 rounded-xl border border-dashed border-on-surface/15 text-on-surface/55 text-[13px] font-semibold hover:bg-on-surface/[0.04] hover:text-on-surface/75 transition-colors"
                  >
                    <Pencil size={14} />
                    Edit top lists
                  </button>
                </aside>

                {/* Main column */}
                <div className="flex-1 min-w-0 space-y-8">
                  {featured && scopeList && (
                    <FeaturedTopCard rating={featured} scopeLabel={topListLabel(scopeList.config)} />
                  )}

                  {sections.map(({ config, items, total, avg }) => (
                    <DesktopTopSection
                      key={topListKey(config)}
                      name={topListLabel(config)}
                      total={total}
                      avg={avg}
                      onSeeAll={goToMyRatings}
                    >
                      {items.map((r, i) => (
                        <DesktopRankCard
                          key={r.restaurantId}
                          rank={i + 1}
                          rating={r}
                          metaText={topListMetaText(config, r)}
                        />
                      ))}
                    </DesktopTopSection>
                  ))}

                  {/* Recommended guides — real public guides from the community. */}
                  {recommendedGuides.length > 0 && (
                    <section>
                      <div className="flex items-start justify-between gap-3 mb-4">
                        <div className="min-w-0">
                          <h3 className="font-serif font-bold text-on-surface text-[26px] leading-tight">Recommended guides</h3>
                          <p className="text-[13px] text-on-surface/45 mt-0.5">Fresh from the community</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => navigate('/discover')}
                          className="inline-flex items-center gap-0.5 text-[13px] font-semibold text-primary hover:text-primary/80 mt-1 flex-shrink-0"
                        >
                          Explore <ChevronRight size={14} />
                        </button>
                      </div>
                      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x">
                        {recommendedGuides.map((g) => (
                          <GuideCard key={g.id} guide={g} />
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              </div>
            );
          })()
        )}

        {activeTab === 'posts' && (
          myPosts.length === 0 ? (
            <EmptyTabState
              icon={<LayoutGrid size={32} className="text-on-surface/15" />}
              title="No posts yet"
              subtitle="Share photos and videos from your favorite spots."
              ctaLabel="Create a post"
              onCta={() => openAddPostModal()}
            />
          ) : (
            <ProfilePostsSection
              posts={myPosts}
              isOwn
              onEdit={(id) => openEditPostModal(id)}
              onDelete={(id) => setConfirmDeletePostId(id)}
              onToggleVisibility={(id, next) => setPostVisibility(id, next)}
              hideHeader
            />
          )
        )}

        {activeTab === 'reels' && (
          myReels.length === 0 ? (
            <EmptyTabState
              icon={<Film size={32} className="text-on-surface/15" />}
              title="No reels yet"
              subtitle="Share short videos of your favorite places and recipes."
              ctaLabel="Create a reel"
              onCta={() => openAddReelModal()}
            />
          ) : (
            <ProfileReelsSection
              reels={myReels}
              isOwn
              onEdit={(id) => openEditReelModal(id)}
              onDelete={(id) => setConfirmDeleteReelId(id)}
              onToggleVisibility={(id, next) => setReelVisibility(id, next)}
              hideHeader
            />
          )
        )}

        {activeTab === 'guides' && (
          visibleGuides.length === 0 ? (
            <EmptyTabState
              icon={<BookOpen size={32} className="text-on-surface/15" />}
              title="No guides yet"
              subtitle="Curate a list of places or recipes worth sharing."
              ctaLabel="Create a guide"
              onCta={() => openGuideCreator()}
            />
          ) : (
            <ProfileGuidesSection
              guides={visibleGuides}
              isOwn
              onEdit={(guide) => openGuideCreator(guide)}
              onDelete={(id) => setConfirmDeleteGuideId(id)}
              onToggleVisibility={onToggleGuideVisibility}
              hideHeader
            />
          )
        )}

        {activeTab === 'rated' && (
          ratings.length === 0 ? (
            <EmptyTabState
              icon={<ListIcon size={32} className="text-on-surface/15" />}
              title="No ratings yet"
              subtitle="Rate restaurants to see your cuisine breakdown and history."
              ctaLabel="Open map"
              onCta={() => navigate('/')}
            />
          ) : (
            <div className="space-y-4">
              {cuisineStats.length > 0 && (
                <section>
                  <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45 mb-4">Cuisine breakdown</h3>
                  <div className="space-y-3.5">
                    {cuisineStats.map(([name, count]) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="text-[13px] font-medium text-on-surface/75 w-24 truncate">{name}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-on-surface/[0.06] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary/70"
                            style={{ width: `${Math.max(8, (count / maxCuisine) * 100)}%` }}
                          />
                        </div>
                        <span className="text-[12px] text-on-surface/40 tabular-nums w-6 text-right">{count}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {recentRatings.length > 0 && (
                <section>
                  <div className="flex items-baseline justify-between mb-2">
                    <h3 className="text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Recent</h3>
                    <button
                      type="button"
                      onClick={goToMyRatings}
                      className="inline-flex items-center gap-0.5 text-[12px] font-semibold text-on-surface/55 hover:text-on-surface"
                    >
                      See all <ChevronRight size={12} />
                    </button>
                  </div>
                  <ul className="divide-y divide-on-surface/[0.06]">
                    {recentRatings.map((r) => (
                      <li key={r.restaurantId}>
                        <Link
                          to={`/restaurant/${r.restaurantId}`}
                          className="flex items-center gap-3.5 py-3 group"
                        >
                          <div className="w-11 h-11 rounded-xl bg-on-surface/[0.05] overflow-hidden flex-shrink-0 flex items-center justify-center">
                            {r.image ? (
                              <img src={r.image} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <MapPin size={15} className="text-on-surface/30" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-serif font-bold truncate leading-tight">{r.name}</p>
                            <p className="text-[11.5px] text-on-surface/45 mt-0.5">
                              {r.visitDate
                                ? new Date(r.visitDate.length === 10 ? `${r.visitDate}T12:00:00` : r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : ''}
                              {r.cuisine && `${r.visitDate ? ' · ' : ''}${r.cuisine}`}
                            </p>
                          </div>
                          <ScoreBadge rating={numericScore(r.score)} size="sm" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )
        )}
      </main>
      </div>

      <EditTopListsSheet
        open={editListsOpen}
        onClose={() => setEditListsOpen(false)}
        visibleLists={visibleConfigs}
        addableByCategory={addableByCategory}
        onDelete={deleteList}
        onAdd={addList}
        onReorder={reorderLists}
      />

      {/* Delete-reel / Delete-post confirmations. Both call into their
          respective contexts and clean up storage objects. */}
      <AnimatePresence>
        {confirmDeleteReelId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[80] flex items-center justify-center px-6"
            onClick={() => { if (!deletingReel) setConfirmDeleteReelId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-on-surface text-lg">Delete reel?</h4>
              <p className="text-sm text-on-surface/55 mt-1">This permanently removes the video and all of its likes, saves, and comments. It can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeleteReelId(null)} disabled={deletingReel} className="flex-1 h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold hover:bg-on-surface/[0.1] disabled:opacity-40">Cancel</button>
                <button type="button" onClick={onConfirmDeleteReel} disabled={deletingReel} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-60">{deletingReel ? 'Deleting…' : 'Delete'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {confirmDeletePostId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[80] flex items-center justify-center px-6"
            onClick={() => { if (!deletingPost) setConfirmDeletePostId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-on-surface text-lg">Delete post?</h4>
              <p className="text-sm text-on-surface/55 mt-1">This permanently removes every photo / video and the comments. It can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeletePostId(null)} disabled={deletingPost} className="flex-1 h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold hover:bg-on-surface/[0.1] disabled:opacity-40">Cancel</button>
                <button type="button" onClick={onConfirmDeletePost} disabled={deletingPost} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-60">{deletingPost ? 'Deleting…' : 'Delete'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
        {confirmDeleteGuideId && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/55 backdrop-blur-sm z-[80] flex items-center justify-center px-6"
            onClick={() => { if (!deletingGuide) setConfirmDeleteGuideId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-surface rounded-3xl p-6 max-w-xs w-full text-center"
            >
              <h4 className="font-serif font-bold text-on-surface text-lg">Delete guide?</h4>
              <p className="text-sm text-on-surface/55 mt-1">This permanently removes the guide and all its entries. It can't be undone.</p>
              <div className="flex gap-2 mt-5">
                <button type="button" onClick={() => setConfirmDeleteGuideId(null)} disabled={deletingGuide} className="flex-1 h-11 rounded-full bg-on-surface/[0.06] text-on-surface text-sm font-bold hover:bg-on-surface/[0.1] disabled:opacity-40">Cancel</button>
                <button type="button" onClick={onConfirmDeleteGuide} disabled={deletingGuide} className="flex-1 h-11 rounded-full bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 disabled:opacity-60">{deletingGuide ? 'Deleting…' : 'Delete'}</button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings — desktop: centered modal card. Phone: bottom sheet
          with drag-to-dismiss. Three sub-pages (main / edit / account)
          slide in and out within the same shell. */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: phoneMode ? 0.18 : 0.16 }}
            className={cn(
              'fixed inset-0 z-[60]',
              phoneMode
                ? 'bg-black/45 backdrop-blur-sm'
                : 'bg-black/55 backdrop-blur-md flex items-center justify-center px-4',
            )}
            onClick={() => setSettingsOpen(false)}
          >
            <motion.div
              {...(phoneMode
                ? {
                    initial: { y: '100%' },
                    animate: { y: 0 },
                    exit: { y: '100%' },
                    transition: { type: 'spring' as const, damping: 28, stiffness: 300 },
                    ...settingsDrag.dragProps,
                  }
                : {
                    initial: { opacity: 0, scale: 0.95, y: -10 },
                    animate: { opacity: 1, scale: 1, y: 0 },
                    exit: { opacity: 0, scale: 0.97, y: -6 },
                    transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] as const },
                  })}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
              className={cn(
                'bg-surface flex flex-col overflow-hidden',
                phoneMode
                  ? 'fixed inset-x-0 bottom-0 rounded-t-[28px] max-h-[88vh]'
                  : 'w-full max-w-[480px] max-h-[86vh] rounded-[28px] shadow-[0_30px_80px_-16px_rgba(0,0,0,0.45)] ring-1 ring-on-surface/[0.06]',
              )}
            >
              {phoneMode && (
                <div
                  className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing"
                  onPointerDown={settingsDrag.startDrag}
                >
                  <div className="w-10 h-1 rounded-full bg-on-surface/15" />
                </div>
              )}
              <AnimatePresence mode="wait">
                {settingsPage === 'main' && (
                  <motion.div
                    key="main"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className={cn(
                      'flex items-center justify-between flex-shrink-0',
                      phoneMode ? 'px-6 pt-3 pb-4' : 'px-7 pt-6 pb-4',
                    )}>
                      <div>
                        <h3 className="font-serif font-bold text-[22px] leading-none">Settings</h3>
                        <p className="text-[11.5px] text-on-surface/45 mt-1.5">Manage your profile and preferences.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(false)}
                        aria-label="Close"
                        className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 transition-colors flex items-center justify-center -mr-1"
                      >
                        <X size={16} className="text-on-surface/65" />
                      </button>
                    </div>
                    <div className={cn(
                      'flex-1 overflow-y-auto',
                      phoneMode ? 'px-5 pb-5' : 'px-5 pb-6',
                    )}>
                      <SettingsSection label="Profile">
                        <SettingsRow
                          icon={<Sparkles size={17} />}
                          label="Your Activity"
                          hint="Saves, likes, and comments"
                          onClick={() => { setSettingsOpen(false); navigate('/activity'); }}
                        />
                        <SettingsRow
                          icon={<Edit3 size={17} />}
                          label="Edit Profile"
                          hint="Name, username, bio, home city"
                          onClick={() => { resetEditFields(); setSettingsPage('edit'); }}
                        />
                        <SettingsRow
                          icon={<Lock size={17} />}
                          label="Account"
                          hint="Email, password, delete account"
                          onClick={() => {
                            setSettingsPage('account');
                            setAccountMsg('');
                            setAccountError('');
                            setDeleteStep(0);
                          }}
                          isLast
                        />
                      </SettingsSection>

                      <SettingsSection label="Preferences">
                        <SettingsRow
                          icon={profile?.is_public ? <Globe size={17} /> : <Lock size={17} />}
                          label="Private Account"
                          hint={profile?.is_verified
                            ? 'Verified accounts are always public'
                            : profile?.is_public ? 'Anyone can see your profile' : 'Only approved followers'}
                          toggle
                          toggleValue={!profile?.is_public}
                          onClick={async () => {
                            if (!user?.id || !profile) return;
                            // The DB trigger enforces this too — the toggle
                            // just explains instead of silently snapping back.
                            if (profile.is_verified) return;
                            const newVal = !profile.is_public;
                            await saveProfile(user.id, profile.display_name, profile.username, profile.bio, newVal);
                            await refreshProfile();
                          }}
                        />
                        <SettingsRow
                          icon={darkMode ? <Moon size={17} /> : <Sun size={17} />}
                          label="Dark Mode"
                          hint={darkMode ? 'On — dark surface' : 'Off — light cream surface'}
                          toggle
                          toggleValue={darkMode}
                          onClick={toggleDarkMode}
                          isLast
                        />
                      </SettingsSection>

                      {isAdmin && (
                        <SettingsSection label="Admin">
                          <SettingsRow
                            icon={<BadgeCheck size={17} />}
                            label="Verification requests"
                            hint="Review and approve applications"
                            onClick={() => { setSettingsOpen(false); navigate('/admin/verification'); }}
                            isLast
                          />
                        </SettingsSection>
                      )}

                      {listsCtx.pendingPhotoUploadCount > 0 && (
                        <SettingsSection label="Sync">
                          <SettingsRow
                            icon={<UploadCloud size={17} />}
                            label={`${listsCtx.pendingPhotoUploadCount} photo${listsCtx.pendingPhotoUploadCount === 1 ? '' : 's'} waiting to upload`}
                            hint="Kept on this device until back online — tap to retry now"
                            onClick={listsCtx.retryPendingPhotoUploads}
                            isLast
                          />
                        </SettingsSection>
                      )}

                      <SettingsSection label="About">
                        <SettingsRow
                          icon={<Shield size={17} />}
                          label="Privacy Policy"
                          hint="How your data is collected and used"
                          onClick={() => openExternalUrl(PRIVACY_URL)}
                        />
                        <SettingsRow
                          icon={<LifeBuoy size={17} />}
                          label="Support"
                          hint="Get help or contact us"
                          onClick={() => openExternalUrl(SUPPORT_URL)}
                          isLast
                        />
                      </SettingsSection>

                      <button
                        type="button"
                        onClick={() => { setSettingsOpen(false); signOut(); }}
                        className="mt-5 w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-red-50 hover:bg-red-100 text-red-600 text-[14px] font-semibold transition-colors"
                      >
                        <LogOut size={15} />
                        Sign out
                      </button>
                    </div>
                  </motion.div>
                )}
                {settingsPage === 'edit' && (
                  <motion.div
                    key="edit"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className={cn(
                      'flex items-center justify-between flex-shrink-0',
                      phoneMode ? 'px-5 pt-3 pb-3' : 'px-6 pt-6 pb-3',
                    )}>
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => setSettingsPage('main')}
                          aria-label="Back"
                          className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 transition-colors flex items-center justify-center text-on-surface/65 -ml-1"
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <h3 className="font-serif font-bold text-[20px] leading-none">Edit Profile</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(false)}
                        aria-label="Close"
                        className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 transition-colors flex items-center justify-center text-on-surface/65 -mr-1"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Display Name</p>
                        <div className="relative">
                          <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Username</p>
                        <div className="relative">
                          <AtSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="text"
                            value={editUsername}
                            onChange={(e) => setEditUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                            autoCapitalize="off"
                          />
                        </div>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Bio</p>
                        <div className="relative">
                          <FileText size={16} className="absolute left-3 top-3 text-on-surface/30" />
                          <textarea
                            value={editBio}
                            onChange={(e) => setEditBio(e.target.value)}
                            rows={3}
                            maxLength={150}
                            placeholder="Tell people about yourself..."
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                          />
                        </div>
                        <p className="text-[11px] text-on-surface/40 text-right mt-1 tabular-nums">{editBio.length}/150 characters</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">
                          Home city
                          {profile?.is_verified && (
                            <span className="ml-1.5 text-primary normal-case font-semibold tracking-normal">· recommended for verified users</span>
                          )}
                        </p>
                        <div className="relative">
                          <MapPin size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="text"
                            value={editHomeCity}
                            onChange={(e) => setEditHomeCity(e.target.value)}
                            placeholder="e.g. Westport, CT"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                            autoCapitalize="words"
                            autoCorrect="off"
                          />
                        </div>
                        <p className="text-[11px] text-on-surface/40 mt-1">
                          Where you're based. Shown on your profile and helps surface you to people exploring your area.
                        </p>
                      </div>
                      {editError && <p className="text-xs text-red-500">{editError}</p>}
                      {editSuccess && (
                        <div className="flex items-center gap-1.5 text-green-600">
                          <Check size={14} />
                          <span className="text-xs font-semibold">Saved!</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={handleSaveProfile}
                        disabled={editSaving}
                        className="w-full py-3 bg-primary text-white rounded-2xl text-sm font-semibold disabled:opacity-60"
                      >
                        {editSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </motion.div>
                )}
                {settingsPage === 'account' && (
                  <motion.div
                    key="account"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="flex flex-col flex-1 overflow-hidden"
                  >
                    <div className={cn(
                      'flex items-center justify-between flex-shrink-0',
                      phoneMode ? 'px-5 pt-3 pb-3' : 'px-6 pt-6 pb-3',
                    )}>
                      <div className="flex items-center gap-2 min-w-0">
                        <button
                          type="button"
                          onClick={() => setSettingsPage('main')}
                          aria-label="Back"
                          className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 transition-colors flex items-center justify-center text-on-surface/65 -ml-1"
                        >
                          <ArrowLeft size={16} />
                        </button>
                        <h3 className="font-serif font-bold text-[20px] leading-none">Account</h3>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSettingsOpen(false)}
                        aria-label="Close"
                        className="w-9 h-9 rounded-full bg-on-surface/[0.05] hover:bg-on-surface/10 transition-colors flex items-center justify-center text-on-surface/65 -mr-1"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
                      <div className="bg-on-surface/3 rounded-xl px-3 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/35 mb-0.5">Current Email</p>
                        <p className="text-sm font-medium text-on-surface/70">{user?.email}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Change Email</p>
                        <div className="relative mb-2">
                          <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="email"
                            value={newEmail}
                            onChange={(e) => setNewEmail(e.target.value)}
                            placeholder="New email"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleUpdateEmail}
                          disabled={!newEmail.trim()}
                          className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                        >
                          Update Email
                        </button>
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Change Password</p>
                        <div className="relative mb-2">
                          <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/30" />
                          <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="New password (min 6)"
                            className="w-full bg-on-surface/5 rounded-xl py-2.5 pl-9 pr-4 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={handleUpdatePassword}
                          disabled={newPassword.length < 6}
                          className="w-full py-2.5 bg-primary text-white rounded-xl text-xs font-semibold disabled:opacity-40"
                        >
                          Update Password
                        </button>
                      </div>
                      {accountMsg && (
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-green-50 border border-green-200 rounded-xl">
                          <Check size={14} className="text-green-600" />
                          <span className="text-xs text-green-700">{accountMsg}</span>
                        </div>
                      )}
                      {accountError && (
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
                          <AlertTriangle size={14} className="text-red-500" />
                          <span className="text-xs text-red-600">{accountError}</span>
                        </div>
                      )}
                      {/* ── Verification ── */}
                      <div className="border-t border-on-surface/6 pt-4">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface/40 mb-1.5">Verification</p>
                        {profile?.is_verified ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 px-1">
                              <VerifiedBadge size={15} />
                              <p className="text-sm font-medium text-on-surface/75">You're verified</p>
                            </div>
                            <p className="text-[11px] text-on-surface/45 px-1 -mt-1">Your public status line, shown on your profile:</p>
                            <VerifiedStatusPicker
                              userId={user?.id || ''}
                              initialValue={profile?.verified_status}
                              saveLabel="Save status"
                              onSaved={() => { void refreshProfile(); setAccountMsg('Status updated'); }}
                            />
                          </div>
                        ) : verifReq?.status === 'pending' ? (
                          <div className="bg-on-surface/3 rounded-xl px-3 py-3 flex items-center gap-2.5">
                            <VerifiedBadge size={16} />
                            <div>
                              <p className="text-sm font-medium text-on-surface/75">Application under review</p>
                              <p className="text-[11px] text-on-surface/45 mt-0.5">We'll let you know as soon as it's decided.</p>
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setSettingsOpen(false); navigate('/verify/apply'); }}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl bg-on-surface/3 hover:bg-on-surface/[0.06] transition-colors text-left"
                          >
                            <VerifiedBadge size={16} />
                            <span className="flex-1 min-w-0">
                              <span className="block text-sm font-medium text-on-surface/80">Request a verified badge</span>
                              <span className="block text-[11px] text-on-surface/45 mt-0.5">For chefs, critics, and creators</span>
                            </span>
                            <ChevronRight size={14} className="text-on-surface/30 flex-shrink-0" />
                          </button>
                        )}
                      </div>

                      <div className="border-t border-on-surface/6 pt-4">
                        {deleteStep === 0 && (
                          <button
                            type="button"
                            onClick={() => setDeleteStep(1)}
                            className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-red-50 transition-colors text-left"
                          >
                            <Trash2 size={16} className="text-red-400" />
                            <span className="text-sm font-medium text-red-500">Delete Account</span>
                          </button>
                        )}
                        {deleteStep === 1 && (
                          <div className="bg-red-50 border border-red-200 rounded-xl p-3 space-y-2">
                            <p className="text-xs text-red-600 font-medium">
                              This permanently deletes your account and everything in it —
                              profile, ratings, recipes, posts, reels, guides, photos and
                              friends. There is no way to recover it.
                            </p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDeleteStep(0)}
                                className="flex-1 py-2 border border-on-surface/15 rounded-lg text-xs font-semibold text-on-surface/50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteStep(2)}
                                className="flex-1 py-2 bg-red-500 text-white rounded-lg text-xs font-semibold"
                              >
                                Yes, Continue
                              </button>
                            </div>
                          </div>
                        )}
                        {deleteStep === 2 && (
                          <div className="bg-red-100 border border-red-300 rounded-xl p-3 space-y-2">
                            <p className="text-xs text-red-700 font-bold">FINAL WARNING: This cannot be undone!</p>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => setDeleteStep(0)}
                                disabled={deletingAccount}
                                className="flex-1 py-2 border border-on-surface/15 rounded-lg text-xs font-semibold text-on-surface/50 disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={handleDeleteAccount}
                                disabled={deletingAccount}
                                className="flex-1 py-2 bg-red-700 text-white rounded-lg text-xs font-semibold disabled:opacity-70 flex items-center justify-center gap-1.5"
                              >
                                {deletingAccount ? (
                                  <>
                                    <Loader2 size={12} className="animate-spin" />
                                    Deleting…
                                  </>
                                ) : (
                                  'Delete Forever'
                                )}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ─── Stat popups ─────────────────────────────────────────────
          Bottom sheet on phone/mobile, centered modal on desktop.
          Shows followers / following / rated lists depending on which
          stat the user tapped. */}
      <AnimatePresence>
        {statPopup && (
          <motion.div
            key="profile-stat-popup"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={cn(
              'fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex justify-center',
              isDesktop ? 'items-center px-4' : 'items-end',
            )}
            onClick={() => setStatPopup(null)}
          >
            <motion.div
              initial={isDesktop ? { opacity: 0, y: 12, scale: 0.98 } : { y: '100%' }}
              animate={isDesktop ? { opacity: 1, y: 0, scale: 1 } : { y: 0 }}
              exit={isDesktop ? { opacity: 0, y: 12, scale: 0.98 } : { y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'bg-surface flex flex-col w-full',
                isDesktop
                  ? 'max-w-md rounded-2xl shadow-2xl border border-on-surface/[0.08] max-h-[80vh]'
                  : 'rounded-t-3xl max-h-[85vh]',
              )}
            >
              {!isDesktop && (
                <div className="pt-2 pb-1 flex justify-center">
                  <span className="w-10 h-1 rounded-full bg-on-surface/15" />
                </div>
              )}

              {/* Header */}
              <div className="px-5 pt-4 pb-3 flex items-center justify-between border-b border-on-surface/[0.06]">
                <div className="min-w-0">
                  <h3 className="font-serif font-bold text-[18px] text-on-surface capitalize">
                    {statPopup === 'rated' ? 'Rated' : statPopup}
                  </h3>
                  <p className="text-[11px] text-on-surface/45 mt-0.5 tabular-nums">
                    {statPopup === 'rated'
                      ? `${ratings.length} ${ratings.length === 1 ? 'restaurant' : 'restaurants'}`
                      : statPopup === 'followers'
                        ? `${followers} ${followers === 1 ? 'person' : 'people'}`
                        : `${following} ${following === 1 ? 'person' : 'people'}`}
                  </p>
                </div>
                <button
                  onClick={() => setStatPopup(null)}
                  className="w-8 h-8 rounded-full hover:bg-on-surface/[0.05] flex items-center justify-center text-on-surface/60"
                  aria-label="Close"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto">
                {statPopup === 'rated' ? (
                  ratings.length === 0 ? (
                    <div className="py-14 text-center px-6">
                      <Star size={28} className="text-on-surface/15 mx-auto mb-2" />
                      <p className="text-sm font-semibold text-on-surface/55">No rated restaurants yet</p>
                      <p className="text-xs text-on-surface/35 mt-1">Rate places to see them here.</p>
                    </div>
                  ) : (
                    <ul className="divide-y divide-on-surface/[0.06]">
                      {[...ratings].sort((a, b) => b.score - a.score).map((r) => (
                        <li key={r.restaurantId}>
                          <Link
                            to={`/restaurant/${r.restaurantId}`}
                            onClick={() => setStatPopup(null)}
                            className="flex items-center gap-3 px-5 py-3 hover:bg-on-surface/[0.03] transition-colors"
                          >
                            <div className="w-10 h-10 rounded-xl bg-on-surface/[0.05] overflow-hidden flex-shrink-0 flex items-center justify-center">
                              {r.image ? (
                                <img src={r.image} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                              ) : (
                                <MapPin size={14} className="text-on-surface/30" />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[14px] font-serif font-bold text-on-surface truncate leading-tight">{r.name}</p>
                              <p className="text-[11px] text-on-surface/45 truncate mt-0.5">
                                {[r.cuisine, r.price, r.address?.split(',')[0]?.trim()].filter(Boolean).join(' · ')}
                              </p>
                            </div>
                            <ScoreBadge rating={r.score} size="sm" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )
                ) : popupLoading && !popupPeople ? (
                  // Spinner only when there's nothing cached — a re-open
                  // revalidates behind the kept list instead of flashing.
                  <div className="py-14 flex flex-col items-center text-center">
                    <div className="w-6 h-6 rounded-full border-2 border-on-surface/15 border-t-primary animate-spin" />
                    <p className="text-xs text-on-surface/45 mt-3">Loading…</p>
                  </div>
                ) : !popupPeople || popupPeople.length === 0 ? (
                  <div className="py-14 text-center px-6">
                    <Heart size={28} className="text-on-surface/15 mx-auto mb-2" />
                    <p className="text-sm font-semibold text-on-surface/55">
                      {statPopup === 'followers' ? 'No followers yet' : 'Not following anyone yet'}
                    </p>
                    <p className="text-xs text-on-surface/35 mt-1">
                      {statPopup === 'followers'
                        ? 'When people follow you, they’ll show up here.'
                        : 'Find friends and experts to follow from the Circle page.'}
                    </p>
                  </div>
                ) : (
                  <ul className="divide-y divide-on-surface/[0.06]">
                    {popupPeople.map((p) => (
                      <li key={p.user_id} className="flex items-center pr-3 hover:bg-on-surface/[0.03] transition-colors">
                        <Link
                          to={`/user/${p.username || ''}`}
                          onClick={() => setStatPopup(null)}
                          className="flex items-center gap-3 px-5 py-3 flex-1 min-w-0"
                        >
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <span className="text-[13px] font-serif font-bold text-primary">
                              {(p.display_name?.charAt(0) || p.username?.charAt(0) || '?').toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-semibold text-on-surface truncate leading-tight inline-flex items-center gap-1.5">
                              {p.display_name || p.username || 'User'}
                              {p.is_verified && (
                                <VerifiedBadge size={13} />
                              )}
                            </p>
                            <p className="text-[11px] text-on-surface/45 truncate mt-0.5">@{p.username || 'user'}</p>
                          </div>
                        </Link>
                        {statPopup === 'followers' ? (
                          <button
                            type="button"
                            onClick={() => handleRemoveFollower(p.user_id)}
                            disabled={removingFollower.has(p.user_id)}
                            className="flex-shrink-0 text-[12px] font-semibold px-3 py-1.5 rounded-full border border-on-surface/15 text-on-surface/70 hover:bg-on-surface/[0.06] disabled:opacity-50 transition-colors"
                          >
                            {removingFollower.has(p.user_id) ? 'Removing…' : 'Remove'}
                          </button>
                        ) : (
                          <ChevronRight size={14} className="text-on-surface/25 flex-shrink-0" />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
