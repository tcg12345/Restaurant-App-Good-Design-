import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Compass, Search, User, ListPlus, Map as MapIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';

const navItems = [
  { icon: Compass, label: 'Home', path: '/', isExplore: true },
  { icon: Search, label: 'Search', path: '/search', splitsWith: 'map' },
  { icon: ListPlus, label: 'Lists', path: '/pantry' },
  { icon: User, label: 'Profile', path: '/profile' },
];

export const BottomNav: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [searchSplit, setSearchSplit] = useState(false);
  const { phoneMode, hideBottomNav } = useSettings();
  const navigate = useNavigate();
  const location = useLocation();
  const splitTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // Collapse the split when navigating away from search-related pages
  useEffect(() => {
    if (location.pathname !== '/search' && location.pathname !== '/map') {
      setSearchSplit(false);
    }
  }, [location.pathname]);

  // Close split when tapping outside (any other nav item handles this via onClick)
  const closeSplit = () => {
    clearTimeout(splitTimerRef.current);
    setSearchSplit(false);
  };

  const isSearchActive = location.pathname === '/search';
  const isMapActive = location.pathname === '/map';
  const isSearchOrMap = isSearchActive || isMapActive;
  const isExpanded = !collapsible || expanded;

  return (
    <motion.nav
      layout
      animate={{ opacity: hideBottomNav ? 0 : 1, y: hideBottomNav ? 20 : 0 }}
      className={cn(
        "fixed left-1/2 glass rounded-full border border-on-surface/[0.06] z-50 flex items-center justify-center",
        hideBottomNav && "pointer-events-none",
        !phoneMode && "bottom-6",
        isExpanded
          ? phoneMode ? "gap-2 px-3 py-2" : "gap-2 px-6 py-2"
          : phoneMode ? "px-2 py-2" : "px-3 py-2"
      )}
      style={{
        x: '-50%',
        ...(phoneMode ? { bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' } : {}),
      }}
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
          const isSplittable = (item as any).splitsWith === 'map';
          const shouldShow = isExpanded || isExplore;

          if (!shouldShow) return null;

          // ── Explore (Home) button ──
          if (isExplore) {
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
                <button
                  onClick={() => {
                    closeSplit();
                    if (!isExpanded) {
                      setExpanded(true);
                      return;
                    }
                    if (location.pathname !== '/') {
                      navigate('/');
                    }
                    if (collapsible) setTimeout(() => setExpanded(false), 150);
                  }}
                  onTouchStart={() => {
                    if (!isExpanded && collapsible) setExpanded(true);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-full min-w-[44px] min-h-[44px] px-3 py-2 transition-colors duration-200",
                    location.pathname === '/'
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                  )}
                >
                  <item.icon size={22} strokeWidth={location.pathname === '/' ? 2.5 : 2} />
                  <span className="font-semibold uppercase text-[11px] tracking-wider">{item.label}</span>
                </button>
              </motion.div>
            );
          }

          // ── Search button with split into Search + Map ──
          if (isSplittable) {
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
                <AnimatePresence mode="popLayout" initial={false}>
                  {searchSplit ? (
                    /* ── Split state: two buttons side by side ── */
                    <motion.div
                      key="split"
                      layout
                      className="flex items-center gap-1"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                    >
                      {/* Search half */}
                      <motion.button
                        layoutId="search-icon"
                        onClick={() => {
                          navigate('/search');
                          if (collapsible) setTimeout(() => setExpanded(false), 150);
                        }}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 rounded-full min-w-[44px] min-h-[44px] px-2.5 py-2 transition-colors duration-200",
                          isSearchActive
                            ? "bg-primary/10 text-primary"
                            : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                        )}
                        transition={{ type: 'spring', damping: 22, stiffness: 280, mass: 0.8 }}
                      >
                        <Search size={20} strokeWidth={isSearchActive ? 2.5 : 2} />
                        <span className="font-semibold uppercase text-[9px] tracking-wider">Search</span>
                      </motion.button>

                      {/* Map half */}
                      <motion.button
                        layoutId="map-icon"
                        initial={{ opacity: 0, scale: 0.3, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.3, filter: 'blur(4px)' }}
                        onClick={() => {
                          navigate('/map');
                          if (collapsible) setTimeout(() => setExpanded(false), 150);
                        }}
                        className={cn(
                          "flex flex-col items-center justify-center gap-1 rounded-full min-w-[44px] min-h-[44px] px-2.5 py-2 transition-colors duration-200",
                          isMapActive
                            ? "bg-primary/10 text-primary"
                            : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                        )}
                        transition={{ type: 'spring', damping: 22, stiffness: 280, mass: 0.8 }}
                      >
                        <MapIcon size={20} strokeWidth={isMapActive ? 2.5 : 2} />
                        <span className="font-semibold uppercase text-[9px] tracking-wider">Map</span>
                      </motion.button>
                    </motion.div>
                  ) : (
                    /* ── Single search button ── */
                    <motion.button
                      key="single"
                      layoutId="search-icon"
                      onClick={() => {
                        // If already on search or map, just toggle the split
                        if (isSearchOrMap) {
                          setSearchSplit(true);
                          return;
                        }
                        // First tap: split open
                        setSearchSplit(true);
                        // Navigate to search after a beat so the user sees the split
                        splitTimerRef.current = setTimeout(() => {
                          navigate('/search');
                        }, 200);
                        if (collapsible) setTimeout(() => setExpanded(false), 350);
                      }}
                      className={cn(
                        "flex flex-col items-center justify-center gap-1 rounded-full min-w-[44px] min-h-[44px] px-3 py-2 transition-colors duration-200",
                        isSearchOrMap
                          ? "bg-primary/10 text-primary"
                          : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                      )}
                      transition={{ type: 'spring', damping: 22, stiffness: 280, mass: 0.8 }}
                    >
                      <Search size={22} strokeWidth={isSearchOrMap ? 2.5 : 2} />
                      <span className="font-semibold uppercase text-[11px] tracking-wider">{item.label}</span>
                    </motion.button>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          }

          // ── Regular nav items (Lists, Profile) ──
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
              <NavLink
                to={item.path}
                onClick={() => {
                  closeSplit();
                  if (collapsible) {
                    setTimeout(() => setExpanded(false), 150);
                  }
                }}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center justify-center gap-1 rounded-full min-w-[44px] min-h-[44px] px-3 py-2 transition-colors duration-200",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
                    <span className="font-semibold uppercase text-[11px] tracking-wider">{item.label}</span>
                  </>
                )}
              </NavLink>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </motion.nav>
  );
};
