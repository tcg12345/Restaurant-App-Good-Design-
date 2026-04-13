import React, { useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Compass, User, ListPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';

const navItems = [
  { icon: Compass, label: 'Explore', path: '/', isExplore: true },
  { icon: ListPlus, label: 'Lists', path: '/pantry' },
  { icon: User, label: 'Profile', path: '/profile' },
];

export const BottomNav: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [expanded, setExpanded] = useState(false);
  const { phoneMode, hideBottomNav } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();

  const isExpanded = !collapsible || expanded;

  return (
    <motion.nav
      layout
      animate={{ opacity: hideBottomNav ? 0 : 1, y: hideBottomNav ? 20 : 0 }}
      className={cn(
        "fixed left-1/2 glass rounded-full shadow-2xl border border-white/20 z-50 flex items-center justify-center",
        hideBottomNav && "pointer-events-none",
        phoneMode ? "bottom-3" : "bottom-6",
        isExpanded
          ? phoneMode ? "gap-2 px-3 py-3" : "gap-2 px-8 py-4"
          : phoneMode ? "px-2 py-2" : "px-3 py-3"
      )}
      style={{ x: '-50%' }}
      transition={{
        layout: { type: 'spring', damping: 22, stiffness: 280, mass: 0.8 },
        opacity: { duration: 0.2 },
        y: { duration: 0.2 },
      }}
      onMouseEnter={() => collapsible && setExpanded(true)}
      onMouseLeave={() => collapsible && setExpanded(false)}
    >
      <AnimatePresence mode="popLayout">
        {navItems.map((item) => {
          const isExplore = (item as any).isExplore;
          const shouldShow = isExpanded || isExplore;

          if (!shouldShow) return null;

          return (
            <motion.div
              key={item.label}
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
              {isExplore ? (
                <button
                  onClick={() => {
                    if (!isExpanded) {
                      setExpanded(true);
                      return;
                    }
                    if (location.pathname === '/') {
                      window.dispatchEvent(new CustomEvent('open-discover-sheet'));
                    } else {
                      navigate('/?discover=1');
                    }
                    if (collapsible) setTimeout(() => setExpanded(false), 150);
                  }}
                  onTouchStart={() => {
                    if (!isExpanded && collapsible) setExpanded(true);
                  }}
                  className={cn(
                    "flex flex-col items-center transition-colors duration-200",
                    isExpanded
                      ? phoneMode ? "gap-1 px-1" : "gap-1.5 px-2"
                      : phoneMode ? "gap-0.5 px-0.5" : "gap-1 px-1",
                    location.pathname === '/' ? "text-primary" : "text-on-surface/40 hover:text-on-surface/60"
                  )}
                >
                  <item.icon size={isExpanded ? (phoneMode ? 18 : 22) : (phoneMode ? 16 : 18)} strokeWidth={location.pathname === '/' ? 2.5 : 2} />
                  <span className={cn(
                    "font-semibold uppercase",
                    isExpanded
                      ? phoneMode ? "text-[8px] tracking-wide" : "text-[10px] tracking-wider"
                      : phoneMode ? "text-[7px] tracking-wide" : "text-[8px] tracking-wider"
                  )}>{item.label}</span>
                </button>
              ) : (
                <NavLink
                  to={item.path}
                  onClick={() => {
                    if (collapsible) {
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
