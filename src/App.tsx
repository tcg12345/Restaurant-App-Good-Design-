/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, useNavigationType, Navigate } from 'react-router-dom';
import { Discover } from './pages/Discover';
import { Experts } from './pages/Experts';
import { VerificationApply } from './pages/VerificationApply';
import { AdminVerification } from './pages/AdminVerification';
import { Profile } from './pages/Profile';
import { SettingsPage } from './pages/SettingsPage';
import { TopListPage } from './pages/TopListPage';
import { TasteProfilePage } from './pages/TasteProfilePage';
import { UserTasteProfilePage } from './pages/UserTasteProfilePage';
import { AdminCuisineSuggestions } from './pages/AdminCuisineSuggestions';
import { Pantry } from './pages/Pantry';
import { RecommendedForYou } from './pages/RecommendedForYou';
import { Circle } from './pages/Circle';
import { Search } from './pages/Search';
import { SearchMain } from './pages/SearchMain';
import { Reels } from './pages/Reels';
import { Activity } from './pages/Activity';
import { RestaurantDetail } from './pages/RestaurantDetail';
import { Create } from './pages/Create';
import { BottomNav } from './components/BottomNav';
import { PullToRefresh } from './components/PullToRefresh';
import { SwipeBackContainer } from './components/SwipeBackContainer';
import { subscribeOverlay } from './lib/overlay-registry';
import { topLayerAvailable } from './lib/useBottomSheet';
import { ScrollRestoration } from './components/ScrollRestoration';
import { KEEP_ALIVE_PATHS } from './lib/keep-alive';
import { useHomeLocation } from './contexts/HomeLocationContext';
import { recordNavEntry, navEntryAt, backTargetFor, isTabRootLocation, isSheetPath, stackKeyFor } from './lib/nav-stack';
import { Sidebar } from './components/Sidebar';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ListsProvider } from './contexts/ListsContext';
import { SharedListsProvider } from './contexts/SharedListsContext';
import { ToastProvider } from './contexts/ToastContext';
import { RecipesProvider } from './contexts/RecipesContext';
import { configureNativeKeyboard } from './lib/native-keyboard';
import { VerificationOutcomeModal } from './components/VerificationOutcomeModal';
import { AddToListModal } from './components/AddToListModal';
import { RatingFlow } from './components/RatingFlow';
import { AddRecipeModal } from './components/AddRecipeModal';
import { AddHomeMealModal } from './components/AddHomeMealModal';
import { AddReelModal } from './components/AddReelModal';
import { AddPostModal } from './components/AddPostModal';
import { RecipeModal } from './components/RecipeModal';
import { RecipePage } from './pages/RecipePage';
import { RecipesForYou } from './pages/RecipesForYou';
import { GuideDetail } from './pages/GuideDetail';
import { GuideEdit } from './pages/GuideEdit';
import { Auth } from './pages/Auth';
import { PreAuthFlow } from './components/onboarding/PreAuthFlow';
import { isPreauthDone, getPreauthOutcome, shouldAskGuestToSave, noteGuestAsked } from './lib/preauth';
import { ImportRestaurants } from './pages/ImportRestaurants';
import { ProfileSetup } from './pages/ProfileSetup';
import { UserProfile } from './pages/UserProfile';
import { FollowList } from './pages/FollowList';
import { Messages } from './pages/Messages';
import { FriendReviewDetail } from './pages/FriendReviewDetail';
import { LocationPage } from './pages/LocationPage';
import { LocationMap } from './pages/LocationMap';
import { RestaurantCircleReviews } from './pages/RestaurantCircleReviews';
import { ReorderRatings } from './pages/ReorderRatings';
import { ChatProvider } from './contexts/ChatContext';
import { NotificationsProvider } from './contexts/NotificationsContext';
import { ReelsProvider } from './contexts/ReelsContext';
import { PostsProvider } from './contexts/PostsContext';
import { PageAddActionProvider } from './contexts/PageAddActionContext';
import { CirclePanelProvider, useCirclePanel } from './contexts/CirclePanelContext';
import { GuideCreatorProvider, useGuideCreator } from './contexts/GuideCreatorContext';
import { HomeLocationProvider } from './contexts/HomeLocationContext';
import { FindAPlaceHost } from './components/FindAPlaceHost';
import { AssistantProvider } from './contexts/AssistantContext';
import { AiChatHistoryProvider } from './contexts/AiChatHistoryContext';
import { GuideCreatorSheet } from './components/GuideCreatorSheet';
import { CirclePanel } from './components/CirclePanel';
import { AppAssistant } from './components/AppAssistant';
import { FeatureTour } from './components/FeatureTour';
import { Logo } from './components/Logo';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { SignInModalProvider } from './contexts/SignInModalContext';
import { PlanProvider } from './contexts/PlanContext';
import { PaywallProvider } from './contexts/PaywallContext';
import { ProPage } from './pages/ProPage';
import { ProIntroStep } from './components/onboarding/ProIntroStep';

/** /pro/intro — the onboarding Pro intro as a page; every exit goes back. */
const ProIntroRoute: React.FC = () => {
  const navigate = useNavigate();
  return <ProIntroStep onDone={() => navigate(-1)} />;
};
import { RequireAuthRoute } from './components/RequireAuthRoute';
import { wakeGlassButtons } from './lib/glass-buttons';

