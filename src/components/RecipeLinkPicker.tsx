import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Check, ChefHat, Clock, Loader2, Lock, Search, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLists, type LinkedRecipeRef } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useSettings } from '../contexts/SettingsContext';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { cn } from '../lib/utils';

/* ── Recipe link picker ──────────────────────────────────────────────────────
   Search popup opened from the Advanced builder's "Link a recipe" buttons.
   Lets the author attach another recipe as a component of the one being
   written. Searches across:

     - the user's pantry (home meals from ListsContext)
     - the user's formal recipes (RecipesContext.myRecipes)
     - public recipes by friends (fetched on open)
     - all other public community recipes (fetched on open)

   Desktop renders the centered spotlight card; phone gets a full-page
   slide-up panel. Layered at z-[200] — the picker-sheet tier above the
   AddHomeMealModal shell (z-[100]). Selection returns a LinkedRecipeRef
   minus the placement flags; the caller decides where it surfaces.
   ──────────────────────────────────────────────────────────────────────── */

export type PickedRecipe = Omit<LinkedRecipeRef, 'inIngredients' | 'inMethod'>;

type Scope = 'all' | 'mine' | 'friends' | 'community';
const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'mine', label: 'My recipes' },
  { key: 'friends', label: 'Friends' },
  { key: 'community', label: 'Community' },
];

interface PickerItem extends PickedRecipe {
  key: string;
  scope: Exclude<Scope, 'all'>;
  scopeLabel: string;
  cuisine?: string;
  isPrivate: boolean;
  /** Sort key — newest first within a scope. */
  sortTs: number;
}

function hashToHue(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return ((h % 360) + 360) % 360;
}

function formatMin(m?: number): string | null {
  if (!m || m <= 0) return null;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h === 0) return `${mm} min`;
  return mm === 0 ? `${h} hr` : `${h} hr ${mm} min`;
}

interface RecipeLinkPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called with the chosen recipe; the picker closes itself after. */
  onPick: (recipe: PickedRecipe) => void;
  /** Ids already linked — rendered checked + non-clickable. */
  linkedIds: string[];
  /** The recipe being edited, so it can't link to itself. */
  excludeId?: string | null;
}

