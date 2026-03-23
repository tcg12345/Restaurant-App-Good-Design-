/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  const isMapPage = location.pathname === '/map';
  const showBottomNav = !['/onboarding'].includes(location.pathname) && !location.pathname.startsWith('/restaurant/');

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
      <AppBottomNav show={showBottomNav} autoHide={isMapPage} />
    </div>
  );
};

const AppBottomNav: React.FC<{ show: boolean; autoHide?: boolean }> = ({ show, autoHide = false }) => {
  const [hidden, setHidden] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastY = useRef(0);

  const resetTimer = useCallback(() => {
    setHidden(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setHidden(true), 3000);
  }, []);

  useEffect(() => {
    if (!autoHide) {
      setHidden(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      return;
    }

    // Show initially, then start auto-hide timer
    resetTimer();

    const handleTouchStart = () => resetTimer();

    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0].clientY;
      if (Math.abs(currentY - lastY.current) > 5) {
        setHidden(true);
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
      }
      lastY.current = currentY;
    };

    const handleTouchEnd = () => resetTimer();
    const handleMouseMove = () => resetTimer();

    window.addEventListener('touchstart', handleTouchStart);
    window.addEventListener('touchmove', handleTouchMove);
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [autoHide, resetTimer]);

  const isVisible = show && !hidden;

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: isVisible ? 0 : 100, opacity: isVisible ? 1 : 0 }}
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

