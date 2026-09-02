import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { Compass, Search, User, ListPlus, Film } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import { activeTabPath, useNativeGlassNav } from '../lib/native-glass';
import { isSearchTakeoverOpen, subscribeSearchTakeover } from '../lib/search-takeover';

const navItems = [
  { icon: Compass, label: 'Home', path: '/' },
  { icon: Search, label: 'Search', path: '/search' },
  { icon: Film, label: 'Reels', path: '/reels' },
  { icon: ListPlus, label: 'Lists', path: '/pantry' },
  { icon: User, label: 'Profile', path: '/profile' },
];

/**
 * Phone tab bar — solid full-width bar flush with the bottom edge, 50px of
 * content plus the home-indicator safe area.
 *
 * This is phone-layout-only chrome: App.tsx renders it solely in the narrow
 * (non-sidebar) layout, where phoneMode is always true, and `/map` is
 * excluded by showBottomNav. The old desktop floating-pill, hover-collapse,
 * and search↔map split variants were therefore unreachable and have been
 * removed.
 *
 * On iOS 26 this hands the job over entirely: `useNativeGlassNav` installs a
 * real UIKit `UITabBar` above the WebView (see
 * ios/App/App/MainViewController.swift) and this component renders nothing.
 * Not a Liquid Glass lookalike — the system control, which genuinely refracts
 * the page beneath it and lenses the glyph under its selection, neither of
 * which any amount of `backdrop-filter` can do. Older iOS, Android and the
 * browser keep the markup below, unchanged.
 */
export const BottomNav: React.FC = () => {
  const { hideBottomNav, keyboardOpen } = useSettings();
  // The search takeover is its own reason to hide, composed HERE rather
  // than written through setHideBottomNav: that flag is one boolean with
  // many writers, and the assistant FAB mounting inside the takeover
  // (its own hide-on-open effect runs setHideBottomNav(false) on mount)
  // stomped the takeover's `true` the moment it appeared. Reasons that
  // are ORed at the read site cannot stomp each other.
  const [takeoverOpen, setTakeoverOpen] = useState(isSearchTakeoverOpen());
  useEffect(() => subscribeSearchTakeover(setTakeoverOpen), []);
  const location = useLocation();
  const navigate = useNavigate();
  // Hide whenever any consumer asked us to OR the on-screen keyboard is up.
  // The native shell keeps the WebView full-height under the keyboard
  // (Keyboard resize:"none" — the app pads itself with --kb-height), so
  // without this the bar would sit uselessly behind the keyboard while
  // still intercepting taps.
  const navHidden = hideBottomNav || keyboardOpen || takeoverOpen;

  // App.tsx only mounts this component on routes that should show a tab bar,
  // so being mounted at all is the "enabled" signal for the native one.
  const { profile } = useAuth();
  const avatarInitial =
    (profile?.display_name || profile?.username || '').trim().charAt(0).toUpperCase() || undefined;

  const glass = useNativeGlassNav({
    enabled: true,
    hidden: navHidden,
    activePath: activeTabPath(location.pathname),
    // The full route as well as the owning tab: the native bar un-shrinks on
    // every navigation, including ones that stay within a tab.
    pathname: location.pathname,
    // Reels is black regardless of theme. The material re-chromes itself from
    // what's behind it, so this only lifts the brand accent.
    darkPage: location.pathname.startsWith('/reels'),
    // The Profile tab is the user's own photo when they have one, else the
    // initial-circle avatar.
    avatarInitial,
    avatarUrl: profile?.avatar_url || undefined,
    onSelect: (path) => navigate(path),
  });

  // The native bar draws itself over the WebView; rendering the web one too
  // would stack two tab bars.
  if (glass.active) return null;

  return (
    <motion.nav
      animate={{ opacity: navHidden ? 0 : 1, y: navHidden ? 20 : 0 }}
      transition={{ opacity: { duration: 0.2 }, y: { duration: 0.2 } }}
      className={cn(
        'fixed z-50 flex items-center left-0 right-0 bottom-0 bg-surface border-t border-on-surface/10 justify-around',
        navHidden && 'pointer-events-none',
      )}
      style={{
        height: 'calc(50px + env(safe-area-inset-bottom))',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {navItems.map((item) => (
        <NavLink
          key={item.label}
          to={item.path}
          end={item.path === '/'}
          aria-label={item.label}
          // One ink for every tab, selected or not: the weight of the stroke
          // (and the photo, on Profile) is the only thing that changes.
          className="flex items-center justify-center w-11 h-11 text-on-surface"
        >
          {({ isActive }) => (
            item.path === '/profile' && profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className={cn('h-6 w-6 rounded-full object-cover', isActive ? 'ring-2 ring-on-surface' : 'ring-1 ring-on-surface/30')}
              />
            ) : (
              <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />
            )
          )}
        </NavLink>
      ))}
    </motion.nav>
  );
};
