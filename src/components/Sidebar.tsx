import React, { useEffect, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Compass, Map as MapIcon, Bookmark, Users, User, Plus, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';

/**
 * Desktop-only collapsible sidebar. Replaces the floating BottomNav on
 * wide viewports (handled by App.tsx — this component only renders the
 * panel itself; the layout decision lives upstream).
 *
 * Layout:
 *  ┌──────────────────┐
 *  │ logo · app name  │
 *  │ ─────────────────│
 *  │  + New Rating    │
 *  │ ─────────────────│
 *  │ • Discover       │
 *  │ • Map            │
 *  │ • Pantry         │
 *  │ • Circle         │
 *  │ • Profile        │
 *  │       ⋮          │  (flex spacer)
 *  │ ─────────────────│
 *  │ avatar · name    │
 *  │         · count  │
 *  └──────────────────┘
 *
 * The collapsed state is persisted to localStorage so it survives reloads.
 */

const COLLAPSE_KEY = 'gourmad-sidebar-collapsed';

const navItems: Array<{
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  label: string;
  path: string;
  /** Match nested routes too — e.g. Pantry should highlight on /pantry/anything. */
  matchPrefix?: boolean;
}> = [
  { icon: Compass, label: 'Discover', path: '/' },
  { icon: MapIcon, label: 'Map', path: '/map' },
  { icon: Bookmark, label: 'Pantry', path: '/pantry' },
  { icon: Users, label: 'Circle', path: '/circle' },
  { icon: User, label: 'Profile', path: '/profile' },
];

export const SIDEBAR_EXPANDED_WIDTH = 264;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

function loadCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { ratings } = useLists();

  const [collapsed, setCollapsed] = useState<boolean>(loadCollapsed);
  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  // Initial of the user's display name for the avatar fallback.
  const initial = (profile?.display_name || profile?.username || 'U').charAt(0).toUpperCase();
  const ratingCount = ratings.length;

  const isHomeActive =
    location.pathname === '/' || location.pathname === '/index.html';

  const isActive = (path: string) => {
    if (path === '/') return isHomeActive;
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  // While collapsed, clicking any "blank" area of the sidebar (anything
  // that isn't a button, link, or an explicit interactive control) is
  // treated as an "expand me" gesture. The closest() check makes nav
  // links and the +New Rating button keep their primary behavior.
  const handleAsideClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!collapsed) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, a, [role="button"]')) return;
    setCollapsed(false);
  };

  // Reusable collapse / expand chevron — placed at both the top of the
  // header row and inline with the footer so the user can toggle from
  // either end of the rail.
  const ToggleButton: React.FC<{ size?: number; className?: string }> = ({ size = 16, className }) => (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); setCollapsed((c) => !c); }}
      aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      className={cn(
        'rounded-lg flex items-center justify-center flex-shrink-0',
        'text-on-surface/40 hover:text-on-surface hover:bg-on-surface/[0.05] transition-colors',
        className,
      )}
    >
      {collapsed ? <ChevronsRight size={size} /> : <ChevronsLeft size={size} />}
    </button>
  );

  return (
    <motion.aside
      animate={{ width }}
      transition={{ type: 'spring', damping: 28, stiffness: 280, mass: 0.9 }}
      onClick={handleAsideClick}
      className={cn(
        'h-screen sticky top-0 flex-shrink-0 border-r border-on-surface/[0.07] bg-surface',
        'flex flex-col z-30',
        collapsed && 'cursor-e-resize',
      )}
      aria-label="Primary"
    >
      {/* ── Header: logo + brand + collapse toggle ─────────────────────── */}
      <div className={cn(
        'flex items-center pt-5 pb-4 gap-3',
        collapsed ? 'flex-col gap-2 px-3' : 'px-5',
      )}>
        <div className={cn('flex items-center gap-3 min-w-0', !collapsed && 'flex-1')}>
          <div className="w-9 h-9 rounded-full bg-primary flex items-center justify-center text-white font-serif italic text-lg flex-shrink-0">
            G
          </div>
          {!collapsed && (
            <h1 className="font-serif font-bold text-[17px] text-on-surface leading-tight truncate">
              Gourmet Canvas
            </h1>
          )}
        </div>
        <ToggleButton size={16} className="w-8 h-8" />
      </div>

      <div className="border-t border-on-surface/[0.06] mx-3" />

      {/* ── New Rating CTA ─────────────────────────────────────────────── */}
      <div className={cn('px-3 pt-4 pb-3', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={() => navigate('/search/main')}
          aria-label="New rating"
          className={cn(
            'w-full bg-primary text-white rounded-full font-semibold text-sm',
            'flex items-center justify-center gap-2',
            'shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all',
            collapsed ? 'h-11 px-0' : 'h-11 px-4',
          )}
        >
          <Plus size={18} strokeWidth={2.5} />
          {!collapsed && <span>New Rating</span>}
        </button>
      </div>

      {/* ── Nav list ───────────────────────────────────────────────────── */}
      <nav className={cn('flex-1 overflow-y-auto pt-2 pb-3', collapsed ? 'px-2' : 'px-3')}>
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = isActive(item.path);
            return (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  className={cn(
                    'group flex items-center rounded-2xl text-[14px] font-medium transition-colors',
                    'min-h-[44px]',
                    collapsed ? 'justify-center px-0' : 'gap-3 px-3',
                    active
                      ? 'bg-on-surface/[0.07] text-on-surface font-bold'
                      : 'text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.04]',
                  )}
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon
                    size={20}
                    strokeWidth={active ? 2.4 : 1.9}
                    className={cn('flex-shrink-0', active ? 'text-on-surface' : 'text-on-surface/65')}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* ── Footer: profile snapshot + collapse toggle ─────────────────── */}
      <div className="border-t border-on-surface/[0.06] mx-3" />
      <div className={cn('px-3 py-3 flex items-center gap-3', collapsed && 'flex-col gap-2 px-2')}>
        <NavLink
          to="/profile"
          className={cn(
            'flex items-center gap-3 min-w-0 rounded-xl flex-1',
            collapsed ? 'flex-col gap-1' : 'p-2 hover:bg-on-surface/[0.04] transition-colors',
          )}
          title={profile?.display_name || 'Profile'}
        >
          <div className="w-9 h-9 rounded-full bg-secondary text-white flex items-center justify-center font-serif font-bold text-sm flex-shrink-0">
            {initial}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-on-surface leading-tight truncate">
                {profile?.display_name || profile?.username || 'You'}
              </p>
              <p className="text-[11px] text-on-surface/45 leading-tight truncate">
                {ratingCount} rating{ratingCount === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </NavLink>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            'text-on-surface/40 hover:text-on-surface hover:bg-on-surface/[0.05] transition-colors',
            collapsed && 'hidden',
          )}
        >
          <ChevronsLeft size={16} />
        </button>
      </div>
    </motion.aside>
  );
};
