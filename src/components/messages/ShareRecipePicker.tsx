// Desktop share-a-recipe picker (Messages composer).
// Two tabs: "Your recipes" (the user's cookbook / home meals from
// ListsContext) and "All recipes" (public home meals across the community,
// via getAllPublicHomeMeals). Selecting a recipe + Send hands a SharedRecipe
// back to the chat, which sends it into the current thread.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Search, ChefHat, Clock, Send, Loader2, SlidersHorizontal, BookOpen } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useLists, type HomeMeal } from '../../contexts/ListsContext';
import { useAuth } from '../../contexts/AuthContext';
import { type SharedRecipe } from '../../contexts/ChatContext';
import { getAllPublicHomeMeals, getProfilesByIds, type FriendHomeMeal } from '../../lib/supabase-community';
import { getMealCoverUrl } from '../../lib/recipe-display';

type Tab = 'mine' | 'all';
const DIFFICULTIES = ['Easy', 'Medium', 'Hard'];

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

export const ShareRecipePicker: React.FC<{
  open: boolean;
  recipientName?: string;
  selfName?: string;
  onClose: () => void;
  onShare: (recipe: SharedRecipe) => void;
}> = ({ open, recipientName, selfName, onClose, onShare }) => {
  const { homeMeals } = useLists();
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('mine');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<SharedRecipe | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [difficulty, setDifficulty] = useState<string | null>(null);

  // Community recipes — loaded lazily the first time the "All" tab opens.
  const [community, setCommunity] = useState<{ meal: FriendHomeMeal; authorName: string }[]>([]);
  const [communityLoaded, setCommunityLoaded] = useState(false);
  const [communityLoading, setCommunityLoading] = useState(false);
  const loadSeq = useRef(0);

  useEffect(() => {
    if (!open) return;
    setTab('mine');
    setQuery('');
    setPicked(null);
    setShowFilters(false);
    setDifficulty(null);
  }, [open]);

  useEffect(() => {
    if (!open || tab !== 'all' || communityLoaded || communityLoading || !user?.id) return;
    const seq = ++loadSeq.current;
    setCommunityLoading(true);
    (async () => {
      const meals = await getAllPublicHomeMeals(user.id, { mealLimit: 60 });
      const ids = Array.from(new Set(meals.map((m) => m.userId)));
      const profs = ids.length > 0 ? await getProfilesByIds(ids) : {};
      if (seq !== loadSeq.current) return;
      setCommunity(meals.map((m) => ({
        meal: m,
        authorName: profs[m.userId]?.display_name || profs[m.userId]?.username || 'A cook',
      })));
      setCommunityLoaded(true);
      setCommunityLoading(false);
    })();
  }, [open, tab, communityLoaded, communityLoading, user?.id]);

  const matchesFilters = (m: HomeMeal) => {
    if (difficulty && m.difficulty !== difficulty) return false;
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const hay = `${m.name} ${m.cuisine || ''} ${(m.tags || []).join(' ')} ${m.description || ''}`.toLowerCase();
    return hay.includes(q);
  };

  const mineFiltered = useMemo(() => homeMeals.filter(matchesFilters), [homeMeals, query, difficulty]);
  const allFiltered = useMemo(() => community.filter((c) => matchesFilters(c.meal)), [community, query, difficulty]);

  const selfAuthor = selfName || user?.email?.split('@')[0] || 'You';

  const tabsMeta: { key: Tab; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'mine', label: 'Your recipes', icon: <ChefHat size={14} />, count: homeMeals.length },
    { key: 'all', label: 'All recipes', icon: <BookOpen size={14} />, count: communityLoaded ? community.length : undefined },
  ];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] bg-black/45 backdrop-blur-sm" onClick={onClose}
          />
          <div className="fixed inset-0 z-[90] grid place-items-center p-6 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.985 }}
              transition={{ type: 'spring', damping: 26, stiffness: 320 }}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto w-full max-w-3xl max-h-[86vh] flex flex-col rounded-3xl bg-surface border border-on-surface/10 shadow-2xl overflow-hidden"
            >
              {/* Header */}
              <div className="px-7 pt-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-serif font-bold text-2xl tracking-tight">Share a recipe</h2>
                    <p className="text-[13.5px] text-on-surface/55 mt-1">Pick from your cookbook or search community recipes.</p>
                    {recipientName && (
                      <span className="inline-flex items-center gap-1.5 mt-3 pl-2.5 pr-3 py-1 rounded-full bg-on-surface/[0.05] border border-on-surface/10 text-[12px] font-medium">
                        <span className="text-on-surface/45">To</span>
                        <span className="text-on-surface">{recipientName}</span>
                      </span>
                    )}
                  </div>
                  <button onClick={onClose} className="w-9 h-9 rounded-full bg-on-surface/[0.05] border border-on-surface/10 grid place-items-center text-on-surface/55 hover:text-on-surface hover:bg-on-surface/10 transition-colors">
                    <X size={16} />
                  </button>
                </div>
                {/* Tabs */}
                <div className="flex gap-1 mt-5 border-b border-on-surface/10">
                  {tabsMeta.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => { setTab(t.key); setPicked(null); }}
                      className={cn(
                        'relative inline-flex items-center gap-2 px-3.5 pb-3 pt-1 text-[13px] transition-colors',
                        tab === t.key ? 'text-on-surface font-semibold' : 'text-on-surface/50 hover:text-on-surface/75 font-medium',
                      )}
                    >
                      {t.icon}{t.label}
                      {t.count !== undefined && (
                        <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded-full', tab === t.key ? 'bg-primary/12 text-primary' : 'bg-on-surface/[0.06] text-on-surface/45')}>{t.count}</span>
                      )}
                      {tab === t.key && <span className="absolute left-3 right-3 -bottom-px h-0.5 rounded-full bg-primary" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search + filters */}
              <div className="px-7 pt-4 pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2.5 h-11 px-3.5 rounded-2xl bg-on-surface/[0.04] border border-on-surface/10 focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                    <Search size={16} className="text-on-surface/40 flex-shrink-0" />
                    <input
                      autoFocus
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={tab === 'mine' ? 'Search your cookbook…' : 'Search community recipes…'}
                      className="flex-1 bg-transparent text-sm text-on-surface placeholder:text-on-surface/35 focus:outline-none"
                    />
                  </div>
                  <button
                    onClick={() => setShowFilters((v) => !v)}
                    className={cn(
                      'inline-flex items-center gap-1.5 h-11 px-3.5 rounded-2xl border text-[12.5px] font-semibold transition-colors',
                      showFilters || difficulty ? 'bg-primary/10 border-primary/30 text-primary' : 'bg-on-surface/[0.04] border-on-surface/10 text-on-surface/70 hover:border-on-surface/20',
                    )}
                  >
                    <SlidersHorizontal size={13} /> Filters
                  </button>
                </div>
                {showFilters && (
                  <div className="flex items-center gap-2 mt-3">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-on-surface/40">Difficulty</span>
                    {DIFFICULTIES.map((d) => (
                      <button
                        key={d}
                        onClick={() => setDifficulty((cur) => (cur === d ? null : d))}
                        className={cn(
                          'px-3 py-1 rounded-full text-[12px] font-semibold transition-colors',
                          difficulty === d ? 'bg-primary text-white' : 'bg-on-surface/[0.06] text-on-surface/60 hover:bg-on-surface/10',
                        )}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-7 pb-4 min-h-0">
                {tab === 'mine' ? (
                  mineFiltered.length === 0 ? (
                    <EmptyState text={query || difficulty ? 'No matching recipes.' : 'Your cookbook is empty.'} />
                  ) : (
                    <>
                      <SectionLabel text={`${mineFiltered.length} of your recipes`} />
                      <div className="flex flex-col -mx-1">
                        {mineFiltered.map((m) => {
                          const shared = mealToShared(m, user?.id || '', selfAuthor);
                          const sel = picked?.mealId === m.id && picked?.authorId === (user?.id || '');
                          return (
                            <RecipeRow
                              key={m.id}
                              name={m.name}
                              cuisine={m.cuisine}
                              difficulty={m.difficulty}
                              byline="You"
                              time={timeLabel(shared.totalTime)}
                              selected={sel}
                              onClick={() => setPicked(shared)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )
                ) : (
                  communityLoading ? (
                    <div className="flex items-center justify-center py-16 text-on-surface/40"><Loader2 size={22} className="animate-spin" /></div>
                  ) : allFiltered.length === 0 ? (
                    <EmptyState text={query || difficulty ? 'No matching recipes.' : 'No community recipes yet.'} />
                  ) : (
                    <>
                      <SectionLabel text={`${allFiltered.length} recipe${allFiltered.length === 1 ? '' : 's'} from the community`} />
                      <div className="flex flex-col -mx-1">
                        {allFiltered.map(({ meal, authorName }) => {
                          const shared = mealToShared(meal, meal.userId, authorName);
                          const sel = picked?.mealId === meal.id && picked?.authorId === meal.userId;
                          return (
                            <RecipeRow
                              key={`${meal.userId}-${meal.id}`}
                              name={meal.name}
                              cuisine={meal.cuisine}
                              difficulty={meal.difficulty}
                              byline={authorName}
                              time={timeLabel(shared.totalTime)}
                              selected={sel}
                              onClick={() => setPicked(shared)}
                            />
                          );
                        })}
                      </div>
                    </>
                  )
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-3 px-7 py-4 border-t border-on-surface/10 bg-surface">
                <p className="flex-1 text-[13px] text-on-surface/55 truncate">
                  {picked ? <>Sending <b className="text-on-surface font-semibold">{picked.name}</b>{recipientName ? <> to <b className="text-on-surface font-semibold">{recipientName}</b></> : ''}.</> : 'Pick a recipe to share.'}
                </p>
                <button onClick={onClose} className="px-4 py-2 rounded-full text-[13px] font-semibold text-on-surface/60 hover:text-on-surface hover:bg-on-surface/[0.06] transition-colors">Cancel</button>
                <button
                  onClick={() => { if (picked) { onShare(picked); onClose(); } }}
                  disabled={!picked}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-full text-[13px] font-semibold bg-primary text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
                >
                  <Send size={14} /> Send
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

/* ── shared bits ── */

const SectionLabel: React.FC<{ text: string }> = ({ text }) => (
  <div className="flex items-center gap-3 pt-3 pb-2.5">
    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-on-surface/40 whitespace-nowrap">{text}</span>
    <span className="flex-1 h-px bg-on-surface/8" />
  </div>
);

const EmptyState: React.FC<{ text: string }> = ({ text }) => (
  <div className="text-center py-16 text-on-surface/35">
    <ChefHat size={26} className="mx-auto mb-3 text-on-surface/20" />
    <p className="font-serif italic text-[17px]">{text}</p>
  </div>
);

/** Single-column recipe row — mirrors the restaurant rows / header search:
 *  serif name + dimmed "cuisine · difficulty · by author", time pill at right. */
const RecipeRow: React.FC<{
  name: string;
  cuisine?: string;
  difficulty?: string;
  byline: string;
  time: string;
  selected: boolean;
  onClick: () => void;
}> = ({ name, cuisine, difficulty, byline, time, selected, onClick }) => (
  <button
    onClick={onClick}
    className={cn(
      'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors',
      selected ? 'bg-primary/[0.07] ring-1 ring-primary/30' : 'hover:bg-on-surface/[0.04]',
    )}
  >
    <div className="min-w-0 flex-1">
      <p className="font-serif font-bold text-[15px] text-on-surface leading-tight truncate">{name}</p>
      <p className="text-[12px] text-on-surface/50 leading-tight truncate mt-0.5">
        {cuisine || 'Recipe'}
        {difficulty ? <span className="text-on-surface/30"> · {difficulty}</span> : null}
        <span className="text-on-surface/30"> · by {byline}</span>
      </p>
    </div>
    {time && (
      <span className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-on-surface/60 bg-on-surface/[0.06] px-2 py-1 rounded-full">
        <Clock size={11} /> {time}
      </span>
    )}
  </button>
);
