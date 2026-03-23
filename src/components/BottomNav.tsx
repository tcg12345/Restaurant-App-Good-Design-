import React from 'react';
import { NavLink } from 'react-router-dom';
import { Search, Map as MapIcon, Users, User, Heart } from 'lucide-react';
import { cn } from '../lib/utils';

export const BottomNav: React.FC = () => {
  const navItems = [
    { icon: Search, label: 'Search', path: '/' },
    { icon: MapIcon, label: 'Map', path: '/map' },
    { icon: Heart, label: 'Pantry', path: '/pantry' },
    { icon: Users, label: 'Circle', path: '/circle' },
    { icon: User, label: 'Profile', path: '/profile' },
  ];

  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md glass rounded-full px-6 py-3 flex items-center justify-between z-50 shadow-2xl border border-white/20">
      {navItems.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-1 transition-all duration-300",
              isActive ? "text-primary scale-110" : "text-on-surface/40 hover:text-on-surface/60"
            )
          }
        >
          {({ isActive }) => (
            <>
              <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span className="text-[10px] font-bold uppercase tracking-widest">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
};
