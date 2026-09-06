/**
 * Pinned shelf — the three things a person put at the top of their profile.
 *
 * A pin is only a reference (lib/pins.ts), so the shelf first has to turn
 * each one into something it can draw: a title, a cover, a kind, a score
 * for restaurants, and where tapping goes. `usePinnedCards` does that from
 * whatever the page already holds (the owner's own ratings, meals and
 * guides; a public profile's already-fetched items) and reaches for the
 * network only for the kinds a profile page doesn't keep in full — posts
 * and reels, fetched by id through the same RLS-guarded reads everything
 * else uses. A pin that resolves to nothing isn't the viewer's to see and
 * is simply left out.
 *
 * One tile for every kind — same size, same cover treatment — so three
 * different things read as one deliberate row rather than three widgets.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Pencil, Pin, X, BookOpen, ChefHat, Film, Image as ImageIcon, Utensils } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { formatScore, scoreHex } from '../../lib/score';
import { useSettings } from '../../contexts/SettingsContext';
import type { PinnedItem, PinnedType } from '../../lib/pins';
import type { RestaurantRating, HomeMeal } from '../../contexts/ListsContext';
import type { CommunityRating, CommunityPhoto } from '../../lib/supabase-community';
import { getPublicHomeMealById } from '../../lib/supabase-community';
import { getGuideById, isPublicGuide, type Guide } from '../../lib/supabase-guides';
import { getRecipe } from '../../lib/supabase-recipes';
import { getPost, type PostRow } from '../../lib/supabase-posts';
import { getReel, type ReelRow } from '../../lib/supabase-reels';

export interface PinCard {
  pin: PinnedItem;
  title: string;
  subtitle: string;
  image: string;
  kind: string;
  score: number | null;
  href: string;
}

export interface PinSources {
  /** Whose pins these are — needed for recipe and meal routes and reads. */
  ownerId: string | null;
  /** The owner's own ratings (own profile). */
  ratings?: RestaurantRating[];
  /** The owner's published ratings as a viewer sees them (public profile). */
  communityRatings?: CommunityRating[];
  /** The owner's published photos (public profile) — rating rows carry no
   *  image, so a restaurant tile's cover comes from here. */
  photos?: CommunityPhoto[];
  meals?: HomeMeal[];
  guides?: Guide[];
  posts?: PostRow[];
  reels?: ReelRow[];
  /** Viewer mode: a guide only counts if it's public (the tabs apply the
   *  same filter, so a pinned draft never shows to anyone but its owner). */
  viewer?: boolean;
}

const KIND_LABEL: Record<PinnedType, string> = {
  restaurant: 'Rated', recipe: 'Recipe', meal: 'Recipe', guide: 'Guide', post: 'Post', reel: 'Reel',
};

const KIND_ICON: Record<PinnedType, React.FC<{ size?: number; className?: string }>> = {
  restaurant: Utensils, recipe: ChefHat, meal: ChefHat, guide: BookOpen, post: ImageIcon, reel: Film,
};

const postCover = (p: PostRow) => {
  const first = p.items[0];
  if (!first) return '';
  return first.mediaType === 'video' ? (first.posterUrl || '') : (first.mediaUrl || first.posterUrl || '');
};

