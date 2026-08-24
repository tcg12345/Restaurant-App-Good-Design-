// AppAssistant — global mount for the AI chatbot. Renders LocationChat
// with the right action handlers and context wired up for any page.
//
// On the LocationPage (which publishes rich filtered-pool + city +
// search-callback state via AssistantContext) the assistant behaves
// just like before. On every other page the assistant still works for:
//   - Looking up other users / experts and navigating to their profile
//   - Opening rating / wishlist / add-to-list / add-recipe / add-post /
//     add-reel / home-meal / guide-creator modals
//   - Navigating to any page
//   - Answering questions about the user's saved restaurants / recipes
//   - Free-text restaurant search anchored to the user's home city
//
// Mounted once in App.tsx. Hidden from auth, onboarding, the create
// page, focused reels, and inside other full-screen flows where a FAB
// would clash (controlled by the visibleByRoute check below).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LocationChat, type ActionResult, type AssistantUser, type AssistantCircleRating, type CommunityRecipeHit } from './LocationChat';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useLists, type RestaurantMeta } from '../contexts/ListsContext';
import { useRecipes } from '../contexts/RecipesContext';
import { useReels } from '../contexts/ReelsContext';
import { usePosts } from '../contexts/PostsContext';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { useHomeLocation } from '../contexts/HomeLocationContext';
import { useAssistantContext, type AssistantPageContext } from '../contexts/AssistantContext';
import { searchPlacesByTextPaged } from '../lib/places';
import { isAllowedAppPath } from '../lib/app-routes';
import { ugc, UGC_MAX_NAME } from '../lib/ugc';
import { michelinNearby, michelinByName, michelinToPlaceResult, michelinDistinctionLabel, michelinPriceDisplay, type MichelinInfo } from '../lib/michelin';
import type { MichelinChatHit } from './LocationChat';
import { geocodePlace } from './HomeLocationBar';
import {
  searchUsersByUsername,
  getExpertProfiles,
  getProfilesByIds,
  getFriends,
  getFriendsPublicHomeMeals,
  getAllPublicHomeMeals,
  getCircleRatingsForRestaurant,
  type UserProfile,
  type FriendHomeMeal,
} from '../lib/supabase-community';
import {
  getPublicRecipes,
  getExpertRecipes,
  getFriendRecipes,
  type Recipe,
} from '../lib/supabase-recipes';
import type { HomeMeal } from '../contexts/ListsContext';
import type { ScoredPlace } from '../lib/recommendations';
import type { ChatFilters, UserContext } from '../lib/location-chat-client';
import { isSearchTakeoverOpen, subscribeSearchTakeover } from '../lib/search-takeover';

/* ── Route gating ─────────────────────────────────────────────────
   Pages where mounting the assistant FAB would clash with the
   page's own chrome. Auth, onboarding, profile setup, focused full-
   screen reels, and import flows are excluded. */
const HIDE_ON_PATHS = new Set<string>([
  '/auth',
  '/onboarding',
  '/import',
  '/profile-setup',
  // Messages: the FAB sits right on top of the composer / quick-share
  // chips in a conversation, and chatting is already a focused activity.
  '/messages',
]);

function shouldHideAssistant(pathname: string, isPhone: boolean): boolean {
  if (HIDE_ON_PATHS.has(pathname)) return true;
  // Focused single-reel viewer; the page itself is full-screen video.
  if (pathname.startsWith('/r/')) return true;
  // On mobile, hide on the Reels feed too — the page is full-screen
  // video and the FAB clashes with the page's own chrome. Desktop
  // keeps it because the reels lane is much narrower than the screen.
  if (isPhone && pathname === '/reels') return true;
  // On mobile, hide on the Create page — the FAB overlaps the page's own
  // POST / REEL / GUIDE tabs and its primary action button.
  if (isPhone && pathname === '/create') return true;
  return false;
}

/* ── Bottom-nav routes (mirror of App.tsx's showBottomNav logic).
     The FAB clears the nav with the `is-above-nav` modifier when
     this returns true. Phone-mode-only because desktop sidebars
     don't collide with the FAB. ─────────────────────────────── */
const HIDE_BOTTOM_NAV_PATHS = new Set<string>([
  '/onboarding', '/messages', '/reorder', '/location', '/location/map', '/map', '/create',
]);

function routeShowsBottomNav(pathname: string): boolean {
  if (HIDE_BOTTOM_NAV_PATHS.has(pathname)) return false;
  if (pathname.startsWith('/restaurant/')) return false;
  if (pathname.startsWith('/user/')) return false;
  if (pathname.startsWith('/recipe/')) return false;
  if (pathname.startsWith('/review/')) return false;
  if (pathname.startsWith('/activity')) return false;
  if (pathname.startsWith('/guides/')) return false;
  if (pathname.startsWith('/r/')) return false;
  return true;
}

