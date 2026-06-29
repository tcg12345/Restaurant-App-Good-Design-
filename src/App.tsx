/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom';
import { Discover } from './pages/Discover';
import { Experts } from './pages/Experts';
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
import { Sidebar } from './components/Sidebar';
import { DesktopHeader } from './components/DesktopHeader';
import { AnimatePresence, motion } from 'motion/react';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ListsProvider } from './contexts/ListsContext';
import { ToastProvider } from './contexts/ToastContext';
import { RecipesProvider } from './contexts/RecipesContext';
import { configureNativeKeyboard } from './lib/native-keyboard';
import { RatingModal } from './components/RatingModal';
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
import { PageSearchProvider } from './contexts/PageSearchContext';
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
  const { isOpen, initialGuide, closeGuideCreator } = useGuideCreator();
  return <GuideCreatorSheet open={isOpen} onClose={closeGuideCreator} initialGuide={initialGuide} />;
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
const keepAliveElement = (path: string): React.ReactNode => {
  switch (path) {
    case '/': return <Discover mode="home" />;
    case '/search/main': return <SearchMain />;
    case '/pantry': return <RequireAuthRoute reason="Sign in to open your lists"><Pantry /></RequireAuthRoute>;
    case '/profile': return <RequireAuthRoute reason="Sign in to view your profile"><Profile /></RequireAuthRoute>;
    default: return null;
  }
};

const AppContent: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  // Set true by the swipe-back gesture so a single route change swaps with no
  // AnimatePresence transition — the gesture drives the slide itself.
  const [instantNav, setInstantNav] = React.useState(false);
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
  const { isSignedIn, isGuest, continueAsGuest, loading, profileComplete } = useAuth();
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
  if (!isSignedIn && !isGuest) {
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
  const motionExit = isCreateRoute ? { x: '-100%', opacity: 1 } : { x: '100%' };
  const motionTransition = instantNav
    ? { duration: 0 }
    : isCreateRoute
      ? { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }
      : { duration: 0.3, ease: [0.32, 0.72, 0, 1] as const };

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
              // Inactive tabs are hidden with `visibility` (not display:none)
              // and positioned absolutely — display:none would reset inner
              // scroll positions, defeating the point of keep-alive.
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 10,
                visibility: active ? 'visible' : 'hidden',
                pointerEvents: active ? undefined : 'none',
              }}
              aria-hidden={!active}
            >
              {keepAliveElement(path)}
            </div>
          );
        })}
      </React.Fragment>

      {/* Stack — every non-keep-alive route (details, map, reels, create…).
          Absolutely positioned so it overlays the tab layer; on exit it
          animates away to reveal the kept-alive tab underneath. */}
      <AnimatePresence mode={isCreateRoute ? 'sync' : 'wait'} initial={false}>
        {!isKeepAlivePath && (
        <motion.div
          key={location.pathname}
          initial={motionInitial}
          animate={motionAnimate}
          exit={motionExit}
          transition={motionTransition}
          className={isCreateRoute ? 'absolute inset-0 z-30' : 'absolute inset-0 z-20 bg-surface'}
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
  // Wide viewports (>= lg) render a sticky left sidebar + a sticky page
  // header instead of the floating BottomNav. The header is hidden on
  // the map page (and on /messages, which has its own chrome) so its
  // chrome doesn't fight the rendered content.
  if (useSidebar) {
    const hideHeader = isMapPage || isReelsPage || isFocusedReel || location.pathname.startsWith('/messages');
    return (
      <div className="min-h-screen bg-surface text-on-surface selection:bg-primary/20 selection:text-primary flex">
        <ScrollRestoration />
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-screen flex flex-col">
          {!hideHeader && <DesktopHeader />}
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
  // Edge swipe-back is allowed wherever there's in-app history to pop, except
  // on routes that own horizontal/vertical gestures or have no "back".
  const historyIdx = typeof window.history.state?.idx === 'number' ? window.history.state.idx : null;
  const canGoBack = historyIdx !== null ? historyIdx > 0 : window.history.length > 1;
  // Bottom-nav tab roots are NOT swipeable: you should never swipe between
  // tabs, and on a tab root a route-back just crosses into whatever tab is
  // behind it in history (e.g. swiping on Pantry would jump to Reels). Tabs
  // are switched via the nav bar; their own in-page back closes sub-views.
  const isTabRoot = KEEP_ALIVE_PATHS.includes(location.pathname) || location.pathname === '/search';
  const allowSwipeBack =
    canGoBack && !isReelsPage && !isFocusedReel && !isMapPage && !isTabRoot &&
    !['/create', '/onboarding', '/location/map'].includes(location.pathname);
  return (
    <div className="min-h-screen bg-surface selection:bg-primary/20 selection:text-primary">
      <ScrollRestoration />
      <PullToRefresh enabled={allowPullToRefresh} onRefresh={handleRefresh} />
      <SwipeBackContainer
        enabled={allowSwipeBack}
        navKey={historyIdx ?? 0}
        snapshotable={!isMapPage && !isReelsPage && !isFocusedReel}
        onBack={() => navigate(-1)}
        onLockTransition={setInstantNav}
      >
        {routesBlock}
      </SwipeBackContainer>
      <AnimatePresence>
        {showBottomNav && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            transition={{ type: 'spring', damping: 20, stiffness: 100 }}
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
                      <PageSearchProvider>
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
                      </PageSearchProvider>
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
