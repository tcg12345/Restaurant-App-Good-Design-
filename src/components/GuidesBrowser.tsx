import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Bookmark, BookOpen, Clock, Search, X } from 'lucide-react';
import { useSettings } from '../contexts/SettingsContext';
import { cn } from '../lib/utils';

/* ── Browse-all guides popup ─────────────────────────────────────────────────
   Opened from the "Browse all" affordance on the Discover and Location
   guide rails. Content is still placeholder (same fiction as the rails
   themselves) but the surface is fully functional: search, filter by
   author, and re-sort all work against the filler pool so the real data
   hookup later is just a prop swap.

   Chrome follows the app's two established popup modes:
   - Desktop: centered spotlight card — same backdrop, position, radius
     and shadow as the change-location picker (HomeLocationBar).
   - Mobile: full-page slide-up panel with a back arrow, since a browse
     grid wants the whole viewport rather than a half sheet.
   ──────────────────────────────────────────────────────────────────────── */

export interface BrowseGuide {
  id: string;
  title: string;
  author: string;
  image: string;
  count: number;
  /** Days since last update — drives the recency sort + "Updated" label. */
  daysAgo: number;
  saves: number;
}

/* Filler pool. `cityTitle` is used when the browser is opened from a
   location surface ("{city}" → short city name); `genericTitle` when
   opened from Discover where there's no single anchor city. Images are
   reused from elsewhere in the app so they're known-good URLs. */