/* ── Scroll-driven hide for the FAB on mobile ────────────────────
   Twitter / Instagram-style: the floating button slips down + fades
   out when the user scrolls DOWN, and snaps back when they scroll UP.

   Different pages scroll in different containers — sometimes the
   window, sometimes the phone-frame's inner div, sometimes a page's
   own nested `overflow-y-auto` element. To catch them all with one
   listener we bind to `document` in the CAPTURE phase: scroll events
   don't bubble, but a capturing listener still observes them from any
   descendant scroller. We then read the scroll position off the event
   target. This is what makes it work on every page.

   - `enabled=false` short-circuits the listener so desktop / sidebar
     mode keeps the FAB pinned.
   - `pathname` is in the dep list so the hook re-installs on route
     changes (each fresh page starts at scroll 0 so the FAB returns
     into view).
   - We require a small DELTA threshold so a single jittery wheel
     tick can't flip-flop the state, and always show near the top
     so a scroll-to-top doesn't leave the FAB hidden.
   - When the active scroller changes (navigating between containers)
     we reset the baseline instead of comparing scrollTops across two
     unrelated elements. */
function useFabScrollHide(enabled: boolean, pathname: string): boolean {
  const [hidden, setHidden] = React.useState(false);

  // Whenever the route changes the new page starts at scroll 0 —
  // reveal the FAB so the user always sees it on page load.
  React.useEffect(() => {
    setHidden(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }

    const SHOW_NEAR_TOP = 80;
    const DELTA_THRESHOLD = 8;

    const scrollTopOf = (target: EventTarget | null): number => {
      if (
        !target
        || target === document
        || target === window
        || target === document.documentElement
        || target === document.body
      ) {
        return window.scrollY || document.documentElement.scrollTop || 0;
      }
      return (target as HTMLElement).scrollTop ?? 0;
    };

    let lastY = 0;
    let lastTarget: EventTarget | null = null;
    let pendingTarget: EventTarget | null = null;
    let raf = 0;

    const handle = () => {
      raf = 0;
      const target = pendingTarget;
      const y = scrollTopOf(target);
      // New scroll container in focus — rebase rather than diffing
      // against an unrelated element's scrollTop.
      if (target !== lastTarget) {
        lastTarget = target;
        lastY = y;
        if (y < SHOW_NEAR_TOP) setHidden(false);
        return;
      }
      const dy = y - lastY;
      if (y < SHOW_NEAR_TOP) {
        setHidden(false);
      } else if (Math.abs(dy) > DELTA_THRESHOLD) {
        setHidden(dy > 0);
      }
      lastY = y;
    };

    const onScroll = (e: Event) => {
      pendingTarget = e.target;
      if (raf) return;
      raf = requestAnimationFrame(handle);
    };

    // Capture phase + document target = catches scroll from the window
    // AND any nested scroll container on the page.
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    document.addEventListener('scroll', onScroll, opts);
    return () => {
      document.removeEventListener('scroll', onScroll, opts);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [enabled, pathname]);

  return hidden;
}

/* ── Human labels for routes (sent to the system prompt). ────────── */
function labelForPath(path: string): string {
  if (path === '/') return 'the Discover home feed';
  if (path === '/map') return 'the map view';
  if (path === '/circle') return 'the Circle (friends) page';
  if (path === '/create') return 'the Create menu';
  if (path === '/search' || path === '/search/main') return 'the Search page';
  if (path === '/reels') return 'the Reels feed';
  if (path.startsWith('/r/')) return 'a focused reel / post';
  if (path.startsWith('/activity')) return "the user's own activity archive (their saved, liked and commented-on posts and reels)";
  if (path === '/experts') return 'the Experts list';
  if (path === '/profile') return "the user's own profile";
  if (path === '/pantry') return 'the Pantry (saved recipes)';
  if (path.startsWith('/restaurant/')) return 'a restaurant detail page';
  if (path === '/recipes-for-you') return 'the Recipes For You page';
  if (path.startsWith('/recipe/') || path.startsWith('/meal/')) return 'a recipe detail page';
  if (path.startsWith('/guides/')) return 'a guide page';
  if (path.startsWith('/user/')) return "another user's profile";
  if (path === '/messages') return 'the Messages (DMs) page';
  if (path.startsWith('/review/')) return 'a friend\'s review';
  if (path === '/location') return 'the Explore (city restaurants) page';
  if (path === '/location/map') return 'the Explore map view';
  if (path === '/reorder') return 'the Reorder ratings page';
  return `the ${path} page`;
}

/* ── Fallback restaurant search ──────────────────────────────────
   Used when no page has published an onSearchRestaurants callback.
   Anchors to the user's home city by default; honours an explicit
   city override Claude can pass via the tool. */
async function fallbackSearchRestaurants(
  query: string,
  cityOverride: string | undefined,
  homeLocation: { lat: number; lng: number; label: string } | null,
): Promise<ScoredPlace[]> {
  let lat = homeLocation?.lat;
  let lng = homeLocation?.lng;
  const targetCity = cityOverride?.trim();
  if (targetCity) {
    try {
      const geo = await geocodePlace(targetCity);
      if (geo) { lat = geo.lat; lng = geo.lng; }
    } catch { /* ignore — fall through to home location */ }
  }
  if (lat == null || lng == null) return [];
  const finalQuery = targetCity ? `${query} in ${targetCity}` : query;
  try {
    const res = await searchPlacesByTextPaged(finalQuery, {
      lat,
      lng,
      // ~12 mi radius — wide enough for most city-anchored searches.
      radiusMeters: 19312,
      useRestriction: true,
    });
    return res.places.map<ScoredPlace>((p) => ({
      ...p,
      recScore: p.rating > 0 ? p.rating * 2 : 0,
      sources: ['google'],
    }));
  } catch {
    return [];
  }
}

/* ── Build "knownPlaces" — minimal ScoredPlaces for every restaurant
     the user has rated or wishlisted. Lets chat cards and inline
     name-links resolve for places that are outside the visible pool
     (e.g. when the user isn't on /location at all). ─────────────── */
function buildKnownPlaces(
  ratings: Array<{ restaurantId: string; name: string; score?: number; cuisine?: string; address?: string; image?: string }>,
  wishlist: Array<{ restaurantId: string; name: string; cuisine?: string; address?: string; image?: string }>,
): ScoredPlace[] {
  const seen = new Set<string>();
  const out: ScoredPlace[] = [];
  const push = (id: string, name: string, score: number, _cuisine: string, address: string, image: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      name: name || 'Unnamed',
      rating: score > 0 ? score / 2 : 0,
      types: [],
      priceLevel: 0,
      address: address || '',
      fullAddress: address || '',
      photoUrl: image || null,
      userRatingCount: 0,
      lat: 0,
      lng: 0,
      recScore: score,
      sources: ['google'],
    });
  };
  for (const r of ratings) push(r.restaurantId, r.name, r.score ?? 0, r.cuisine ?? '', r.address ?? '', r.image ?? '');
  for (const w of wishlist) push(w.restaurantId, w.name, 0, w.cuisine ?? '', w.address ?? '', w.image ?? '');
  return out;
}

