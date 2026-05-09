import React, { useEffect, useMemo, useState } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, Map as MapIcon, Bookmark, Users, User, Plus, ChevronsLeft, ChevronsRight, ChevronDown, Heart, ChefHat, Plane, MessageCircle, Film } from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useChat } from '../contexts/ChatContext';
import { useReels } from '../contexts/ReelsContext';

/**
 * Desktop-only collapsible sidebar. App.tsx decides when to mount it
 * (wide viewports, signed in, not in phone-frame preview).
 *
 *  ┌──────────────────┐
 *  │ logo · app name  │
 *  │ ─────────────────│
 *  │  + New Rating    │
 *  │ ─────────────────│
 *  │ • Discover       │
 *  │ • Map            │
 *  │ ▾ Pantry         │   ← expandable: opens "My Lists" tray below
 *  │   ❤ Wishlist  6  │
 *  │   👨‍🍳 Home Cooking│
 *  │   ⚡ Quick Bites 3│
 *  │   + New List     │
 *  │ • Circle         │
 *  │ • Profile        │
 *  │       ⋮          │
 *  │ ─────────────────│
 *  │ avatar · name    │
 *  └──────────────────┘
 */

const COLLAPSE_KEY = 'gourmad-sidebar-collapsed';
const PANTRY_OPEN_KEY = 'gourmad-sidebar-pantry-open';

export const SIDEBAR_EXPANDED_WIDTH = 264;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v === '1';
  } catch { return fallback; }
}

