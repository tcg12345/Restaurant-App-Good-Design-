import React from 'react';
import { NavLink } from 'react-router-dom';
import { Compass, Search, User, ListPlus, Film } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { useSettings } from '../contexts/SettingsContext';

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
 */
export const BottomNav: React.FC = () => {
  const { hideBottomNav, keyboardOpen } = useSettings();
  // Hide whenever any consumer asked us to OR the on-screen keyboard is up.
  // The native shell keeps the WebView full-height under the keyboard
  // (Keyboard resize:"none" — the app pads itself with --kb-height), so
  // without this the bar would sit uselessly behind the keyboard while
  // still intercepting taps.
  const navHidden = hideBottomNav || keyboardOpen;

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
          className={({ isActive }) => cn(
            'flex items-center justify-center w-11 h-11 transition-colors duration-200',
            isActive ? 'text-primary' : 'text-on-surface/50',
          )}
        >
          {({ isActive }) => <item.icon size={24} strokeWidth={isActive ? 2.5 : 2} />}
        </NavLink>
      ))}
    </motion.nav>
  );
};
