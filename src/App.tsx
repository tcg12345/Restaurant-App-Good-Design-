/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation, Navigate } from 'react-router-dom';
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
import { Sidebar } from './components/Sidebar';
import { DesktopHeader } from './components/DesktopHeader';
import { AnimatePresence, motion } from 'motion/react';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ListsProvider } from './contexts/ListsContext';
import { ToastProvider } from './contexts/ToastContext';
import { RecipesProvider } from './contexts/RecipesContext';
import { RatingModal } from './components/RatingModal';
import { AddToListModal } from './components/AddToListModal';
import { AddRestaurantModal } from './components/AddRestaurantModal';
import { AddRecipeModal } from './components/AddRecipeModal';
import { AddHomeMealModal } from './components/AddHomeMealModal';
import { AddReelModal } from './components/AddReelModal';
import { AddPostModal } from './components/AddPostModal';
import { RecipeModal } from './components/RecipeModal';
import { RecipeDetail } from './pages/RecipeDetail';
import { RecipesForYou } from './pages/RecipesForYou';
import { GuideDetail } from './pages/GuideDetail';
import { GuideEdit } from './pages/GuideEdit';
import { SignIn } from './pages/SignIn';
import { Auth } from './pages/Auth';
import { ImportRestaurants } from './pages/ImportRestaurants';
import { ProfileSetup } from './pages/ProfileSetup';
import { UserProfile } from './pages/UserProfile';
import { Messages } from './pages/Messages';
import { FriendReviewDetail } from './pages/FriendReviewDetail';
import { LocationPage } from './pages/LocationPage';
import { LocationMap } from './pages/LocationMap';
import { RestaurantCircleReviews } from './pages/RestaurantCircleReviews';
import { MealRecipePage } from './pages/MealRecipePage';
import { ReorderRatings } from './pages/ReorderRatings';
import { ChatProvider } from './contexts/ChatContext';
import { ReelsProvider } from './contexts/ReelsContext';
import { PostsProvider } from './contexts/PostsContext';
import { PageSearchProvider } from './contexts/PageSearchContext';
import { PageAddActionProvider } from './contexts/PageAddActionContext';
import { CirclePanelProvider, useCirclePanel } from './contexts/CirclePanelContext';
import { GuideCreatorProvider, useGuideCreator } from './contexts/GuideCreatorContext';
import { GuideCreatorSheet } from './components/GuideCreatorSheet';
import { CirclePanel } from './components/CirclePanel';

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