/** Resolve a restaurant id back to a RestaurantMeta we can pass to
 *  the modal openers — checks the meta cache, then synthesizes a
 *  minimum-viable record from rated / wishlist data if needed. */
function buildRestaurantMetaFromId(
  id: string,
  metaCache: Record<string, RestaurantMeta>,
  ratings: Array<{ restaurantId: string; name: string; image?: string; cuisine?: string; price?: string; address?: string }>,
  wishlist: Array<{ restaurantId: string; name: string; image?: string; cuisine?: string; price?: string; address?: string }>,
  pageContext: AssistantPageContext | null,
): RestaurantMeta | null {
  const cached = metaCache[id];
  if (cached) return cached;
  const r = ratings.find((x) => x.restaurantId === id);
  if (r) {
    return {
      id,
      name: r.name || 'Unnamed',
      image: r.image || '',
      cuisine: r.cuisine || '',
      price: r.price || '',
      address: r.address || '',
    };
  }
  const w = wishlist.find((x) => x.restaurantId === id);
  if (w) {
    return {
      id,
      name: w.name || 'Unnamed',
      image: w.image || '',
      cuisine: w.cuisine || '',
      price: w.price || '',
      address: w.address || '',
    };
  }
  // Look inside the location-page's visible pool — those carry Google
  // place fields directly without going through the meta cache.
  if (pageContext) {
    const p = pageContext.visible.find((x) => x.id === id);
    if (p) {
      return {
        id,
        name: p.name || 'Unnamed',
        image: p.photoUrl || '',
        cuisine: '',
        price: '',
        address: p.address || '',
      };
    }
  }
  return null;
}