const BROWSE_GUIDE_TEMPLATES: Array<{
  id: string;
  cityTitle: string;
  genericTitle: string;
  author: string;
  image: string;
  count: number;
  daysAgo: number;
  saves: number;
}> = [
  { id: 'bg-pasta', cityTitle: 'A Pasta Crawl Through {city}', genericTitle: 'A Proper Pasta Crawl', author: 'Jamie Lin', image: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&q=80&w=800', count: 9, daysAgo: 2, saves: 184 },
  { id: 'bg-date', cityTitle: 'Where {city} Locals Take a Date', genericTitle: 'Where Locals Take a Date', author: 'Camille Durand', image: 'https://images.unsplash.com/photo-1550547660-d9450f859349?auto=format&fit=crop&q=80&w=800', count: 12, daysAgo: 5, saves: 327 },
  { id: 'bg-gems', cityTitle: 'Hidden Gems in {city}', genericTitle: 'Hidden Gems Worth a Detour', author: 'Marco Rossi', image: 'https://images.unsplash.com/photo-1526318896980-cf78c088247c?auto=format&fit=crop&q=80&w=800', count: 8, daysAgo: 0, saves: 96 },
  { id: 'bg-brunch', cityTitle: 'A Proper Brunch Itinerary in {city}', genericTitle: 'A Proper Weekend Brunch Itinerary', author: 'Aiko Tanaka', image: 'https://images.unsplash.com/photo-1525351484163-7529414344d8?auto=format&fit=crop&q=80&w=800', count: 7, daysAgo: 9, saves: 211 },
  { id: 'bg-tasting', cityTitle: 'Tasting-Menu Temples Near {city}', genericTitle: 'Tasting-Menu Temples', author: 'Diego Ramirez', image: 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&q=80&w=800', count: 10, daysAgo: 13, saves: 142 },
  { id: 'bg-latenight', cityTitle: 'Late-Night {city} Standbys', genericTitle: 'Late-Night Standbys', author: 'Sam Hughes', image: 'https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?auto=format&fit=crop&q=80&w=800', count: 11, daysAgo: 1, saves: 263 },
  { id: 'bg-omakase', cityTitle: 'The {city} Omakase Shortlist', genericTitle: 'The Omakase Shortlist', author: 'Aiko Tanaka', image: 'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?auto=format&fit=crop&q=80&w=800', count: 6, daysAgo: 3, saves: 388 },
  { id: 'bg-classics', cityTitle: 'Old-School Classics of {city}', genericTitle: 'Old-School Classics Still Worth It', author: 'Marco Rossi', image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?auto=format&fit=crop&q=80&w=800', count: 14, daysAgo: 21, saves: 175 },
  { id: 'bg-slices', cityTitle: 'A Slice Tour of {city}', genericTitle: 'A Proper Slice Tour', author: 'Jamie Lin', image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&q=80&w=800', count: 13, daysAgo: 4, saves: 240 },
  { id: 'bg-veg', cityTitle: 'Vegetarian Standouts in {city}', genericTitle: 'Vegetarian Standouts', author: 'Priya Patel', image: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&q=80&w=800', count: 9, daysAgo: 7, saves: 118 },
  { id: 'bg-comfort', cityTitle: 'Rainy-Day Comfort Food in {city}', genericTitle: 'Rainy-Day Comfort Food', author: 'Lena Kovács', image: 'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&q=80&w=800', count: 8, daysAgo: 11, saves: 87 },
  { id: 'bg-bakery', cityTitle: 'The {city} Bakery Run', genericTitle: 'The Saturday Bakery Run', author: 'Priya Patel', image: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&q=80&w=800', count: 10, daysAgo: 6, saves: 154 },
  { id: 'bg-dessert', cityTitle: 'Dessert First: {city} Sweets', genericTitle: 'Dessert First', author: 'Camille Durand', image: 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&q=80&w=800', count: 7, daysAgo: 16, saves: 201 },
  { id: 'bg-patio', cityTitle: 'Patio Season in {city}', genericTitle: 'Patio Season Essentials', author: 'Sam Hughes', image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&q=80&w=800', count: 12, daysAgo: 8, saves: 133 },
  { id: 'bg-spice', cityTitle: 'Spice Routes of {city}', genericTitle: 'Spice Routes', author: 'Lena Kovács', image: 'https://images.unsplash.com/photo-1585937421612-70a008356fbe?auto=format&fit=crop&q=80&w=800', count: 9, daysAgo: 28, saves: 92 },
  { id: 'bg-lunch', cityTitle: 'Healthy-ish Lunches in {city}', genericTitle: 'Healthy-ish Lunch Spots', author: 'Diego Ramirez', image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=800', count: 8, daysAgo: 35, saves: 64 },
];

export function buildBrowseGuides(cityName?: string): BrowseGuide[] {
  const city = cityName?.trim();
  return BROWSE_GUIDE_TEMPLATES.map(({ cityTitle, genericTitle, ...rest }) => ({
    ...rest,
    title: city ? cityTitle.replace(/\{city\}/g, city) : genericTitle,
  }));
}

/* Stable name → hue so author avatars get consistent colors without a
   palette table. Mirrors the hash Discover uses for guide author chips. */
function hashToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

function agoLabel(daysAgo: number): string {
  if (daysAgo <= 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  if (daysAgo < 7) return `${daysAgo}d ago`;
  if (daysAgo < 30) return `${Math.round(daysAgo / 7)}w ago`;
  return `${Math.round(daysAgo / 30)}mo ago`;
}

type SortKey = 'recent' | 'spots' | 'alpha';
const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'recent', label: 'Newest' },
  { key: 'spots', label: 'Most spots' },
  { key: 'alpha', label: 'A–Z' },
];

interface GuidesBrowserProps {
  open: boolean;
  onClose: () => void;
  /** Short city name ("New York"). Set on location surfaces — templates the
   *  guide titles and the header. Omit on Discover for the generic pool. */
  cityName?: string;
  /** Parent-supplied mobile signal (each page already has its own). */
  isMobile: boolean;
}

export const GuidesBrowser: React.FC<GuidesBrowserProps> = ({ open, onClose, cityName, isMobile }) => {
  const { setHideBottomNav } = useSettings();
  const [query, setQuery] = useState('');
  const [selectedAuthors, setSelectedAuthors] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>('recent');
  const inputRef = useRef<HTMLInputElement>(null);

  const guides = useMemo(() => buildBrowseGuides(cityName), [cityName]);

  // Author chips, ordered by how many guides each has so the most
  // prolific people surface first in the scroll row.
  const authors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of guides) counts.set(g.author, (counts.get(g.author) ?? 0) + 1);
    return Array.from(counts.keys()).sort((a, b) => (counts.get(b)! - counts.get(a)!) || a.localeCompare(b));
  }, [guides]);

  // Fresh browse state every open. Autofocus only on desktop — popping
  // the keyboard immediately on the mobile full-pager is hostile.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedAuthors(new Set());
    setSortBy('recent');
    if (!isMobile) {
      const t = setTimeout(() => inputRef.current?.focus(), 180);
      return () => clearTimeout(t);
    }
  }, [open, isMobile]);

  // The mobile full-pager covers the bottom nav's space — hide it.
  useEffect(() => {
    setHideBottomNav(open && isMobile);
    return () => setHideBottomNav(false);
  }, [open, isMobile, setHideBottomNav]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = guides.filter((g) =>
      (q === '' || g.title.toLowerCase().includes(q) || g.author.toLowerCase().includes(q)) &&
      (selectedAuthors.size === 0 || selectedAuthors.has(g.author)),
    );
    switch (sortBy) {
      case 'spots': return [...list].sort((a, b) => b.count - a.count);
      case 'alpha': return [...list].sort((a, b) => a.title.localeCompare(b.title));
      default: return [...list].sort((a, b) => a.daysAgo - b.daysAgo);
    }
  }, [guides, query, selectedAuthors, sortBy]);

  const toggleAuthor = (name: string) => {
    setSelectedAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const clearAll = () => {
    setQuery('');
    setSelectedAuthors(new Set());
  };

  const title = cityName ? `Guides for ${cityName}` : 'Browse all guides';

  const controls = (
    <div className="px-5 pt-3 pb-2 flex-shrink-0 space-y-3 border-b border-on-surface/6">
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search guides or authors"
          className="w-full bg-on-surface/[0.04] rounded-full py-3 pl-11 pr-10 text-sm font-medium focus:outline-none focus:bg-on-surface/[0.06]"
          autoCapitalize="off"
          autoCorrect="off"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-on-surface/[0.07] grid place-items-center text-on-surface/55 hover:bg-on-surface/[0.12] transition-colors"
            aria-label="Clear search"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* People filter — multi-select author chips. "Everyone" clears. */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
        <button
          type="button"
          onClick={() => setSelectedAuthors(new Set())}
          className={cn(
            'flex-shrink-0 px-3.5 py-2 rounded-full border text-[12.5px] font-semibold transition-colors',
            selectedAuthors.size === 0
              ? 'bg-on-surface text-surface border-on-surface'
              : 'bg-transparent border-on-surface/12 text-on-surface/65 hover:border-on-surface/35',
          )}
        >
          Everyone
        </button>
        {authors.map((name) => {
          const active = selectedAuthors.has(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggleAuthor(name)}
              className={cn(
                'flex-shrink-0 inline-flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full border text-[12.5px] font-semibold transition-colors',
                active
                  ? 'bg-on-surface text-surface border-on-surface'
                  : 'bg-transparent border-on-surface/12 text-on-surface/65 hover:border-on-surface/35',
              )}
              aria-pressed={active}
            >
              <span
                className="w-6 h-6 rounded-full grid place-items-center text-[10px] font-bold text-white flex-shrink-0"
                style={{ background: `hsl(${hashToHue(name)} 42% 48%)` }}
              >
                {name.charAt(0).toUpperCase()}
              </span>
              {name}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] font-semibold text-on-surface/45 tabular-nums">
          {visible.length} {visible.length === 1 ? 'guide' : 'guides'}
        </p>
        <div className="flex items-center gap-0.5">
          {SORTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setSortBy(key)}
              className={cn(
                'px-3 py-1.5 rounded-full text-[12px] font-semibold transition-colors',
                sortBy === key
                  ? 'bg-on-surface/[0.08] text-on-surface'
                  : 'text-on-surface/50 hover:text-on-surface',
              )}
              aria-pressed={sortBy === key}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const grid = (
    <div className="flex-1 overflow-y-auto px-5 pb-safe-5 pt-4">
      {visible.length === 0 ? (
        <div className="py-16 flex flex-col items-center text-center px-6">
          <div className="w-12 h-12 rounded-2xl bg-on-surface/[0.05] grid place-items-center text-on-surface/40">
            <BookOpen size={20} />
          </div>
          <p className="mt-3 font-serif font-semibold text-[17px] text-on-surface">No guides match</p>
          <p className="mt-1 text-[13px] text-on-surface/55 max-w-[260px] leading-snug">
            Try a different search, or clear your filters.
          </p>
          <button
            type="button"
            onClick={clearAll}
            className="mt-4 px-4 py-2 rounded-full bg-on-surface text-surface text-[13px] font-semibold hover:opacity-90 transition-opacity"
          >
            Clear search & filters
          </button>
        </div>
      ) : (
        <div className={cn('grid gap-3 pb-6', isMobile ? 'grid-cols-2' : 'grid-cols-3')}>
          {visible.map((g) => (
            <article
              key={g.id}
              className="bg-white border border-on-surface/[0.08] rounded-2xl overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_6px_18px_-8px_rgba(31,26,23,0.12),0_1px_2px_rgba(31,26,23,0.04)] hover:border-on-surface/15"
            >
              <div
                className="relative aspect-[1/0.78] overflow-hidden"
                /* Gradient seed sits behind the photo so a slow or failed
                   image load never shows a broken-image glyph. */
                style={{ background: `linear-gradient(135deg, hsl(${hashToHue(g.id)} 38% 60%), hsl(${(hashToHue(g.id) + 40) % 360} 42% 42%))` }}
              >
                <img
                  src={g.image}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    backgroundImage:
                      'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.10), transparent 45%), linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.22) 100%)',
                  }}
                />
                <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 px-2 py-[3px] rounded-full bg-white/92 backdrop-blur text-[10px] font-bold uppercase tracking-[0.08em] text-on-surface">
                  <BookOpen size={11} className="text-primary" />
                  Guide · {g.count} spots
                </span>
              </div>
              <div className="px-3.5 pt-3 pb-3.5">
                <h4 className="font-serif font-semibold text-on-surface text-[15px] tracking-[-0.01em] leading-[1.25] line-clamp-2">
                  {g.title}
                </h4>
                <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-on-surface/55 min-w-0">
                  <span
                    className="w-[18px] h-[18px] rounded-full grid place-items-center text-[9px] font-bold text-white flex-shrink-0"
                    style={{ background: `hsl(${hashToHue(g.author)} 42% 48%)` }}
                  >
                    {g.author.charAt(0).toUpperCase()}
                  </span>
                  <span className="truncate">by {g.author}</span>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[11px] font-semibold text-on-surface/45">
                  <span className="inline-flex items-center gap-1"><Clock size={11} />{agoLabel(g.daysAgo)}</span>
                  <span className="inline-flex items-center gap-1"><Bookmark size={11} />{g.saves}</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        isMobile ? (
          /* Mobile: full-page slide-up panel. No backdrop — it covers
             the whole viewport, dismissed via the back arrow. */
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring' as const, damping: 28, stiffness: 300 }}
            className="fixed inset-0 z-50 bg-surface flex flex-col"
          >
            <div className="pt-safe-4 pl-2 pr-4 pb-2 flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 grid place-items-center rounded-full text-on-surface/70 hover:bg-on-surface/[0.05] transition-colors flex-shrink-0"
                aria-label="Back"
              >
                <ArrowLeft size={22} />
              </button>
              <h3 className="flex-1 min-w-0 font-serif font-semibold text-[19px] tracking-[-0.015em] text-on-surface truncate">
                {title}
              </h3>
              <span className="text-[13px] font-medium text-on-surface/45 tabular-nums flex-shrink-0">
                {guides.length}
              </span>
            </div>
            {controls}
            {grid}
          </motion.div>
        ) : (
          /* Desktop: backdrop + centered spotlight card, mirroring the
             change-location picker's chrome. */
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-black/45 backdrop-blur-md"
              onClick={onClose}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] as const }}
              className="fixed left-1/2 -translate-x-1/2 top-[7vh] w-full max-w-3xl max-h-[84vh] z-50 bg-surface rounded-3xl shadow-[0_30px_80px_-16px_rgba(28,24,22,0.42)] ring-1 ring-on-surface/[0.06] flex flex-col overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-on-surface/6 flex-shrink-0">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/45">
                    {cityName ? 'Local guides' : 'Community guides'}
                  </p>
                  <h3 className="mt-1 font-serif font-semibold text-[24px] leading-tight tracking-[-0.02em] text-on-surface truncate">
                    {title}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-8 h-8 rounded-full bg-on-surface/5 flex items-center justify-center hover:bg-on-surface/10 transition-colors flex-shrink-0"
                  aria-label="Close"
                >
                  <X size={16} className="text-on-surface/60" />
                </button>
              </div>
              {controls}
              {grid}
            </motion.div>
          </>
        )
      )}
    </AnimatePresence>,
    document.getElementById('phone-frame-root') ?? document.body,
  );
};