/**
 * Track whether the viewport is wide enough to render the desktop sidebar.
 * Falls back to false during SSR / before the first matchMedia read.
 */
/**
 * Renders the Instagram-style Circle slide-out next to the desktop
 * sidebar with a dim backdrop. Only renders when the panel context says
 * it's open; mobile / phone-frame layouts don't use this helper at all.
 */
const CircleDesktopOverlay: React.FC = () => {
  const { open, setOpen } = useCirclePanel();
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="circle-panel-backdrop"
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <CirclePanel variant="overlay" onClose={() => setOpen(false)} />
        </>
      )}
    </AnimatePresence>
  );
};

/**
 * Mounts the guide-creation sheet once at the app root. Triggered by
 * useGuideCreator() from anywhere — sidebar / profile / Discover tile /
 * Create page.
 */
const GuideCreatorMount: React.FC = () => {
  const { isOpen, initialGuide, seed, closeGuideCreator } = useGuideCreator();
  return <GuideCreatorSheet open={isOpen} onClose={closeGuideCreator} initialGuide={initialGuide} seed={seed} />;
};

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = React.useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches,
  );
  React.useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isDesktop;
}

// Tab-root pages stay mounted across navigation (keep-alive) so returning to
// them is instant with scroll + state intact, rather than remounting and
// reloading. Heavy/transient screens (map, reels, create, detail pages) are
// intentionally NOT kept alive — they push/pop normally. KEEP_ALIVE_PATHS is
// shared with ScrollRestoration (which skips them — they keep their own scroll).
// `active` — whether this layer is the CURRENT route. Auth-gated tabs pass
// it to RequireAuthRoute as `redirect` so a hidden (inactive) layer renders
// null for guests instead of a <Navigate> that re-fires on every location
// change and permanently hijacks navigation back to Home.
const keepAliveElement = (path: string, active: boolean): React.ReactNode => {
  switch (path) {
    case '/': return <Discover mode="home" />;
    case '/search': return <Search />;
    case '/search/main': return <SearchMain />;
    case '/pantry': return <RequireAuthRoute reason="Sign in to open your lists" redirect={active}><Pantry /></RequireAuthRoute>;
    case '/profile': return <RequireAuthRoute reason="Sign in to view your profile" redirect={active}><Profile /></RequireAuthRoute>;
    default: return null;
  }
};

// Every destination reachable directly from the bottom nav or the desktop
// sidebar. Landing on one via a tap/click is a tab SWITCH and must swap with
// no motion — the iOS push/pop slide is only for detail-page navigation.
// (Keep-alive tabs never animate anyway; listing them still matters for the
// EXIT side: leaving a Stack page for a kept tab must also be instant.)
const TAB_SWITCH_PATHS = new Set<string>([
  ...KEEP_ALIVE_PATHS, '/search', '/map', '/reels', '/messages',
]);

/** Shown when the signed-in user's profile fetch failed (network/timeout).
 *  We genuinely don't know whether their profile row exists, so rendering
 *  ProfileSetup here would let one flaky request re-onboard an existing user
 *  and overwrite their real profile. Offer a retry (and sign-out) instead. */
const ProfileLoadError: React.FC = () => {
  const { refreshProfile, signOut } = useAuth();
  const [retrying, setRetrying] = React.useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await refreshProfile(); } finally { setRetrying(false); }
  };
  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <Logo size={48} variant="tint" className="mx-auto text-primary" />
        <h1 className="mt-5 font-serif font-bold text-2xl text-on-surface">Couldn't load your profile</h1>
        <p className="mt-2 text-sm text-on-surface/55 leading-relaxed">
          Check your connection and try again — your profile is safe, we just couldn't reach it.
        </p>
        <button
          type="button"
          onClick={() => void retry()}
          disabled={retrying}
          className="mt-6 w-full bg-primary text-on-primary px-8 py-3 rounded-2xl text-base font-semibold shadow-lg shadow-primary/25 disabled:opacity-60"
        >
          {retrying ? 'Retrying…' : 'Retry'}
        </button>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 text-sm text-on-surface/45 hover:text-on-surface transition-colors"
        >
          Sign out
        </button>
      </div>
    </div>
  );
};

