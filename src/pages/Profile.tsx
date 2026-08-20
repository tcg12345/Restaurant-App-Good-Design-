import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Settings, LogOut, X, User, AtSign, Check, ChevronRight, Lock, Loader2, Mail, Trash2, ArrowLeft, AlertTriangle, Edit3, FileText,
  Star, MapPin, Globe, EyeOff, Moon, Sun, Film, Plus, UserPlus, Image as ImageIcon, Sparkles,
  LayoutGrid, List as ListIcon, Upload, Pencil, GripVertical, BookOpen, ChefHat, SquarePen,
  Shield, LifeBuoy, BadgeCheck, UploadCloud, Utensils,
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
import { getMyLatestVerificationRequest, type VerificationRequest } from '../lib/supabase-verification';
import { VerifiedBadge } from '../components/VerifiedBadge';
import { useUnifiedCreatePicker } from '../components/useUnifiedComposer';
import { VerifiedStatusPicker } from '../components/VerifiedStatusPicker';
import { OwnScoreBadge, ScoreBadge } from '../components/ScoreBadge';
import { scoreColor } from '../lib/score';
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
    const map = new Map<string, number>();
    ratings.forEach((r) => {
      if (!r.cuisine) return;
      map.set(r.cuisine, (map.get(r.cuisine) || 0) + 1);
    });
    return Array.from(map.entries())
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

  return (
    <div className="pb-32 min-h-screen bg-surface">
      {/* Mirror the mobile Discover header — Create shortcut on the
          left, centered logo, messages/Circle cluster on the right.
          Hidden on desktop where the sidebar layout owns the chrome. */}
      {!isDesktop && (
        <TopBar
          centerLogo={phoneMode}
          fadeOnScroll={phoneMode}
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

          {/* Each stat opens its Instagram-style full-page list. */}
          <div className="flex-1 grid grid-cols-3 gap-2">
            <button type="button" onClick={() => navigate(`${publicProfilePath}/rated`)} className="flex flex-col items-center text-center group">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums group-hover:text-primary transition-colors">{ratings.length}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">rated</span>
            </button>
            <button type="button" onClick={() => navigate(`${publicProfilePath}/followers`)} className="flex flex-col items-center text-center group">
              <span className="text-[24px] font-bold text-on-surface leading-none tabular-nums group-hover:text-primary transition-colors">{followers}</span>
              <span className="text-[12px] text-on-surface/45 mt-1.5 font-medium">followers</span>
            </button>
            <button type="button" onClick={() => navigate(`${publicProfilePath}/following`)} className="flex flex-col items-center text-center group">
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
        {/* Four tabs, not five: TOP used to be its own tab of stacked
            rails built from the very ratings RATED was already breaking
            down. One tab now owns everything about what you've rated. */}
        <div className="grid grid-cols-4">
          {([
            ['rated', Star, 'RATED'],
            ['posts', LayoutGrid, 'POSTS'],
            ['reels', Film, 'REELS'],
            ['guides', BookOpen, 'GUIDES'],
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
                <Icon size={18} className={cn(isActive && key === 'rated' && 'fill-on-surface')} />
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
              icon={<Film size={32} className="text-on-surface/15" />}
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
              icon={<BookOpen size={32} className="text-on-surface/15" />}
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
              icon={<Star size={32} className="text-on-surface/15" />}
              title="No ratings yet"
              subtitle="Rate restaurants to build your top lists and see your cuisine breakdown."
              ctaLabel="Open map"
              onCta={() => navigate('/')}
            />
          ) : (
            <div className={cn('pb-10', isDesktop ? 'space-y-12' : 'space-y-9')}>
              {/* ── At a glance ──
                  One panel, not a loose line of numbers above a card. The
                  #1 place is the headline and the totals are its plinth:
                  the eye lands on the restaurant, then reads the three
                  numbers that give it scale. Everything shares one border,
                  so the top of the tab is a single object instead of two
                  competing ones. */}
              <section className="overflow-hidden rounded-[26px] border border-on-surface/[0.08] bg-gradient-to-b from-on-surface/[0.035] to-transparent">
                {topOverall ? (
                  <Link
                    to={`/restaurant/${topOverall.restaurantId}`}
                    className={cn('group flex items-center gap-4', isDesktop ? 'p-5' : 'p-4')}
                  >
                    <span className={cn(
                      'relative flex flex-shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-on-surface/[0.06] ring-1 ring-on-surface/[0.06]',
                      isDesktop ? 'h-[76px] w-[76px]' : 'h-[62px] w-[62px]',
                    )}>
                      {topOverall.image
                        ? <img src={topOverall.image} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" referrerPolicy="no-referrer" />
                        : <Star size={20} className="text-on-surface/25" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
                        <Star size={10} className="fill-primary" /> Your #1
                      </span>
                      <span className={cn(
                        'mt-1 block truncate font-serif font-bold leading-tight text-on-surface transition-colors group-hover:text-primary',
                        isDesktop ? 'text-[24px]' : 'text-[20px]',
                      )}>
                        {topOverall.name}
                      </span>
                      <span className="mt-0.5 block truncate text-[12.5px] text-on-surface/45">
                        {[topOverall.cuisine, topOverall.price, cityFromAddress(topOverall.address || '')].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <OwnScoreBadge rating={numericScore(topOverall.score)} unlocked={scoresUnlocked} size="xl" />
                  </Link>
                ) : (
                  <div className={cn('flex items-center gap-3', isDesktop ? 'p-5' : 'p-4')}>
                    <Star size={18} className="text-on-surface/20" />
                    <p className="text-[13.5px] text-on-surface/45">Rate a few places and your #1 shows up here.</p>
                  </div>
                )}

                {/* The plinth. Serif numerals so they read as a statement
                    rather than a readout, hairline-divided so the three
                    stay distinct without needing boxes of their own. */}
                <dl className="grid grid-cols-3 divide-x divide-on-surface/[0.07] border-t border-on-surface/[0.07]">
                  <Stat value={String(ratings.length)} label={`place${ratings.length === 1 ? '' : 's'} rated`} isDesktop={isDesktop} />
                  <Stat
                    value={scoresUnlocked && overallAvg > 0 ? overallAvg.toFixed(1) : '—'}
                    label="average"
                    isDesktop={isDesktop}
                    valueClass={scoresUnlocked && overallAvg > 0 ? scoreColor(overallAvg) : undefined}
                  />
                  <Stat value={String(visibleLists.length)} label={`top list${visibleLists.length === 1 ? '' : 's'}`} isDesktop={isDesktop} />
                </dl>
              </section>

              {/* ── Top lists ──
                  A shelf of covers, not eleven stacked rails. Each tile
                  opens its full ranking at /profile/top/:listKey. */}
              {visibleLists.length > 0 && (
                <section>
                  <div className="mb-4 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className={cn('font-serif font-bold leading-tight text-on-surface', isDesktop ? 'text-[26px]' : 'text-[21px]')}>
                        Top lists
                      </h3>
                      <p className="mt-0.5 text-[12.5px] text-on-surface/45">
                        Your ratings, sliced. Tap one for the full ranking.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditListsOpen(true)}
                      className="inline-flex h-9 flex-shrink-0 items-center gap-1.5 rounded-full border border-on-surface/[0.1] px-3.5 text-[12.5px] font-semibold text-on-surface/65 transition-colors hover:border-on-surface/25 hover:text-on-surface"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                  </div>
                  {/* One rail, both viewports. A wrapping grid of eleven
                      covers is a wall — it pushed everything below it off
                      the screen and made a shelf of lists look like the
                      whole page. Scrolling sideways keeps the section one
                      row tall however many lists exist, and the cover is a
                      fixed width so the tile never changes shape. */}
                  <div className="flex gap-3 snap-x overflow-x-auto no-scrollbar pb-1">
                    {visibleLists.map((list) => (
                      <div key={list.key} className={cn('flex-shrink-0 snap-start', isDesktop ? 'w-[196px]' : 'w-[152px]')}>
                        <TopListCard list={list} scoresUnlocked={scoresUnlocked} />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* ── Cuisine breakdown + Recent ──
                  Side by side on desktop, where a single column left half
                  the width empty; stacked on a phone. */}
              <div className={cn(isDesktop ? 'grid grid-cols-2 gap-10 items-start' : 'space-y-9')}>
                {cuisineStats.length > 0 && (
                  <section>
                    <h3 className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/45">Cuisine breakdown</h3>
                    <div className="space-y-3.5">
                      {cuisineStats.map(([name, count]) => (
                        <div key={name} className="flex items-center gap-3">
                          <span className="w-24 truncate text-[13px] font-medium text-on-surface/75">{name}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-on-surface/[0.06]">
                            <div
                              className="h-full rounded-full bg-primary/70"
                              style={{ width: `${Math.max(8, (count / maxCuisine) * 100)}%` }}
                            />
                          </div>
                          <span className="w-6 text-right text-[12px] tabular-nums text-on-surface/40">{count}</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {recentRatings.length > 0 && (
                  <section>
                    <div className="mb-2 flex items-baseline justify-between">
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
                          <Link to={`/restaurant/${r.restaurantId}`} className="group flex items-center gap-3.5 py-3">
                            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-on-surface/[0.05]">
                              {r.image ? (
                                <img src={r.image} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <MapPin size={15} className="text-on-surface/30" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-serif text-[14px] font-bold leading-tight">{r.name}</p>
                              <p className="mt-0.5 text-[11.5px] text-on-surface/45">
                                {r.visitDate
                                  ? new Date(r.visitDate.length === 10 ? `${r.visitDate}T12:00:00` : r.visitDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : ''}
                                {r.cuisine && `${r.visitDate ? ' · ' : ''}${r.cuisine}`}
                              </p>
                            </div>
                            <OwnScoreBadge rating={numericScore(r.score)} unlocked={scoresUnlocked} size="sm" />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>

              {/* Recommended guides — real public guides from the community. */}
              {recommendedGuides.length > 0 && (
                <section className={!isDesktop ? '-mx-5' : undefined}>
                  <div className={cn('mb-4 flex items-end justify-between gap-3', !isDesktop && 'px-5')}>
                    <div className="min-w-0">
                      <h3 className={cn('font-serif font-bold leading-tight text-on-surface', isDesktop ? 'text-[26px]' : 'text-[21px]')}>
                        Recommended guides
                      </h3>
                      <p className="mt-0.5 text-[12.5px] text-on-surface/45">Fresh from the community</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate('/discover')}
                      className="inline-flex flex-shrink-0 items-center gap-0.5 text-[13px] font-semibold text-primary hover:text-primary/80"
                    >
                      Explore <ChevronRight size={14} />
                    </button>
                  </div>
                  <div className={cn('flex gap-4 overflow-x-auto pb-2 scrollbar-hide snap-x', !isDesktop && 'px-5')}>
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
