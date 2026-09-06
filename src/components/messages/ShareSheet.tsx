import { useSocialDialog } from '../social/useSocialDialog';
import '../social/SocialDesign.css';
// The thread's ONE share surface — the overhaul of the old pair of
// pickers. The composer's + opens this sheet: two tabs (Restaurant /
// Recipe), one search, one list per tab with the tab's two sources
// merged as captioned groups — your reviews above the live database,
// your cookbook above the community — pick a row, Send. Replaces
// ShareRestaurantPicker + ShareRecipePicker and the permanent two-button
// shelf that used to sit above the composer.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Send, Loader2, Store, ChefHat } from 'lucide-react';
import { cn } from '../../lib/utils';
import { displayCuisine } from '../../lib/cuisine';
import { scoreTintStyle } from '../../lib/score';
import { useLists, type RestaurantRating, type HomeMeal } from '../../contexts/ListsContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { type SharedRestaurant, type SharedRecipe } from '../../contexts/ChatContext';
import { searchPlacesByText, priceLevelToString, type PlaceResult } from '../../lib/places';
import { getCuisineLabel } from '../../pages/useRestaurantDetail';
import { loadLastSelectedLocation } from '../HomeLocationBar';
import { getAllPublicHomeMeals, getProfilesByIds, type FriendHomeMeal } from '../../lib/supabase-community';
import { getMealCoverUrl } from '../../lib/recipe-display';
import { SearchField } from '../SearchField';

type Kind = 'restaurant' | 'recipe';

function ratingToShared(r: RestaurantRating): SharedRestaurant {
  return {
    restaurantId: r.restaurantId,
    name: r.name,
    image: r.image,
    cuisine: r.cuisine,
    price: r.price,
    address: r.address,
    score: r.score,
    notes: r.notes,
    tags: r.tags,
    isReview: true,
  };
}

function placeToShared(p: PlaceResult): SharedRestaurant {
  return {
    restaurantId: p.id,
    name: p.name,
    image: p.photoUrl || '',
    cuisine: getCuisineLabel(p),
    price: priceLevelToString(p.priceLevel) || '',
    address: p.address || '',
    isReview: false,
  };
}

function timeLabel(total?: number): string {
  if (!total || total <= 0) return '';
  if (total < 60) return `${total}m`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function mealToShared(m: HomeMeal, authorId: string, authorName: string): SharedRecipe {
  return {
    mealId: m.id,
    authorId,
    authorName,
    name: m.name,
    image: getMealCoverUrl(m),
    description: m.description || undefined,
    tags: m.tags && m.tags.length > 0 ? m.tags : undefined,
    totalTime: ((m.prepTime ?? 0) + (m.cookTime ?? 0)) || undefined,
    difficulty: m.difficulty || undefined,
    ingredientCount: m.ingredients?.length || undefined,
    stepCount: m.steps?.length || undefined,
  };
}

/** One row of the share list — serif name over a quiet meta line, the
 *  tab's own fact worn as the trailing tag (score disc / time / price). */
const ShareRow: React.FC<{
  name: string;
  meta: string;
  tag?: React.ReactNode;
  picked: boolean;
  divider: boolean;
  onPick: () => void;
}> = ({ name, meta, tag, picked, divider, onPick }) => (
  <button
    type="button"
    onClick={onPick}
    className={cn(
      'w-full text-left flex items-center gap-3 px-3 -mx-3 py-[13px] rounded-2xl transition-colors',
      divider && !picked && 'border-t border-on-surface/[0.07]',
      picked ? 'bg-primary/[0.09]' : 'active:bg-on-surface/[0.05]',
    )}
  >
    <span className="flex-1 min-w-0 block">
      <span className="block font-sans font-bold text-[15px] leading-[1.2] tracking-[-0.015em] text-on-surface truncate">{name}</span>
      {meta && <span className="block mt-[5px] text-[12px] leading-[1.2] text-on-surface/50 truncate">{meta}</span>}
    </span>
    {tag}
  </button>
);

const ScoreTag: React.FC<{ score: number }> = ({ score }) => {
  const t = scoreTintStyle(score);
  return (
    <span
      className="flex-none grid place-items-center rounded-full font-sans font-bold tabular-nums"
      style={{ width: 38, height: 38, fontSize: 13, color: t.color, background: t.background, boxShadow: `inset 0 0 0 1.5px ${t.ring}` }}
    >
      {score.toFixed(1)}
    </span>
  );
};

const TextTag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="flex-none inline-flex items-center rounded-full px-2.5 h-7 text-[12px] font-bold bg-on-surface/[0.06] text-on-surface/60">
    {children}
  </span>
);