const AppContent: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const navType = useNavigationType();
  // Set true by the swipe-back gesture so a single route change swaps with no
  // AnimatePresence transition — the gesture drives the slide itself.
  const [instantNav, setInstantNav] = React.useState(false);
  // Router history index of the current entry — keys the swipe-back snapshot
  // store and the in-app nav-stack record.
  const historyIdx = typeof window.history.state?.idx === 'number' ? window.history.state.idx : null;
  // Remember what lives at each history index so the swipe-back gesture knows
  // where a pop would actually land (see lib/nav-stack.ts).
  React.useEffect(() => {
    recordNavEntry(historyIdx ?? 0, { pathname: location.pathname, search: location.search }, navType);
  }, [location, historyIdx, navType]);
  // A route change moves whole layers (keep-alive flips visibility with no
  // event the sampler listens for) — re-arm it so native glass from the
  // hidden layer stands down instead of floating over the new page.
  React.useEffect(() => {
    wakeGlassButtons();
  }, [location.pathname]);
  const { phoneMode, setKeyboardOpen } = useSettings();
  React.useEffect(() => {
    let handle: { destroy(): void } | null = null;
    let cancelled = false;
    void configureNativeKeyboard({
      onKeyboardChange: (open) => setKeyboardOpen(open),
    }).then((h) => {
      // Setup is async: if the effect tore down before it resolved
      // (StrictMode does exactly this on mount), `handle` was still null in
      // the cleanup — the first invocation's whole listener set (capture
      // pointerdown, focusin, visualViewport ×2, Keyboard ×3) leaked and a
      // second full set installed. Destroy a handle that arrives late.
      if (cancelled) { h.destroy(); return; }
      handle = h;
    });
    return () => { cancelled = true; handle?.destroy(); };
  }, [setKeyboardOpen]);
  const isMapPage = location.pathname === '/map';
  const isReelsPage = location.pathname === '/reels';
  const isFocusedReel = location.pathname.startsWith('/r/');
  const showBottomNav = !['/messages', '/reorder', '/location', '/location/map', '/map', '/create', '/recipes-for-you', '/circle', '/settings'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/') && !location.pathname.startsWith('/user/') && !location.pathname.startsWith('/profile/top/') && !location.pathname.startsWith('/recipe/') && !location.pathname.startsWith('/meal/') && !location.pathname.startsWith('/review/') && !location.pathname.startsWith('/activity') && !location.pathname.startsWith('/guides/') && !isFocusedReel;
  const { isSignedIn, isGuest, continueAsGuest, loading, profile, profileComplete, profileError, profileLoading, needsPasswordSetup } = useAuth();
  // How the pre-auth taste flow was left — 'signup' carries the "save your
  // taste profile" framing into the Auth screen it hands off to. Seeded from
  // the durable record so a relaunch ON the gate keeps that framing instead
  // of falling back to the generic "Welcome to GoodEats" sign-in copy.
  const [preauthExited, setPreauthExited] = React.useState<null | 'signup' | 'signin'>(() => {
    const o = getPreauthOutcome();
    return o === 'signup' || o === 'signin' ? o : null;
  });
  // The one follow-up offer to a guest who finished onboarding (see
  // shouldAskGuestToSave). Decided once per launch, and burned on show so
  // declining it never re-arms it.
  const [askGuestToSave, setAskGuestToSave] = React.useState(() => isGuest && shouldAskGuestToSave());
  React.useEffect(() => { if (askGuestToSave) noteGuestAsked(); }, [askGuestToSave]);
  // Reinstall / second-device backstop: the profile knows their home city,
  // but nothing ever read those columns back into the location the app
  // actually resolves from. Without this a returning user on a new phone
  // gets the GPS prompt and, on denial, New York.
  const homeLocationCtx = useHomeLocation();
  const hydrateHome = homeLocationCtx?.hydrateFromProfile;
  const profileCity = profile?.home_city;
  const profileLat = profile?.home_lat;
  const profileLng = profile?.home_lng;
  React.useEffect(() => {
    if (!profileCity || !hydrateHome) return;
    hydrateHome(profileCity, profileLat, profileLng);
  }, [profileCity, profileLat, profileLng, hydrateHome]);
  const isDesktop = useIsDesktop();
  // Sidebar mode: real desktop viewport. Guests get the sidebar too so they
  // can navigate the app (it renders a "Sign in" affordance instead of a
  // profile). `phoneMode` is viewport/runtime-derived (<1024px or native) — the
  // exact inverse of `isDesktop` (≥1024px), so every viewport is either phone
  // or desktop-sidebar with no intermediate "tablet" layout in between.
  const useSidebar = isDesktop && !phoneMode;

  // Pull-to-refresh (phone): bump the CURRENT route's nonce so that page
  // remounts and its mount-time data loads re-run, and broadcast
  // `app:refresh` for any context that wants to refetch in place — a soft
  // refresh with no full page reload / loading flash. Nonces are scoped
  // PER PATH: a single global nonce used to key every keep-alive layer,
  // so refreshing Discover also remounted Search/Pantry/Profile and threw
  // away the scroll positions keep-alive exists to preserve.
  const [refreshNonces, setRefreshNonces] = React.useState<Record<string, number>>({});
  const refreshKeyFor = (path: string) => refreshNonces[path] ?? 0;
  const handleRefresh = React.useCallback(async () => {
    window.scrollTo({ top: 0 });
    const path = location.pathname;
    setRefreshNonces((m) => ({ ...m, [path]: (m[path] ?? 0) + 1 }));
    window.dispatchEvent(new CustomEvent('app:refresh'));
    // Hold briefly so the remount's fetches start under the spinner.
    await new Promise((resolve) => setTimeout(resolve, 750));
  }, [location.pathname]);

  // Keep-alive: once a tab-root page is visited it stays mounted. Mounted
  // lazily (on first visit) so we don't eagerly mount every tab at startup.
  const [keptAlive, setKeptAlive] = React.useState<string[]>([]);
  // Any bottom sheet open → the page zooms back (see the presenter below).
  // Only when sheets can be lifted to the top layer; otherwise a transform
  // here would shrink the sheets too.
  const [sheetUp, setSheetUp] = React.useState(false);
  // The safe-area top, measured once: the zoomed page's top edge sits just
  // under the status bar, where iOS puts a presenting screen.
  const [safeTop, setSafeTop] = React.useState(0);
  React.useEffect(() => {
    if (!topLayerAvailable()) return;
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:env(safe-area-inset-top);pointer-events:none;visibility:hidden';
    document.body.appendChild(probe);
    setSafeTop(probe.offsetHeight);
    probe.remove();
    return subscribeOverlay((open) => { setSheetUp(open); wakeGlassButtons(); });
  }, []);
  React.useEffect(() => {
    if (KEEP_ALIVE_PATHS.includes(location.pathname)) {
      setKeptAlive((k) => (k.includes(location.pathname) ? k : [...k, location.pathname]));
    }
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Logo size={48} className="text-primary animate-pulse" />
      </div>
    );
  }

  // Auth is the first screen, but it offers "Browse without an account"
  // (Guideline 5.1.1(v) — non-account features must be reachable without
  // registering). Once the user is signed in OR has chosen guest mode, the
  // full app renders; account-only routes/actions then prompt sign-in
  // on demand via the SignInModal overlay.
  // Signed-out (non-guest) users get the Auth screen — and so does a
  // freshly code-verified signup that hasn't chosen a password yet
  // (needsPasswordSetup): the session already exists, but Auth stays up
  // on its choose-password step until it's set.
  // `askGuestToSave` is the third case: a guest who answered every onboarding
  // question and was never once offered an account, because "Browse without
  // an account" wrote a flag that this branch has always treated as final.
  // They get the gate one more time, with the escape still on it.
  if ((!isSignedIn && !isGuest) || (isSignedIn && needsPasswordSetup) || (isGuest && askGuestToSave)) {
    // Fresh installs meet the taste questions BEFORE the account gate — the
    // signup ask lands after the personalized preview, framed as saving
    // what was just built. One-shot per device (isPreauthDone); leaving the
    // flow in any direction (signup, sign-in, guest) marks it done, so
    // returning users and mid-signup relaunches (needsPasswordSetup) go
    // straight to Auth as before.
    const showPreauth = !isSignedIn && !preauthExited && !isPreauthDone();
    return (
      <div className="min-h-screen bg-surface selection:bg-primary/20 selection:text-primary">
        <Routes location={location}>
          <Route path="/import" element={<ImportRestaurants />} />
          <Route
            path="*"
            element={showPreauth
              ? <PreAuthFlow onExit={(mode) => setPreauthExited(mode)} onBrowseAsGuest={continueAsGuest} />
              : (
                <Auth
                  // For the guest follow-up the escape DISMISSES the ask —
                  // they are already a guest, so re-entering guest mode
                  // would leave the gate up forever.
                  onBrowseAsGuest={askGuestToSave ? () => setAskGuestToSave(false) : continueAsGuest}
                  saveTasteFraming={preauthExited === 'signup' || askGuestToSave}
                  // Reached via "Sign in": unknown identifiers error
                  // instead of silently starting a signup. (Survives
                  // relaunch — preauthExited is seeded from the stored
                  // outcome.)
                  signInOnly={preauthExited === 'signin'}
                />
              )}
          />
        </Routes>
      </div>
    );
  }

  // Order matters here. When the profile fetch FAILED we don't know whether
  // a row exists, so ProfileSetup must never render — completing it would
  // overwrite the user's real profile (bio wiped, private account flipped
  // public). Show a retry screen instead; ProfileSetup is reserved for a
  // confirmed-missing/incomplete profile. While a fetch is still in flight
  // (e.g. right after sign-in), hold the splash rather than flash the wizard.
  if (isSignedIn && !profileComplete && profileError) {
    // Checked before profileLoading so a retry keeps this screen (with its
    // own "Retrying…" state) mounted instead of bouncing through the splash.
    return <ProfileLoadError />;
  }
  if (isSignedIn && !profileComplete && profileLoading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <Logo size={48} className="text-primary animate-pulse" />
      </div>
    );
  }
  if (isSignedIn && !profileComplete) {
    return (
      <div className="min-h-screen bg-surface">
        <ProfileSetup />
      </div>
    );
  }

  // ── Routes block, shared between sidebar and phone/narrow layouts ──
  // The Create page slides in horizontally from the left and overlays
  // the route underneath, so the swipe-from-edge gesture on Discover
  // feels native rather than waiting for a fade-out first. Other routes
  // keep the existing fade + small vertical lift in `mode="wait"`.
  const isCreateRoute = location.pathname === '/create';
  /**
   * Routes that present as a SHEET rather than a push: they rise from the
   * bottom over the page that opened them, which stays put behind, scaled
   * back and dimmed the way iOS shrinks a presenting screen. The lists
   * hanging off a profile's stat row are a modal view of that profile's
   * data, not a place you navigate to — so they should read as the same
   * page with something raised over it.
   */
  const isSheetRoute = isSheetPath(location.pathname);
  // Detail pages slide horizontally (iOS push/pop) rather than fading. Fading
  // an opaque page out over the kept tab caused a white wash; sliding it off
  // also covers the tab during its first repaint, so there's no flash.
  const motionTransition = isCreateRoute
    ? { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }
    : { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const };
  // Tapping a bottom-nav / sidebar destination is a tab SWITCH, not a push —
  // it must swap with no motion. The iOS slide stays reserved for pushes
  // into detail pages and their pops (navType POP keeps the slide so an
  // in-app back button still plays the exit reveal; the swipe gesture sets
  // `instantNav` itself and drives the motion with its own drag).
  const isTabSwitchNav = TAB_SWITCH_PATHS.has(location.pathname) && navType !== 'POP';
  const stackInstant = instantNav || isTabSwitchNav;
  // PUSH and POP slide in opposite directions (iOS). On a push the new page
  // drives in from the right ABOVE the old one, which parks 35% off to the
  // left, slightly dimmed (the iOS parallax); on a pop the old page slides
  // off to the RIGHT above the parked page gliding back to center. The exit
  // used to be x:'100%' unconditionally, so pushing detail→detail played the
  // POP animation on the outgoing page — it read as going backwards.
  // REPLACE navigations count as pushes. Both flags travel via
  // AnimatePresence `custom`, not props: an exiting page keeps its STALE
  // variants (that's what preserves /create's leftward exit direction after
  // leaving it), but framer refreshes `custom` on exiting clones — so the
  // new navigation's instant-ness AND direction reach the old page's exit
  // while the create-vs-stack branch stays source-correct.
  // A dismissal is a POP whose FORWARD entry (the one being popped off) is
  // a sheet — that is what tells the page underneath to come back by
  // un-scaling rather than sliding in from the parallax slot.
  const fromSheet = navType === 'POP'
    && isSheetPath(navEntryAt((historyIdx ?? 0) + 1)?.pathname ?? '');
  const stackNav = {
    instant: stackInstant, pop: navType === 'POP',
    // Read by the OUTGOING page: framer refreshes `custom` on exiting
    // clones, so the presenter learns it is being covered by a sheet.
    toSheet: isSheetRoute,
    fromSheet,
  };
  type StackNav = typeof stackNav;
  // Non-create pages live in normal flow (so the document is as tall as the
  // page and sticky chrome works) and only become absolute for the exit
  // slide, where they must overlay what's revealed underneath. Motion applies
  // the non-animatable position/inset/zIndex values instantly at exit start —
  // the geometry is identical to the in-flow box, so there's no jump. The
  // dim rides a brightness() filter, NOT opacity: the parked page must stay
  // opaque or the kept-alive tab beneath ghosts through it mid-slide.
  const stackVariants: Variants = {
    enter: ({ instant, pop, fromSheet }: StackNav) => {
      if (instant) return { x: 0 };
      if (isCreateRoute) return { x: '-100%', opacity: 1 };
      // A sheet rises from the bottom edge, full width, no parallax.
      if (isSheetRoute) return { y: '100%' };
      // Revealed by a sheet going down: already in place, just held back
      // and dimmed — the mirror of the presenter's exit below.
      if (fromSheet) return { scale: 0.94, filter: 'brightness(0.82)' };
      // Pop: re-emerge from the parked parallax slot, brightening.
      return pop ? { x: '-35%', filter: 'brightness(0.85)' } : { x: '100%' };
    },
    center: ({ instant }: StackNav) => ({
      x: 0,
      ...(isSheetRoute ? { y: 0 } : { scale: 1 }),
      ...(isCreateRoute
        ? { opacity: 1 }
        // Clear the filter once centered — any non-none filter turns the
        // wrapper into a containing block for fixed-position descendants
        // (bottom sheets, overlays), which must not persist at rest.
        : { filter: 'brightness(1)', transitionEnd: { filter: 'none' } }),
      transition: instant ? { duration: 0 } : motionTransition,
    }),
    exit: ({ instant, pop, toSheet }: StackNav) => ({
      ...(isCreateRoute
        ? { x: '-100%', opacity: 1 }
        : isSheetRoute
          // The sheet itself, dismissing: straight back down.
          ? { position: 'absolute' as const, top: 0, left: 0, right: 0, y: '100%', zIndex: 10 }
        : toSheet
          // The presenter, being covered: it does not travel. It settles
          // back a little and dims, so the sheet reads as rising in front
          // of the page you were already on.
          ? { position: 'absolute' as const, top: 0, left: 0, right: 0, scale: 0.94, filter: 'brightness(0.82)', zIndex: 0 }
        : {
            position: 'absolute' as const, top: 0, left: 0, right: 0,
            ...(pop
              // Pop: slide off rightward ABOVE the page re-emerging beneath.
              ? { x: '100%', zIndex: 10 }
              // Push: park left + dim under the newcomer (which paints above
              // by DOM order), then unmount invisibly behind it.
              : { x: '-35%', filter: 'brightness(0.8)', zIndex: 0 }),
          }),
      transition: instant ? { duration: 0 } : motionTransition,
    }),
  };

  const isKeepAlivePath = KEEP_ALIVE_PATHS.includes(location.pathname);
  const routesBlock = (
    <>
      {/* Persistent keep-alive tab pages — visible when active, kept mounted
          (hidden) otherwise so returning to them preserves scroll + state.
          Each layer is keyed by ITS OWN refresh nonce so a pull-to-refresh
          remounts only the tab being refreshed, never its siblings. */}
      <React.Fragment>
        {keptAlive.map((path) => {
          const active = path === location.pathname;
          return (
            <div
              key={`${path}#${refreshKeyFor(path)}`}
              // The ACTIVE tab sits in normal flow so the document grows with
              // its content — position:sticky chrome (the desktop sidebar and
              // header) only sticks within its parent's real height. Inactive
              // tabs are absolutely positioned and hidden with `visibility`
              // (not display:none — that would reset inner scroll positions,
              // defeating keep-alive). No z-index: it would create a stacking
              // context that traps in-page bottom sheets below the nav. The
              // stack (rendered after this in DOM) overlays it by tree order.
              // Inactive tabs also clip overflow so an oversized hidden page
              // (e.g. a 100vh root taller than the current viewport-minus-
              // header content box) can't extend the document's scroll height
              // and let you scroll into empty space below the active page.
              style={{
                ...(active
                  ? { position: 'relative' as const }
                  : { position: 'absolute' as const, inset: 0, overflow: 'hidden' as const }),
                visibility: active ? 'visible' : 'hidden',
                pointerEvents: active ? undefined : 'none',
              }}
              aria-hidden={!active}
            >
              {keepAliveElement(path, active)}
            </div>
          );
        })}
      </React.Fragment>

      {/* Stack — every non-keep-alive route (details, map, reels, create…).
          Absolutely positioned so it overlays the tab layer; on exit it
          animates away to reveal the kept-alive tab underneath. mode="sync"
          (not "wait") so push/pop overlap like iOS: the old and new page
          slide simultaneously — sequential wait-mode played the exit over
          bare surface, then the entrance, which read as two disjoint moves. */}
      <AnimatePresence mode="sync" initial={false} custom={stackNav}>
        {!isKeepAlivePath && (
        <motion.div
          // Keyed by the SHEET, not the tab, so moving between a sheet's
          // tabs is an update rather than a dismiss-and-present.
          key={stackKeyFor(location.pathname)}
          // Lets the swipe-back gesture verify the destination (this exact
          // pathname) is mounted and at rest before it drops the covering
          // snapshot — the exiting page's wrapper must not pass for it.
          data-route-stack={location.pathname}
          variants={stackVariants}
          custom={stackNav}
          initial="enter"
          animate="center"
          exit="exit"
          className={
            isCreateRoute ? 'absolute inset-0 z-30'
              // A sheet overlays the page it was opened from instead of
              // taking its place in flow, and keeps a soft top edge while
              // it travels (flush at rest, where it is full-bleed).
              : isSheetRoute ? 'absolute inset-0 z-30 overflow-hidden rounded-t-[22px] bg-surface shadow-[0_-8px_40px_rgba(0,0,0,0.28)]'
              : 'relative bg-surface'
          }
          style={isSheetRoute ? { transformOrigin: '50% 100%' } : { transformOrigin: '50% 50%' }}
        >
        <React.Fragment key={refreshKeyFor(location.pathname)}>
        <Routes location={location}>
          <Route path="/" element={<Discover mode="home" />} />
          <Route path="/map" element={<Discover mode="map" />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          {/* Public on purpose: guests can read what Pro is; buying asks
              for sign-in. /pro/welcome is where Stripe sends people back. */}
          <Route path="/pro" element={<ProPage />} />
          <Route path="/pro/welcome" element={<ProPage />} />
          {/* The onboarding intro, on its own: for anyone who wants the tour
              again, and the way to see it without a fresh account. */}
          <Route path="/pro/intro" element={<ProIntroRoute />} />
          <Route path="/circle" element={<RequireAuthRoute reason="Sign in to see your circle"><Circle /></RequireAuthRoute>} />
          <Route path="/create" element={<RequireAuthRoute reason="Sign in to create"><Create /></RequireAuthRoute>} />
          <Route path="/search" element={<Search />} />
          <Route path="/search/main" element={<SearchMain />} />
          <Route path="/reels" element={<Reels />} />
          {/* Focused single-item viewer — same Reels component, but
              centered on a specific reel/post key (e.g. reel-<id> or
              post-<id>). Bottom nav is hidden and a back arrow is
              shown so it reads as a "look at this one" surface. */}
          <Route path="/r/:focusKey" element={<Reels />} />
          <Route path="/activity" element={<RequireAuthRoute reason="Sign in to see your activity"><Activity /></RequireAuthRoute>} />
          <Route path="/activity/saved" element={<RequireAuthRoute reason="Sign in to see your saved items"><Activity /></RequireAuthRoute>} />
          <Route path="/activity/likes" element={<RequireAuthRoute reason="Sign in to see your likes"><Activity /></RequireAuthRoute>} />
          <Route path="/activity/comments" element={<RequireAuthRoute reason="Sign in to see your comments"><Activity /></RequireAuthRoute>} />
          <Route path="/activity/drafts" element={<RequireAuthRoute reason="Sign in to see your drafts"><Activity /></RequireAuthRoute>} />
          <Route path="/experts" element={<Experts />} />
          <Route path="/verify/apply" element={<RequireAuthRoute reason="Sign in to request verification"><VerificationApply /></RequireAuthRoute>} />
          <Route path="/admin/verification" element={<RequireAuthRoute reason="Sign in to continue"><AdminVerification /></RequireAuthRoute>} />
          <Route path="/admin/cuisine" element={<RequireAuthRoute reason="Sign in to continue"><AdminCuisineSuggestions /></RequireAuthRoute>} />
          <Route path="/profile" element={<RequireAuthRoute reason="Sign in to view your profile"><Profile /></RequireAuthRoute>} />
          <Route path="/settings" element={<RequireAuthRoute reason="Sign in to manage your account"><SettingsPage /></RequireAuthRoute>} />
          <Route path="/profile/top/:listKey" element={<RequireAuthRoute reason="Sign in to view your top lists"><TopListPage /></RequireAuthRoute>} />
          <Route path="/profile/taste" element={<RequireAuthRoute reason="Sign in to see your taste profile"><TasteProfilePage /></RequireAuthRoute>} />
          <Route path="/user/:username/taste" element={<UserTasteProfilePage />} />
          <Route path="/pantry" element={<RequireAuthRoute reason="Sign in to open your lists"><Pantry /></RequireAuthRoute>} />
          <Route path="/pantry/recommended" element={<RequireAuthRoute reason="Sign in for your recommendations"><RecommendedForYou /></RequireAuthRoute>} />
          <Route path="/restaurant/:id" element={<RestaurantDetail />} />
          <Route path="/restaurant/:id/circle" element={<RestaurantCircleReviews />} />
          <Route path="/import" element={<ImportRestaurants />} />
          <Route path="/reorder" element={<RequireAuthRoute reason="Sign in to reorder your ratings"><ReorderRatings /></RequireAuthRoute>} />
          <Route path="/recipes-for-you" element={<RecipesForYou />} />
          {/* Canonical recipe detail page; the /recipe/:id (legacy) and
              /meal/:userId/:mealId aliases below keep existing links
              (reels, messages, RecipePanel, old guide entries) working. */}
          <Route path="/recipe/:userId/:id" element={<RecipePage />} />
          <Route path="/recipe/:id" element={<RecipePage />} />
          <Route path="/guides/:id" element={<GuideDetail />} />
          <Route path="/guides/:id/edit" element={<RequireAuthRoute reason="Sign in to edit guides"><GuideEdit /></RequireAuthRoute>} />
          <Route path="/meal/:userId/:mealId" element={<RecipePage />} />
          <Route path="/user/:username" element={<UserProfile />} />
          {/* Instagram-style full-page follow lists (+ own rated list) —
              one component, tab derived from the path's last segment. */}
          <Route path="/user/:username/followers" element={<FollowList />} />
          <Route path="/user/:username/following" element={<FollowList />} />
          <Route path="/user/:username/rated" element={<FollowList />} />
          <Route path="/messages" element={<RequireAuthRoute reason="Sign in to message"><Messages /></RequireAuthRoute>} />
          <Route path="/review/:ratingId" element={<FriendReviewDetail />} />
          <Route path="/location" element={<LocationPage />} />
          <Route path="/location/map" element={<LocationMap />} />
        </Routes>
        </React.Fragment>
        </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  const modals = (
    <>
      <VerificationOutcomeModal />
      <AddToListModal />
      <RatingFlow />
      <AddRecipeModal />
      <AddHomeMealModal />
      <AddReelModal />
      <AddPostModal />
      <RecipeModal />
      <GuideCreatorMount />
      {/* Global AI assistant — FAB + island, available on every
          signed-in page that hasn't opted out (see AppAssistant for
          the route exclusion list). Mounted alongside modals so its
          z-index stacks correctly. */}
      <AppAssistant />
      <FindAPlaceHost />
    </>
  );

  // ── Desktop sidebar layout ───────────────────────────────────────────
  // Wide viewports (>= lg) render a sticky left sidebar instead of the
  // floating BottomNav. There is no global top bar: search is a sidebar
  // tab, the quick-add action lives in the sidebar's Create menu, and
  // Discover hosts the home-location chip itself.
  if (useSidebar) {
    return (
      <div className="min-h-screen bg-surface text-on-surface selection:bg-primary/20 selection:text-primary flex">
        <ScrollRestoration />
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-screen flex flex-col">
          <div className="flex-1 min-w-0 relative">
            {routesBlock}
          </div>
        </main>
        <CircleDesktopOverlay />
        {modals}
      </div>
    );
  }

  // ── Phone / narrow viewport layout ───────────────────────────────────
  // Pull-to-refresh is off where a downward drag already means something
  // (reels/map panning, the messages thread, the create overlay, onboarding).
  const allowPullToRefresh =
    !isReelsPage && !isFocusedReel && !isMapPage &&
    !['/messages', '/create', '/location/map', '/search'].includes(location.pathname);
  // Edge swipe-back is allowed wherever a back destination exists, except on
  // routes that own horizontal/vertical gestures. Pure bottom-nav tab roots
  // are NOT swipeable (you never swipe between tabs), but tab *sub-views*
  // (e.g. /pantry?list=x) are — nav-stack.ts resolves where they go: a
  // history pop when the previous entry is within the same flow, otherwise
  // the sub-view's logical parent (a pantry list always backs out to the
  // pantry root, never sideways into whatever tab history holds).
  const backTarget = backTargetFor(historyIdx ?? 0, location.pathname, location.search);
  const isTabRoot = isTabRootLocation(location.pathname, location.search);
  const allowSwipeBack =
    backTarget !== null && !isReelsPage && !isFocusedReel && !isMapPage && !isTabRoot && !isSheetRoute &&
    !['/create', '/location/map'].includes(location.pathname);
  return (
    <div className="min-h-screen selection:bg-primary/20 selection:text-primary" style={{ background: sheetUp ? '#000' : 'var(--color-surface)' }}>
      <ScrollRestoration />
      <PullToRefresh enabled={allowPullToRefresh} onRefresh={handleRefresh} />
      {/* The presenter: while any bottom sheet is up the whole page zooms
          back and dims, the way iOS shrinks the screen a card is presented
          over, and comes forward again as the sheet goes down. Sheets
          themselves ride the top layer (useBottomSheet), so they don't
          shrink with it. Clipped with clip-path rather than overflow:
          hidden, which would turn this into a scroll container and break
          every sticky header inside. */}
      <motion.div
        animate={sheetUp
          ? { scale: 0.92, y: safeTop + 8, filter: 'brightness(0.78)', clipPath: 'inset(0 round 26px)' }
          : { scale: 1, y: 0, filter: 'brightness(1)', clipPath: 'inset(0 round 0px)', transitionEnd: { filter: 'none', clipPath: 'none' } }}
        transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
        style={{ transformOrigin: '50% 0%' }}
      >
      <SwipeBackContainer
        enabled={allowSwipeBack}
        navKey={historyIdx ?? 0}
        locationKey={location.key}
        snapshotable={!isMapPage && !isReelsPage && !isFocusedReel && location.pathname !== '/search'}
        revealSnapshotKey={backTarget?.kind === 'pop' ? (historyIdx ?? 0) - 1 : null}
        backIsPop={backTarget?.kind === 'pop'}
        onBack={() => {
          if (!backTarget) return;
          if (backTarget.kind === 'pop') navigate(-1);
          // Logical-parent "up" navigation REPLACES the current entry (iOS
          // semantics): a plain push meant swiping back from a deep-linked
          // /pantry?list=x pushed /pantry, so hardware back went "forward"
          // into the sub-view just dismissed, and repeated up-navigations
          // stacked junk history entries (polluting nav-stack's index map
          // and snapshot keying too). nav-stack records REPLACE in place.
          else navigate(backTarget.to, { replace: true });
        }}
        onLockTransition={setInstantNav}
      >
        {routesBlock}
      </SwipeBackContainer>
      </motion.div>
      <AnimatePresence>
        {showBottomNav && (
          <motion.div
            // Identifies the nav for the swipe-back snapshot: the destination
            // preview includes a copy of it when the source page hides the
            // real one, so the tab bar rides in with the page during a
            // back-swipe like on iOS.
            data-bottom-nav=""
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            // A gesture-driven swap must not replay the spring entrance — the
            // nav is already in the destination preview and simply becomes
            // real underneath it. The spring stays for tapped navigation.
            transition={instantNav ? { duration: 0 } : { type: 'spring', damping: 20, stiffness: 100 }}
          >
            <BottomNav />
          </motion.div>
        )}
      </AnimatePresence>
      {modals}
      {/* Post-onboarding coachmark tour. Phone layout only: its stops point
          at phone chrome, and the sidebar layout labels every destination
          anyway. Arming on desktop keeps the flag for a later phone launch. */}
      <FeatureTour />
    </div>
  );
};

export default function App() {
  return (
    <AppErrorBoundary>
    <Router>
      <AuthProvider>
        <SettingsProvider>
          <ToastProvider>
            {/* SignInModalProvider sits above the action contexts (Lists/
                Reels/Posts/GuideCreator) so their openers can call
                requireSignIn for guests, and below Auth/Settings/Toast so
                the overlay's <Auth> screen has what it needs. */}
            <SignInModalProvider>
            {/* Plan + paywall sit just inside the sign-in gate and above the
                action contexts, so any of them can ask requirePro() the way
                they ask requireSignIn(). */}
            <PlanProvider>
            <PaywallProvider>
            <ListsProvider>
              <SharedListsProvider>
              <RecipesProvider>
                <ChatProvider>
                  <NotificationsProvider>
                    <ReelsProvider>
                      <PostsProvider>
                        <PageAddActionProvider>
                          <CirclePanelProvider>
                            <GuideCreatorProvider>
                              <HomeLocationProvider>
                                <AssistantProvider>
                                  <AiChatHistoryProvider>
                                    <AppContent />
                                  </AiChatHistoryProvider>
                                </AssistantProvider>
                              </HomeLocationProvider>
                            </GuideCreatorProvider>
                          </CirclePanelProvider>
                        </PageAddActionProvider>
                      </PostsProvider>
                    </ReelsProvider>
                  </NotificationsProvider>
                </ChatProvider>
              </RecipesProvider>
              </SharedListsProvider>
            </ListsProvider>
            </PaywallProvider>
            </PlanProvider>
            </SignInModalProvider>
          </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </Router>
    </AppErrorBoundary>
  );
}
