import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Compass, Search, Map as MapIcon, Bookmark, Users, User, Plus, MessageCircle, Film, Image as ImageIcon, BookOpen, ChefHat, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { Logo } from './Logo';
import { useAuth } from '../contexts/AuthContext';
import { useLists } from '../contexts/ListsContext';
import { useChat } from '../contexts/ChatContext';
import { useNotifications } from '../contexts/NotificationsContext';
import { useCirclePanel } from '../contexts/CirclePanelContext';
import { useGuideCreator } from '../contexts/GuideCreatorContext';
import { usePageAddAction } from '../contexts/PageAddActionContext';
import { useUnifiedCreatePicker } from './useUnifiedComposer';

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
 *  │ • Pantry         │
 *  │ • Circle         │
 *  │ • Profile        │
 *  │ ─────────────────│
 *  │ avatar · name    │
 *  └──────────────────┘
 */

export const SIDEBAR_EXPANDED_WIDTH = 264;
export const SIDEBAR_COLLAPSED_WIDTH = 72;

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { profile, pendingRequestCount } = useAuth();
  const { ratings, openHomeMealModal } = useLists();
  const { unreadCount } = useChat();
  // Friend requests and alerts both live behind the Circle button, so the
  // badge on it has to speak for both.
  const { unreadCount: alertCount } = useNotifications();
  const circleBadge = pendingRequestCount + alertCount;
  // One "Post" entry covers photos AND video — the user picks media
  // first (Instagram-style) and the selection routes itself: a single
  // video continues as a reel, everything else as a post.
  const { openPicker: openUnifiedPicker, pickerInput } = useUnifiedCreatePicker();
  const { openGuideCreator } = useGuideCreator();
  const { open: circleOpen, toggle: toggleCircle, setOpen: setCircleOpen } = useCirclePanel();
  // Page-contextual quick-add (was the removed desktop header's CTA): Pantry
  // and RecipesForYou override the label/action per view; the default rates a
  // new restaurant via the full search page.
  const { override: addAction } = usePageAddAction();

  // Auto-close the panel whenever the route changes — otherwise it
  // hovers over the new page and confuses the user.
  useEffect(() => {
    if (circleOpen) setCircleOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  // The rail is always collapsed by default. Hover expands it; leaving
  // collapses it again. We don't persist this — the rail is hover-driven
  // every session. A small "leave delay" prevents the rail from snapping
  // shut when the cursor briefly grazes outside the bounds.
  const [hovered, setHovered] = useState(false);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Create menu — small popover anchored to the Create button.
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createWrapRef = useRef<HTMLDivElement>(null);

  // Keep the rail expanded while a popover is open (otherwise it'd snap
  // shut underneath the cursor when the user moves onto a menu item
  // anchored to the rail).
  const collapsed = !(hovered || createMenuOpen);

  const onAsideMouseEnter = () => {
    if (leaveTimerRef.current) { clearTimeout(leaveTimerRef.current); leaveTimerRef.current = null; }
    setHovered(true);
  };
  const onAsideMouseLeave = () => {
    if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => setHovered(false), 120);
  };

  useEffect(() => {
    if (!createMenuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (createWrapRef.current && !createWrapRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [createMenuOpen]);
  useEffect(() => { setCreateMenuOpen(false); }, [location.pathname]);

  const width = collapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_EXPANDED_WIDTH;

  const initial = (profile?.display_name || profile?.username || 'U').charAt(0).toUpperCase();
  const ratingCount = ratings.length;

  const isHomeActive = location.pathname === '/' || location.pathname === '/index.html';
  const isSearchActive = location.pathname === '/search/main' || location.pathname === '/search';
  const isMapActive = location.pathname === '/map';
  const isReelsActive = location.pathname === '/reels';
  const isPantryActive = location.pathname === '/pantry' || location.pathname.startsWith('/pantry/');
  const isCircleActive = location.pathname === '/circle';
  const isMessagesActive = location.pathname === '/messages' || location.pathname.startsWith('/messages/');
  const isProfileActive = location.pathname === '/profile';

  // Reusable nav-row className for the top-level items.
  const navRowClass = (active: boolean) =>
    cn(
      'group flex items-center rounded-2xl text-[14px] font-medium transition-colors min-h-[44px]',
      collapsed ? 'justify-center px-0' : 'gap-3 px-3',
      active
        ? 'bg-on-surface/[0.07] text-on-surface font-bold'
        : 'text-on-surface/55 hover:text-on-surface hover:bg-on-surface/[0.04]',
    );

  // Expose the current sidebar width as a CSS custom property on the
  // document root so the CirclePanel overlay can anchor its left edge
  // flush against the rail (margin-left: var(--sidebar-width)).
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
  }, [width]);

  return (
    <>
    {/* Fixed-width slot that holds the rail's place in the flex row. The
        real rail renders as a fixed overlay next to it, so hover-expanding
        72→264 never changes the flow width — the old in-flow width spring
        re-laid-out <main> on every frame (the map canvas visibly resized). */}
    <div style={{ width: SIDEBAR_COLLAPSED_WIDTH }} className="flex-shrink-0" aria-hidden />
    <motion.aside
      animate={{ width }}
      transition={{ type: 'spring', damping: 28, stiffness: 280, mass: 0.9 }}
      onMouseEnter={onAsideMouseEnter}
      onMouseLeave={onAsideMouseLeave}
      className={cn(
        'fixed left-0 top-0 h-screen border-r border-on-surface/[0.07] bg-surface',
        // Above page chrome (sticky headers cap at z-40 — SearchMain's
        // translucent header was punching through the expanded rail) but
        // below full-screen overlays and sheets (z-50+).
        'flex flex-col z-[45] transition-shadow duration-200',
        // Expanded, the rail floats OVER the page content — the shadow
        // sells the overlay so it doesn't read as content being shoved.
        !collapsed && 'shadow-[12px_0_32px_-16px_rgba(0,0,0,0.28)]',
      )}
      aria-label="Primary"
    >
      {/* ── Header: logo + brand + collapse toggle ─────────────────────── */}
      <div className={cn(
        'flex items-center pt-5 pb-4 gap-3',
        collapsed ? 'flex-col gap-2 px-3' : 'px-5',
      )}>
        <div className={cn('flex items-center gap-3 min-w-0', !collapsed && 'flex-1')}>
          <Logo size={36} className="text-primary flex-shrink-0" />
          {!collapsed && (
            <h1 className="font-serif font-bold text-[17px] text-on-surface leading-tight truncate">
              GoodEats
            </h1>
          )}
        </div>
      </div>

      <div className="border-t border-on-surface/[0.06] mx-3" />

      {/* ── Create CTA — single red button that opens a small menu with
              Post, Guide and Recipe choices. */}
      <div ref={createWrapRef} className={cn('relative px-3 pt-4 pb-3', collapsed && 'px-2')}>
        {/* Hidden media input for the unified Post entry — lives outside
            the AnimatePresence menu so it survives the menu closing. */}
        {pickerInput}
        <button
          type="button"
          onClick={() => setCreateMenuOpen((o) => !o)}
          aria-haspopup="menu"
          aria-expanded={createMenuOpen}
          aria-label="Create"
          title={collapsed ? 'Create' : undefined}
          className={cn(
            'w-full bg-primary text-on-primary rounded-full font-semibold text-sm',
            'flex items-center justify-center gap-2',
            'shadow-sm hover:bg-primary/90 active:scale-[0.99] transition-all',
            collapsed ? 'h-11 px-0' : 'h-11 px-4',
          )}
        >
          <Plus
            size={18}
            strokeWidth={2.5}
            className={cn('transition-transform duration-200', createMenuOpen && 'rotate-45')}
          />
          {!collapsed && <span>Create</span>}
        </button>

        <AnimatePresence>
          {createMenuOpen && (
            <motion.div
              role="menu"
              initial={{ opacity: 0, y: -4, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.97 }}
              transition={{ duration: 0.14, ease: 'easeOut' }}
              className={cn(
                'absolute z-40 rounded-2xl bg-surface border border-on-surface/[0.08] shadow-xl overflow-hidden',
                collapsed
                  ? 'left-full top-2 ml-2 min-w-[200px]'
                  : 'left-3 right-3 top-[calc(100%-0.25rem)]',
              )}
            >
              {/* Page-contextual quick add — the removed top bar's "Add
                  Rating" CTA. Pantry/RecipesForYou override the label and
                  action for their current view; default rates a new
                  restaurant via the full search page. */}
              {!addAction?.hidden && (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setCreateMenuOpen(false);
                      if (addAction) addAction.onClick();
                      else navigate('/search/main');
                    }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
                  >
                    <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                      <Star size={16} strokeWidth={2.2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold leading-tight">{addAction?.label ?? 'Add Rating'}</span>
                      <span className="block text-[12px] text-on-surface/50 leading-tight">
                        {(addAction?.label ?? 'Add Rating').toLowerCase().includes('recipe')
                          ? 'Log a recipe you cooked'
                          : 'Search & rate a restaurant'}
                      </span>
                    </span>
                  </button>
                  <div className="border-t border-on-surface/[0.06]" />
                </>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => { setCreateMenuOpen(false); openUnifiedPicker(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
              >
                <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <ImageIcon size={16} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold leading-tight">Post</span>
                  <span className="block text-[12px] text-on-surface/50 leading-tight">Photos or a video — one video posts as a reel</span>
                </span>
              </button>
              <div className="border-t border-on-surface/[0.06]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { setCreateMenuOpen(false); openGuideCreator(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
              >
                <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <BookOpen size={16} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold leading-tight">Guide</span>
                  <span className="block text-[12px] text-on-surface/50 leading-tight">Curated restaurants or recipes</span>
                </span>
              </button>
              <div className="border-t border-on-surface/[0.06]" />
              <button
                type="button"
                role="menuitem"
                onClick={() => { setCreateMenuOpen(false); openHomeMealModal(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-on-surface/[0.05] text-left"
              >
                <span className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <ChefHat size={16} strokeWidth={2.2} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold leading-tight">Recipe</span>
                  <span className="block text-[12px] text-on-surface/50 leading-tight">Cook from home — ingredients &amp; steps</span>
                </span>
              </button>
            </motion.div>
          )}
        </AnimatePresence>
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

          {/* Search — the full search surface (restaurants, recipes,
              friends). Replaces the search input that lived in the old
              desktop top bar. */}
          <li>
            <NavLink to="/search/main" className={navRowClass(isSearchActive)} title={collapsed ? 'Search' : undefined}>
              <Search size={20} strokeWidth={isSearchActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isSearchActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Search</span>}
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

          {/* Pantry — single nav row. Restaurants/Recipes tabs and
              per-tab list management live on the page itself. */}
          <li>
            <NavLink to="/pantry" className={navRowClass(isPantryActive)} title={collapsed ? 'Pantry' : undefined}>
              <Bookmark size={20} strokeWidth={isPantryActive ? 2.4 : 1.9} className={cn('flex-shrink-0', isPantryActive ? 'text-on-surface' : 'text-on-surface/65')} />
              {!collapsed && <span className="truncate">Pantry</span>}
            </NavLink>
          </li>

          {/* Circle — opens a slide-out panel next to the sidebar
              instead of navigating to a separate page. */}
          <li>
            <button
              type="button"
              onClick={toggleCircle}
              className={cn(
                navRowClass(circleOpen || isCircleActive),
                'w-full text-left',
              )}
              title={collapsed ? 'Circle' : undefined}
            >
              <span className="relative flex-shrink-0">
                <Users size={20} strokeWidth={(circleOpen || isCircleActive) ? 2.4 : 1.9} className={cn((circleOpen || isCircleActive) ? 'text-on-surface' : 'text-on-surface/65')} />
                {circleBadge > 0 && (
                  <span className={cn(
                    'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-surface',
                    // A waiting friend request is the more urgent of the two.
                    pendingRequestCount > 0 ? 'bg-red-500' : 'bg-primary',
                  )}>
                    {circleBadge > 9 ? '9+' : circleBadge}
                  </span>
                )}
              </span>
              {!collapsed && (
                <>
                  <span className="truncate flex-1 text-left">Circle</span>
                  {circleBadge > 0 && (
                    <span className={cn(
                      'text-[11px] font-bold tabular-nums',
                      pendingRequestCount > 0 ? 'text-red-500' : 'text-primary',
                    )}>
                      {circleBadge}
                    </span>
                  )}
                </>
              )}
            </button>
          </li>

          {/* Messages */}
          <li>
            <NavLink to="/messages" className={navRowClass(isMessagesActive)} title={collapsed ? 'Messages' : undefined}>
              <span className="relative flex-shrink-0">
                <MessageCircle size={20} strokeWidth={isMessagesActive ? 2.4 : 1.9} className={cn(isMessagesActive ? 'text-on-surface' : 'text-on-surface/65')} />
                {unreadCount > 0 && (
                  <span
                    className={cn(
                      'absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-on-primary text-[10px] font-bold',
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
          <div className="w-9 h-9 rounded-full bg-secondary text-on-primary flex items-center justify-center font-serif font-bold text-sm flex-shrink-0">
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
      </div>
    </motion.aside>
    </>
  );
};
