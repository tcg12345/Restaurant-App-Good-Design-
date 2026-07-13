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
import { Pantry } from './pages/Pantry';
import { Circle } from './pages/Circle';
import { Search } from './pages/Search';
import { SearchMain } from './pages/SearchMain';
import { Reels } from './pages/Reels';
import { Activity } from './pages/Activity';
import { RestaurantDetail } from './pages/RestaurantDetail';
import { Onboarding } from './pages/Onboarding';
import { Create } from './pages/Create';
import { BottomNav } from './components/BottomNav';
import { PullToRefresh } from './components/PullToRefresh';
import { SwipeBackContainer } from './components/SwipeBackContainer';
import { ScrollRestoration } from './components/ScrollRestoration';
import { KEEP_ALIVE_PATHS } from './lib/keep-alive';
import { recordNavEntry, backTargetFor, isTabRootLocation } from './lib/nav-stack';
import { Sidebar } from './components/Sidebar';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ListsProvider } from './contexts/ListsContext';
import { ToastProvider } from './contexts/ToastContext';
import { RecipesProvider } from './contexts/RecipesContext';
import { configureNativeKeyboard } from './lib/native-keyboard';
import { RatingModal } from './components/RatingModal';
import { VerificationOutcomeModal } from './components/VerificationOutcomeModal';
import { AddToListModal } from './components/AddToListModal';
import { AddRestaurantModal } from './components/AddRestaurantModal';
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
import { ImportRestaurants } from './pages/ImportRestaurants';
import { ProfileSetup } from './pages/ProfileSetup';
import { UserProfile } from './pages/UserProfile';
import { Messages } from './pages/Messages';
import { FriendReviewDetail } from './pages/FriendReviewDetail';
import { LocationPage } from './pages/LocationPage';
import { LocationMap } from './pages/LocationMap';
import { RestaurantCircleReviews } from './pages/RestaurantCircleReviews';
import { ReorderRatings } from './pages/ReorderRatings';
import { ChatProvider } from './contexts/ChatContext';
import { ReelsProvider } from './contexts/ReelsContext';
import { PostsProvider } from './contexts/PostsContext';
import { PageAddActionProvider } from './contexts/PageAddActionContext';
import { CirclePanelProvider, useCirclePanel } from './contexts/CirclePanelContext';
import { GuideCreatorProvider, useGuideCreator } from './contexts/GuideCreatorContext';
import { HomeLocationProvider } from './contexts/HomeLocationContext';
import { AssistantProvider } from './contexts/AssistantContext';
import { AiChatHistoryProvider } from './contexts/AiChatHistoryContext';
import { GuideCreatorSheet } from './components/GuideCreatorSheet';
import { CirclePanel } from './components/CirclePanel';
import { AppAssistant } from './components/AppAssistant';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { SignInModalProvider } from './contexts/SignInModalContext';
import { RequireAuthRoute } from './components/RequireAuthRoute';

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
  const { phoneMode, setKeyboardOpen } = useSettings();
  React.useEffect(() => {
    let handle: { destroy(): void } | null = null;
    void configureNativeKeyboard({
      onKeyboardChange: (open) => setKeyboardOpen(open),
    }).then((h) => { handle = h; });
    return () => { handle?.destroy(); };
  }, [setKeyboardOpen]);
  const isMapPage = location.pathname === '/map';
  const isReelsPage = location.pathname === '/reels';
  const isFocusedReel = location.pathname.startsWith('/r/');
  const showBottomNav = !['/onboarding', '/messages', '/reorder', '/location', '/location/map', '/map', '/create', '/recipes-for-you'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/') && !location.pathname.startsWith('/user/') && !location.pathname.startsWith('/recipe/') && !location.pathname.startsWith('/meal/') && !location.pathname.startsWith('/review/') && !location.pathname.startsWith('/activity') && !location.pathname.startsWith('/guides/') && !isFocusedReel;
  const { isSignedIn, isGuest, continueAsGuest, loading, profileComplete, needsPasswordSetup } = useAuth();
  const isDesktop = useIsDesktop();
  // Sidebar mode: real desktop viewport. Guests get the sidebar too so they
  // can navigate the app (it renders a "Sign in" affordance instead of a
  // profile). `phoneMode` is viewport/runtime-derived (<1024px or native) — the
  // exact inverse of `isDesktop` (≥1024px), so every viewport is either phone
  // or desktop-sidebar with no intermediate "tablet" layout in between.
  const useSidebar = isDesktop && !phoneMode;

  // Pull-to-refresh (phone): bump a nonce keyed onto <Routes> so the current
  // route remounts and its mount-time data loads re-run, and broadcast
  // `app:refresh` for any context that wants to refetch in place — a soft
  // refresh with no full page reload / loading flash.
  const [refreshNonce, setRefreshNonce] = React.useState(0);
  const handleRefresh = React.useCallback(async () => {
    window.scrollTo({ top: 0 });
    setRefreshNonce((n) => n + 1);
    window.dispatchEvent(new CustomEvent('app:refresh'));
    // Hold briefly so the remount's fetches start under the spinner.
    await new Promise((resolve) => setTimeout(resolve, 750));
  }, []);

  // Keep-alive: once a tab-root page is visited it stays mounted. Mounted
  // lazily (on first visit) so we don't eagerly mount every tab at startup.
  const [keptAlive, setKeptAlive] = React.useState<string[]>([]);
  React.useEffect(() => {
    if (KEEP_ALIVE_PATHS.includes(location.pathname)) {
      setKeptAlive((k) => (k.includes(location.pathname) ? k : [...k, location.pathname]));
    }
  }, [location.pathname]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center">
        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-2xl animate-pulse">
          G
        </div>
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
  if ((!isSignedIn && !isGuest) || (isSignedIn && needsPasswordSetup)) {
    return (
      <div className="min-h-screen bg-surface selection:bg-primary/20 selection:text-primary">
        <Routes location={location}>
          <Route path="/import" element={<ImportRestaurants />} />
          <Route path="*" element={<Auth onBrowseAsGuest={continueAsGuest} />} />
        </Routes>
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
  // Detail pages slide horizontally (iOS push/pop) rather than fading. Fading
  // an opaque page out over the kept tab caused a white wash; sliding it off
  // also covers the tab during its first repaint, so there's no flash.
  const motionInitial = isCreateRoute ? { x: '-100%', opacity: 1 } : { x: '100%' };
  const motionAnimate = isCreateRoute ? { x: 0, opacity: 1 } : { x: 0 };
  // Non-create pages live in normal flow (so the document is as tall as the
  // page and sticky chrome works) and only become absolute for the exit
  // slide, where they must overlay what's revealed underneath. Motion applies
  // the non-animatable position/inset values instantly at exit start — the
  // geometry is identical to the in-flow box, so there's no jump.
  const motionExit = isCreateRoute
    ? { x: '-100%', opacity: 1 }
    : { x: '100%', position: 'absolute' as const, top: 0, left: 0, right: 0 };
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
  // The instant flag travels via AnimatePresence `custom`, not props: an
  // exiting page keeps its STALE variants (that's what preserves /create's
  // leftward exit direction after leaving it), but framer refreshes `custom`
  // on exiting clones — so the new navigation's instant-ness reaches the old
  // page's exit transition while its direction stays source-correct.
  const stackVariants: Variants = {
    enter: (instant: boolean) => (instant ? { x: 0 } : motionInitial),
    center: (instant: boolean) => ({
      ...motionAnimate,
      transition: instant ? { duration: 0 } : motionTransition,
    }),
    exit: (instant: boolean) => ({
      ...motionExit,
      transition: instant ? { duration: 0 } : motionTransition,
    }),
  };

  const isKeepAlivePath = KEEP_ALIVE_PATHS.includes(location.pathname);
  const routesBlock = (
    <>
      {/* Persistent keep-alive tab pages — visible when active, kept mounted
          (hidden) otherwise so returning to them preserves scroll + state.
          Keyed by refreshNonce so a pull-to-refresh still reloads them. */}
      <React.Fragment key={refreshNonce}>
        {keptAlive.map((path) => {
          const active = path === location.pathname;
          return (
            <div
              key={path}
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
          animates away to reveal the kept-alive tab underneath. */}
      <AnimatePresence mode={isCreateRoute ? 'sync' : 'wait'} initial={false} custom={stackInstant}>
        {!isKeepAlivePath && (
        <motion.div
          key={location.pathname}
          // Lets the swipe-back gesture verify the destination (this exact
          // pathname) is mounted and at rest before it drops the covering
          // snapshot — the exiting page's wrapper must not pass for it.
          data-route-stack={location.pathname}
          variants={stackVariants}
          custom={stackInstant}
          initial="enter"
          animate="center"
          exit="exit"
          className={isCreateRoute ? 'absolute inset-0 z-30' : 'relative bg-surface'}
        >
        <React.Fragment key={refreshNonce}>
        <Routes location={location}>
          <Route path="/" element={<Discover mode="home" />} />
          <Route path="/map" element={<Discover mode="map" />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
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
          <Route path="/profile" element={<RequireAuthRoute reason="Sign in to view your profile"><Profile /></RequireAuthRoute>} />
          <Route path="/pantry" element={<RequireAuthRoute reason="Sign in to open your lists"><Pantry /></RequireAuthRoute>} />
          <Route path="/restaurant/:id" element={<RestaurantDetail />} />
          <Route path="/restaurant/:id/circle" element={<RestaurantCircleReviews />} />
          <Route path="/onboarding" element={<Onboarding />} />
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
      <RatingModal />
      <VerificationOutcomeModal />
      <AddToListModal />
      <AddRestaurantModal />
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
    !['/messages', '/create', '/onboarding', '/location/map'].includes(location.pathname);
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
    backTarget !== null && !isReelsPage && !isFocusedReel && !isMapPage && !isTabRoot &&
    !['/create', '/onboarding', '/location/map'].includes(location.pathname);
  return (
    <div className="min-h-screen bg-surface selection:bg-primary/20 selection:text-primary">
      <ScrollRestoration />
      <PullToRefresh enabled={allowPullToRefresh} onRefresh={handleRefresh} />
      <SwipeBackContainer
        enabled={allowSwipeBack}
        navKey={historyIdx ?? 0}
        locationKey={location.key}
        snapshotable={!isMapPage && !isReelsPage && !isFocusedReel}
        revealSnapshotKey={backTarget?.kind === 'pop' ? (historyIdx ?? 0) - 1 : null}
        backIsPop={backTarget?.kind === 'pop'}
        onBack={() => {
          if (!backTarget) return;
          if (backTarget.kind === 'pop') navigate(-1);
          else navigate(backTarget.to);
        }}
        onLockTransition={setInstantNav}
      >
        {routesBlock}
      </SwipeBackContainer>
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
            <BottomNav collapsible={isMapPage} />
          </motion.div>
        )}
      </AnimatePresence>
      {modals}
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
            <ListsProvider>
              <RecipesProvider>
                <ChatProvider>
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
                </ChatProvider>
              </RecipesProvider>
            </ListsProvider>
            </SignInModalProvider>
          </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </Router>
    </AppErrorBoundary>
  );
}