const AppContent: React.FC = () => {
  const location = useLocation();
  const isMapPage = location.pathname === '/map';
  const isReelsPage = location.pathname === '/reels';
  const isFocusedReel = location.pathname.startsWith('/r/');
  const showBottomNav = !['/onboarding', '/messages', '/reorder', '/location', '/location/map', '/create'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/') && !location.pathname.startsWith('/user/') && !location.pathname.startsWith('/recipe/') && !location.pathname.startsWith('/review/') && !location.pathname.startsWith('/activity') && !location.pathname.startsWith('/guides/') && !isFocusedReel;
  const { phoneMode, isNative } = useSettings();
  const { isSignedIn, loading, profileComplete } = useAuth();
  const isDesktop = useIsDesktop();
  // `phoneMode` does two jobs: gate the mobile UI everywhere, and (only
  // here in App.tsx) render the desktop "phone preview" frame around
  // the app. On Capacitor / real mobile we want the first job but not
  // the second — the OS already gives us a phone-shaped viewport.
  const showPhoneFrame = phoneMode && !isNative;
  // Sidebar mode: real desktop viewport AND not in the phone-frame preview.
  // The Onboarding flow is intentionally pre-auth-only so this gate isn't
  // needed for it; we just keep the sidebar off the few pages where it
  // would clash (none today, but the variable exists so we can tune).
  const useSidebar = isDesktop && !phoneMode && isSignedIn && profileComplete;

  if (loading) {
    return (
      <div className={showPhoneFrame ? "min-h-screen bg-black flex items-center justify-center" : "min-h-screen bg-surface flex items-center justify-center"}>
        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-2xl animate-pulse">
          G
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className={showPhoneFrame ? "min-h-screen bg-black flex items-center justify-center" : ""}>
        <div
          className={
            showPhoneFrame
              ? "relative bg-surface selection:bg-primary/20 selection:text-primary overflow-hidden rounded-3xl shadow-2xl border border-white/10"
              : "min-h-screen bg-surface selection:bg-primary/20 selection:text-primary"
          }
          style={
            showPhoneFrame
              ? { width: 'min(100vw, calc(100vh * 9 / 19.5))', height: '100vh', maxHeight: '100vh', transform: 'translateZ(0)' }
              : undefined
          }
        >
          <div className={showPhoneFrame ? "h-full overflow-y-auto overflow-x-hidden" : ""}>
            <Routes location={location}>
              <Route path="/auth" element={<Auth />} />
              <Route path="/import" element={<ImportRestaurants />} />
              <Route path="*" element={<SignIn />} />
            </Routes>
          </div>
        </div>
      </div>
    );
  }

  if (isSignedIn && !profileComplete) {
    return (
      <div className={showPhoneFrame ? "min-h-screen bg-black flex items-center justify-center" : ""}>
        <div
          className={showPhoneFrame ? "relative bg-surface overflow-hidden rounded-3xl shadow-2xl border border-white/10" : "min-h-screen bg-surface"}
          style={showPhoneFrame ? { width: 'min(100vw, calc(100vh * 9 / 19.5))', height: '100vh', maxHeight: '100vh', transform: 'translateZ(0)' } : undefined}
        >
          <div className={showPhoneFrame ? "h-full overflow-y-auto overflow-x-hidden" : ""}>
            <ProfileSetup />
          </div>
        </div>
      </div>
    );
  }

  // ── Routes block, shared between sidebar and phone/narrow layouts ──
  // The Create page slides in horizontally from the left and overlays
  // the route underneath, so the swipe-from-edge gesture on Discover
  // feels native rather than waiting for a fade-out first. Other routes
  // keep the existing fade + small vertical lift in `mode="wait"`.
  const isCreateRoute = location.pathname === '/create';
  const motionInitial = isCreateRoute ? { x: '-100%', opacity: 1 } : { opacity: 0, y: 6 };
  const motionAnimate = isCreateRoute ? { x: 0, opacity: 1 } : { opacity: 1, y: 0 };
  const motionExit = isCreateRoute ? { x: '-100%', opacity: 1 } : { opacity: 0, y: -4 };
  const motionTransition = isCreateRoute
    ? { duration: 0.26, ease: [0.22, 1, 0.36, 1] as const }
    : { duration: 0.18, ease: 'easeOut' as const };

  const routesBlock = (
    <AnimatePresence mode={isCreateRoute ? 'sync' : 'wait'} initial={false}>
      <motion.div
        key={location.pathname}
        initial={motionInitial}
        animate={motionAnimate}
        exit={motionExit}
        transition={motionTransition}
        // While /create is the current path its motion.div overlays the
        // page underneath; for every other route the wrapper is a normal
        // in-flow block so layout doesn't shift.
        className={isCreateRoute ? 'absolute inset-0 z-30' : undefined}
      >
        <Routes location={location}>
          <Route path="/" element={<Discover mode="home" />} />
          <Route path="/map" element={<Discover mode="map" />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="/circle" element={<Circle />} />
          <Route path="/create" element={<Create />} />
          <Route path="/search" element={<Search />} />
          <Route path="/search/main" element={<SearchMain />} />
          <Route path="/reels" element={<Reels />} />
          {/* Focused single-item viewer — same Reels component, but
              centered on a specific reel/post key (e.g. reel-<id> or
              post-<id>). Bottom nav is hidden and a back arrow is
              shown so it reads as a "look at this one" surface. */}
          <Route path="/r/:focusKey" element={<Reels />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/activity/saved" element={<Activity />} />
          <Route path="/activity/likes" element={<Activity />} />
          <Route path="/activity/comments" element={<Activity />} />
          <Route path="/experts" element={<Experts />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/restaurant/:id" element={<RestaurantDetail />} />
          <Route path="/restaurant/:id/circle" element={<RestaurantCircleReviews />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/import" element={<ImportRestaurants />} />
          <Route path="/reorder" element={<ReorderRatings />} />
          <Route path="/recipes-for-you" element={<RecipesForYou />} />
          <Route path="/recipe/:id" element={<RecipeDetail />} />
          <Route path="/guides/:id" element={<GuideDetail />} />
          <Route path="/guides/:id/edit" element={<GuideEdit />} />
          <Route path="/meal/:userId/:mealId" element={<MealRecipePage />} />
          <Route path="/user/:username" element={<UserProfile />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/review/:ratingId" element={<FriendReviewDetail />} />
          <Route path="/location" element={<LocationPage />} />
          <Route path="/location/map" element={<LocationMap />} />
        </Routes>
      </motion.div>
    </AnimatePresence>
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

  // ── Phone-frame preview / narrow viewport layout (existing) ──────────
  return (
    <div className={showPhoneFrame ? "min-h-screen bg-black flex items-center justify-center" : ""}>
      <div
        className={
          showPhoneFrame
            ? "relative bg-surface selection:bg-primary/20 selection:text-primary overflow-hidden rounded-3xl shadow-2xl border border-white/10"
            : "min-h-screen bg-surface selection:bg-primary/20 selection:text-primary"
        }
        style={
          showPhoneFrame
            ? { width: 'min(100vw, calc(100vh * 9 / 19.5))', height: '100vh', maxHeight: '100vh', transform: 'translateZ(0)' }
            : undefined
        }
      >
        <div className={showPhoneFrame ? "relative h-full overflow-y-auto overflow-x-hidden" : "relative"}>
          {routesBlock}
        </div>
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
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <SettingsProvider>
          <ToastProvider>
            <ListsProvider>
              <RecipesProvider>
                <ChatProvider>
                  <ReelsProvider>
                    <PostsProvider>
                      <PageSearchProvider>
                        <PageAddActionProvider>
                          <CirclePanelProvider>
                            <GuideCreatorProvider>
                              <AppContent />
                            </GuideCreatorProvider>
                          </CirclePanelProvider>
                        </PageAddActionProvider>
                      </PageSearchProvider>
                    </PostsProvider>
                  </ReelsProvider>
                </ChatProvider>
              </RecipesProvider>
            </ListsProvider>
          </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </Router>
  );
}
