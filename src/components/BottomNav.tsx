import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, Home, Users, User, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';

const navItems = [
  { icon: Home, label: 'Home', path: '/map' },
  { icon: Search, label: 'Search', path: '/' },
  { icon: Heart, label: 'Pantry', path: '/pantry' },
  { icon: Users, label: 'Circle', path: '/circle' },
  { icon: User, label: 'Profile', path: '/profile' },
];

export const BottomNav: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [expanded, setExpanded] = useState(false);
  const { phoneMode } = useSettings();

  const isExpanded = !collapsible || expanded;

  return (
    <motion.nav
      layout
      className={cn(
        "fixed left-1/2 glass rounded-full shadow-2xl border border-white/20 z-50 flex items-center justify-center",
        phoneMode ? "bottom-3" : "bottom-6",
        isExpanded
          ? phoneMode ? "gap-2 px-3 py-3" : "gap-2 px-8 py-4"
          : phoneMode ? "px-3 py-3" : "px-4 py-4"
      )}
      style={{ x: '-50%' }}
      transition={{
        layout: { type: 'spring', damping: 22, stiffness: 280, mass: 0.8 },
      }}
      onMouseEnter={() => collapsible && setExpanded(true)}
      onMouseLeave={() => collapsible && setExpanded(false)}
    >
      <AnimatePresence mode="popLayout">
        {navItems.map((item) => {
          const isHome = item.path === '/map';
          const shouldShow = isExpanded || isHome;

          if (!shouldShow) return null;

          return (
            <motion.div
              key={item.path}
              layout
              initial={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0, filter: 'blur(4px)' }}
              transition={{
                layout: { type: 'spring', damping: 22, stiffness: 280, mass: 0.8 },
                opacity: { duration: 0.2 },
                scale: { type: 'spring', damping: 18, stiffness: 350, mass: 0.6 },
                filter: { duration: 0.2 },
              }}
              className={cn("flex items-center justify-center", isExpanded ? `flex-1 ${phoneMode ? 'min-w-[3rem]' : 'min-w-[3.5rem]'}` : "flex-none")}
            >
              {collapsible && isHome && !isExpanded ? (
                <button
                  className={cn("flex flex-col items-center text-primary cursor-pointer", phoneMode ? "gap-1 px-1" : "gap-1.5 px-2")}
                  onClick={() => setExpanded(true)}
                  onTouchStart={() => setExpanded(true)}
                >
                  <Home size={phoneMode ? 18 : 22} strokeWidth={2.5} />
                  <span className={cn("font-semibold uppercase", phoneMode ? "text-[8px] tracking-wide" : "text-[10px] tracking-wider")}>Home</span>
                </button>
              ) : (
                <NavLink
                  to={item.path}
                  onClick={() => {
                    if (collapsible && isHome) {
                      setTimeout(() => setExpanded(false), 150);
                    }
                  }}
                  className={({ isActive }) =>
                    cn(
                      "flex flex-col items-center transition-colors duration-200",
                      phoneMode ? "gap-1 px-1" : "gap-1.5 px-2",
                      isActive ? "text-primary" : "text-on-surface/40 hover:text-on-surface/60"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon size={phoneMode ? 18 : 22} strokeWidth={isActive ? 2.5 : 2} />
                      <span className={cn("font-semibold uppercase", phoneMode ? "text-[8px] tracking-wide" : "text-[10px] tracking-wider")}>{item.label}</span>
                    </>
                  )}
                </NavLink>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.nav>
  );
};
