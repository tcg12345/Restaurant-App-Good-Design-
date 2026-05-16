/**
 * GuideDetail — editorial reader for a single guide.
 *
 * Layout follows the Best-Chinese-Restaurants-in-NYC mock:
 *   • Hero with cover photo, gradient overlay, serif title, author chip,
 *     SPOTS / AVG / read-time stat row, and Save / Share / View map CTAs.
 *   • Body is two-column on desktop (left = intro + numbered entries,
 *     right = sticky "In this guide" nav). One column on mobile.
 *   • Each entry: big red numeral, photo with score badge, name + meta,
 *     description, MUST ORDER / BEST FOR / INSIDER TIP block, link out.
 *   • Footer: author card with bio + follow.
 *
 * Owners see Edit / Unpublish controls in the top bar.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Bookmark, Share2, MapIcon, BookOpen, ChefHat, Check, ArrowUpRight, Edit3, EyeOff, Loader2, Heart, Plus, Clock, MapPin } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { getGuideById, saveGuideBookmark, removeGuideBookmark, getSavedGuideIds, saveGuide, type Guide, type GuideEntry } from '../lib/supabase-guides';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { ShareDialog } from '../components/ShareDialog';
import { RestaurantPanel, type RestaurantPanelSnapshot } from '../components/RestaurantPanel';
import { RecipePanel, type RecipePanelSnapshot } from '../components/RecipePanel';
import { scoreColor } from '../lib/score';
import { ScoreBadge } from '../components/ScoreBadge';

const numLabel = (n: number) => n.toString().padStart(2, '0');

/** Tailwind's lg breakpoint — desktop panel only kicks in at this width. */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

/** Pull cuisine / price / neighborhood out of an entry's "X · Y · Z" subtitle. */
function parseRestaurantSubtitle(subtitle: string): { cuisine: string; price: string } {
  const parts = subtitle.split(/\s·\s/).map((s) => s.trim()).filter(Boolean);
  let cuisine = '';
  let price = '';
  for (const p of parts) {
    if (/^\$+$/.test(p)) price = p;
    else if (!cuisine) cuisine = p;
  }
  return { cuisine, price };
}

function entryToRestaurantSnapshot(entry: GuideEntry): RestaurantPanelSnapshot {
  const { cuisine, price } = parseRestaurantSubtitle(entry.subtitle);
  return {
    id: entry.refId,
    name: entry.name,
    cuisine,
    price,
    address: entry.neighborhood || '',
    image: entry.image || undefined,
    score: entry.score,
  };
}

function entryToRecipeSnapshot(entry: GuideEntry): RecipePanelSnapshot | null {
  if (!entry.authorId) return null;
  return {
    authorId: entry.authorId,
    recipe: {
      id: entry.refId,
      title: entry.name,
      prepTime: 0,
      cookTime: entry.totalTime || 0,
      servings: 0,
      difficulty: (entry.difficulty as 'Easy' | 'Medium' | 'Hard') || 'Medium',
      image: entry.image || undefined,
    },
  };
}