function fromLocal(pin: PinnedItem, s: PinSources): PinCard | null | undefined {
  // undefined = "not held locally, go fetch"; null = "resolved to nothing".
  const owner = s.ownerId ?? '';
  switch (pin.type) {
    case 'restaurant': {
      const own = s.ratings?.find((r) => r.restaurantId === pin.id);
      if (own) return { pin, title: own.name, subtitle: own.cuisine || '', image: own.photos?.[0]?.url || own.image || '', kind: KIND_LABEL.restaurant, score: own.score, href: `/restaurant/${pin.id}` };
      const pub = s.communityRatings?.find((r) => r.restaurant_id === pin.id);
      if (pub) {
        const mine = (s.photos || []).filter((ph) => ph.restaurant_id === pin.id);
        const cover = mine.find((ph) => ph.is_favorite)?.url || mine[0]?.url || pub.photo_url || '';
        return { pin, title: pub.restaurant_name, subtitle: pub.cuisine || '', image: cover, kind: KIND_LABEL.restaurant, score: pub.score, href: `/restaurant/${pin.id}` };
      }
      // Restaurants aren't fetched by id: if it isn't in the ratings the
      // viewer can see, it isn't theirs to see.
      return s.ratings || s.communityRatings ? null : undefined;
    }
    case 'meal': {
      const m = s.meals?.find((x) => x.id === pin.id);
      if (m) return { pin, title: m.name, subtitle: m.cuisine || KIND_LABEL.meal, image: m.coverPhoto || m.photos?.[0]?.url || '', kind: KIND_LABEL.meal, score: null, href: `/meal/${encodeURIComponent(owner)}/${encodeURIComponent(pin.id)}` };
      return undefined;
    }
    case 'guide': {
      const g = s.guides?.find((x) => x.id === pin.id);
      if (g) return s.viewer && !isPublicGuide(g) ? null : { pin, title: g.title, subtitle: g.subtitle || KIND_LABEL.guide, image: g.coverPhoto || '', kind: KIND_LABEL.guide, score: null, href: `/guides/${pin.id}` };
      return undefined;
    }
    case 'post': {
      const p = s.posts?.find((x) => x.id === pin.id);
      if (p) return { pin, title: p.caption || p.items[0]?.restaurant?.name || p.items[0]?.recipe?.title || 'Post', subtitle: p.items[0]?.restaurant?.name && p.caption ? p.items[0].restaurant.name : KIND_LABEL.post, image: postCover(p), kind: KIND_LABEL.post, score: null, href: `/r/post-${pin.id}` };
      return undefined;
    }
    case 'reel': {
      const r = s.reels?.find((x) => x.id === pin.id);
      if (r) return { pin, title: r.recipe?.title || r.restaurant?.name || r.caption || 'Reel', subtitle: KIND_LABEL.reel, image: r.posterUrl || '', kind: KIND_LABEL.reel, score: null, href: `/r/reel-${pin.id}` };
      return undefined;
    }
    case 'recipe':
      return undefined;
  }
}

async function fetchCard(pin: PinnedItem, s: PinSources): Promise<PinCard | null> {
  const owner = s.ownerId ?? '';
  try {
    switch (pin.type) {
      case 'recipe': {
        const r = await getRecipe(pin.id);
        return r ? { pin, title: r.title, subtitle: KIND_LABEL.recipe, image: r.photos?.[0] || '', kind: KIND_LABEL.recipe, score: null, href: `/recipe/${encodeURIComponent(owner)}/${encodeURIComponent(pin.id)}` } : null;
      }
      case 'meal': {
        if (!owner) return null;
        const m = await getPublicHomeMealById(owner, pin.id);
        return m ? { pin, title: m.name, subtitle: m.cuisine || KIND_LABEL.meal, image: m.coverPhoto || m.photos?.[0]?.url || '', kind: KIND_LABEL.meal, score: null, href: `/meal/${encodeURIComponent(owner)}/${encodeURIComponent(pin.id)}` } : null;
      }
      case 'guide': {
        const g = await getGuideById(pin.id);
        if (!g) return null;
        if (s.viewer && !isPublicGuide(g)) return null;
        return { pin, title: g.title, subtitle: g.subtitle || KIND_LABEL.guide, image: g.coverPhoto || '', kind: KIND_LABEL.guide, score: null, href: `/guides/${pin.id}` };
      }
      case 'post': {
        const p = await getPost(pin.id);
        return p ? { pin, title: p.caption || p.items[0]?.restaurant?.name || p.items[0]?.recipe?.title || 'Post', subtitle: KIND_LABEL.post, image: postCover(p), kind: KIND_LABEL.post, score: null, href: `/r/post-${pin.id}` } : null;
      }
      case 'reel': {
        const r = await getReel(pin.id);
        return r ? { pin, title: r.recipe?.title || r.restaurant?.name || r.caption || 'Reel', subtitle: KIND_LABEL.reel, image: r.posterUrl || '', kind: KIND_LABEL.reel, score: null, href: `/r/reel-${pin.id}` } : null;
      }
      case 'restaurant':
        return null;
    }
  } catch {
    return null;
  }
}

