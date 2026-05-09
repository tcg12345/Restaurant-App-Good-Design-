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
import { RestaurantDetail } from './pages/RestaurantDetail';
import { Onboarding } from './pages/Onboarding';
import { BottomNav } from './components/BottomNav';
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

const AppContent: React.FC = () => {
  const location = useLocation();
  const isMapPage = location.pathname === '/map';
  const showBottomNav = !['/onboarding', '/messages', '/reorder', '/location', '/location/map'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/') && !location.pathname.startsWith('/user/') && !location.pathname.startsWith('/recipe/') && !location.pathname.startsWith('/review/');
  const { phoneMode } = useSettings();
  const { isSignedIn, loading, profileComplete } = useAuth();

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
          {/*
            Route-level fade+slide transition. AnimatePresence with mode="wait"
            so the outgoing page finishes its exit before the incoming one
            mounts — keeps scroll reset clean. Transition intentionally brief
            (~180ms) so navigation still feels instant.
          */}
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
        <RatingModal />
        <AddToListModal />
        <AddRestaurantModal />
        <AddRecipeModal />
        <AddHomeMealModal />
        <RecipeModal />
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
                  <AppContent />
                </ChatProvider>
              </RecipesProvider>
            </ListsProvider>
          </ToastProvider>
        </SettingsProvider>
      </AuthProvider>
    </Router>
  );
}
