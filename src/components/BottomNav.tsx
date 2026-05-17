import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Compass, Search, User, ListPlus, Map as MapIcon, Film } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';

const navItems = [
  { icon: Compass, label: 'Home', path: '/', isExplore: true },
  { icon: Search, label: 'Search', path: '/search', splitsWith: 'map' },
  { icon: Film, label: 'Reels', path: '/reels' },
  { icon: ListPlus, label: 'Lists', path: '/pantry' },
  { icon: User, label: 'Profile', path: '/profile' },
];

export const BottomNav: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [expanded, setExpanded] = useState(false);
  const [searchSplit, setSearchSplit] = useState(false);
  const { phoneMode, hideBottomNav, keyboardOpen } = useSettings();
  // Hide whenever any consumer asked us to OR the on-screen keyboard is up.
  // Typing in a search bar shouldn't leave the nav floating in the way and
  // intercepting taps, especially on phone where the WebView shrinks to fit
  // above the keyboard and the nav ends up flush against the accessory area.
  const navHidden = hideBottomNav || keyboardOpen;
  const navigate = useNavigate();
  const location = useLocation();
  const splitTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const splitHoverRef = useRef<ReturnType<typeof setTimeout>>();

  const isSearchActive = location.pathname === '/search';
  const isMapActive = location.pathname === '/map';
  const isSearchOrMap = isSearchActive || isMapActive;

  // On the map page the nav is collapsible and should show the split by default
  useEffect(() => {
    if (isMapActive && collapsible) {
      setSearchSplit(true);
    }
  }, [isMapActive, collapsible]);

  // Collapse the split when navigating away from search-related pages
  // (but not when collapsible on the map page — that stays split)
  useEffect(() => {
    if (!isSearchOrMap) {
      setSearchSplit(false);
    }
  }, [location.pathname]);

  const closeSplit = () => {
    clearTimeout(splitTimerRef.current);
    // Don't close the split if we're on the map page with collapsible nav
    if (!(isMapActive && collapsible)) {
      setSearchSplit(false);
    }
  };

  const isExpanded = !collapsible || expanded;

  // When collapsed on the map page, show the search/map split; otherwise show explore
  const collapsedShowsSearch = collapsible && isMapActive;

  return (
    <motion.nav
      layout
      animate={{ opacity: navHidden ? 0 : 1, y: navHidden ? 20 : 0 }}
      className={cn(
        "fixed z-50 flex items-center",
        navHidden && "pointer-events-none",
        phoneMode
          // Phone: solid full-width bar flush with the bottom edge, with
          // a thin top divider. 50px of content + safe-area-inset-bottom
          // padding underneath, set inline below.
          ? "left-0 right-0 bottom-0 bg-surface border-t border-on-surface/10 justify-around"
          // Desktop: original floating pill, centered above the bottom.
          : cn(
              "left-1/2 glass rounded-full border border-on-surface/[0.06] justify-center bottom-6",
              isExpanded ? "gap-2 px-6 py-2" : "px-3 py-2",
            ),
      )}
      style={
        phoneMode
          ? {
              height: 'calc(50px + env(safe-area-inset-bottom))',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }
          : { x: '-50%' }
      }
      transition={{
        layout: { type: 'spring', damping: 22, stiffness: 280, mass: 0.8 },
        opacity: { duration: 0.2 },
        y: { duration: 0.2 },
      }}
      onMouseEnter={() => !phoneMode && collapsible && setExpanded(true)}
      onMouseLeave={() => !phoneMode && collapsible && setExpanded(false)}
    >
      <AnimatePresence mode="popLayout">
        {navItems.map((item) => {
          const isExplore = (item as any).isExplore;
          const isSplittable = (item as any).splitsWith === 'map';

          // Visibility when collapsed:
          // - On map page: show the search/map split, hide everything else
          // - On other collapsible pages: show explore, hide everything else
          const shouldShow = isExpanded
            || (collapsedShowsSearch ? isSplittable : isExplore);

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
                className={cn("flex items-center justify-center", isExpanded ? (phoneMode ? "flex-none" : "flex-1 min-w-[3.5rem]") : "flex-none")}
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
                  aria-label={item.label}
                  className={cn(
                    "flex items-center justify-center transition-colors duration-200",
                    phoneMode
                      ? "w-11 h-11"
                      : "flex-col gap-1 min-w-[44px] min-h-[44px] px-3 py-2 rounded-full",
                    location.pathname === '/'
                      ? phoneMode ? "text-primary" : "bg-primary/10 text-primary"
                      : phoneMode ? "text-on-surface/50" : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                  )}
                >
                  <item.icon size={phoneMode ? 24 : 22} strokeWidth={location.pathname === '/' ? 2.5 : 2} />
                  {!phoneMode && (
                    <span className="font-semibold uppercase text-[11px] tracking-wider">{item.label}</span>
                  )}
                </button>
              </motion.div>
            );
          }

          // ── Search button with split into Search + Map ──
          if (isSplittable) {
            // Force split open when collapsed on the map page.
            // On phone we never split — the navbar Search button is a plain
            // link to /search; the map is reached from a button inside the
            // Discover tab instead.
            const showSplit = !phoneMode && (searchSplit || (collapsedShowsSearch && !isExpanded));

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
                className={cn("flex items-center justify-center", isExpanded ? (phoneMode ? "flex-none" : "flex-1 min-w-[3.5rem]") : "flex-none")}
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  {showSplit ? (
                    /* ── Split state: two buttons side by side ── */
                    <motion.div
                      key="split"
                      layout
                      className="flex items-center gap-1"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      onMouseEnter={() => { if (!phoneMode) clearTimeout(splitHoverRef.current); }}
                      onMouseLeave={() => {
                        if (!phoneMode && !isSearchOrMap) {
                          splitHoverRef.current = setTimeout(() => setSearchSplit(false), 300);
                        }
                      }}
                    >
                      {/* Search half (desktop only — phone never splits) */}
                      <motion.button
                        layoutId="search-icon"
                        onClick={() => {
                          navigate('/search');
                          if (collapsible) setTimeout(() => setExpanded(false), 150);
                        }}
                        aria-label="Search"
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

                      {/* Map half (desktop only — phone never splits) */}
                      <motion.button
                        layoutId="map-icon"
                        initial={{ opacity: 0, scale: 0.3, filter: 'blur(4px)' }}
                        animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
                        exit={{ opacity: 0, scale: 0.3, filter: 'blur(4px)' }}
                        onClick={() => {
                          navigate('/map');
                          if (collapsible) setTimeout(() => setExpanded(false), 150);
                        }}
                        aria-label="Map"
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
                      onMouseEnter={() => {
                        if (!phoneMode) {
                          clearTimeout(splitHoverRef.current);
                          setSearchSplit(true);
                        }
                      }}
                      onClick={() => {
                        // Phone: plain link to /search, no split, no map.
                        if (phoneMode) {
                          if (location.pathname !== '/search') navigate('/search');
                          return;
                        }
                        if (isSearchOrMap) {
                          setSearchSplit(true);
                          return;
                        }
                        setSearchSplit(true);
                        splitTimerRef.current = setTimeout(() => {
                          navigate('/search');
                        }, 200);
                        if (collapsible) setTimeout(() => setExpanded(false), 350);
                      }}
                      aria-label={item.label}
                      className={cn(
                        "flex items-center justify-center transition-colors duration-200",
                        phoneMode
                          ? "w-11 h-11"
                          : "flex-col gap-1 min-w-[44px] min-h-[44px] px-3 py-2 rounded-full",
                        (phoneMode ? isSearchActive : isSearchOrMap)
                          ? phoneMode ? "text-primary" : "bg-primary/10 text-primary"
                          : phoneMode ? "text-on-surface/50" : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                      )}
                      transition={{ type: 'spring', damping: 22, stiffness: 280, mass: 0.8 }}
                    >
                      <Search size={phoneMode ? 24 : 22} strokeWidth={(phoneMode ? isSearchActive : isSearchOrMap) ? 2.5 : 2} />
                      {!phoneMode && (
                        <span className="font-semibold uppercase text-[11px] tracking-wider">{item.label}</span>
                      )}
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
              className={cn("flex items-center justify-center", isExpanded ? (phoneMode ? "flex-none" : "flex-1 min-w-[3.5rem]") : "flex-none")}
            >
              <NavLink
                to={item.path}
                onClick={() => {
                  closeSplit();
                  if (collapsible) {
                    setTimeout(() => setExpanded(false), 150);
                  }
                }}
                aria-label={item.label}
                className={({ isActive }) =>
                  cn(
                    "flex items-center justify-center transition-colors duration-200",
                    phoneMode
                      ? "w-11 h-11"
                      : "flex-col gap-1 min-w-[44px] min-h-[44px] px-3 py-2 rounded-full",
                    isActive
                      ? phoneMode ? "text-primary" : "bg-primary/10 text-primary"
                      : phoneMode ? "text-on-surface/50" : "text-on-surface/50 hover:text-on-surface/80 hover:bg-on-surface/5"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={phoneMode ? 24 : 22} strokeWidth={isActive ? 2.5 : 2} />
                    {!phoneMode && (
                      <span className="font-semibold uppercase text-[11px] tracking-wider">{item.label}</span>
                    )}
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
