import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Search, Home, Users, User, Heart } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

const navItems = [
  { icon: Search, label: 'Search', path: '/' },
  { icon: Home, label: 'Home', path: '/map' },
  { icon: Heart, label: 'Pantry', path: '/pantry' },
  { icon: Users, label: 'Circle', path: '/circle' },
  { icon: User, label: 'Profile', path: '/profile' },
];

const homeItem = navItems.find((item) => item.path === '/map')!;

export const BottomNav: React.FC<{ collapsible?: boolean }> = ({ collapsible = false }) => {
  const [expanded, setExpanded] = useState(false);

  const isExpanded = !collapsible || expanded;

  return (
    <motion.nav
      className="fixed bottom-6 left-1/2 glass rounded-full shadow-2xl border border-white/20 z-50 flex items-center justify-between overflow-hidden"
      initial={false}
      animate={{
        width: isExpanded ? 'min(90%, 28rem)' : '3.5rem',
        paddingLeft: isExpanded ? '1.5rem' : '0rem',
        paddingRight: isExpanded ? '1.5rem' : '0rem',
        paddingTop: '0.75rem',
        paddingBottom: '0.75rem',
        x: '-50%',
      }}
      transition={{ type: 'spring', damping: 25, stiffness: 300 }}
      onMouseEnter={() => collapsible && setExpanded(true)}
      onMouseLeave={() => collapsible && setExpanded(false)}
    >
      {isExpanded ? (
        navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={(e) => {
              // On touch devices, tapping Home while expanded on map page should just collapse
              if (collapsible && item.path === '/map') {
                // Let the link navigate normally, then collapse
                setTimeout(() => setExpanded(false), 100);
              }
            }}
            className={({ isActive }) =>
              cn(
                "flex flex-col items-center gap-1 transition-all duration-300 flex-1",
                isActive ? "text-primary scale-110" : "text-on-surface/40 hover:text-on-surface/60"
              )
            }
          >
            {({ isActive }) => (
              <motion.div
                className="flex flex-col items-center gap-1"
                initial={{ opacity: 0, scale: 0.5 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'spring', damping: 20, stiffness: 300 }}
              >
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
              </motion.div>
            )}
          </NavLink>
        ))
      ) : (
        <button
          className="flex flex-col items-center gap-1 text-primary w-14 cursor-pointer"
          onClick={() => setExpanded(true)}
          onTouchStart={() => setExpanded(true)}
        >
          <homeItem.icon size={20} strokeWidth={2.5} />
          <span className="text-[10px] font-bold uppercase tracking-widest">{homeItem.label}</span>
        </button>
      )}
    </motion.nav>
  );
};