export const Sidebar: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const { ratings, lists, wishlist, homeMeals, trips } = useLists();
  const { unreadCount } = useChat();
  const { openAddReelModal } = useReels();

  const [collapsed, setCollapsed] = useState<boolean>(() => loadFlag(COLLAPSE_KEY, false));
  const [pantryOpen, setPantryOpen] = useState<boolean>(() => loadFlag(PANTRY_OPEN_KEY, false));

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);
  useEffect(() => {
    try { localStorage.setItem(PANTRY_OPEN_KEY, pantryOpen ? '1' : '0'); } catch {}
  }, [pantryOpen]);

  // Auto-open the Pantry tray when the user lands on /pantry, so the
  // active list is visible without an extra click.
  useEffect(() => {
    if (location.pathname.startsWith('/pantry') && !pantryOpen) {
      setPantryOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // Auto-collapse the sidebar when the user lands on /reels — the desktop
  // reels layout wants the full canvas. We don't auto-expand on leaving
  // because re-expanding the rail under the user's cursor is jarring;
  // they can click the chevron to bring it back.
  useEffect(() => {
    if (location.pathname === '/reels' && !collapsed) {
      setCollapsed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  const initial = (profile?.display_name || profile?.username || 'U').charAt(0).toUpperCase();
  const ratingCount = ratings.length;

  const isHomeActive = location.pathname === '/' || location.pathname === '/index.html';
  const isMapActive = location.pathname === '/map';
  const isReelsActive = location.pathname === '/reels';
  const isPantryActive = location.pathname === '/pantry' || location.pathname.startsWith('/pantry/');
  const isCircleActive = location.pathname === '/circle';
  const isMessagesActive = location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  const isProfileActive = location.pathname === '/profile';

  // Parse the Pantry URL query so the tray can highlight the active
  // sub-item (?list=<id> or ?view=<home-cooking|trips>).
  const pantryParams = useMemo(() => {
    if (!isPantryActive) return { list: null as string | null, view: null as string | null };
    const sp = new URLSearchParams(location.search);
    return { list: sp.get('list'), view: sp.get('view') };
  }, [isPantryActive, location.search]);

  // Click anywhere blank on the rail (only while collapsed) to expand.
  const handleAsideClick = (e: React.MouseEvent<HTMLElement>) => {
    if (!collapsed) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('button, a, [role="button"]')) return;
    setCollapsed(false);
  };

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

  // Reusable nav-row className for the top-level items.
  const navRowClass = (active: boolean) =>
    cn(
      'group flex items-center rounded-2xl text-[14px] font-medium transition-colors min-h-[44px]',
      collapsed ? 'justify-center px-0' : 'gap-3 px-3',
      active
        ? 'bg-on-surface/[0.07] text-on-surface font-bold'
        : 'text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.04]',
    );

  // Sub-row for items inside the Pantry tray. Smaller, indented when
  // expanded; emoji on the left, count on the right.
  const subRowClass = (active: boolean) =>
    cn(
      'group flex items-center rounded-xl text-[13px] transition-colors min-h-[36px]',
      'gap-2.5 pl-3 pr-2',
      active
        ? 'bg-primary/[0.07] text-on-surface font-bold'
        : 'text-on-surface/65 hover:text-on-surface hover:bg-on-surface/[0.04] font-medium',
    );

  // Build the Pantry tray's sub-items in display order.
  const wishlistCount = wishlist.length;
  const homeCookingCount = homeMeals.length;
  const tripsCount = trips.length;

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

      {/* ── Create CTA — single red button that opens the Post Reel modal.
              Replaces the previous two-button stack. */}
      <div className={cn('px-3 pt-4 pb-3', collapsed && 'px-2')}>
        <button
          type="button"
          onClick={() => openAddReelModal()}
          aria-label="Create — post a reel"
          title={collapsed ? 'Create' : undefined}
          className={cn(
            'w-full bg-primary text-white rounded-full font-semibold text-sm',
            'flex items-center justify-center gap-2',
            'shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all',
            collapsed ? 'h-11 px-0' : 'h-11 px-4',
          )}
        >
          <Plus size={18} strokeWidth={2.5} />
          {!collapsed && <span>Create</span>}
        </button>
      </div>

      {/* ── Nav list ───────────────────────────────────────────────────── */}
      <nav className={cn('flex-1 overflow-y-auto pt-2 pb-3', collapsed ? 'px-2' : 'px-3')}>
        <ul className="space-y-1">
          {/* Discover */}
          <li>
            <NavLink to="/" className={navRowClass(isHomeActive)} title={collapsed ? 'Discover' : undefined}>
              <Compass size={20} strokeWidth={isHomeActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isHomeActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Discover</span>}
            </NavLink>
          </li>

          {/* Map */}
          <li>
            <NavLink to="/map" className={navRowClass(isMapActive)} title={collapsed ? 'Map' : undefined}>
              <MapIcon size={20} strokeWidth={isMapActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isMapActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Map</span>}
            </NavLink>
          </li>

          {/* Reels */}
          <li>
            <NavLink to="/reels" className={navRowClass(isReelsActive)} title={collapsed ? 'Reels' : undefined}>
              <Film size={20} strokeWidth={isReelsActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isReelsActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Reels</span>}
            </NavLink>
          </li>

          {/* Pantry — expandable. Body click navigates to /pantry AND
              opens the lists tray; the chevron on the right toggles the
              tray without navigating. The tray previously lived as a
              standalone "LISTS" block at the bottom of the rail; it's
              now consolidated under the Pantry row so the tray is
              visually anchored to the page it controls. */}
          <li>
            <button
              type="button"
              onClick={() => {
                navigate('/pantry');
                if (!collapsed) setPantryOpen(true);
              }}
              className={cn(navRowClass(isPantryActive), 'w-full text-left')}
              title={collapsed ? 'Pantry' : undefined}
            >
              <Bookmark size={20} strokeWidth={isPantryActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isPantryActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && (
                <>
                  <span className="truncate flex-1">Pantry</span>
                  <span
                    role="button"
                    aria-label={pantryOpen ? 'Collapse lists' : 'Expand lists'}
                    aria-expanded={pantryOpen}
                    onClick={(e) => { e.stopPropagation(); setPantryOpen((o) => !o); }}
                    className="p-1 -mr-1 rounded-md text-on-surface/40 hover:text-on-surface hover:bg-on-surface/[0.05] transition-colors"
                  >
                    <ChevronDown
                      size={15}
                      className={cn('transition-transform', pantryOpen ? 'rotate-0' : '-rotate-90')}
                    />
                  </span>
                </>
              )}
            </button>

            {/* Inline lists tray — shown only when expanded and the rail
                isn't collapsed. Same content as the old bottom "LISTS"
                section; visual hierarchy now puts each list directly
                under the Pantry row so the relationship reads. */}
            <AnimatePresence initial={false}>
              {!collapsed && pantryOpen && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  className="overflow-hidden space-y-0.5 pt-1"
                >
                  {/* Wishlist */}
                  <li>
                    <button
                      type="button"
                      onClick={() => navigate('/pantry?list=__wishlist__')}
                      className={cn(subRowClass(isPantryActive && pantryParams.list === '__wishlist__'), 'w-full text-left')}
                    >
                      <Heart size={13} className="text-red-400 fill-red-400 flex-shrink-0" />
                      <span className="flex-1 truncate">Wishlist</span>
                      <span className="text-[11px] text-on-surface/40 tabular-nums">{wishlistCount}</span>
                    </button>
                  </li>
                  {/* Home Cooking */}
                  <li>
                    <button
                      type="button"
                      onClick={() => navigate('/pantry?view=home-cooking')}
                      className={cn(subRowClass(isPantryActive && pantryParams.view === 'home-cooking'), 'w-full text-left')}
                    >
                      <ChefHat size={13} className="text-emerald-600 flex-shrink-0" />
                      <span className="flex-1 truncate">Home Cooking</span>
                      {homeCookingCount > 0 && (
                        <span className="text-[11px] text-on-surface/40 tabular-nums">{homeCookingCount}</span>
                      )}
                    </button>
                  </li>
                  {/* Trips — only if any exist */}
                  {tripsCount > 0 && (
                    <li>
                      <button
                        type="button"
                        onClick={() => navigate('/pantry?view=trips')}
                        className={cn(subRowClass(isPantryActive && pantryParams.view === 'trips'), 'w-full text-left')}
                      >
                        <Plane size={13} className="text-primary flex-shrink-0" />
                        <span className="flex-1 truncate">Trips</span>
                        <span className="text-[11px] text-on-surface/40 tabular-nums">{tripsCount}</span>
                      </button>
                    </li>
                  )}
                  {/* User-created lists */}
                  {lists.map((list) => {
                    const total = list.restaurantIds.length + (list.wishlistIds?.length || 0);
                    const active = isPantryActive && pantryParams.list === list.id;
                    return (
                      <li key={list.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/pantry?list=${encodeURIComponent(list.id)}`)}
                          className={cn(subRowClass(active), 'w-full text-left')}
                        >
                          <span className="text-[14px] leading-none flex-shrink-0 w-[15px] text-center">{list.emoji}</span>
                          <span className="flex-1 truncate">{list.name}</span>
                          <span className="text-[11px] text-on-surface/40 tabular-nums">{total}</span>
                        </button>
                      </li>
                    );
                  })}
                  {/* New List */}
                  <li>
                    <button
                      type="button"
                      onClick={() => navigate('/pantry?new-list=1')}
                      className={cn(
                        'w-full flex items-center gap-2.5 pl-3 pr-2 min-h-[36px] rounded-xl',
                        'text-[13px] font-semibold text-primary',
                        'hover:bg-primary/[0.06] transition-colors',
                      )}
                    >
                      <Plus size={13} className="flex-shrink-0" />
                      <span>New List</span>
                    </button>
                  </li>
                </motion.ul>
              )}
            </AnimatePresence>
          </li>

          {/* Circle */}
          <li>
            <NavLink to="/circle" className={navRowClass(isCircleActive)} title={collapsed ? 'Circle' : undefined}>
              <Users size={20} strokeWidth={isCircleActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isCircleActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Circle</span>}
            </NavLink>
          </li>

          {/* Messages */}
          <li>
            <NavLink to="/messages" className={navRowClass(isMessagesActive)} title={collapsed ? 'Messages' : undefined}>
              <span className="relative flex-shrink-0">
                <MessageCircle size={20} strokeWidth={isMessagesActive ? 2.4 : 1.9} className={cn(isMessagesActive ? 'text-on-surface' : 'text-on-surface/65')} />
                {unreadCount > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-white text-[10px] font-bold',
                      'flex items-center justify-center ring-2 ring-surface',
                    )}
                  >
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate flex-1">Messages</span>
                  {unreadCount > 0 && (
                    <span className="text-[11px] font-bold text-primary tabular-nums">{unreadCount}</span>
                  )}
                </>
              )}
            </NavLink>
          </li>

          {/* Profile */}
          <li>
            <NavLink to="/profile" className={navRowClass(isProfileActive)} title={collapsed ? 'Profile' : undefined}>
              <User size={20} strokeWidth={isProfileActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isProfileActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Profile</span>}
            </NavLink>
          </li>
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
