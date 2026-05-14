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
  const showBottomNav = !['/onboarding', '/messages', '/reorder', '/location', '/location/map'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/') && !location.pathname.startsWith('/user/') && !location.pathname.startsWith('/recipe/') && !location.pathname.startsWith('/review/') && !location.pathname.startsWith('/activity') && !isFocusedReel;
  const { phoneMode } = useSettings();
  const { isSignedIn, loading, profileComplete } = useAuth();
  const isDesktop = useIsDesktop();
  // Sidebar mode: real desktop viewport AND not in the phone-frame preview.
  // The Onboarding flow is intentionally pre-auth-only so this gate isn't
  // needed for it; we just keep the sidebar off the few pages where it
  // would clash (none today, but the variable exists so we can tune).
  const useSidebar = isDesktop && !phoneMode && isSignedIn && profileComplete;

  if (loading) {
    return (
      <div className={phoneMode ? "min-h-screen bg-black flex items-center justify-center" : "min-h-screen bg-surface flex items-center justify-center"}>
        <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-2xl animate-pulse">
          G
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className={phoneMode ? "min-h-screen bg-black flex items-center justify-center" : ""}>
        <div
          className={
            phoneMode
              ? "relative bg-surface selection:bg-primary/20 selection:text-primary overflow-hidden rounded-3xl shadow-2xl border border-white/10"
              : "min-h-screen bg-surface selection:bg-primary/20 selection:text-primary"
          }
          style={
            phoneMode
              ? { width: 'min(100vw, calc(100vh * 9 / 19.5))', height: '100vh', maxHeight: '100vh', transform: 'translateZ(0)' }
              : undefined
          }
        >
          <div className={phoneMode ? "h-full overflow-y-auto overflow-x-hidden" : ""}>
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
      <div className={phoneMode ? "min-h-screen bg-black flex items-center justify-center" : ""}>
        <div
          className={phoneMode ? "relative bg-surface overflow-hidden rounded-3xl shadow-2xl border border-white/10" : "min-h-screen bg-surface"}
          style={phoneMode ? { width: 'min(100vw, calc(100vh * 9 / 19.5))', height: '100vh', maxHeight: '100vh', transform: 'translateZ(0)' } : undefined}
        >
          <div className={phoneMode ? "h-full overflow-y-auto overflow-x-hidden" : ""}>
            <ProfileSetup />
          </div>
        </div>
      </div>
    );
  }

  // ── Routes block, shared between sidebar and phone/narrow layouts ──
  const routesBlock = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <Routes location={location}>
          <Route path="/" element={<Discover mode="home" />} />
          <Route path="/map" element={<Discover mode="map" />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="/circle" element={<Circle />} />
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
          <div className="flex-1 min-w-0">
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
    <div className={phoneMode ? "min-h-screen bg-black flex items-center justify-center" : ""}>
      <div
        className={
          phoneMode
            ? "relative bg-surface selection:bg-primary/20 selection:text-primary overflow-hidden rounded-3xl shadow-2xl border border-white/10"
            : "min-h-screen bg-surface selection:bg-primary/20 selection:text-primary"
        }
        style={
          phoneMode
            ? { width: 'min(100vw, calc(100vh * 9 / 19.5))', height: '100vh', maxHeight: '100vh', transform: 'translateZ(0)' }
            : undefined
        }
      >
        <div className={phoneMode ? "h-full overflow-y-auto overflow-x-hidden" : ""}>
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
                            <AppContent />
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
