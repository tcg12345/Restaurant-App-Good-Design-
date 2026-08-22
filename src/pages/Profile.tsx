import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings, LogOut, X, User, AtSign, Check, ChevronRight, Lock, Loader2, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText,
  Star, MapPin, Globe, EyeOff, Moon, Sun, Film, Plus, UserPlus, Image as ImageIcon, Sparkles,
  LayoutGrid, List as ListIcon, Upload, Pencil, GripVertical, BookOpen, ChefHat, SquarePen,
  Shield, LifeBuoy, BadgeCheck, UploadCloud, Utensils, ArrowUpDown,
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
import { saveProfile, getFollowCounts, getExpertRecommendationCount, getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { getMyGuides, deleteGuide, setGuideVisibility, getGuidesForFeed, type Guide as MyGuide } from '../lib/supabase-guides';
import { deleteAccount, clearLocalAppData } from '../lib/supabase-account';
import { geocodePlace } from '../components/HomeLocationBar';
import { supabase } from '../lib/supabase';
import { cn, parseVisitDate } from '../lib/utils';
import { GlassButton } from '../lib/glass-buttons';
import { getMyLatestVerificationRequest, type VerificationRequest } from '../lib/supabase-verification';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { useUnifiedCreatePicker } from '../components/useUnifiedComposer';
import { VerifiedStatusPicker } from '../components/VerifiedStatusPicker';
import { OwnScoreBadge, ScoreBadge } from '../components/ScoreBadge';
import { scoreColor, scoreTint, scoreSolid } from '../lib/score';
import { useBottomSheet } from '../lib/useBottomSheet';
import { TopListCard } from '../components/TopListCard';
import {
  MIN_LIST_SIZE, cityFromAddress, countCategories, autoTopListConfigs, visibleTopListConfigs,
  buildTopList, loadCustomization, saveCustomization, topListKey,
  topListPlainLabel, topListKindLabel,
  type TopListConfig, type TopListCustomization,
} from '../lib/topLists';
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

/** Human names for the profile columns saveProfile may have to skip, so a
 *  partial save can tell the user exactly what didn't stick. */
const PROFILE_FIELD_LABELS: Record<string, string> = {
  home_city: 'home city', home_lat: 'home city', home_lng: 'home city',
  bio: 'bio', is_public: 'account visibility',
};

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
/* A section opens with a rule and its name in sentence case — the same
   furniture the restaurant page and the home feed use, so the three tab
   roots read as one app rather than three. */
const ProfileRule: React.FC = () => (
  <div className="border-t border-on-surface/[0.14]" aria-hidden />
);

const ProfileHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>
    {children}
  </h2>
);

const EmptyTabState: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  ctaLabel: string;
  onCta: () => void;
}> = ({ icon, title, subtitle, ctaLabel, onCta }) => (
  /* Flush left, like everything else on the page. A dashed box centred in
     the column was the one thing here pretending to be a card, and it
     centred three lines of copy that the rest of the page sets ragged
     right. */
  <div className="pt-14 flex flex-col items-start gap-2.5">
    <span className="w-12 h-12 rounded-full bg-on-surface/[0.06] text-on-surface/45 flex items-center justify-center mb-1.5">
      {icon}
    </span>
    <p className="text-on-surface" style={{ fontSize: '19px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.028em' }}>{title}</p>
    <p className="text-on-surface/55 max-w-[280px]" style={{ fontSize: '14px', lineHeight: 1.55, textWrap: 'pretty' } as React.CSSProperties}>{subtitle}</p>
    <button
      type="button"
      onClick={onCta}
      className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-primary text-white px-[18px] py-[13px] active:opacity-85 transition-opacity"
      style={{ fontSize: '13px', fontWeight: 700 }}
    >
      <Plus size={14} strokeWidth={2.1} />
      {ctaLabel}
    </button>
  </div>
);

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
/** One number on the "at a glance" plinth. Serif and oversized because
 *  three of these ARE the summary — a 13px label with a 13px value reads
 *  as a form field, not a statement. */
