/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Home } from './pages/Home';
import { Map } from './pages/Map';
import { Experts } from './pages/Experts';
import { Profile } from './pages/Profile';
import { Pantry } from './pages/Pantry';
import { Circle } from './pages/Circle';
import { RestaurantDetail } from './pages/RestaurantDetail';
import { Onboarding } from './pages/Onboarding';
import { BottomNav } from './components/BottomNav';
import { AnimatePresence, motion } from 'motion/react';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ListsProvider } from './contexts/ListsContext';
import { RecipesProvider } from './contexts/RecipesContext';
import { RatingModal } from './components/RatingModal';
import { AddToListModal } from './components/AddToListModal';
import { AddRestaurantModal } from './components/AddRestaurantModal';
import { WishlistModal } from './components/WishlistModal';
import { AddHomeMealModal } from './components/AddHomeMealModal';
import { SignIn } from './pages/SignIn';
import { Auth } from './pages/Auth';
import { ImportRestaurants } from './pages/ImportRestaurants';
import { ProfileSetup } from './pages/ProfileSetup';
import { UserProfile } from './pages/UserProfile';

const AppContent: React.FC = () => {
  const location = useLocation();
  const isMapPage = location.pathname === '/';
  const showBottomNav = !['/onboarding'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/') && !location.pathname.startsWith('/user/');
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
          <AnimatePresence mode="wait">
            <Routes location={location}>
              <Route path="/" element={<Map />} />
              <Route path="/search" element={<Home />} />
              <Route path="/circle" element={<Circle />} />
              <Route path="/experts" element={<Experts />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/pantry" element={<Pantry />} />
              <Route path="/restaurant/:id" element={<RestaurantDetail />} />
              <Route path="/onboarding" element={<Onboarding />} />
              <Route path="/import" element={<ImportRestaurants />} />
              <Route path="/user/:username" element={<UserProfile />} />
            </Routes>
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
        <WishlistModal />
        <AddHomeMealModal />
      </div>
    </div>
  );
};

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <SettingsProvider>
          <ListsProvider>
            <RecipesProvider>
              <AppContent />
            </RecipesProvider>
          </ListsProvider>
        </SettingsProvider>
      </AuthProvider>
    </Router>
  );
}
