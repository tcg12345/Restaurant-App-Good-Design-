/**
 * GuideDetail — editorial reader for a single guide.
 *
 * Renders via the shared primitives in `src/components/guide/GuideRender`
 * so the page and the Live Editor agree on layout, theme application,
 * and per-element typography. Page-level concerns (auth, bookmarks,
 * owner-only edit/unpublish chrome, share dialog, desktop side panels
 * for "View restaurant" / "View recipe") stay here.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Edit3, EyeOff, Loader2 } from 'lucide-react';
import { ShareIcon } from '../components/icons/ShareIcon';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { getGuideById, saveGuideBookmark, removeGuideBookmark, getSavedGuideIds, setGuidePublished, getTheme, type Guide, type GuideEntry } from '../lib/supabase-guides';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { ShareDialog } from '../components/ShareDialog';
import { GlassButton } from '../lib/glass-buttons';
import { useSettings } from '../contexts/SettingsContext';
import { canonicalShareUrl } from '../lib/native-share';
import { RestaurantPanel, type RestaurantPanelSnapshot } from '../components/RestaurantPanel';
import { RecipePanel, type RecipePanelSnapshot } from '../components/RecipePanel';
import {
  GuideThemeScope, GuideHero, GuideIntro, GuideEntries, GuideAuthor, GuideEndCap, GuideTOC,
  DefaultHeroCtas, readEntryMeta, entryDomId,
  type EntryActionAdapter,
} from '../components/guide/GuideRender';
import '../components/guide/GuideRender.css';

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

function entryToRestaurantSnapshot(entry: GuideEntry): RestaurantPanelSnapshot {
  const { cuisine, price } = readEntryMeta(entry);
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
  const { phoneMode } = useSettings();
  const { showToast } = useToast();
  const { requireSignIn } = useSignInModal();
  const { isWishlisted, toggleWishlist, openAddToListModal, getRestaurantInfo } = useLists();
  const isDesktop = useIsDesktop();

  const [guide, setGuide] = useState<Guide | null>(null);
  const [authorProfile, setAuthorProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeEntryIdx, setActiveEntryIdx] = useState(0);
  const [restaurantPanel, setRestaurantPanel] = useState<RestaurantPanelSnapshot | null>(null);
  const [recipePanel, setRecipePanel] = useState<RecipePanelSnapshot | null>(null);
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

  // Scroll-spy + auto-close the desktop side panel on scroll (with a
  // short grace window after open so the open's own layout shift doesn't
  // re-close it).
  useEffect(() => {
    if (!guide) return;
    const handler = () => {
      const headings = guide.entries
        .map((_, i) => document.getElementById(entryDomId(i)))
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
    if (!user?.id) { requireSignIn('Sign in to save guides'); return; }
    if (!guide || savingToggle) return;
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
    // Column-scoped flip — re-saving the whole guide from this page's
    // (possibly stale) snapshot used to clobber newer edits.
    const ok = await setGuidePublished(guide.id, false);
    if (ok) {
      setGuide({ ...guide, isPublished: false });
      showToast('Guide unpublished');
    } else {
      showToast("Couldn't unpublish");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-cream">
        <Loader2 size={28} className="animate-spin text-primary/60" />
      </div>
    );
  }

  if (!guide) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-cream p-8 text-center">
        <BookOpen size={32} className="text-on-surface/25 mb-3" />
        <p className="text-base font-serif font-bold mb-1">Guide not found</p>
        <p className="text-sm text-on-surface/55 mb-4">It may have been unpublished or deleted.</p>
        <button onClick={() => navigate('/')} className="px-4 py-2 rounded-full bg-primary text-on-primary text-sm font-semibold">
          Back to Discover
        </button>
      </div>
    );
  }

  const theme = getTheme(guide);
  const V = theme.visibility;
  const authorName = authorProfile?.display_name || authorProfile?.username || 'Anonymous';
  const authorHandle = authorProfile?.username || '';

  const author = {
    name: theme.authorOverrides?.name || authorName,
    handle: theme.authorOverrides?.handle || authorHandle,
    avatar: theme.authorOverrides?.avatar || undefined,
  };

  /* Top bar (back + owner controls + share) — passed as `topChrome` so it
     sits inside the hero overlay.

     Liquid glass, like every other piece of floating chrome in the app.
     These were flat `bg-white/95` pills, which read as a different app the
     moment you arrived from a screen whose header refracts what's behind
     it. The owner's controls collapse to glyphs on a phone: "Edit" and
     "Unpublish" spelled out pushed the row into the title behind it, and
     the pencil and the crossed-out eye say the same thing in a third of
     the width. */
  const topChrome = (
    <>
      <GlassButton
        id="guide-back"
        symbol="chevron.left"
        title={phoneMode ? undefined : 'Discover'}
        titleStyle="chip"
        label="Back to Discover"
        onClick={() => navigate(-1)}
        className={cn(
          'hit-44 inline-flex items-center gap-1.5 rounded-full text-on-surface text-[13px] font-semibold active:scale-95 transition-transform',
          phoneMode ? 'w-10 h-10 justify-center' : 'h-10 pl-3 pr-4',
        )}
      >
        <ArrowLeft size={17} />
        {!phoneMode && 'Discover'}
      </GlassButton>
      <div className="flex items-center gap-2">
        {isOwner && (
          <>
            <GlassButton
              id="guide-edit"
              symbol="pencil"
              title={phoneMode ? undefined : 'Edit'}
              titleStyle="chip"
              label="Edit guide"
              onClick={() => navigate(`/guides/${guide.id}/edit`)}
              className={cn(
                'hit-44 inline-flex items-center gap-1.5 rounded-full text-on-surface text-[13px] font-semibold active:scale-95 transition-transform',
                phoneMode ? 'w-10 h-10 justify-center' : 'h-10 px-4',
              )}
            >
              <Edit3 size={16} />
              {!phoneMode && 'Edit'}
            </GlassButton>
            {guide.isPublished && (
              <GlassButton
                id="guide-unpublish"
                symbol="eye.slash"
                title={phoneMode ? undefined : 'Unpublish'}
                titleStyle="chip"
                label="Unpublish guide"
                onClick={onUnpublish}
                className={cn(
                  'hit-44 inline-flex items-center gap-1.5 rounded-full text-on-surface text-[13px] font-semibold active:scale-95 transition-transform',
                  phoneMode ? 'w-10 h-10 justify-center' : 'h-10 px-4',
                )}
              >
                <EyeOff size={16} />
                {!phoneMode && 'Unpublish'}
              </GlassButton>
            )}
          </>
        )}
        <GlassButton
          id="guide-share"
          symbol="app.paperplane"
          label="Share guide"
          onClick={() => setShareOpen(true)}
          className="hit-44 w-10 h-10 rounded-full flex items-center justify-center text-on-surface active:scale-95 transition-transform"
        >
          <ShareIcon size={16} />
        </GlassButton>
      </div>
    </>
  );

  const heroCtas = (
    <DefaultHeroCtas
      saved={saved}
      onToggleSave={onToggleSave}
      onShare={() => setShareOpen(true)}
      showMap={guide.type === 'restaurants'}
      mapHref="/map"
    />
  );

  // Entry actions adapter — wires the entry's "View" / heart / + buttons
  // into the existing app behavior.
  const actions: EntryActionAdapter = {
    onView: (entry) => {
      const isRestaurant = guide.type === 'restaurants';
      if (isDesktop) {
        if (isRestaurant) openRestaurantPanelFor(entry);
        else openRecipePanelFor(entry);
      } else {
        const target = isRestaurant
          ? `/restaurant/${entry.refId}`
          : entry.authorId
            ? `/recipe/${entry.authorId}/${entry.refId}`
            : `/recipe/${entry.refId}`;
        navigate(target);
      }
    },
    onSave: (entry) => {
      if (guide.type !== 'restaurants') return;
      const meta = getRestaurantInfo(entry.refId) || (() => {
        const { cuisine, price } = readEntryMeta(entry);
        return {
          id: entry.refId, name: entry.name, image: entry.image || '',
          cuisine, price, address: entry.neighborhood || '', neighborhood: entry.neighborhood,
        };
      })();
      toggleWishlist(meta);
    },
    onAdd: (entry) => {
      if (guide.type !== 'restaurants') return;
      const meta = getRestaurantInfo(entry.refId) || (() => {
        const { cuisine, price } = readEntryMeta(entry);
        return {
          id: entry.refId, name: entry.name, image: entry.image || '',
          cuisine, price, address: entry.neighborhood || '', neighborhood: entry.neighborhood,
        };
      })();
      openAddToListModal(entry.refId, meta);
    },
    isSaved: (entry) => guide.type === 'restaurants' && isWishlisted(entry.refId),
  };

  const onJump = (idx: number) => {
    const el = document.getElementById(entryDomId(idx));
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Author panel trailing chrome — "View profile" button for non-owners
  // viewing a published guide.
  const authorTrailing = authorProfile?.username && !isOwner ? (
    <Link
      to={`/user/${authorProfile.username}`}
      className="flex-shrink-0 px-3.5 py-1.5 rounded-full bg-primary text-on-primary text-[12px] font-bold"
    >
      View profile
    </Link>
  ) : null;

  return (
    <div className="min-h-screen">
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
        externalShareUrl={canonicalShareUrl(`/guides/${guide.id}`)}
      />

      <GuideThemeScope theme={theme}>
        <GuideHero
          guide={guide}
          theme={theme}
          author={author}
          eyebrow={{ type: guide.type === 'recipes' ? 'Recipes' : 'Restaurants', tag: guide.tags?.[0] }}
          topChrome={topChrome}
          ctaChrome={heroCtas}
        />
        <div className={cn('gle-layout', !V.toc && 'no-toc')}>
          <div className="gle-main-col">
            <GuideIntro guide={guide} theme={theme} />
            <GuideEntries guide={guide} theme={theme} actions={actions} />
            {V.author && (
              <GuideAuthor
                guide={guide}
                theme={theme}
                authorProfile={authorProfile}
                trailing={authorTrailing}
              />
            )}
            {V.endCap && <GuideEndCap />}
          </div>
          {V.toc && (
            <GuideTOC
              entries={guide.entries}
              activeIdx={activeEntryIdx}
              onJump={onJump}
            />
          )}
        </div>
      </GuideThemeScope>

      {/* Desktop-only side panel for "View restaurant" / "View recipe".
          Fixed to the right edge of the viewport. */}
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
