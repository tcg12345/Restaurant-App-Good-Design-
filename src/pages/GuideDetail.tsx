import { usePageBack } from '../lib/usePageBack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useToast } from '../contexts/ToastContext';
import { useSignInModal } from '../contexts/SignInModalContext';
import { getGuideById, saveGuideBookmark, removeGuideBookmark, getSavedGuideIds, setGuidePublished, getTheme, type Guide, type GuideEntry } from '../lib/supabase-guides';
import { getProfilesByIds, type UserProfile } from '../lib/supabase-community';
import { ShareDialog } from '../components/ShareDialog';
import { canonicalShareUrl } from '../lib/native-share';
import { RestaurantPanel, type RestaurantPanelSnapshot } from '../components/RestaurantPanel';
import { RecipePanel, type RecipePanelSnapshot } from '../components/RecipePanel';
import { readEntryMeta, type EntryActionAdapter } from '../components/guide/GuideRender';
import { GuideReader } from '../components/guide/GuideReader';

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
  const goBack = usePageBack('/pantry');
  const { user } = useAuth();
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

  // Preserve the desktop preview's existing close-on-scroll behavior.
  useEffect(() => {
    if (!restaurantPanel && !recipePanel) return;
    const closePreview = () => {
      if (Date.now() - panelOpenedAtRef.current > 250) {
        setRestaurantPanel(null);
        setRecipePanel(null);
      }
    };
    window.addEventListener('scroll', closePreview, { passive: true });
    return () => window.removeEventListener('scroll', closePreview);
  }, [restaurantPanel, recipePanel]);

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
        <p className="text-base font-semibold mb-1">Guide not found</p>
        <p className="text-sm text-on-surface/55 mb-4">It may have been unpublished or deleted.</p>
        <button onClick={() => goBack()} className="px-4 py-2 rounded-full bg-primary text-on-primary text-sm font-semibold">
          Go back
        </button>
      </div>
    );
  }

  const theme = getTheme(guide);
  const authorName = authorProfile?.display_name || authorProfile?.username || 'Anonymous';
  const authorHandle = authorProfile?.username || '';

  const author = {
    name: theme.authorOverrides?.name || authorName,
    handle: theme.authorOverrides?.handle || authorHandle,
    avatar: theme.authorOverrides?.avatar || authorProfile?.avatar_url || undefined,
  };

  // Entry actions adapter — wires the entry's "View" / heart / + buttons
  // into the existing app behavior.
  const actions: EntryActionAdapter = {
    onView: (entry) => {
      const isRestaurant = guide.type === 'restaurants';
      if (isDesktop && (isRestaurant || entry.authorId)) {
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

      <GuideReader
        guide={guide}
        theme={theme}
        author={author}
        authorHref={authorProfile?.username ? `/user/${authorProfile.username}` : undefined}
        authorBio={theme.authorOverrides?.bio || authorProfile?.bio || ''}
        saved={saved}
        saving={savingToggle}
        onSave={onToggleSave}
        onBack={goBack}
        onShare={() => setShareOpen(true)}
        onEdit={isOwner ? () => navigate(`/guides/${guide.id}/edit`) : undefined}
        onUnpublish={isOwner && guide.isPublished ? onUnpublish : undefined}
        actions={actions}
      />

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