export const RecipeLinkPicker: React.FC<RecipeLinkPickerProps> = ({ open, onClose, onPick, linkedIds, excludeId }) => {
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const { homeMeals } = useLists();
  const {
    myRecipes, friendRecipes, publicRecipes,
    fetchFriendRecipes, fetchPublicRecipes,
  } = useRecipes();

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<Scope>('all');
  const [loadingRemote, setLoadingRemote] = useState(false);
  const [authorProfiles, setAuthorProfiles] = useState<Record<string, UserProfile>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const myId = user?.id || '';

  // Fresh state + remote fetch on every open. Friend/community recipes are
  // on-demand caches in RecipesContext, so re-fetching keeps them current
  // without paying anything while the picker is closed.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setScope('all');
    setLoadingRemote(true);
    Promise.all([fetchFriendRecipes(), fetchPublicRecipes()])
      .finally(() => setLoadingRemote(false));
    if (!phoneMode) {
      const t = setTimeout(() => inputRef.current?.focus(), 180);
      return () => clearTimeout(t);
    }
  }, [open, phoneMode, fetchFriendRecipes, fetchPublicRecipes]);

  // Resolve display names for friend / community recipe authors.
  useEffect(() => {
    if (!open) return;
    const ids = Array.from(new Set(
      [...friendRecipes, ...publicRecipes].map((r) => r.userId).filter((id) => id && id !== myId),
    ));
    if (ids.length === 0) return;
    let cancelled = false;
    getProfilesByIds(ids).then((profiles) => {
      if (!cancelled) setAuthorProfiles((prev) => ({ ...prev, ...profiles }));
    });
    return () => { cancelled = true; };
  }, [open, friendRecipes, publicRecipes, myId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const items = useMemo<PickerItem[]>(() => {
    const seen = new Set<string>();
    const out: PickerItem[] = [];
    const push = (item: PickerItem) => {
      if (item.id === excludeId) return;
      if (seen.has(item.key)) return;
      seen.add(item.key);
      // Same underlying recipe can surface in both the friends and
      // community pools — first push (friends) wins.
      if (seen.has(`id-${item.id}`)) return;
      seen.add(`id-${item.id}`);
      out.push(item);
    };

    for (const m of homeMeals) {
      push({
        key: `homeMeal-${m.id}`,
        id: m.id,
        ownerId: myId,
        source: 'homeMeal',
        title: m.name,
        coverPhoto: m.coverPhoto || m.photos?.[0]?.url || undefined,
        authorName: 'You',
        totalTimeMin: (m.prepTime || 0) + (m.cookTime || 0) + (m.chillTime || 0) || undefined,
        scope: 'mine',
        scopeLabel: 'Pantry',
        cuisine: m.cuisine,
        isPrivate: !m.isPublic,
        sortTs: m.createdAt || 0,
      });
    }
    for (const r of myRecipes) {
      push({
        key: `recipe-${r.id}`,
        id: r.id,
        ownerId: r.userId || myId,
        source: 'recipe',
        title: r.title,
        coverPhoto: r.photos?.[0] || undefined,
        authorName: 'You',
        totalTimeMin: (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0) || undefined,
        scope: 'mine',
        scopeLabel: 'My recipe',
        cuisine: r.cuisine,
        isPrivate: !r.isPublic,
        sortTs: Date.parse(r.updatedAt || r.createdAt || '') || 0,
      });
    }
    const remote = (list: typeof friendRecipes, scopeKey: 'friends' | 'community', label: string) => {
      for (const r of list) {
        if (r.userId === myId) continue; // own recipes already covered above
        const profile = authorProfiles[r.userId];
        push({
          key: `recipe-${r.id}`,
          id: r.id,
          ownerId: r.userId,
          source: 'recipe',
          title: r.title,
          coverPhoto: r.photos?.[0] || undefined,
          authorName: profile?.display_name || profile?.username || 'A community cook',
          totalTimeMin: (r.prepTimeMinutes || 0) + (r.cookTimeMinutes || 0) || undefined,
          scope: scopeKey,
          scopeLabel: label,
          cuisine: r.cuisine,
          isPrivate: false,
          sortTs: Date.parse(r.updatedAt || r.createdAt || '') || 0,
        });
      }
    };
    remote(friendRecipes, 'friends', 'Friend');
    remote(publicRecipes, 'community', 'Community');
    return out;
  }, [homeMeals, myRecipes, friendRecipes, publicRecipes, authorProfiles, myId, excludeId]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter((it) =>
        (scope === 'all' || it.scope === scope) &&
        (q === '' ||
          it.title.toLowerCase().includes(q) ||
          (it.authorName || '').toLowerCase().includes(q) ||
          (it.cuisine || '').toLowerCase().includes(q)),
      )
      .sort((a, b) => {
        // Mine first when browsing All — the most likely link targets —
        // then friends, then community; newest first within each tier.
        if (scope === 'all' && a.scope !== b.scope) {
          const rank = { mine: 0, friends: 1, community: 2 } as const;
          return rank[a.scope] - rank[b.scope];
        }
        return b.sortTs - a.sortTs;
      });
  }, [items, query, scope]);

  const linkedSet = useMemo(() => new Set(linkedIds), [linkedIds]);

  const handlePick = (it: PickerItem) => {
    if (linkedSet.has(it.id)) return;
    onPick({
      id: it.id,
      ownerId: it.ownerId,
      source: it.source,
      title: it.title,
      coverPhoto: it.coverPhoto,
      authorName: it.authorName,
      totalTimeMin: it.totalTimeMin,
    });
    onClose();
  };

  const controls = (
    <div className="px-5 pt-3 pb-2 flex-shrink-0 space-y-3 border-b border-on-surface/6">
      <div className="relative">
        <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-on-surface/40" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your pantry, friends & community recipes"
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
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-5 px-5">
        {SCOPES.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setScope(key)}
            className={cn(
              'flex-shrink-0 px-3.5 py-2 rounded-full border text-[12.5px] font-semibold transition-colors',
              scope === key
                ? 'bg-on-surface text-surface border-on-surface'
                : 'bg-transparent border-on-surface/12 text-on-surface/65 hover:border-on-surface/35',
            )}
            aria-pressed={scope === key}
          >
            {label}
          </button>
        ))}
        {loadingRemote && (
          <span className="flex-shrink-0 inline-flex items-center gap-1.5 text-[12px] font-medium text-on-surface/45">
            <Loader2 size={12} className="animate-spin" /> Loading…
          </span>
        )}
      </div>
    </div>
  );

  const list = (
    <div className="flex-1 overflow-y-auto px-3 pb-safe-5 pt-2">
      {visible.length === 0 ? (
        <div className="py-14 flex flex-col items-center text-center px-6">
          <div className="w-12 h-12 rounded-2xl bg-on-surface/[0.05] grid place-items-center text-on-surface/40">
            <ChefHat size={20} />
          </div>
          <p className="mt-3 font-serif font-semibold text-[17px] text-on-surface">
            {loadingRemote ? 'Looking for recipes…' : 'No recipes match'}
          </p>
          <p className="mt-1 text-[13px] text-on-surface/55 max-w-[280px] leading-snug">
            {loadingRemote
              ? 'Community recipes are still loading.'
              : 'Try a different search, or switch scope to include friends and community recipes.'}
          </p>
        </div>
      ) : (
        <div className="space-y-0.5 pb-4">
          {visible.map((it) => {
            const already = linkedSet.has(it.id);
            const time = formatMin(it.totalTimeMin);
            return (
              <button
                key={it.key}
                type="button"
                onClick={() => handlePick(it)}
                disabled={already}
                className={cn(
                  'w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-colors',
                  already ? 'opacity-60 cursor-default' : 'hover:bg-on-surface/[0.04]',
                )}
              >
                <div
                  className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 relative"
                  style={{ background: `linear-gradient(135deg, hsl(${hashToHue(it.id)} 36% 62%), hsl(${(hashToHue(it.id) + 40) % 360} 40% 44%))` }}
                >
                  {it.coverPhoto && (
                    <img
                      src={it.coverPhoto}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-serif font-semibold text-[15px] leading-tight text-on-surface truncate">
                    {it.title || 'Untitled recipe'}
                  </p>
                  <p className="mt-0.5 text-[12px] text-on-surface/55 truncate">
                    by {it.authorName}
                    <span className="mx-1.5 text-on-surface/25">·</span>
                    {it.scopeLabel}
                    {it.cuisine ? <><span className="mx-1.5 text-on-surface/25">·</span>{it.cuisine}</> : null}
                  </p>
                  <p className="mt-1 flex items-center gap-2.5 text-[11px] font-semibold text-on-surface/45">
                    {time && <span className="inline-flex items-center gap-1"><Clock size={11} />{time}</span>}
                    {it.isPrivate && (
                      <span className="inline-flex items-center gap-1 text-amber-700/80"><Lock size={11} />Private</span>
                    )}
                  </p>
                </div>
                <span
                  className={cn(
                    'flex-shrink-0 inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-[12px] font-semibold',
                    already
                      ? 'bg-on-surface/[0.06] text-on-surface/50'
                      : 'bg-primary/10 text-primary',
                  )}
                >
                  {already ? (<><Check size={12} /> Linked</>) : 'Link'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        phoneMode ? (
          /* Phone: full-page slide-up panel. */
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring' as const, damping: 28, stiffness: 300 }}
            className="fixed inset-0 z-[200] bg-surface flex flex-col"
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
                Link a recipe
              </h3>
            </div>
            {controls}
            {list}
          </motion.div>
        ) : (
          /* Desktop: backdrop + centered spotlight card (change-location chrome). */
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[200] bg-black/45 backdrop-blur-md"
              onClick={onClose}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -4 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] as const }}
              className="fixed left-1/2 -translate-x-1/2 top-[8vh] w-full max-w-2xl max-h-[82vh] z-[200] bg-surface rounded-3xl shadow-[0_30px_80px_-16px_rgba(28,24,22,0.42)] ring-1 ring-on-surface/[0.06] flex flex-col overflow-hidden"
            >
              <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-on-surface/6 flex-shrink-0">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/45">
                    Component recipes
                  </p>
                  <h3 className="mt-1 font-serif font-semibold text-[24px] leading-tight tracking-[-0.02em] text-on-surface truncate">
                    Link a recipe
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
              {list}
            </motion.div>
          </>
        )
      )}
    </AnimatePresence>,
    document.getElementById('phone-frame-root') ?? document.body,
  );
};
