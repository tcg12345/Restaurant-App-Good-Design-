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

const AppContent: React.FC = () => {
  const location = useLocation();
  const showBottomNav = !['/map', '/onboarding'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/');

  return (
    <div className="min-h-screen bg-surface selection:bg-primary/20 selection:text-primary">
      <AnimatePresence mode="wait">
        <Routes location={location}>
          <Route path="/" element={<Home />} />
          <Route path="/map" element={<Map />} />
          <Route path="/circle" element={<Circle />} />
          <Route path="/experts" element={<Experts />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/pantry" element={<Pantry />} />
          <Route path="/restaurant/:id" element={<RestaurantDetail />} />
          <Route path="/onboarding" element={<Onboarding />} />
        </Routes>
      </AnimatePresence>
      <AppBottomNav show={showBottomNav} />
    </div>
  );
};

const AppBottomNav: React.FC<{ show: boolean }> = ({ show }) => {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: 'spring', damping: 20, stiffness: 100 }}
        >
          <BottomNav />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}