export const GuideDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const { isWishlisted, toggleWishlist, openAddToListModal, getRestaurantInfo } = useLists();
  const isDesktop = useIsDesktop();

  const [guide, setGuide] = useState<Guide | null>(null);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeEntryIdx, setActiveEntryIdx] = useState(0);
  // Desktop-only side panels for the restaurant / recipe overlay. Mobile
  // navigates to the full detail page instead.
  const [restaurantPanel, setRestaurantPanel] = useState<RestaurantPanelSnapshot | null>(null);
  const [recipePanel, setRecipePanel] = useState<RecipePanelSnapshot | null>(null);
  // Suppress the scroll-close handler for the first frame after opening,
  // since opening the panel can itself shift layout enough to register
  // as scroll movement and immediately close again.
  const panelOpenedAtRef = useRef<number>(0);

  const isOwner = !!(user?.id && guide && guide.userId === user.id);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const g = await getGuideById(id);
      if (cancelled) return;
      setGuide(g);
      setLoading(false);
      if (g) {
        const profiles = await getProfilesByIds([g.userId]);
        if (!cancelled) setAuthorProfile(profiles[g.userId] || null);
      }
      if (g && user?.id) {
        const savedIds = await getSavedGuideIds(user.id);
        if (!cancelled) setSaved(savedIds.has(g.id));
      }
    })();
    return () => { cancelled = true; };
  }, [id, user?.id]);

  // Scroll-spy: highlight the entry currently in view inside the sticky nav.
  // Also auto-closes the desktop side panel on scroll (per spec) — a
  // small 250 ms grace window after open keeps the layout shift from
  // immediately closing the panel we just opened.
  useEffect(() => {
    if (!guide) return;
    const handler = () => {
      const headings = guide.entries
        .map((_, i) => document.getElementById(`guide-entry-${i}`))
        .filter((el): el is HTMLElement => !!el);
      const yMid = window.innerHeight / 3;
      let bestIdx = 0;
      for (let i = 0; i < headings.length; i++) {
        const top = headings[i].getBoundingClientRect().top;
        if (top <= yMid) bestIdx = i;
        else break;
      }
      setActiveEntryIdx(bestIdx);
      if ((restaurantPanel || recipePanel) && Date.now() - panelOpenedAtRef.current > 250) {
        setRestaurantPanel(null);
        setRecipePanel(null);
      }
    };
    window.addEventListener('scroll', handler, { passive: true });
    handler();
    return () => window.removeEventListener('scroll', handler);
  }, [guide, restaurantPanel, recipePanel]);

  const openRestaurantPanelFor = useCallback((entry: GuideEntry) => {
    setRecipePanel(null);
    setRestaurantPanel(entryToRestaurantSnapshot(entry));
    panelOpenedAtRef.current = Date.now();
  }, []);
  const openRecipePanelFor = useCallback((entry: GuideEntry) => {
    const snap = entryToRecipeSnapshot(entry);
    if (!snap) return;
    setRestaurantPanel(null);
    setRecipePanel(snap);
    panelOpenedAtRef.current = Date.now();
  }, []);

  const onToggleSave = async () => {
    if (!user?.id || !guide || savingToggle) return;
    setSavingToggle(true);
    const ok = saved
      ? await removeGuideBookmark(user.id, guide.id)
      : await saveGuideBookmark(user.id, guide.id);
    setSavingToggle(false);
    if (!ok) {
      showToast(saved ? "Couldn't unsave" : "Couldn't save");
      return;
    }
    setSaved(!saved);
    showToast(saved ? 'Removed from saved' : 'Guide saved');
  };

  const onUnpublish = async () => {
    if (!guide || !user?.id || !isOwner) return;
    const updated = await saveGuide(user.id, {
      id: guide.id,
      type: guide.type,
      title: guide.title,
      subtitle: guide.subtitle,
      intro: guide.intro,
      coverPhoto: guide.coverPhoto,
      tags: guide.tags,
      visibility: guide.visibility,
      isPublished: false,
      entries: guide.entries,
    });
    if (updated) {
      setGuide(updated);
      showToast('Guide unpublished');
    } else {
      showToast("Couldn't unpublish");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f4f2ec]">
        <Loader2 size={28} className="animate-spin text-primary/60" />
      </div>
    );
  }

  if (!guide) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f4f2ec] p-8 text-center">
        <BookOpen size={32} className="text-on-surface/25 mb-3" />
        <p className="text-base font-serif font-bold mb-1">Guide not found</p>
        <p className="text-sm text-on-surface/55 mb-4">It may have been unpublished or deleted.</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold">
          Back to Discover
        </button>
      </div>
    );
  }

  const authorName = authorProfile?.display_name || authorProfile?.username || 'Anonymous';
  const authorHandle = authorProfile?.username ? `@${authorProfile.username}` : '';
  const avgScoreLabel = guide.avgScore != null ? guide.avgScore.toFixed(1) : null;
  const readMin = guide.readMinutes ?? 1;
  const TypeIcon = guide.type === 'recipes' ? ChefHat : BookOpen;

  return (
    <div className="min-h-screen bg-[#f4f2ec] text-on-surface">
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        payload={{
          sharedGuide: {
            guideId: guide.id,
            title: guide.title,
            subtitle: guide.subtitle,
            coverPhoto: guide.coverPhoto,
            authorName,
            type: guide.type,
            entryCount: guide.entries.length,
            avgScore: guide.avgScore,
          },
        }}
        externalShareUrl={typeof window !== 'undefined' ? `${window.location.origin}/guides/${guide.id}` : undefined}
      />

      {/* Hero */}
      <div className="relative">
        <div className="relative h-[440px] lg:h-[520px] overflow-hidden">
          {guide.coverPhoto ? (
            <img src={guide.coverPhoto} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-stone-700 to-stone-900" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/25 to-transparent pointer-events-none" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 to-transparent pointer-events-none" />

          {/* Top bar */}
          <div className="absolute top-0 inset-x-0 px-4 pt-safe-4 lg:px-8 lg:pt-6 flex items-center justify-between gap-2 z-10">
            <button
              onClick={() => navigate(-1)}
              className="inline-flex items-center gap-1.5 pl-2 pr-3 py-1.5 rounded-full bg-white/95 hover:bg-white text-on-surface/85 text-sm font-semibold shadow-sm"
            >
              <ArrowLeft size={16} />
              Discover
            </button>
            <div className="flex items-center gap-2">
              {isOwner && (
                <>
                  <Link
                    to={`/guides/${guide.id}/edit`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 hover:bg-white text-on-surface/85 text-sm font-semibold shadow-sm"
                  >
                    <Edit3 size={14} />
                    Edit
                  </Link>
                  {guide.isPublished && (
                    <button
                      onClick={onUnpublish}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 hover:bg-white text-on-surface/85 text-sm font-semibold shadow-sm"
                    >
                      <EyeOff size={14} />
                      Unpublish
                    </button>
                  )}
                </>
              )}
              <button
                onClick={() => setShareOpen(true)}
                aria-label="Share"
                className="w-9 h-9 rounded-full bg-white/95 hover:bg-white flex items-center justify-center text-on-surface/85 shadow-sm"
              >
                <Share2 size={16} />
              </button>
              <button
                onClick={onToggleSave}
                aria-label={saved ? 'Unsave' : 'Save'}
                disabled={savingToggle}
                className={cn(
                  'w-9 h-9 rounded-full flex items-center justify-center shadow-sm transition-colors',
                  saved ? 'bg-primary text-white' : 'bg-white/95 hover:bg-white text-on-surface/85',
                )}
              >
                <Bookmark size={16} fill={saved ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>

          {/* Hero copy */}
          <div className="absolute bottom-0 inset-x-0 p-6 lg:p-12 z-10 max-w-2xl">
            <div className="flex items-center gap-2 text-white/75 text-[11px] font-bold uppercase tracking-[0.18em] mb-3">
              <span>Guides</span>
              <span>/</span>
              <span>{guide.type === 'recipes' ? 'Recipes' : 'Restaurants'}</span>
              {guide.tags[0] && (
                <>
                  <span>·</span>
                  <span>{guide.tags[0]}</span>
                </>
              )}
            </div>
            <h1 className="font-serif font-bold text-white text-[40px] lg:text-[64px] leading-[1.02] tracking-tight mb-4 drop-shadow-sm">
              {guide.title}
            </h1>
            {guide.subtitle && (
              <p className="text-white/80 text-[15px] lg:text-[17px] leading-snug max-w-xl mb-5">
                {guide.subtitle}
              </p>
            )}

            {/* Author + stats */}
            <div className="flex items-center gap-3 flex-wrap text-white/85 text-[13px]">
              <Link to={authorProfile?.username ? `/user/${authorProfile.username}` : '#'} className="flex items-center gap-2 bg-white/15 backdrop-blur rounded-full pl-1 pr-3 py-1 hover:bg-white/20 transition-colors">
                <div className="w-7 h-7 rounded-full bg-primary/85 text-white flex items-center justify-center font-bold text-[11px]">
                  {authorName[0]?.toUpperCase() || 'U'}
                </div>
                <span className="text-[13px] font-semibold">{authorName}</span>
                {authorHandle && <span className="text-white/55 text-[11px]">{authorHandle}</span>}
              </Link>
              <span className="text-white/45">·</span>
              <div className="inline-flex items-center gap-1">
                <span className="font-bold tabular-nums">{guide.entries.length}</span>
                <span className="uppercase text-[10.5px] tracking-[0.18em] text-white/65">{guide.type === 'recipes' ? 'recipes' : 'spots'}</span>
              </div>
              {avgScoreLabel && (
                <>
                  <span className="text-white/45">·</span>
                  <div className="inline-flex items-center gap-1">
                    <span className="font-bold tabular-nums">{avgScoreLabel}</span>
                    <span className="uppercase text-[10.5px] tracking-[0.18em] text-white/65">avg</span>
                  </div>
                </>
              )}
              <span className="text-white/45">·</span>
              <div className="inline-flex items-center gap-1">
                <span className="font-semibold">{readMin} min read</span>
              </div>
            </div>

            <div className="flex items-center gap-2 mt-5">
              <button
                onClick={onToggleSave}
                disabled={savingToggle}
                className={cn(
                  'inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold shadow-sm transition-colors',
                  saved ? 'bg-primary text-white' : 'bg-white text-on-surface hover:bg-white/90',
                )}
              >
                <Bookmark size={14} fill={saved ? 'currentColor' : 'none'} />
                {saved ? 'Saved' : 'Save guide'}
              </button>
              <button
                onClick={() => setShareOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 backdrop-blur text-white text-sm font-bold hover:bg-white/25 transition-colors"
              >
                <Share2 size={14} />
                Share
              </button>
              {guide.type === 'restaurants' && (
                <Link
                  to="/map"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/15 backdrop-blur text-white text-sm font-bold hover:bg-white/25 transition-colors"
                >
                  <MapIcon size={14} />
                  View map
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-6xl mx-auto px-6 lg:px-10 py-10 lg:py-14 grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-10 lg:gap-14">
        <div className="min-w-0">
          {/* Intro */}
          {guide.intro && (
            <div className="mb-10 lg:mb-14">
              <div className="text-primary font-serif text-4xl leading-none mb-2">&ldquo;</div>
              <p className="font-serif text-[20px] lg:text-[24px] leading-[1.45] text-on-surface/90">
                {guide.intro}
              </p>
            </div>
          )}

          {/* Tags */}
          {guide.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-10">
              {guide.tags.map((t) => (
                <span key={t} className="px-3 py-1 rounded-full bg-on-surface/[0.06] text-[12px] font-semibold text-on-surface/65">
                  {t}
                </span>
              ))}
            </div>
          )}

          {/* Entries */}
          <div className="space-y-16 lg:space-y-24">
            {guide.entries.map((entry, idx) => {
              const orderedFields = guide.type === 'restaurants' ? entry.mustOrder : entry.keyIngredients;
              const orderedLabel = guide.type === 'restaurants' ? 'Must Order' : 'Key Ingredients';
              const linkTarget = guide.type === 'restaurants' ? `/restaurant/${entry.refId}` : `/recipe/${entry.refId}`;
              const isRestaurant = guide.type === 'restaurants';
              const wishlisted = isRestaurant && isWishlisted(entry.refId);
              const parsed = parseRestaurantSubtitle(entry.subtitle);
              // Fallback meta for actions when the viewer hasn't cached
              // this restaurant yet — e.g. someone reading another user's
              // published guide. Owner has it via ListsContext already.
              const fallbackMeta = {
                id: entry.refId,
                name: entry.name,
                image: entry.image || '',
                cuisine: parsed.cuisine,
                price: parsed.price,
                address: entry.neighborhood || '',
                neighborhood: entry.neighborhood,
              };
              const onViewClick = () => {
                if (isDesktop) {
                  if (isRestaurant) openRestaurantPanelFor(entry);
                  else openRecipePanelFor(entry);
                } else {
                  navigate(linkTarget);
                }
              };
              return (
                <article key={entry.id} id={`guide-entry-${idx}`} className="scroll-mt-24">
                  {/* Hero row — big numeral on the left, large image to the right. */}
                  <div className="flex items-start gap-4 sm:gap-6 mb-5">
                    <div className="flex-shrink-0 pt-2">
                      <p className="font-serif font-bold text-primary text-[42px] lg:text-[54px] leading-none">{numLabel(idx + 1)}</p>
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-on-surface/35 mt-1">of {guide.entries.length}</p>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="relative rounded-2xl overflow-hidden bg-on-surface/[0.05] aspect-[16/10] shadow-[0_8px_28px_-12px_rgba(0,0,0,0.18)]">
                        {entry.image ? (
                          <img src={entry.image} alt="" className="absolute inset-0 w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-on-surface/30">
                            <TypeIcon size={32} />
                          </div>
                        )}
                        {typeof entry.score === 'number' && entry.score > 0 && (
                          <div className="absolute top-3 right-3">
                            <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white shadow-sm">
                              <span className="text-yellow-500">★</span>
                              <span className={cn('font-bold text-[12px] tabular-nums', scoreColor(entry.score))}>{entry.score.toFixed(1)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Title row — title on the left, heart + plus buttons on the right. */}
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <h2 className="font-serif font-bold text-on-surface text-[28px] lg:text-[34px] leading-tight min-w-0 flex-1">
                      {entry.name}
                    </h2>
                    {isRestaurant && (
                      <div className="flex items-center gap-2 flex-shrink-0 pt-1">
                        <button
                          type="button"
                          onClick={() => toggleWishlist(getRestaurantInfo(entry.refId) || fallbackMeta)}
                          aria-label={wishlisted ? 'Remove from wishlist' : 'Save to wishlist'}
                          className={cn(
                            'w-10 h-10 rounded-full inline-flex items-center justify-center transition-colors',
                            wishlisted ? 'bg-primary text-white' : 'bg-on-surface/[0.05] text-on-surface/70 hover:bg-on-surface/10',
                          )}
                        >
                          <Heart size={16} fill={wishlisted ? 'currentColor' : 'none'} strokeWidth={wishlisted ? 0 : 2} />
                        </button>
                        <button
                          type="button"
                          onClick={() => openAddToListModal(entry.refId, getRestaurantInfo(entry.refId) || fallbackMeta)}
                          aria-label="Add to list"
                          className="w-10 h-10 rounded-full inline-flex items-center justify-center bg-on-surface/[0.05] text-on-surface/70 hover:bg-on-surface/10 transition-colors"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Cuisine / price / neighborhood */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-bold uppercase tracking-[0.18em] text-on-surface/55">
                    {parsed.cuisine && <span>{parsed.cuisine}</span>}
                    {parsed.price && (
                      <>
                        <span className="text-on-surface/30">·</span>
                        <span>{parsed.price}</span>
                      </>
                    )}
                    {entry.neighborhood && (
                      <>
                        <span className="text-on-surface/30">·</span>
                        <span className="inline-flex items-center gap-1 text-primary"><MapPin size={11} /> {entry.neighborhood}</span>
                      </>
                    )}
                  </div>
                  {entry.hours && (
                    <div className="mt-2 inline-flex items-center gap-1.5 text-[12px] text-on-surface/50">
                      <Clock size={12} />
                      <span>{entry.hours}</span>
                    </div>
                  )}

                  {entry.notes && (
                    <p className="mt-5 text-[15px] lg:text-[17px] leading-[1.6] text-on-surface/85 whitespace-pre-line">
                      {entry.notes}
                    </p>
                  )}

                  {(entry.bestFor || entry.insiderTip || (orderedFields && orderedFields.length > 0)) && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5 mt-6 pt-6 border-t border-on-surface/10">
                      {orderedFields && orderedFields.length > 0 && (
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface/45 mb-2">
                            {guide.type === 'restaurants' ? 'Favorite Dishes' : orderedLabel}
                          </p>
                          <ul className="space-y-1.5">
                            {orderedFields.map((m, i) => (
                              <li key={i} className="flex items-start gap-2 text-[14px] text-on-surface/85">
                                <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-primary flex items-center justify-center"><Check size={9} strokeWidth={3} className="text-white" /></span>
                                {m}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      <div className="space-y-4">
                        {entry.bestFor && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface/45 mb-1">Best For</p>
                            <p className="text-[14px] leading-snug text-on-surface/85">{entry.bestFor}</p>
                          </div>
                        )}
                        {entry.insiderTip && (
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface/45 mb-1">Insider Tip</p>
                            <p className="text-[14px] leading-snug text-on-surface/85">{entry.insiderTip}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={onViewClick}
                    className="inline-flex items-center gap-2 mt-6 px-5 py-2.5 rounded-full bg-on-surface text-white text-[13px] font-bold hover:bg-on-surface/90 active:scale-[0.98] transition-all"
                  >
                    {isRestaurant ? 'View restaurant' : 'View recipe'}
                    <ArrowUpRight size={14} />
                  </button>
                </article>
              );
            })}
          </div>

          {/* Author footer */}
          <div className="mt-16 lg:mt-24 p-6 rounded-2xl bg-[#fbfaf6] border border-on-surface/[0.06]">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface/45 mb-3">About the author</p>
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-full bg-primary/85 text-white flex items-center justify-center font-bold text-[15px] flex-shrink-0">
                {authorName[0]?.toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-serif font-bold text-[18px]">{authorName}</p>
                {authorHandle && <p className="text-on-surface/55 text-[12px]">{authorHandle}</p>}
                {authorProfile?.bio && (
                  <p className="text-[13px] text-on-surface/75 mt-2 leading-snug">{authorProfile.bio}</p>
                )}
              </div>
              {authorProfile?.username && !isOwner && (
                <Link
                  to={`/user/${authorProfile.username}`}
                  className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-primary text-white text-[12px] font-bold"
                >
                  View profile
                </Link>
              )}
            </div>
          </div>

          <div className="mt-10 flex justify-center">
            <div className="w-10 h-10 rounded-full bg-primary/85 text-white flex items-center justify-center font-serif italic text-xl">
              G
            </div>
          </div>
        </div>

        {/* Sticky right rail (desktop) */}
        <aside className="hidden lg:block">
          <div className="sticky top-24">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-on-surface/45 mb-3">In this guide</p>
            <ol className="space-y-1">
              {guide.entries.map((entry, idx) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById(`guide-entry-${idx}`);
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={cn(
                      'w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-left transition-colors',
                      idx === activeEntryIdx ? 'bg-on-surface text-white' : 'hover:bg-on-surface/[0.05]',
                    )}
                  >
                    <span className="flex items-center gap-2.5 min-w-0">
                      <span className={cn('tabular-nums text-[11px] font-bold w-5 flex-shrink-0', idx === activeEntryIdx ? 'text-white/70' : 'text-on-surface/40')}>
                        {numLabel(idx + 1)}
                      </span>
                      <span className={cn('text-[13px] truncate', idx === activeEntryIdx ? 'font-semibold' : 'text-on-surface/85')}>
                        {entry.name}
                      </span>
                    </span>
                    {typeof entry.score === 'number' && entry.score > 0 && (
                      <span className={cn('text-[11px] font-bold tabular-nums flex-shrink-0', idx === activeEntryIdx ? 'text-white' : scoreColor(entry.score))}>
                        {entry.score.toFixed(1)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ol>
          </div>
        </aside>
      </div>

      {/* Desktop-only side panel for "View restaurant" / "View recipe".
          Fixed to the right edge of the viewport so it overlays the
          sticky "In this guide" rail. On mobile we navigate to the full
          detail page instead, so the panels are gated by isDesktop. The
          AnimatePresence inside RestaurantPanel / RecipePanel handles
          enter/exit, so we always mount the wrapper and let the snapshot
          flip drive visibility — otherwise the close animation would be
          cut off by an outer-mount toggle. */}
      {isDesktop && (
        <div className="hidden lg:flex fixed top-4 bottom-4 right-4 z-50 pointer-events-none justify-end">
          <div className="h-full pointer-events-auto">
            <RestaurantPanel
              variant="panel"
              snapshot={restaurantPanel}
              onClose={() => setRestaurantPanel(null)}
              currentUserId={user?.id ?? null}
            />
            <RecipePanel
              variant="panel"
              snapshot={recipePanel}
              onClose={() => setRecipePanel(null)}
              currentUserId={user?.id ?? null}
            />
          </div>
        </div>
      )}
    </div>
  );
};