export const AppAssistant: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const auth = useAuth();
  const settings = useSettings();
  const lists = useLists();
  const recipes = useRecipes();
  const reels = useReels();
  const posts = usePosts();
  const guides = useGuideCreator();
  const homeLocation = useHomeLocation();
  const homeLoc = homeLocation?.location || null;
  const { pageContext } = useAssistantContext();

  // The Search tab is the map now, and the FAB sat on the results sheet's
  // corner there. It stands down on the map and steps back in when the
  // search takeover opens — the one part of that page with room for it.
  const [takeoverOpen, setTakeoverOpen] = useState(isSearchTakeoverOpen());
  useEffect(() => subscribeSearchTakeover(setTakeoverOpen), []);
  const onSearchMap = settings.phoneMode && location.pathname === '/search';

  // Gate by route + auth — assistant lives only inside the signed-in app.
  const hidden = !auth.isSignedIn || !auth.profileComplete
    || shouldHideAssistant(location.pathname, settings.phoneMode)
    || (onSearchMap && !takeoverOpen);

  /* ── Build the fallback user context for the system prompt (pages
       can publish a richer one — see below) ─────────────────────── */
  const fallbackUserContext = useMemo<UserContext | undefined>(() => {
    if (!auth.profile) return undefined;
    const ctx: UserContext = {};
    if (auth.profile.display_name) ctx.displayName = auth.profile.display_name;
    if (auth.profile.username) ctx.username = auth.profile.username;
    if (auth.profile.home_city) ctx.homeCity = auth.profile.home_city;

    // Top rated — sorted descending by score, capped at 50.
    if (lists.ratings.length > 0) {
      const sorted = [...lists.ratings].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 50);
      ctx.topRated = sorted.map((r) => ({
        id: r.restaurantId,
        name: r.name || 'Unnamed',
        score: typeof r.score === 'number' ? r.score : undefined,
        cuisine: r.cuisine || undefined,
        neighborhood: r.address || undefined,
      }));
    }
    if (lists.wishlist.length > 0) {
      ctx.wishlist = lists.wishlist.slice(0, 30).map((w) => ({
        id: w.restaurantId,
        name: w.name || 'Unnamed',
        cuisine: w.cuisine || undefined,
        neighborhood: w.address || undefined,
      }));
    }
    // Recipes — filter out stubs.
    if (recipes.myRecipes.length > 0) {
      const seen = new Set<string>();
      const out: NonNullable<UserContext['recipes']> = [];
      for (const r of recipes.myRecipes) {
        if (!r?.id || seen.has(r.id)) continue;
        const ing = r.ingredients?.length || 0;
        const stp = r.steps?.length || 0;
        if (ing === 0 && stp === 0) continue;
        seen.add(r.id);
        out.push({
          id: r.id,
          title: r.title || 'Untitled recipe',
          cuisine: r.cuisine || undefined,
          prepTime: r.prepTimeMinutes ?? undefined,
          cookTime: r.cookTimeMinutes ?? undefined,
          difficulty: r.difficulty
            ? r.difficulty.charAt(0).toUpperCase() + r.difficulty.slice(1)
            : undefined,
          ingredientCount: ing,
          stepCount: stp,
        });
        if (out.length >= 30) break;
      }
      if (out.length > 0) ctx.recipes = out;
    }
    return ctx;
  }, [auth.profile, lists.ratings, lists.wishlist, recipes.myRecipes]);

  /* ── knownPlaces (rated + wishlist) — the page-published build is
       preferred below when present ───────────────────────────────── */
  const fallbackKnownPlaces = useMemo<ScoredPlace[]>(() => {
    return buildKnownPlaces(lists.ratings, lists.wishlist);
  }, [lists.ratings, lists.wishlist]);

  /* ── Filter out stub recipes for the recipe-card lookup ──────── */
  const fallbackRecipesAll = useMemo(() => {
    const seen = new Set<string>();
    const out: typeof recipes.myRecipes = [];
    for (const r of recipes.myRecipes) {
      if (!r?.id || seen.has(r.id)) continue;
      const ing = r.ingredients?.length || 0;
      const stp = r.steps?.length || 0;
      if (ing === 0 && stp === 0) continue;
      seen.add(r.id);
      out.push(r);
    }
    return out;
  }, [recipes.myRecipes]);

  /* ── Prefer the page-published personalization over the local
       fallbacks. LocationPage builds a much richer context (friends,
       followed experts, circle signals, meta-enriched neighborhoods)
       that used to be computed and then dropped on the floor. ────── */
  const userContext = pageContext?.userContext ?? fallbackUserContext;
  const knownPlaces = pageContext?.knownPlaces ?? fallbackKnownPlaces;
  const chatRecipesAll = pageContext?.recipes ?? fallbackRecipesAll;

  /* ── Community recipes cache + lazy loader ───────────────────────
     The search_community_recipes tool needs access to TWO data
     sources, because "recipes" in this app split across two tables:
       (1) Formal recipes — `recipes` table (Recipe[]). The
           list-scoped Add Recipe modal writes here. Few power users
           use this, so it's usually sparse.
       (2) Home meals — `user_app_data.home_meals` (HomeMeal[]). The
           Log Home Meal modal writes here. This is where the bulk of
           friends' "recipes" live; isPublic gates whether they're
           shareable.
     We fetch both on first call (deduped by an in-flight ref) and
     cache for the session. Author profiles are looked up in parallel
     so cards / tool results can show "by @username".

     Both sources are normalized to CommunityRecipeHit downstream. */
  const userId = auth.user?.id || null;
  type CommunityCacheEntry = {
    /** Source-agnostic id used in the bot/card flow. For home meals
     *  we prefix with "hm:" so they can't collide with formal recipe
     *  UUIDs and so the navigate handler can route correctly. */
    id: string;
    userId: string;
    title: string;
    cuisine: string;
    description: string;
    tags: string[];
    ingredientText: string;       // joined names for query matching
    prepTime: number | null;
    cookTime: number | null;
    difficulty: string;           // lowercase "easy"/"medium"/"hard"
    photos: string[];
    ingredientCount: number;
    stepCount: number;
    updatedAt: string;            // ISO for ranking
    /** Where this came from so the navigate handler can route to the
     *  right detail page (formal recipe vs home meal). */
    source: 'recipe' | 'home_meal';
  };

  const communityCacheRef = useRef<{
    loaded: boolean;
    loading: Promise<void> | null;
    entries: CommunityCacheEntry[];
    friendIds: Set<string>;
    expertIds: Set<string>;
    authors: Record<string, UserProfile>;
  }>({
    loaded: false,
    loading: null,
    entries: [],
    friendIds: new Set(),
    expertIds: new Set(),
    authors: {},
  });

  // Reset the cache when the user changes (sign out / different account).
  useEffect(() => {
    communityCacheRef.current = {
      loaded: false,
      loading: null,
      entries: [],
      friendIds: new Set(),
      expertIds: new Set(),
      authors: {},
    };
  }, [userId]);

  const loadCommunityRecipes = useCallback(async (): Promise<void> => {
    const cache = communityCacheRef.current;
    if (cache.loaded) return;
    if (cache.loading) return cache.loading;
    const work = (async () => {
      try {
        // Friend ids drive both the friend-recipes and friend-home-meals
        // queries.
        const friends = userId ? await getFriends(userId).catch(() => []) : [];
        const friendIds = new Set(friends.map((f) => f.friend_id));
        // Parallelize every fetch — six independent network calls.
        // Formal recipes from each source + home meals from friends,
        // experts, and a broader public scan + the experts list.
        const friendIdsArr = Array.from(friendIds);
        const [publicRs, expertRs, friendRs, expertProfiles, friendMeals, allPublicMeals] = await Promise.all([
          getPublicRecipes(40).catch(() => []),
          getExpertRecipes(40).catch(() => []),
          friendIdsArr.length > 0 ? getFriendRecipes(friendIdsArr, 40).catch(() => []) : Promise.resolve([] as Recipe[]),
          getExpertProfiles().catch(() => []),
          friendIdsArr.length > 0 ? getFriendsPublicHomeMeals(friendIdsArr).catch(() => []) : Promise.resolve([] as FriendHomeMeal[]),
          userId ? getAllPublicHomeMeals(userId, { userScanLimit: 250, mealLimit: 80 }).catch(() => []) : Promise.resolve([] as FriendHomeMeal[]),
        ]);
        const expertIds = new Set(expertProfiles.map((p) => p.user_id));
        // Also fetch home meals from every expert (some experts only
        // log via Home Meal). Skip ids we already covered as friends
        // so the same row isn't fetched twice.
        const expertOnlyIds = Array.from(expertIds).filter((id) => !friendIds.has(id));
        const expertMeals = expertOnlyIds.length > 0
          ? await getFriendsPublicHomeMeals(expertOnlyIds).catch(() => [] as FriendHomeMeal[])
          : [];

        // Normalize everything into the source-agnostic shape, deduped
        // by id. Home-meal ids get a prefix so they can't collide with
        // formal recipe UUIDs.
        const byId = new Map<string, CommunityCacheEntry>();
        for (const r of [...friendRs, ...expertRs, ...publicRs]) {
          if (!r?.id || byId.has(r.id)) continue;
          byId.set(r.id, {
            id: r.id,
            userId: r.userId,
            title: r.title,
            cuisine: r.cuisine || '',
            description: r.description || '',
            tags: r.tags || [],
            ingredientText: (r.ingredients || []).map((i) => i.name).join(' '),
            prepTime: r.prepTimeMinutes,
            cookTime: r.cookTimeMinutes,
            difficulty: r.difficulty || '',
            photos: r.photos || [],
            ingredientCount: r.ingredients?.length || 0,
            stepCount: r.steps?.length || 0,
            updatedAt: r.updatedAt || r.createdAt || '',
            source: 'recipe',
          });
        }
        // Home meals can repeat (a friend who's also an expert; the
        // all-public scan may overlap). Dedupe across them all.
        const mealsCombined: FriendHomeMeal[] = [];
        const seenMealKey = new Set<string>();
        for (const m of [...friendMeals, ...expertMeals, ...allPublicMeals]) {
          const key = `${m.userId}:${m.id}`;
          if (seenMealKey.has(key)) continue;
          seenMealKey.add(key);
          mealsCombined.push(m);
        }
        for (const m of mealsCombined) {
          const prefixed = `hm:${m.userId}:${m.id}`;
          if (byId.has(prefixed)) continue;
          // Home meal photos can be PhotoItem objects or plain URL strings;
          // normalize to strings for the card cover.
          const photoUrls: string[] = [];
          if (m.coverPhoto) photoUrls.push(m.coverPhoto);
          for (const p of m.photos || []) {
            if (!p) continue;
            if (typeof p === 'string') photoUrls.push(p);
            else if (typeof p === 'object' && 'url' in p && typeof p.url === 'string') photoUrls.push(p.url);
          }
          const ingredientText = (m.ingredients || []).map((i) => i.name || '').join(' ')
            + ' '
            + (m.dishes || []).map((d) => d.name || '').join(' ');
          byId.set(prefixed, {
            id: prefixed,
            userId: m.userId,
            title: m.name || 'Untitled meal',
            cuisine: m.cuisine || '',
            description: m.description || '',
            tags: m.tags || [],
            ingredientText,
            prepTime: m.prepTime ?? null,
            cookTime: m.cookTime ?? null,
            // HomeMeal difficulty is capitalized ("Easy") — lowercase
            // here so the search filter matches uniformly across sources.
            difficulty: (m.difficulty || '').toLowerCase(),
            photos: photoUrls,
            ingredientCount: m.ingredients?.length || 0,
            stepCount: m.steps?.length || 0,
            // home meals store createdAt as a number (ms epoch); convert
            // for a comparable ISO string.
            updatedAt: m.createdAt ? new Date(m.createdAt).toISOString() : '',
            source: 'home_meal',
          });
        }
        const entries = Array.from(byId.values());

        // Author profiles — batch over every unique user id surfaced.
        const allUserIds = new Set<string>();
        for (const e of entries) allUserIds.add(e.userId);
        const authors: Record<string, UserProfile> = {};
        for (const p of expertProfiles) authors[p.user_id] = p;
        const missing = Array.from(allUserIds).filter((id) => !authors[id]);
        if (missing.length > 0) {
          try {
            const fetched = await getProfilesByIds(missing);
            Object.assign(authors, fetched);
          } catch { /* ignore — cards just won't have a byline */ }
        }
        communityCacheRef.current = {
          loaded: true,
          loading: null,
          entries,
          friendIds,
          expertIds,
          authors,
        };
      } catch (err) {
        console.error('[AppAssistant] loadCommunityRecipes failed:', err);
        // Keep loading=null so future calls can retry.
        communityCacheRef.current.loading = null;
      }
    })();
    cache.loading = work;
    return work;
  }, [userId]);

  const handleSearchCommunityRecipes = useCallback(async (
    opts: { query?: string; cuisine?: string; source?: 'friends' | 'experts' | 'public' | 'all' },
  ): Promise<CommunityRecipeHit[]> => {
    await loadCommunityRecipes();
    const cache = communityCacheRef.current;
    if (!cache.loaded) return [];

    // Filter by source. 'friends' = entries authored by accepted
    // friends; 'experts' = entries authored by experts (including
    // experts who are also friends); 'public' = everyone else;
    // 'all' (default) = no source filter.
    const source = opts.source || 'all';
    const ownId = userId || '';
    const candidates = cache.entries.filter((e) => {
      if (e.userId === ownId) return false;
      if (source === 'friends') return cache.friendIds.has(e.userId);
      if (source === 'experts') return cache.expertIds.has(e.userId);
      if (source === 'public') return !cache.friendIds.has(e.userId) && !cache.expertIds.has(e.userId);
      return true;
    });

    // Apply query + cuisine filters. Both are case-insensitive
    // substring matches across title / cuisine / tags / description /
    // ingredient names so a generic query like 'korean' or 'pasta'
    // catches anything that mentions it anywhere.
    const queryLower = (opts.query || '').trim().toLowerCase();
    const cuisineLower = (opts.cuisine || '').trim().toLowerCase();
    const matches = candidates.filter((e) => {
      if (cuisineLower && !e.cuisine.toLowerCase().includes(cuisineLower)) return false;
      if (queryLower) {
        const hay = `${e.title} ${e.cuisine} ${e.description} ${e.tags.join(' ')} ${e.ingredientText}`.toLowerCase();
        if (!hay.includes(queryLower)) return false;
      }
      return true;
    });

    // Sort: friends first (closer connection), then experts, then
    // everyone else. Within each tier, newer updated_at wins.
    matches.sort((a, b) => {
      const aFriend = cache.friendIds.has(a.userId) ? 0 : 1;
      const bFriend = cache.friendIds.has(b.userId) ? 0 : 1;
      if (aFriend !== bFriend) return aFriend - bFriend;
      const aExpert = cache.expertIds.has(a.userId) ? 0 : 1;
      const bExpert = cache.expertIds.has(b.userId) ? 0 : 1;
      if (aExpert !== bExpert) return aExpert - bExpert;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    return matches.slice(0, 10).map<CommunityRecipeHit>((e) => {
      const author = cache.authors[e.userId];
      return {
        id: e.id,
        userId: e.userId,
        title: e.title,
        cuisine: e.cuisine || undefined,
        prepTimeMinutes: e.prepTime ?? undefined,
        cookTimeMinutes: e.cookTime ?? undefined,
        difficulty: e.difficulty || undefined,
        photos: e.photos,
        ingredientCount: e.ingredientCount,
        stepCount: e.stepCount,
        source: e.source,
        authorUsername: author?.username,
        authorDisplayName: author?.display_name || author?.username,
        authorIsExpert: cache.expertIds.has(e.userId),
        authorIsFriend: cache.friendIds.has(e.userId),
      };
    });
  }, [loadCommunityRecipes, userId]);

  /* ── visible / cityDisplay / etc. — page context wins; otherwise
       fall back to defaults derived from the user's home setting ── */
  const visible = pageContext?.visible || [];
  const restaurantMeta = pageContext?.restaurantMeta || lists.restaurantMeta;
  const filters: ChatFilters = pageContext?.filters || {};
  const origin = pageContext?.origin || (homeLoc ? { lat: homeLoc.lat, lng: homeLoc.lng } : null);
  const cityDisplay = pageContext?.cityDisplay
    || homeLoc?.label
    || auth.profile?.home_city
    || 'your area';
  const shortCityName = pageContext?.shortCityName
    || (homeLoc?.label?.split(',')[0] || auth.profile?.home_city?.split(',')[0] || 'your city').trim();

  /* ── Tool callbacks — prefer the page-published handlers, fall
       back to generic implementations otherwise ──────────────── */
  const handleSearchRestaurants = useCallback(async (query: string, city?: string): Promise<ScoredPlace[]> => {
    if (pageContext?.onSearchRestaurants) return pageContext.onSearchRestaurants(query, city);
    return fallbackSearchRestaurants(query, city, homeLoc);
  }, [pageContext, homeLoc]);

  // AI chat: query the bundled Michelin dataset (stars / Bib / Selected).
  // Local-only — no Google/web calls. Resolves the requested city (or the
  // user's current/home coords) and pulls matching restaurants.
  const handleSearchMichelin = useCallback(async (opts: {
    distinctions?: string[]; city?: string; name?: string; limit?: number;
  }): Promise<MichelinChatHit[]> => {
    const toHit = (m: MichelinInfo): MichelinChatHit => ({
      ...michelinToPlaceResult(m),
      recScore: 0,
      sources: ['google'],
      michelinDistinction: michelinDistinctionLabel(m),
      guideUrl: m.guideUrl,
      cuisineText: m.cuisine,
      priceText: michelinPriceDisplay(m),
    });
    try {
      let anchorLat = origin?.lat;
      let anchorLng = origin?.lng;
      const targetCity = opts.city?.trim();
      const isOtherCity = !!targetCity && targetCity.toLowerCase() !== shortCityName.toLowerCase();
      if (isOtherCity) {
        try {
          const geo = await geocodePlace(targetCity!);
          if (geo) { anchorLat = geo.lat; anchorLng = geo.lng; }
        } catch { /* fall back to current coords */ }
      }
      if (opts.name) {
        const found = await michelinByName(opts.name, anchorLat, anchorLng, Math.min(opts.limit ?? 5, 10));
        return found.map(toHit);
      }
      if (anchorLat == null || anchorLng == null) return [];
      const results = await michelinNearby(anchorLat, anchorLng, 12, opts.distinctions ?? []);
      const cap = Math.min(opts.limit ?? 40, 80);
      return results.slice(0, cap).map(toHit);
    } catch (err) {
      console.error('[AppAssistant] handleSearchMichelin error:', err);
      return [];
    }
  }, [origin, shortCityName]);

  const handleLookupUser = useCallback(async (query: string): Promise<AssistantUser[]> => {
    if (pageContext?.onLookupUser) return pageContext.onLookupUser(query);
    try {
      const profiles = await searchUsersByUsername(query.trim(), auth.user?.id || '');
      return profiles.slice(0, 8).map((p) => ({
        username: p.username,
        displayName: p.display_name || p.username,
        bio: p.bio || undefined,
        isExpert: !!p.is_verified,
        homeCity: p.home_city || undefined,
      }));
    } catch {
      return [];
    }
  }, [pageContext, auth.user?.id]);

  const handleFindExperts = useCallback(async (opts: { cuisine?: string; city?: string }): Promise<AssistantUser[]> => {
    try {
      const profiles = await getExpertProfiles();
      if (!profiles || profiles.length === 0) return [];
      const cuisine = opts.cuisine?.trim().toLowerCase() || '';
      const city = opts.city?.trim().toLowerCase() || '';
      let filtered = profiles;
      if (cuisine) {
        filtered = filtered.filter((p) => (p.bio || '').toLowerCase().includes(cuisine));
      }
      if (city) {
        filtered = filtered.filter((p) => (p.home_city || '').toLowerCase().includes(city));
      }
      // Honest empties: when the filters match nobody, say so — silently
      // substituting the unfiltered list made the model present
      // non-matching experts as matches.
      if (filtered.length === 0) return [];
      return filtered.slice(0, 8).map((p) => ({
        username: p.username,
        displayName: p.display_name || p.username,
        bio: p.bio || undefined,
        isExpert: true,
        homeCity: p.home_city || undefined,
      }));
    } catch {
      return [];
    }
  }, []);

  const handleGetCircleRatings = useCallback(async (restaurantId: string): Promise<AssistantCircleRating[]> => {
    // LocationPage supplies a preloaded-signals version; everywhere else
    // run the direct per-restaurant query. Returning a hardcoded [] here
    // used to make the model tell users "no one in your circle rated
    // this" on every page but /location — plausibly false.
    if (pageContext?.onGetCircleRatings) return pageContext.onGetCircleRatings(restaurantId);
    return getCircleRatingsForRestaurant(auth.user?.id, restaurantId);
  }, [pageContext, auth.user?.id]);

  /* ── Action handlers ───────────────────────────────────────── */
  const handleNavigate = useCallback((path: string): ActionResult => {
    // Defense in depth: even though LocationChat already whitelists the path,
    // re-check here so no assistant-driven navigation escapes the route table.
    if (!isAllowedAppPath(path)) {
      return { ok: false, detail: `"${path}" is not a navigable in-app page.` };
    }
    navigate(path);
    return { ok: true };
  }, [navigate]);

  /** Open the unified Add-Restaurant flow — the same multi-step
   *  modal users get when tapping the "+" button on a restaurant
   *  card. Used for both open_rating_modal and
   *  open_add_restaurant_modal because the unified modal is the
   *  canonical rate / log / wishlist surface (the old standalone
   *  RatingModal has been retired). */
  const handleOpenRatingModal = useCallback((restaurantId: string): ActionResult => {
    const meta = buildRestaurantMetaFromId(restaurantId, lists.restaurantMeta, lists.ratings, lists.wishlist, pageContext);
    if (!meta) {
      return { ok: false, detail: "I couldn't resolve that restaurant id. Try search_restaurants first to fetch a real Google place id." };
    }
    lists.openAddRestaurantModal(meta);
    return { ok: true, detail: `Now rating ${ugc(meta.name, UGC_MAX_NAME)}.` };
  }, [lists, pageContext]);

  const handleOpenAddRestaurantModal = useCallback((restaurantId: string, initialPage?: string): ActionResult => {
    const meta = buildRestaurantMetaFromId(restaurantId, lists.restaurantMeta, lists.ratings, lists.wishlist, pageContext);
    if (!meta) {
      return { ok: false, detail: "I couldn't resolve that restaurant id. Try search_restaurants first." };
    }
    lists.openAddRestaurantModal(meta, initialPage);
    return { ok: true, detail: `Add Restaurant flow open for ${ugc(meta.name, UGC_MAX_NAME)}.` };
  }, [lists, pageContext]);

  const handleOpenAddToListModal = useCallback((restaurantId: string): ActionResult => {
    const meta = buildRestaurantMetaFromId(restaurantId, lists.restaurantMeta, lists.ratings, lists.wishlist, pageContext);
    if (!meta) {
      // Still try to open the modal — restaurantId alone can drive the
      // picker if the meta cache picks the entry up later.
      lists.openAddToListModal(restaurantId);
      return { ok: true, detail: 'Opened the Add-to-List picker (resolving restaurant details).' };
    }
    lists.openAddToListModal(restaurantId, meta);
    return { ok: true, detail: `Add-to-list picker open for ${ugc(meta.name, UGC_MAX_NAME)}.` };
  }, [lists, pageContext]);

  const handleToggleWishlist = useCallback((restaurantId: string): ActionResult => {
    const meta = buildRestaurantMetaFromId(restaurantId, lists.restaurantMeta, lists.ratings, lists.wishlist, pageContext);
    if (!meta) {
      return { ok: false, detail: "I couldn't resolve that restaurant id. Try search_restaurants first." };
    }
    const wasOn = lists.isWishlisted(restaurantId);
    // Assistant-driven change: show an undoable toast so a prompt-injected
    // toggle is always visible to the user and reversible in one tap.
    lists.toggleWishlist(meta, { undoable: true });
    return {
      ok: true,
      detail: wasOn
        ? `Removed ${ugc(meta.name, UGC_MAX_NAME)} from your wishlist.`
        : `Added ${ugc(meta.name, UGC_MAX_NAME)} to your wishlist.`,
    };
  }, [lists, pageContext]);

  /** Recipe flow. We route BOTH open_add_recipe_modal and
   *  open_home_meal_modal to the same canonical Add Recipe surface
   *  (internally AddHomeMealModal — the richer one with ingredients,
   *  steps, photos, score). The list-scoped AddRecipeModal
   *  (lists.openAddRecipeModal) is a legacy variant we deliberately
   *  don't surface through the chat. */
  const handleOpenAddRecipeModal = useCallback((): ActionResult => {
    lists.openHomeMealModal();
    return { ok: true, detail: 'Add Recipe flow open.' };
  }, [lists]);

  const handleOpenAddPostModal = useCallback((): ActionResult => {
    posts.openAddPostModal();
    return { ok: true };
  }, [posts]);

  const handleOpenAddReelModal = useCallback((kind?: 'restaurant' | 'recipe'): ActionResult => {
    reels.openAddReelModal(kind);
    return { ok: true };
  }, [reels]);

  const handleOpenHomeMealModal = useCallback((meal?: HomeMeal, opts?: { onBackToDraft?: () => void }): ActionResult => {
    lists.openHomeMealModal(meal, opts);
    return { ok: true };
  }, [lists]);

  const handleOpenGuideCreator = useCallback((): ActionResult => {
    guides.openGuideCreator();
    return { ok: true };
  }, [guides]);

  const currentPath = location.pathname;
  const currentPageLabel = labelForPath(currentPath);
  const fabAboveBottomNav = settings.phoneMode && routeShowsBottomNav(currentPath);
  // Only enable scroll-hide on the mobile / phone-frame layout.
  // Desktop sidebar mode keeps the FAB pinned. Hook MUST run before
  // any early return so the rules-of-hooks order stays stable.
  const fabHidden = useFabScrollHide(settings.phoneMode, currentPath);

  if (hidden) return null;

  return (
    <LocationChat
      fabAboveBottomNav={fabAboveBottomNav}
      fabOverTakeover={onSearchMap && takeoverOpen}
      fabHidden={fabHidden}
      visible={visible}
      restaurantMeta={restaurantMeta}
      cityDisplay={cityDisplay}
      shortCityName={shortCityName}
      ratingsCount={lists.ratings.length}
      filters={filters}
      origin={origin}
      onSearchRestaurants={handleSearchRestaurants}
      onSearchMichelin={handleSearchMichelin}
      onLookupUser={handleLookupUser}
      onFindExperts={handleFindExperts}
      onSearchCommunityRecipes={handleSearchCommunityRecipes}
      onGetCircleRatings={handleGetCircleRatings}
      onAssistantPlaces={pageContext?.onAssistantPlaces}
      userContext={userContext}
      recipes={chatRecipesAll}
      knownPlaces={knownPlaces}
      currentPath={currentPath}
      currentPageLabel={currentPageLabel}
      onNavigate={handleNavigate}
      onOpenRatingModal={handleOpenRatingModal}
      onOpenAddRestaurantModal={handleOpenAddRestaurantModal}
      onOpenAddToListModal={handleOpenAddToListModal}
      onToggleWishlist={handleToggleWishlist}
      onOpenAddRecipeModal={handleOpenAddRecipeModal}
      onOpenAddPostModal={handleOpenAddPostModal}
      onOpenAddReelModal={handleOpenAddReelModal}
      onOpenHomeMealModal={handleOpenHomeMealModal}
      onOpenGuideCreator={handleOpenGuideCreator}
      homeMeals={lists.homeMeals}
      onPublishHomeMeal={lists.createHomeMeal}
    />
  );
};