const Stat: React.FC<{
  value: string;
  label: string;
  isDesktop: boolean;
  valueClass?: string;
}> = ({ value, label, isDesktop, valueClass }) => (
  <div className={cn('min-w-0 text-center', isDesktop ? 'px-3 py-3.5' : 'px-2 py-3')}>
    <dt className="sr-only">{label}</dt>
    <dd>
      <span className={cn(
        'block font-serif font-bold leading-none tabular-nums',
        isDesktop ? 'text-[26px]' : 'text-[22px]',
        valueClass || 'text-on-surface',
      )}>
        {value}
      </span>
      <span className="mt-1.5 block truncate text-[10.5px] font-bold uppercase tracking-[0.14em] text-on-surface/40">
        {label}
      </span>
    </dd>
  </div>
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

            {/* Header. The count sits in the title rather than in a
                subtitle, so the sheet says what state you are in before it
                says what you can do about it. */}
            <div className={cn(
              'flex flex-shrink-0 items-start justify-between gap-4 border-b border-on-surface/[0.06]',
              phoneMode ? 'px-5 pb-4 pt-3' : 'px-7 pb-5 pt-6',
            )}>
              <div className="min-w-0">
                <h3 className={cn('font-serif font-bold leading-tight text-on-surface', phoneMode ? 'text-[21px]' : 'text-[25px]')}>
                  Top lists
                </h3>
                <p className="mt-1 text-[12.5px] leading-snug text-on-surface/45">
                  {visibleLists.length === 0
                    ? 'Add a slice of your ratings to get started.'
                    : `${visibleLists.length} on your profile. Drag to reorder, or add another slice below.`}
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-on-surface/45 transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
              >
                <X size={17} />
              </button>
            </div>

            <div className={cn('flex-1 overflow-y-auto', phoneMode ? 'px-5 py-5' : 'px-7 py-6')}>
              {/* ── Your lists ──
                  Full rows rather than chips: each carries its kind, its
                  size and its own remove control, which a chip has no room
                  for. Reorder.Group makes any row draggable — the whole
                  row, so touch reorder works without aiming at a handle. */}
              <section>
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">
                  On your profile
                </p>
                {visibleLists.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-on-surface/[0.12] px-4 py-7 text-center">
                    <p className="text-[13px] text-on-surface/45">No lists yet — add one below.</p>
                  </div>
                ) : (
                  <Reorder.Group
                    axis="y"
                    values={visibleLists}
                    onReorder={onReorder}
                    className="space-y-1.5"
                  >
                    {visibleLists.map((c, i) => (
                      <Reorder.Item
                        key={topListKey(c)}
                        value={c}
                        className="group flex cursor-grab select-none items-center gap-3 rounded-2xl border border-on-surface/[0.07] bg-surface px-3 py-2.5 transition-colors active:cursor-grabbing hover:border-on-surface/[0.14]"
                        whileDrag={{
                          scale: 1.015,
                          boxShadow: '0 14px 34px -14px rgba(0,0,0,0.3)',
                          zIndex: 10,
                        }}
                      >
                        <GripVertical size={15} className="flex-shrink-0 text-on-surface/20 transition-colors group-hover:text-on-surface/45" />
                        <span className="w-4 flex-shrink-0 text-center font-serif text-[13px] font-bold tabular-nums text-on-surface/25">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-semibold leading-tight text-on-surface">
                            {topListPlainLabel(c)}
                          </span>
                          <span className="mt-0.5 block text-[10.5px] font-bold uppercase tracking-[0.14em] text-on-surface/35">
                            {topListKindLabel(c)}
                          </span>
                        </span>
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={() => onDelete(c)}
                          aria-label={`Remove ${topListPlainLabel(c)}`}
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-on-surface/30 transition-colors hover:bg-rose-500/10 hover:text-rose-600"
                        >
                          <X size={14} />
                        </button>
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                )}
              </section>

              {/* ── Add a list ──
                  A segmented control rather than five loose pills: the
                  categories are one choice, and a filled track says so. */}
              <section className="mt-7">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35">
                  Add a list
                </p>

                <div className="mb-4 flex gap-0.5 rounded-full bg-on-surface/[0.05] p-1">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      onClick={() => setCategory(t.key)}
                      className={cn(
                        'relative flex-1 rounded-full px-2 py-1.5 text-[12px] font-semibold transition-colors',
                        category === t.key ? 'text-on-surface' : 'text-on-surface/45 hover:text-on-surface/70',
                      )}
                    >
                      {category === t.key && (
                        <motion.span
                          layoutId="toplist-cat"
                          className="absolute inset-0 rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.10)] ring-1 ring-on-surface/[0.06]"
                          transition={{ type: 'spring', damping: 30, stiffness: 380 }}
                        />
                      )}
                      <span className="relative">{t.label}</span>
                    </button>
                  ))}
                </div>

                {addable.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-on-surface/[0.12] px-4 py-7 text-center">
                    <p className="text-[12.5px] leading-relaxed text-on-surface/45">
                      Nothing eligible here yet.<br />
                      A list needs at least {MIN_LIST_SIZE} rated places to qualify.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {addable.map(({ config, label, count }) => (
                      <button
                        key={topListKey(config)}
                        type="button"
                        onClick={() => onAdd(config)}
                        className="group flex items-center gap-2.5 rounded-2xl border border-on-surface/[0.07] px-3 py-2.5 text-left transition-colors hover:border-primary/35 hover:bg-primary/[0.04]"
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-on-surface/[0.05] text-on-surface/40 transition-colors group-hover:bg-primary group-hover:text-white">
                          <Plus size={13} strokeWidth={2.8} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-on-surface/80 transition-colors group-hover:text-primary">
                          {label}
                        </span>
                        <span className="flex-shrink-0 text-[11.5px] font-bold tabular-nums text-on-surface/30">
                          {count}
                        </span>
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
  const scoresUnlocked = listsCtx.scoresUnlocked;

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
  const [activeTab, setActiveTab] = useState<'rated' | 'posts' | 'reels' | 'guides'>('rated');
  const [cuisineSort, setCuisineSort] = useState<'count' | 'alpha'>('count');
  const [editListsOpen, setEditListsOpen] = useState(false);
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

  // Desktop vs phone — drives the sidebar-style layout on wide viewports.
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

  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [accountMsg, setAccountMsg] = useState('');
  const [accountError, setAccountError] = useState('');
  const [deleteStep, setDeleteStep] = useState(0);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    const uid = user.id;
    const refetch = () => {
      getFollowCounts(uid).then(({ followers: f, following: fg }) => {
        setFollowers(f);
        setFollowing(fg);
      });
    };
    refetch();
    // The full-page follow lists (FollowList) fire this after a follow /
    // unfollow / remove-follower — this page is keep-alive-mounted, so a
    // mount-only fetch would show stale counts on return.
    window.addEventListener('follows:changed', refetch);
    return () => window.removeEventListener('follows:changed', refetch);
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
      // saveProfile drops a column this database doesn't know rather than
      // failing the whole write (see migration 067). The row saved, but
      // those fields didn't — say so instead of flashing a success tick
      // over an edit that only partly landed.
      const lost = [...new Set((result.droppedColumns ?? []).map((c) => PROFILE_FIELD_LABELS[c] ?? c))];
      await refreshProfile();
      if (lost.length) {
        setEditError(`Saved — but your ${lost.join(' and ')} couldn't be stored. Please try again later.`);
      } else {
        setEditSuccess(true);
        setTimeout(() => setSettingsPage('main'), 800);
      }
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
    // Count AND mean score per cuisine: the bar's length says how much you
    // eat of it, its colour says how you rate it.
    const map = new Map<string, { n: number; sum: number }>();
    ratings.forEach((r) => {
      if (!r.cuisine) return;
      const slot = map.get(r.cuisine) || { n: 0, sum: 0 };
      slot.n += 1;
      slot.sum += numericScore(r.score);
      map.set(r.cuisine, slot);
    });
    return Array.from(map.entries())
      .map(([name, { n, sum }]) => [name, n, n > 0 ? sum / n : 0] as [string, number, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);
  }, [ratings]);

  /** Counts per (cuisine / city / price / tag) — used both to seed
   *  auto-generated lists and to gate which slices the user can add
   *  from the editor (must have MIN_LIST_SIZE+ matches). */
  const categoryCounts = useMemo(() => countCategories(ratings), [ratings]);

  /** Auto-seeded configs: overall + any cuisine / city above the
   *  threshold, sorted by count desc so the heaviest categories lead. */
  const autoConfigs = useMemo<TopListConfig[]>(() => autoTopListConfigs(categoryCounts), [categoryCounts]);

  /** Final ordered configs after applying the user's deltas. */
  const visibleConfigs = useMemo<TopListConfig[]>(
    () => visibleTopListConfigs(autoConfigs, customization),
    [autoConfigs, customization],
  );

  /** Each visible config resolved against the ratings — the preview
   *  (`items`) feeds the cover cards, `all` feeds the full-list page. */
  const visibleLists = useMemo(
    () => visibleConfigs
      .map((config) => buildTopList(config, ratings))
      .filter((l): l is NonNullable<typeof l> => l !== null),
    [ratings, visibleConfigs],
  );

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

  /** Headline numbers for the RATED tab: the best-scoring place overall
   *  and the average across everything. */
  const topOverall = useMemo(
    () => [...ratings].sort((a, b) => numericScore(b.score) - numericScore(a.score))[0] ?? null,
    [ratings],
  );
  const overallAvg = useMemo(
    () => (ratings.length === 0 ? 0 : ratings.reduce((sum, r) => sum + numericScore(r.score), 0) / ratings.length),
    [ratings],
  );

  const recentRatings = useMemo(() => {
    return [...ratings].sort((a, b) => ratingRecencyIso(b).localeCompare(ratingRecencyIso(a))).slice(0, 6);
  }, [ratings]);

  const memberSince = user?.created_at
    ? new Date(user.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : null;

  const maxCuisine = cuisineStats[0]?.[1] || 1;
  const sortedCuisines = useMemo(
    () => (cuisineSort === 'alpha'
      ? [...cuisineStats].sort((a, b) => a[0].localeCompare(b[0]))
      : cuisineStats),
    [cuisineStats, cuisineSort],
  );

  return (
    <div className="pb-32 min-h-screen bg-surface type-archivo">
      {/* Mirror the mobile Discover header — Create shortcut on the
          left, centered logo, messages/Circle cluster on the right.
          Hidden on desktop where the sidebar layout owns the chrome. */}
      {!isDesktop && (
        <TopBar
          centerLogo={phoneMode}
          fadeOnScroll={phoneMode}
          // Scrolling swaps the header for a compact glass bar carrying
          // the same actions plus your name, so Messages and Circle stay
          // one tap away instead of only existing at the top of the page.
          condensedTitle={phoneMode ? displayName : undefined}
          leftAction={phoneMode ? (
            <GlassButton
              id="profile-create"
              symbol="plus"
              label="Create"
              onClick={() => navigate('/create')}
              className="w-11 h-11 rounded-full flex items-center justify-center text-on-surface/80 transition-colors"
            >
              <Plus size={20} />
            </GlassButton>
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
      <div className="px-[22px] pt-4 pb-1">
        {/* Avatar, and the three numbers that describe the account, in a
            row beside it. They used to be centred columns under a
            gradient disc — three centred numbers next to a left-aligned
            everything-else is two grids fighting over the same block. */}
        <div className="flex items-center gap-[18px]">
          <div className="relative flex-none">
            <div className="w-[84px] h-[84px] rounded-full bg-primary/[0.12] flex items-center justify-center">
              <span className="text-primary" style={{ fontSize: '34px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            {profile?.is_verified && (
              <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 rounded-full bg-surface ring-[3px] ring-surface flex items-center justify-center">
                <VerifiedBadge size={24} />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0 flex justify-between gap-2.5">
            {([
              ['rated', String(ratings.length), 'rated'],
              ['followers', String(followers), 'followers'],
              ['following', String(following), 'following'],
            ] as const).map(([path, value, label]) => (
              <button
                key={path}
                type="button"
                onClick={() => navigate(`${publicProfilePath}/${path}`)}
                className="flex-1 min-w-0 flex flex-col items-start gap-1.5 text-left active:opacity-60 transition-opacity"
              >
                <span className="text-on-surface tabular-nums" style={{ fontSize: '21px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.03em' }}>{value}</span>
                <span className="text-on-surface/45" style={{ fontSize: '12px', lineHeight: 1 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-[7px]">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <h1 className="text-on-surface" style={{ fontSize: '27px', fontWeight: 700, lineHeight: 1.05, letterSpacing: '-0.035em' }}>{displayName}</h1>
            <span className="text-on-surface/45" style={{ fontSize: '13.5px' }}>@{username}</span>
          </div>
          {/* One quiet line, not three bordered chips. Whether the account
              is public, whether it is verified and when it was made are
              facts about the account, not badges it wears. */}
          <div className="flex items-center gap-2 flex-wrap text-on-surface/45" style={{ fontSize: '12.5px' }}>
            <span className="inline-flex items-center gap-1.5">
              {profile?.is_public ? <Globe size={12} /> : <EyeOff size={12} />}
              {profile?.is_public ? 'Public' : 'Private'}
            </span>
            {profile?.is_verified && (
              <>
                <span className="text-on-surface/25">·</span>
                <span className="inline-flex items-center gap-1 text-primary" style={{ fontWeight: 600 }}>
                  <VerifiedBadge size={12} />
                  Verified{expertPickCount > 0 && ` · ${expertPickCount}`}
                </span>
              </>
            )}
            {memberSince && (
              <>
                <span className="text-on-surface/25">·</span>
                <span>Joined {memberSince}</span>
              </>
            )}
          </div>
        </div>

        {profile?.is_verified && profile?.verified_status && (
          <p className="mt-2.5 text-primary" style={{ fontSize: '13px', fontWeight: 600 }}>{profile.verified_status}</p>
        )}

        {bio && (
          <p className="mt-4 text-on-surface/60" style={{ fontSize: '14px', lineHeight: 1.55, textWrap: 'pretty' } as React.CSSProperties}>{bio}</p>
        )}

        {/* Action row — one accent verb, one outlined verb, two outlined
            circles. The four used to be equal-weight grey rectangles, so
            nothing said which one you were meant to press. */}
        <div ref={createWrapRef} className="relative flex items-center gap-2 mt-[22px]">
          {pickerInput}
          <button
            type="button"
            onClick={() => setCreateMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={createMenuOpen}
            className="flex-1 inline-flex items-center justify-center gap-[7px] rounded-full bg-primary text-white px-4 py-[13px] active:opacity-85 transition-opacity"
            style={{ fontSize: '13px', fontWeight: 700 }}
          >
            <Plus size={15} strokeWidth={2.1} className={cn('transition-transform duration-200', createMenuOpen && 'rotate-45')} />
            Create
          </button>
          <button
            type="button"
            onClick={openEditProfile}
            className="flex-none inline-flex items-center gap-[7px] rounded-full border border-on-surface/[0.22] text-on-surface px-4 py-[13px] active:bg-on-surface/[0.06] transition-colors"
            style={{ fontSize: '13px', fontWeight: 700 }}
          >
            <SquarePen size={14} />
            Edit
          </button>
          <Link
            to={publicProfilePath}
            className="flex-none w-11 h-11 rounded-full border border-on-surface/[0.22] text-on-surface flex items-center justify-center active:bg-on-surface/[0.06] transition-colors"
            aria-label="View public profile"
          >
            <Upload size={16} />
          </Link>
          <button
            type="button"
            onClick={openSettings}
            className="flex-none w-11 h-11 rounded-full border border-on-surface/[0.22] text-on-surface flex items-center justify-center active:bg-on-surface/[0.06] transition-colors"
            aria-label="Settings"
          >
            <Settings size={16} />
          </button>

          <AnimatePresence>
            {createMenuOpen && (
              <motion.div
                role="menu"
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className="absolute left-0 top-[calc(100%+0.5rem)] origin-top-left w-56 z-30 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-xl overflow-hidden"
              >
                {([
                  [<ImageIcon key="p" size={16} strokeWidth={2.2} />, 'Post', 'Photos or a video — one video posts as a reel', openUnifiedPicker],
                  [<BookOpen key="g" size={16} strokeWidth={2.2} />, 'Guide', 'Curated restaurants or recipes', openGuideCreator],
                  [<ChefHat key="r" size={16} strokeWidth={2.2} />, 'Recipe', 'Cook from home — ingredients & steps', () => listsCtx.openHomeMealModal()],
                ] as const).map(([icon, label, sub, run], i) => (
                  <button
                    key={label}
                    type="button"
                    role="menuitem"
                    onClick={() => { setCreateMenuOpen(false); (run as () => void)(); }}
                    className={cn('w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-on-surface/[0.05] transition-colors', i > 0 && 'border-t border-on-surface/[0.06]')}
                  >
                    <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-none">{icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-on-surface" style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.2 }}>{label}</span>
                      <span className="block text-on-surface/45 mt-0.5" style={{ fontSize: '11px', lineHeight: 1.3 }}>{sub}</span>
                    </span>
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────
          Pills, not four icon-and-caps columns under an underline. The
          old bar spent a full row of height on decoration — an icon, a
          spaced-capitals label and a sliding rule — to say one word. */}
      <div className="mt-6 px-[22px] pb-3.5 flex gap-1.5 overflow-x-auto no-scrollbar border-b border-on-surface/[0.14]">
        {([
          ['rated', Star, 'Rated'],
          ['posts', LayoutGrid, 'Posts'],
          ['reels', Film, 'Reels'],
          ['guides', BookOpen, 'Guides'],
        ] as const).map(([key, Icon, label]) => {
          const on = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              aria-pressed={on}
              className={cn(
                'flex-none inline-flex items-center gap-1.5 rounded-full border px-3 py-2.5 active:opacity-80 transition-colors',
                on ? 'bg-on-surface border-on-surface text-cream' : 'bg-transparent border-on-surface/20 text-on-surface',
              )}
              style={{ fontSize: '12px', fontWeight: 700 }}
            >
              <Icon size={14} className={cn(on && key === 'rated' && 'fill-current')} />
              {label}
            </button>
          );
        })}
      </div>
      {/* ── Tab content ───────────────────────────────────────────────── */}
      <main className="px-[22px]">
        {activeTab === 'posts' && (
          myPosts.length === 0 ? (
            <EmptyTabState
              icon={<LayoutGrid size={22} />}
              title="No posts yet"
              subtitle="Share photos and videos from your favorite spots."
              ctaLabel="Create a post"
              onCta={() => openAddPostModal()}
            />
          ) : (
            // Phone grids are full-bleed (like UserProfile) — cancel `main`'s pad.
            <div className={phoneMode ? '-mx-5' : undefined}>
              <ProfilePostsSection
                posts={myPosts}
                isOwn
                onEdit={(id) => openEditPostModal(id)}
                onDelete={(id) => setConfirmDeletePostId(id)}
                onToggleVisibility={(id, next) => setPostVisibility(id, next)}
                hideHeader
              />
            </div>
          )
        )}

        {activeTab === 'reels' && (
          myReels.length === 0 ? (
            <EmptyTabState
              icon={<Film size={22} />}
              title="No reels yet"
              subtitle="Share short videos of your favorite places and recipes."
              ctaLabel="Create a reel"
              onCta={() => openAddReelModal()}
            />
          ) : (
            <div className={phoneMode ? '-mx-5' : undefined}>
              <ProfileReelsSection
                reels={myReels}
                isOwn
                onEdit={(id) => openEditReelModal(id)}
                onDelete={(id) => setConfirmDeleteReelId(id)}
                onToggleVisibility={(id, next) => setReelVisibility(id, next)}
                hideHeader
              />
            </div>
          )
        )}

        {activeTab === 'guides' && (
          visibleGuides.length === 0 ? (
            <EmptyTabState
              icon={<BookOpen size={22} />}
              title="No guides yet"
              subtitle="Curate a list of places or recipes worth sharing."
              ctaLabel="Create a guide"
              onCta={() => openGuideCreator()}
            />
          ) : (
            <div className={phoneMode ? '-mx-5' : undefined}>
              <ProfileGuidesSection
                guides={visibleGuides}
                isOwn
                onEdit={(guide) => openGuideCreator(guide)}
                onDelete={(id) => setConfirmDeleteGuideId(id)}
                onToggleVisibility={onToggleGuideVisibility}
                hideHeader
              />
            </div>
          )
        )}

        {activeTab === 'rated' && (
          ratings.length === 0 ? (
            <EmptyTabState
              icon={<Star size={22} />}
              title="No ratings yet"
              subtitle="Rate restaurants to build your top lists and see your cuisine breakdown."
              ctaLabel="Rate a place"
              onCta={() => navigate('/')}
            />
          ) : (
            <div className="pb-10">
              {/* ── Your #1 ──
                  The headline of the whole tab. It used to sit inside a
                  bordered panel with a thumbnail and the three totals
                  welded underneath — one object doing three jobs. The
                  place is named at size, the score sits beside it, and
                  the totals get their own row below. */}
              {topOverall ? (
                <section className="pt-6">
                  <p className="flex items-center gap-[7px] text-primary" style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                    <Star size={13} className="fill-current" />
                    Your #1
                  </p>
                  <Link to={`/restaurant/${topOverall.restaurantId}`} className="mt-3.5 flex items-center gap-3.5 active:opacity-70 transition-opacity">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate text-on-surface" style={{ fontSize: '20px', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em' }}>
                        {topOverall.name}
                      </span>
                      <span className="mt-1.5 block truncate text-on-surface/45" style={{ fontSize: '13px', lineHeight: 1.3 }}>
                        {[topOverall.cuisine, topOverall.price, cityFromAddress(topOverall.address || '')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    {scoresUnlocked ? (
                      <span className={cn('flex-none rounded-full px-3.5 py-2.5 tabular-nums', scoreTint(numericScore(topOverall.score)))} style={{ fontSize: '16px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                        {numericScore(topOverall.score).toFixed(1)}
                      </span>
                    ) : (
                      <span className="flex-none w-11 h-11 rounded-full bg-on-surface/[0.06] text-on-surface/40 flex items-center justify-center" aria-label="Score hidden until you rate more places">
                        <Lock size={17} />
                      </span>
                    )}
                  </Link>
                </section>
              ) : (
                <p className="pt-6 text-on-surface/45" style={{ fontSize: '13.5px' }}>Rate a few places and your #1 shows up here.</p>
              )}

              {/* Three tinted cells — the totals, given room rather than
                  squeezed into a hairline-divided strip. */}
              <div className="mt-6 grid grid-cols-3 gap-2.5">
                {([
                  [String(ratings.length), `Place${ratings.length === 1 ? '' : 's'} rated`, false],
                  [scoresUnlocked && overallAvg > 0 ? overallAvg.toFixed(1) : '—', 'Your average', true],
                  [String(visibleLists.length), `Top list${visibleLists.length === 1 ? '' : 's'}`, false],
                ] as const).map(([value, label, accent]) => (
                  <div key={label} className={cn('flex flex-col items-start gap-2 rounded-[20px] px-3.5 py-4', accent ? 'bg-primary/10' : 'bg-on-surface/[0.05]')}>
                    <span className={cn('tabular-nums', accent ? 'text-primary' : 'text-on-surface')} style={{ fontSize: '24px', fontWeight: 700, lineHeight: 1, letterSpacing: '-0.04em' }}>{value}</span>
                    <span className="text-on-surface/45" style={{ fontSize: '11px', fontWeight: 600, lineHeight: 1.1 }}>{label}</span>
                  </div>
                ))}
              </div>

              {/* ── Top lists ── */}
              {visibleLists.length > 0 && (
                <section className="mt-8">
                  <ProfileRule />
                  <div className="pt-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <ProfileHeading>Top lists</ProfileHeading>
                      <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '13px', lineHeight: 1.4 }}>
                        Your ratings, sliced. Tap one for the full ranking.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditListsOpen(true)}
                      className="flex-none inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2.5 active:opacity-70 transition-opacity"
                      style={{ fontSize: '11.5px', fontWeight: 700 }}
                    >
                      <Pencil size={12} />
                      Edit
                    </button>
                  </div>
                  <div className="mt-[18px] -mx-[22px] px-[22px] flex gap-2.5 overflow-x-auto no-scrollbar snap-x scroll-px-[22px]">
                    {visibleLists.map((list) => (
                      <div key={list.key} className="flex-none w-[168px] snap-start">
                        <TopListCard list={list} scoresUnlocked={scoresUnlocked} />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Cuisines ──
                  The bar now says something beyond how many: it carries
                  the tier colour of what you actually scored that cuisine,
                  so a long bar in the low tier reads as "you eat a lot of
                  this and rate it badly" at a glance. */}
              {cuisineStats.length > 0 && (
                <section className="mt-8">
                  <ProfileRule />
                  <div className="pt-3 flex items-center justify-between gap-3">
                    <ProfileHeading>Cuisines</ProfileHeading>
                    <button
                      type="button"
                      onClick={() => setCuisineSort((s) => (s === 'count' ? 'alpha' : 'count'))}
                      className="flex-none inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2 active:opacity-70 transition-opacity"
                      style={{ fontSize: '11.5px', fontWeight: 700 }}
                    >
                      {cuisineSort === 'count' ? 'Most rated' : 'A–Z'}
                      <ArrowUpDown size={12} />
                    </button>
                  </div>
                  <div className="mt-4 flex flex-col gap-3.5">
                    {sortedCuisines.map(([name, count, avg]) => (
                      <div key={name} className="flex items-center gap-3">
                        <span className="flex-none w-[104px] truncate text-on-surface" style={{ fontSize: '13.5px', fontWeight: 500, lineHeight: 1.2 }}>{name}</span>
                        <span className="flex-1 h-[7px] rounded-full bg-on-surface/[0.08] overflow-hidden">
                          <span
                            className="block h-full rounded-full transition-[width] duration-[450ms] ease-[var(--ease-drawer)]"
                            style={{
                              width: `${Math.max(8, (count / maxCuisine) * 100)}%`,
                              background: avg > 0 ? scoreSolid(avg) : 'var(--color-primary)',
                              opacity: avg > 0 && avg < 6 ? 0.42 : 1,
                            }}
                          />
                        </span>
                        <span className="flex-none w-[22px] text-right text-on-surface/45 tabular-nums" style={{ fontSize: '12.5px', fontWeight: 700 }}>{count}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Recent ratings ──
                  Hairline rows, no thumbnails. A 44px cover per row is a
                  column of avatars for places you already know you went
                  to; what you came back for is the name and the number. */}
              {recentRatings.length > 0 && (
                <section className="mt-8">
                  <ProfileRule />
                  <div className="pt-3 flex items-center justify-between gap-3">
                    <ProfileHeading>Recent ratings</ProfileHeading>
                    <button
                      type="button"
                      onClick={goToMyRatings}
                      className="flex-none inline-flex items-center gap-1 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2 active:opacity-70 transition-opacity"
                      style={{ fontSize: '11.5px', fontWeight: 700 }}
                    >
                      See all {ratings.length}
                      <ChevronRight size={12} />
                    </button>
                  </div>
                  <div className="pt-2 flex flex-col">
                    {recentRatings.map((r, i) => (
                      <Link
                        key={r.restaurantId}
                        to={`/restaurant/${r.restaurantId}`}
                        className={cn('flex items-center gap-3.5 py-3.5 active:opacity-60 transition-opacity', i > 0 && 'border-t border-on-surface/[0.09]')}
                      >
                        <span className="flex-1 min-w-0">
                          <span className="block truncate text-on-surface" style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.022em' }}>{r.name}</span>
                          <span className="mt-1.5 block truncate text-on-surface/45" style={{ fontSize: '12.5px', lineHeight: 1.3 }}>
                            {[
                              r.visitDate
                                ? new Date(r.visitDate.length === 10 ? `${r.visitDate}T12:00:00` : r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                : '',
                              r.cuisine,
                              cityFromAddress(r.address || ''),
                            ].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        {scoresUnlocked ? (
                          <span className={cn('flex-none rounded-full px-[11px] py-2 tabular-nums', scoreTint(numericScore(r.score)))} style={{ fontSize: '13.5px', fontWeight: 700 }}>
                            {numericScore(r.score).toFixed(1)}
                          </span>
                        ) : (
                          <span className="flex-none w-8 h-8 rounded-full bg-on-surface/[0.06] text-on-surface/40 flex items-center justify-center" aria-label="Score hidden until you rate more places">
                            <Lock size={14} />
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                </section>
              )}
              {/* Recommended guides — real public guides from the community. */}
              {recommendedGuides.length > 0 && (
                <section className="mt-8">
                  <ProfileRule />
                  <div className="pt-3 flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <ProfileHeading>Recommended guides</ProfileHeading>
                      <p className="mt-1.5 text-on-surface/45" style={{ fontSize: '13px', lineHeight: 1.4 }}>Fresh from the community.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/discover')}
                      className="flex-none inline-flex items-center gap-1 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2 active:opacity-70 transition-opacity"
                      style={{ fontSize: '11.5px', fontWeight: 700 }}
                    >
                      Explore
                      <ChevronRight size={12} />
                    </button>
                  </div>
                  <div className="mt-[18px] -mx-[22px] px-[22px] flex gap-2.5 overflow-x-auto no-scrollbar snap-x scroll-px-[22px]">
                    {recommendedGuides.map((g) => (
                      <GuideCard key={g.id} guide={g} />
                    ))}
                  </div>
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
                          />
                          <SettingsRow
                            icon={<Utensils size={17} />}
                            label="Cuisine suggestions"
                            hint="Approve proposed cuisine edits"
                            onClick={() => { setSettingsOpen(false); navigate('/admin/cuisine'); }}
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

                      <SettingsSection label="Data">
                        <SettingsRow
                          icon={<Upload size={17} />}
                          label="Import restaurants"
                          hint="Bring lists over — Beli screenshots or a file"
                          onClick={() => { setSettingsOpen(false); navigate('/import'); }}
                          isLast
                        />
                      </SettingsSection>

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

    </div>
  );
};