/** Resolve pins to cards. Returns `null` until the first pass settles so a
 *  shelf never flashes empty and then fills. Order follows the pins. */
export function usePinnedCards(pins: PinnedItem[], sources: PinSources): PinCard[] | null {
  const [fetched, setFetched] = useState<Record<string, PinCard | null>>({});
  const key = pins.map((p) => `${p.type}:${p.id}`).join('|');

  const local = useMemo(() => pins.map((pin) => fromLocal(pin, sources)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, sources.ownerId, sources.ratings, sources.communityRatings, sources.photos, sources.meals, sources.guides, sources.posts, sources.reels, sources.viewer]);

  const missing = pins.filter((_, i) => local[i] === undefined && !(`${pins[i].type}:${pins[i].id}` in fetched));

  useEffect(() => {
    if (missing.length === 0) return;
    let alive = true;
    void Promise.all(missing.map(async (pin) => [`${pin.type}:${pin.id}`, await fetchCard(pin, sources)] as const)).then((rows) => {
      if (!alive) return;
      setFetched((prev) => { const next = { ...prev }; for (const [k, v] of rows) next[k] = v; return next; });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.map((p) => `${p.type}:${p.id}`).join('|'), sources.ownerId]);

  return useMemo(() => {
    if (pins.length === 0) return [];
    const out: PinCard[] = [];
    for (let i = 0; i < pins.length; i++) {
      const l = local[i];
      if (l === undefined) {
        const k = `${pins[i].type}:${pins[i].id}`;
        if (!(k in fetched)) return null; // still resolving
        const f = fetched[k];
        if (f) out.push(f);
      } else if (l) {
        out.push(l);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, local, fetched]);
}

/* ── The tile ─────────────────────────────────────────────────────── */

export const PinTile: React.FC<{ card: PinCard }> = ({ card }) => {
  const { twoDecimalScores } = useSettings();
  const Icon = KIND_ICON[card.pin.type];
  return (
    <Link
      to={card.href}
      className="group block w-full rounded-[22px] overflow-hidden relative bg-on-surface/[0.06] active:opacity-85 transition-opacity"
      style={{ aspectRatio: '4 / 5' }}
      aria-label={`${card.kind}: ${card.title}`}
    >
      {card.image ? (
        <img src={card.image} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" loading="lazy" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-on-surface/25">
          <Icon size={30} />
        </div>
      )}
      {/* The gradient only when there's a photo to read against; on the
          flat fallback the text sits in ink on the tint. */}
      {card.image && <div className="absolute inset-x-0 bottom-0 h-[62%] bg-gradient-to-t from-black/75 via-black/30 to-transparent" aria-hidden />}
      <div className="absolute top-2.5 left-2.5 flex items-center gap-1 rounded-full px-2 py-1 bg-black/45 text-white backdrop-blur-sm" style={{ fontSize: '9px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
        <Icon size={10} />
        {card.kind}
      </div>
      {card.score != null && (
        <span
          className="absolute top-2 right-2 inline-flex items-center h-7 px-2.5 rounded-full tabular-nums bg-black/50 backdrop-blur-sm"
          style={{ fontSize: '12.5px', fontWeight: 700, color: scoreHex(card.score) }}
        >
          {formatScore(card.score, twoDecimalScores)}
        </span>
      )}
      <div className={cn('absolute inset-x-0 bottom-0 p-3', card.image ? 'text-white' : 'text-on-surface')}>
        <p className="line-clamp-2" style={{ fontSize: '14px', fontWeight: 700, lineHeight: 1.2, letterSpacing: '-0.01em' }}>{card.title}</p>
        {card.subtitle && <p className={cn('mt-0.5 truncate', card.image ? 'text-white/70' : 'text-on-surface/50')} style={{ fontSize: '11px', fontWeight: 600 }}>{card.subtitle}</p>}
      </div>
    </Link>
  );
};

/* ── The empty-state hint ─────────────────────────────────────────── */
/* Dismissing it is per account and per device: a hint you have read once
 * is noise on every visit after, and it has nothing to restore since
 * pinning something replaces it anyway. Keyed by user so a second account
 * on the same phone still gets told. */
const HINT_KEY = 'goodeats-pins-hint-dismissed';
const hintKeyFor = (uid: string | null) => (uid ? `${HINT_KEY}:${uid}` : HINT_KEY);
const hintDismissed = (uid: string | null): boolean => {
  try { return localStorage.getItem(hintKeyFor(uid)) === '1'; } catch { return false; }
};
const dismissHint = (uid: string | null): void => {
  try { localStorage.setItem(hintKeyFor(uid), '1'); } catch { /* storage off */ }
};

/* ── The shelf ────────────────────────────────────────────────────── */

export const PinnedShelf: React.FC<{
  /** Resolved cards; `null` while resolving (renders nothing yet). */
  cards: PinCard[] | null;
  isOwn: boolean;
  onEdit?: () => void;
  /** Horizontal gutter of the page, so the row can bleed edge to edge. */
  gutter?: number;
  className?: string;
}> = ({ cards, isOwn, onEdit, gutter = 22, className }) => {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  // Above the early returns below — hooks run on every render or none.
  const [hintGone, setHintGone] = useState(() => hintDismissed(uid));
  useEffect(() => { setHintGone(hintDismissed(uid)); }, [uid]);
  if (cards === null) return null;
  if (cards.length === 0) {
    if (!isOwn || !onEdit || hintGone) return null;
    // The owner's empty state: one quiet line that says what this is and
    // where to start. Never shown to anyone else.
    return (
      <div className={cn('profile-pin-empty relative', className)}>
        <button
          type="button"
          onClick={onEdit}
          className="w-full flex items-center gap-3 rounded-2xl border border-dashed border-tint/40 bg-tint/[0.07] pl-4 pr-11 py-3 text-left active:opacity-70 transition-opacity"
        >
          <span className="flex-none w-8 h-8 rounded-full bg-tint/20 text-tint-ink flex items-center justify-center"><Pin size={14} /></span>
          <span className="flex-1 min-w-0">
            <span className="block text-on-surface" style={{ fontSize: '13.5px', fontWeight: 700 }}>Pin your favorites</span>
            <span className="block text-on-surface/50" style={{ fontSize: '12px' }}>Choose up to three highlights.</span>
          </span>
        </button>
        {/* A sibling, not a child: a button inside a button is invalid and
            the inner one's taps reach both. */}
        <button
          type="button"
          onClick={() => { dismissHint(uid); setHintGone(true); }}
          aria-label="Dismiss"
          className="hit-44 absolute top-1.5 right-1.5 w-8 h-8 rounded-full flex items-center justify-center text-on-surface/35 active:text-on-surface/70 active:scale-90 transition-all"
        >
          <X size={14} strokeWidth={2.4} />
        </button>
      </div>
    );
  }
  return (
    <section className={className}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-on-surface" style={{ fontSize: '18px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.022em' }}>Pinned</h2>
        {isOwn && onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex-none inline-flex items-center gap-1.5 rounded-full bg-on-surface/[0.06] text-on-surface px-3 py-2.5 active:opacity-70 transition-opacity"
            style={{ fontSize: '11.5px', fontWeight: 700 }}
          >
            <Pencil size={12} />
            Edit
          </button>
        )}
      </div>
      <div
        className="mt-[14px] flex gap-2.5 overflow-x-auto no-scrollbar snap-x"
        style={{ marginLeft: -gutter, marginRight: -gutter, paddingLeft: gutter, paddingRight: gutter, scrollPaddingLeft: gutter }}
      >
        {cards.map((c) => (
          <div key={`${c.pin.type}:${c.pin.id}`} className="flex-none w-[168px] snap-start">
            <PinTile card={c} />
          </div>
        ))}
      </div>
    </section>
  );
};