const GroupCaption: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <p className="pt-4 pb-1 text-[10px] font-bold uppercase tracking-[0.15em] text-on-surface/40">{children}</p>
);

export const ShareSheet: React.FC<{
  open: boolean;
  recipientName?: string;
  selfName?: string;
  onClose: () => void;
  onShareRestaurant: (restaurant: SharedRestaurant) => void;
  onShareRecipe: (recipe: SharedRecipe) => void;
}> = ({ open, recipientName, selfName, onClose, onShareRestaurant, onShareRecipe }) => {
  const dialogRef = useSocialDialog(open, onClose);
  const { ratings, homeMeals } = useLists();
  const { user } = useAuth();
  const { phoneMode } = useSettings();
  const [kind, setKind] = useState<Kind>('restaurant');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<
    | { kind: 'restaurant'; value: SharedRestaurant }
    | { kind: 'recipe'; value: SharedRecipe }
    | null
  >(null);

  // Live database search — same request the old restaurant picker made.
  const [dbResults, setDbResults] = useState<PlaceResult[]>([]);
  const [dbLoading, setDbLoading] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const searchSeq = useRef(0);

  // Community recipes — loaded lazily the first time the Recipe tab shows.
  const [community, setCommunity] = useState<{ meal: FriendHomeMeal; authorName: string }[]>([]);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [communityLoading, setCommunityLoading] = useState(false);
  const loadSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setKind('restaurant');
    setQuery('');
    setPicked(null);
    setDbResults([]);
    const last = loadLastSelectedLocation();
    if (last) setCoords({ lat: last.lat, lng: last.lng });
  }, [open]);

  // Tab change clears the pick and the query — the two lists share nothing.
  useEffect(() => {
    setPicked(null);
    setQuery('');
  }, [kind]);

  useEffect(() => {
    if (!open || kind !== 'restaurant') return;
    const q = query.trim();
    if (!q || !coords) { setDbResults([]); setDbLoading(false); return; }
    const seq = ++searchSeq.current;
    setDbLoading(true);
    const t = setTimeout(async () => {
      const res = await searchPlacesByText(q, coords.lat, coords.lng);
      if (seq !== searchSeq.current) return;
      setDbResults(res);
      setDbLoading(false);
    }, 350);
    return () => clearTimeout(t);
  }, [open, kind, query, coords]);

  useEffect(() => {
    if (!open || kind !== 'recipe' || communityLoaded || communityLoading || !user?.id) return;
    const seq = ++loadSeq.current;
    setCommunityLoading(true);
    (async () => {
      try {
        const meals = await getAllPublicHomeMeals(user.id, { mealLimit: 60 });
        const ids = Array.from(new Set(meals.map((m) => m.userId)));
        const profs = ids.length > 0 ? await getProfilesByIds(ids) : {};
        if (seq !== loadSeq.current) return;
        setCommunity(meals.map((m) => ({
          meal: m,
          authorName: profs[m.userId]?.display_name || profs[m.userId]?.username || 'A cook',
        })));
        setCommunityLoaded(true);
      } finally {
        if (seq === loadSeq.current) setCommunityLoading(false);
      }
    })();
  }, [open, kind, communityLoaded, communityLoading, user?.id]);

  const q = query.trim().toLowerCase();

  const ratedRows = useMemo(() => {
    if (!q) return ratings;
    return ratings.filter((r) => r.name.toLowerCase().includes(q) || r.cuisine.toLowerCase().includes(q));
  }, [ratings, q]);

  const myRecipes = useMemo(() => {
    const mine = homeMeals;
    if (!q) return mine;
    return mine.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      (m.tags || []).some((t) => t.toLowerCase().includes(q)),
    );
  }, [homeMeals, q]);

  const communityRows = useMemo(() => {
    const others = community.filter((c) => c.meal.userId !== user?.id);
    if (!q) return others;
    return others.filter((c) => c.meal.name.toLowerCase().includes(q));
  }, [community, q, user?.id]);

  const first = (recipientName || '').split(' ')[0] || 'them';
  const canSend = !!picked;
  const status = picked
    ? `Sharing ${picked.value.name}`
    : kind === 'restaurant'
      ? 'Pick a place to share'
      : 'Pick a recipe to share';

  const send = () => {
    if (!picked) return;
    if (picked.kind === 'restaurant') onShareRestaurant(picked.value);
    else onShareRecipe(picked.value);
    onClose();
  };

  const restaurantMeta = (cuisine: string, price: string, city: string) =>
    [displayCuisine(cuisine), price, city].filter(Boolean).join(' · ');

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[3px]"
            onClick={onClose}
          />
          <div className={cn('fixed inset-0 z-[90] pointer-events-none', phoneMode ? 'flex items-end' : 'grid place-items-center p-6')}>
            <motion.div
              ref={dialogRef} role="dialog" aria-modal="true" aria-label="Share to conversation"
              initial={phoneMode ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.985 }}
              animate={phoneMode ? { y: 0 } : { opacity: 1, y: 0, scale: 1 }}
              exit={phoneMode ? { y: '100%' } : { opacity: 0, y: 10, scale: 0.985 }}
              transition={{ type: 'spring', damping: 30, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className={cn(
                'social-design social-share-sheet pointer-events-auto flex flex-col bg-surface overflow-hidden',
                phoneMode
                  ? 'w-full h-[76vh] rounded-t-[28px] shadow-[0_-14px_40px_rgba(0,0,0,0.25)]'
                  : 'w-full max-w-xl max-h-[80vh] rounded-[28px] border border-on-surface/10 shadow-2xl',
              )}
            >
              {phoneMode && (
                <div className="flex justify-center pt-3 flex-shrink-0"><div className="w-[38px] h-1 rounded-full bg-on-surface/20" /></div>
              )}

              {/* Title */}
              <div className="flex-shrink-0 px-5 pt-3.5 flex items-center gap-3">
                <h2 className="flex-1 min-w-0 font-sans font-bold text-[22px] leading-[1.1] tracking-[-0.02em] truncate">
                  Share to {first}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="flex-none w-8 h-8 rounded-full grid place-items-center bg-on-surface/[0.07] text-on-surface active:bg-on-surface/[0.13] transition-colors"
                >
                  <X size={15} strokeWidth={2.3} />
                </button>
              </div>

              {/* Kind tabs */}
              <div className="flex-shrink-0 px-5 pt-3.5 flex gap-2">
                {([['restaurant', 'Restaurant', <Store key="i" size={13} />], ['recipe', 'Recipe', <ChefHat key="i" size={13} />]] as const).map(([key, label, icon]) => {
                  const on = kind === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setKind(key)}
                      aria-pressed={on}
                      className={cn(
                        'flex-1 h-10 rounded-full inline-flex items-center justify-center gap-1.5 text-[12.5px] font-bold transition-colors',
                        on ? 'bg-on-surface text-surface' : 'bg-on-surface/[0.06] text-on-surface active:bg-on-surface/[0.1]',
                      )}
                    >
                      {icon}
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Search */}
              <div className="flex-shrink-0 px-5 pt-3">
                <SearchField
                  value={query}
                  onChange={setQuery}
                  placeholder={kind === 'restaurant' ? 'Your reviews or the whole database' : 'Your cookbook or the community'}
                  aria-label="Search things to share"
                />
              </div>

              {/* List */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-3">
                {kind === 'restaurant' ? (
                  <>
                    {ratedRows.length > 0 && (
                      <>
                        <GroupCaption>Your reviews</GroupCaption>
                        {ratedRows.map((r, i) => {
                          const shared = ratingToShared(r);
                          const on = picked?.kind === 'restaurant' && picked.value.restaurantId === r.restaurantId && picked.value.isReview;
                          return (
                            <ShareRow
                              key={`rated-${r.restaurantId}`}
                              name={r.name}
                              meta={restaurantMeta(r.cuisine, r.price, r.city || '')}
                              tag={<ScoreTag score={r.score} />}
                              picked={!!on}
                              divider={i > 0}
                              onPick={() => setPicked(on ? null : { kind: 'restaurant', value: shared })}
                            />
                          );
                        })}
                      </>
                    )}
                    {q && (
                      <>
                        <GroupCaption>From the database</GroupCaption>
                        {dbLoading && dbResults.length === 0 && (
                          <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-on-surface/30" /></div>
                        )}
                        {!dbLoading && dbResults.length === 0 && (
                          <p className="py-4 text-[12.5px] text-on-surface/40">
                            {coords ? 'Nothing in the database matches that here.' : 'Set a home location to search the database.'}
                          </p>
                        )}
                        {dbResults.map((p, i) => {
                          const shared = placeToShared(p);
                          const on = picked?.kind === 'restaurant' && picked.value.restaurantId === p.id && !picked.value.isReview;
                          return (
                            <ShareRow
                              key={`db-${p.id}`}
                              name={p.name}
                              meta={restaurantMeta(shared.cuisine || '', shared.price || '', p.address?.split(',')[1]?.trim() || '')}
                              tag={shared.price ? <TextTag>{shared.price}</TextTag> : undefined}
                              picked={!!on}
                              divider={i > 0}
                              onPick={() => setPicked(on ? null : { kind: 'restaurant', value: shared })}
                            />
                          );
                        })}
                      </>
                    )}
                    {!q && ratedRows.length === 0 && (
                      <p className="py-10 text-center text-[13px] text-on-surface/40">
                        No reviews yet — search to share from the database.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    {myRecipes.length > 0 && (
                      <>
                        <GroupCaption>Your cookbook</GroupCaption>
                        {myRecipes.map((m, i) => {
                          const shared = mealToShared(m, user?.id || '', selfName || 'You');
                          const on = picked?.kind === 'recipe' && picked.value.mealId === m.id && picked.value.authorId === (user?.id || '');
                          const t = timeLabel(shared.totalTime);
                          return (
                            <ShareRow
                              key={`mine-${m.id}`}
                              name={m.name}
                              meta={[shared.difficulty, shared.ingredientCount ? `${shared.ingredientCount} ingredients` : ''].filter(Boolean).join(' · ')}
                              tag={t ? <TextTag>{t}</TextTag> : undefined}
                              picked={!!on}
                              divider={i > 0}
                              onPick={() => setPicked(on ? null : { kind: 'recipe', value: shared })}
                            />
                          );
                        })}
                      </>
                    )}
                    <GroupCaption>From the community</GroupCaption>
                    {communityLoading && (
                      <div className="flex justify-center py-6"><Loader2 size={16} className="animate-spin text-on-surface/30" /></div>
                    )}
                    {!communityLoading && communityRows.length === 0 && (
                      <p className="py-4 text-[12.5px] text-on-surface/40">
                        {q ? 'No community recipes match that.' : 'Nothing from the community yet.'}
                      </p>
                    )}
                    {communityRows.map((c, i) => {
                      const shared = mealToShared(c.meal, c.meal.userId, c.authorName);
                      const on = picked?.kind === 'recipe' && picked.value.mealId === c.meal.id && picked.value.authorId === c.meal.userId;
                      const t = timeLabel(shared.totalTime);
                      return (
                        <ShareRow
                          key={`community-${c.meal.userId}-${c.meal.id}`}
                          name={c.meal.name}
                          meta={`by ${c.authorName}${shared.difficulty ? ` · ${shared.difficulty}` : ''}`}
                          tag={t ? <TextTag>{t}</TextTag> : undefined}
                          picked={!!on}
                          divider={i > 0}
                          onPick={() => setPicked(on ? null : { kind: 'recipe', value: shared })}
                        />
                      );
                    })}
                    {!q && myRecipes.length === 0 && !communityLoading && communityRows.length === 0 && (
                      <p className="py-10 text-center text-[13px] text-on-surface/40">No recipes yet.</p>
                    )}
                  </>
                )}
              </div>

              {/* Footer */}
              <div className="flex-shrink-0 border-t border-on-surface/[0.09] px-5 pt-3 pb-[max(env(safe-area-inset-bottom),18px)] flex items-center gap-3">
                <span className={cn('flex-1 min-w-0 truncate text-[12.5px]', picked ? 'text-on-surface/75 font-semibold' : 'text-on-surface/45')}>
                  {status}
                </span>
                <button
                  type="button"
                  onClick={send}
                  disabled={!canSend}
                  className={cn(
                    'flex-none inline-flex items-center gap-2 h-11 px-5 rounded-full text-[13px] font-bold transition-all',
                    canSend ? 'bg-primary text-on-primary active:scale-[0.97]' : 'bg-on-surface/[0.08] text-on-surface/35',
                  )}
                >
                  <Send size={14} />
                  Send
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};
